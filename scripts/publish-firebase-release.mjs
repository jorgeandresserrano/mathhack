import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Storage } from '@google-cloud/storage';

const DEFAULT_ARTIFACT_DIRECTORY = 'apps/desktop/release';
const DEFAULT_RELEASE_NOTES =
  'Desktop downloads are now available for the latest MathHack build.';
const IGNORED_ARTIFACT_FILENAMES = new Set([
  'builder-debug.yml',
  'builder-effective-config.yaml',
]);
const SITE_MANIFEST_PATH = path.resolve('apps/site/public/releases.json');
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
  '.dmg',
  '.zip',
  '.exe',
  '.yml',
  '.yaml',
  '.blockmap',
]);

const DOWNLOAD_PREFERENCES = {
  macos: ['.dmg', '.zip'],
  windows: ['.exe'],
};

const CONTENT_TYPES = new Map([
  ['.blockmap', 'application/octet-stream'],
  ['.dmg', 'application/x-apple-diskimage'],
  ['.exe', 'application/vnd.microsoft.portable-executable'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.zip', 'application/zip'],
]);

function parseArguments(argv) {
  const options = {
    artifactDirectories: [],
    bucket: process.env.FIREBASE_STORAGE_BUCKET || null,
    dryRun: false,
    manifestOut: null,
    notes: process.env.RELEASE_NOTES ?? null,
    publishedAt: process.env.RELEASE_PUBLISHED_AT ?? null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case '--artifact-dir':
        options.artifactDirectories.push(argv[index + 1]);
        index += 1;
        break;
      case '--bucket':
        options.bucket = argv[index + 1];
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--manifest-out':
        options.manifestOut = argv[index + 1];
        index += 1;
        break;
      case '--notes':
        options.notes = argv[index + 1];
        index += 1;
        break;
      case '--notes-file':
        options.notesFile = argv[index + 1];
        index += 1;
        break;
      case '--published-at':
        options.publishedAt = argv[index + 1];
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.artifactDirectories.length === 0) {
    options.artifactDirectories.push(DEFAULT_ARTIFACT_DIRECTORY);
  }

  return options;
}

async function readJson(filePath) {
  const rawContent = await fs.readFile(filePath, 'utf8');
  return JSON.parse(rawContent);
}

async function readProjectId() {
  const firebaseConfig = await readJson(path.resolve('.firebaserc'));
  const projectId = firebaseConfig.projects?.default;

  if (!projectId) {
    throw new Error('Missing default Firebase project in .firebaserc.');
  }

  return projectId;
}

async function readReleaseVersion() {
  const desktopPackage = await readJson(path.resolve('apps/desktop/package.json'));
  const version = desktopPackage.version;

  if (!version) {
    throw new Error('Missing version in apps/desktop/package.json.');
  }

  return version;
}

async function resolveReleaseNotes(options) {
  if (options.notesFile) {
    return (await fs.readFile(path.resolve(options.notesFile), 'utf8')).trim();
  }

  if (options.notes) {
    return options.notes.trim();
  }

  return DEFAULT_RELEASE_NOTES;
}

function resolvePublishedAt(publishedAt) {
  if (!publishedAt) {
    return new Date().toISOString();
  }

  const parsedDate = new Date(publishedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid published date: ${publishedAt}`);
  }

  return parsedDate.toISOString();
}

async function listFiles(directoryPath) {
  const directoryEntries = await fs.readdir(directoryPath, {
    withFileTypes: true,
  });

  const collectedFiles = [];

  for (const entry of directoryEntries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      collectedFiles.push(...(await listFiles(entryPath)));
      continue;
    }

    collectedFiles.push(entryPath);
  }

  return collectedFiles;
}

function inferPlatform(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const normalizedPath = filePath.toLowerCase();

  if (extension === '.exe') {
    return 'windows';
  }

  if (extension === '.dmg') {
    return 'macos';
  }

  if (extension === '.zip' && !normalizedPath.includes('win')) {
    return 'macos';
  }

  return null;
}

function getContentType(filePath) {
  return (
    CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ??
    'application/octet-stream'
  );
}

async function calculateSha256(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

function toFirebaseDownloadUrl(bucketName, objectPath) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    objectPath,
  )}?alt=media`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectPreferredArtifact(candidates, platform) {
  for (const extension of DOWNLOAD_PREFERENCES[platform]) {
    const match = candidates.find((candidate) => candidate.extension === extension);

    if (match) {
      return match;
    }
  }

  return null;
}

async function collectReleaseArtifacts(artifactDirectories) {
  const collectedArtifacts = [];
  const seenFileNames = new Set();

  for (const artifactDirectory of artifactDirectories) {
    const absoluteDirectoryPath = path.resolve(artifactDirectory);
    const filePaths = await listFiles(absoluteDirectoryPath);

    for (const filePath of filePaths) {
      const extension = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);

      if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
        continue;
      }

      if (IGNORED_ARTIFACT_FILENAMES.has(fileName)) {
        continue;
      }

      const fileStats = await fs.stat(filePath);

      if (!fileStats.isFile()) {
        continue;
      }

      if (seenFileNames.has(fileName)) {
        throw new Error(`Duplicate artifact filename detected: ${fileName}`);
      }

      seenFileNames.add(fileName);

      collectedArtifacts.push({
        extension,
        fileName,
        filePath,
        platform: inferPlatform(filePath),
        sha256: await calculateSha256(filePath),
        size: fileStats.size,
      });
    }
  }

  if (collectedArtifacts.length === 0) {
    throw new Error(
      `No release artifacts found in: ${artifactDirectories.join(', ')}`,
    );
  }

  return collectedArtifacts;
}

async function uploadArtifacts(storage, bucketName, version, artifacts) {
  const bucket = storage.bucket(bucketName);
  const uploadedArtifacts = [];

  for (const artifact of artifacts) {
    const destinationPath = path.posix.join(
      'releases',
      version,
      artifact.fileName,
    );

    await bucket.upload(artifact.filePath, {
      destination: destinationPath,
      metadata: {
        cacheControl: 'public,max-age=31536000,immutable',
        contentType: getContentType(artifact.filePath),
        metadata: {
          sha256: artifact.sha256,
        },
      },
    });

    uploadedArtifacts.push({
      ...artifact,
      destinationPath,
      url: toFirebaseDownloadUrl(bucketName, destinationPath),
    });
  }

  return uploadedArtifacts;
}

function buildDryRunArtifacts(bucketName, version, artifacts) {
  return artifacts.map((artifact) => {
    const destinationPath = path.posix.join(
      'releases',
      version,
      artifact.fileName,
    );

    return {
      ...artifact,
      destinationPath,
      url: toFirebaseDownloadUrl(bucketName, destinationPath),
    };
  });
}

function buildManifest(version, publishedAt, notes, uploadedArtifacts) {
  const macCandidates = uploadedArtifacts.filter(
    (artifact) => artifact.platform === 'macos',
  );
  const windowsCandidates = uploadedArtifacts.filter(
    (artifact) => artifact.platform === 'windows',
  );

  const selectedMacArtifact = selectPreferredArtifact(macCandidates, 'macos');
  const selectedWindowsArtifact = selectPreferredArtifact(
    windowsCandidates,
    'windows',
  );

  return {
    latestVersion: version,
    publishedAt,
    notes,
    downloads: {
      macos: selectedMacArtifact
        ? {
            label: selectedMacArtifact.fileName,
            size: formatSize(selectedMacArtifact.size),
            url: selectedMacArtifact.url,
          }
        : null,
      windows: selectedWindowsArtifact
        ? {
            label: selectedWindowsArtifact.fileName,
            size: formatSize(selectedWindowsArtifact.size),
            url: selectedWindowsArtifact.url,
          }
        : null,
    },
  };
}

async function writeSiteManifest(manifest) {
  await fs.mkdir(path.dirname(SITE_MANIFEST_PATH), {
    recursive: true,
  });
  await fs.writeFile(
    SITE_MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

async function writeManifest(filePath, manifest) {
  const absolutePath = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolutePath), {
    recursive: true,
  });
  await fs.writeFile(
    absolutePath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

async function uploadStorageManifest(storage, bucketName, manifest, version) {
  const bucket = storage.bucket(bucketName);
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestDestinations = [
    path.posix.join('releases', 'releases.json'),
    path.posix.join('releases', version, 'releases.json'),
  ];

  for (const destination of manifestDestinations) {
    const file = bucket.file(destination);
    await file.save(manifestBody, {
      metadata: {
        cacheControl: 'no-store',
        contentType: 'application/json; charset=utf-8',
      },
    });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const projectId = await readProjectId();
  const version = await readReleaseVersion();
  const notes = await resolveReleaseNotes(options);
  const publishedAt = resolvePublishedAt(options.publishedAt);
  const bucketName = options.bucket || `${projectId}.firebasestorage.app`;
  const artifacts = await collectReleaseArtifacts(options.artifactDirectories);
  const uploadedArtifacts = options.dryRun
    ? buildDryRunArtifacts(bucketName, version, artifacts)
    : await uploadArtifacts(
        new Storage({
          projectId,
        }),
        bucketName,
        version,
        artifacts,
      );
  const manifest = buildManifest(version, publishedAt, notes, uploadedArtifacts);

  if (options.dryRun) {
    if (options.manifestOut) {
      await writeManifest(options.manifestOut, manifest);
      process.stdout.write(`Wrote dry-run manifest to ${path.resolve(options.manifestOut)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    }

    process.stdout.write('Dry run only: skipped Firebase Storage uploads.\n');
    return;
  }

  const storage = new Storage({
    projectId,
  });

  await writeSiteManifest(manifest);
  await uploadStorageManifest(storage, bucketName, manifest, version);

  process.stdout.write(
    `Published ${uploadedArtifacts.length} files to gs://${bucketName}/releases/${version}\n`,
  );
  process.stdout.write(`Updated ${SITE_MANIFEST_PATH}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
