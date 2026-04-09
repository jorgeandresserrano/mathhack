import './style.css';

type PlatformId = 'macos' | 'windows';

type DownloadArtifact = {
  label: string;
  url: string;
  size?: string;
};

type ReleaseManifest = {
  latestVersion: string | null;
  publishedAt: string | null;
  notes: string;
  downloads: Record<PlatformId, DownloadArtifact | null>;
};

const DEFAULT_MANIFEST: ReleaseManifest = {
  latestVersion: null,
  publishedAt: null,
  notes: 'Desktop downloads will appear here once signed installers are ready.',
  downloads: {
    macos: null,
    windows: null,
  },
};

const PLATFORM_LABELS: Record<PlatformId, string> = {
  macos: 'macOS',
  windows: 'Windows',
};

function detectPlatform(): PlatformId | null {
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('mac')) {
    return 'macos';
  }

  if (userAgent.includes('win')) {
    return 'windows';
  }

  return null;
}

function formatPublishedAt(publishedAt: string | null): string {
  if (!publishedAt) {
    return 'Not published yet';
  }

  const date = new Date(publishedAt);

  if (Number.isNaN(date.getTime())) {
    return 'Pending release date';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(date);
}

async function loadManifest(): Promise<ReleaseManifest> {
  try {
    const response = await fetch('/releases.json', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Unexpected status: ${response.status}`);
    }

    const data = (await response.json()) as Partial<ReleaseManifest>;

    return {
      latestVersion: data.latestVersion ?? DEFAULT_MANIFEST.latestVersion,
      publishedAt: data.publishedAt ?? DEFAULT_MANIFEST.publishedAt,
      notes: data.notes ?? DEFAULT_MANIFEST.notes,
      downloads: {
        macos: data.downloads?.macos ?? DEFAULT_MANIFEST.downloads.macos,
        windows: data.downloads?.windows ?? DEFAULT_MANIFEST.downloads.windows,
      },
    };
  } catch {
    return DEFAULT_MANIFEST;
  }
}

function createDownloadCard(
  platform: PlatformId,
  artifact: DownloadArtifact | null,
  isRecommended: boolean,
): HTMLElement {
  const article = document.createElement('article');
  article.className = 'download-card';

  if (isRecommended) {
    article.dataset.recommended = 'true';
  }

  const heading = document.createElement('h2');
  heading.textContent = PLATFORM_LABELS[platform];
  article.append(heading);

  const caption = document.createElement('p');
  caption.className = 'download-card__caption';
  caption.textContent = artifact
    ? artifact.label
    : 'Installer will be published with the first desktop release.';
  article.append(caption);

  if (isRecommended) {
    const badge = document.createElement('p');
    badge.className = 'download-card__badge';
    badge.textContent = 'Recommended for this device';
    article.append(badge);
  }

  const action = document.createElement(artifact ? 'a' : 'span');
  action.className = 'download-card__button';
  action.textContent = artifact ? `Download for ${PLATFORM_LABELS[platform]}` : 'Coming soon';

  if (artifact) {
    action.setAttribute('href', artifact.url);
  } else {
    action.setAttribute('aria-disabled', 'true');
  }

  article.append(action);

  if (artifact?.size) {
    const metadata = document.createElement('p');
    metadata.className = 'download-card__meta';
    metadata.textContent = artifact.size;
    article.append(metadata);
  }

  return article;
}

function renderPage(manifest: ReleaseManifest): void {
  const app = document.querySelector<HTMLDivElement>('#app');

  if (!app) {
    throw new Error('Expected app container to exist.');
  }

  const recommendedPlatform = detectPlatform();
  const version = manifest.latestVersion ? `v${manifest.latestVersion}` : 'No public release yet';
  const publishedAt = formatPublishedAt(manifest.publishedAt);

  app.replaceChildren();

  const page = document.createElement('main');
  page.className = 'page';

  const hero = document.createElement('section');
  hero.className = 'hero';
  hero.innerHTML = `
    <p class="eyebrow">MathHack</p>
    <h1>A focused desktop worksheet for structured math work.</h1>
  `;
  page.append(hero);

  const status = document.createElement('section');
  status.className = 'status-panel';
  const latestRelease = document.createElement('div');
  const latestReleaseLabel = document.createElement('p');
  latestReleaseLabel.className = 'status-panel__label';
  latestReleaseLabel.textContent = 'Latest release';
  const latestReleaseValue = document.createElement('p');
  latestReleaseValue.className = 'status-panel__value';
  latestReleaseValue.textContent = version;
  latestRelease.append(latestReleaseLabel, latestReleaseValue);

  const publishDate = document.createElement('div');
  const publishDateLabel = document.createElement('p');
  publishDateLabel.className = 'status-panel__label';
  publishDateLabel.textContent = 'Published';
  const publishDateValue = document.createElement('p');
  publishDateValue.className = 'status-panel__value';
  publishDateValue.textContent = publishedAt;
  publishDate.append(publishDateLabel, publishDateValue);

  status.append(latestRelease, publishDate);
  page.append(status);

  const downloads = document.createElement('section');
  downloads.className = 'download-grid';
  downloads.append(
    createDownloadCard(
      'macos',
      manifest.downloads.macos,
      recommendedPlatform === 'macos',
    ),
    createDownloadCard(
      'windows',
      manifest.downloads.windows,
      recommendedPlatform === 'windows',
    ),
  );
  page.append(downloads);

  const notes = document.createElement('section');
  notes.className = 'notes';
  const notesLabel = document.createElement('p');
  notesLabel.className = 'notes__label';
  notesLabel.textContent = 'Release notes';
  const notesBody = document.createElement('p');
  notesBody.className = 'notes__body';
  notesBody.textContent = manifest.notes;
  notes.append(notesLabel, notesBody);
  page.append(notes);

  const footer = document.createElement('footer');
  footer.className = 'footer';
  const contactDetails = document.createElement('p');
  contactDetails.className = 'footer__line';
  contactDetails.append('Jorge Andres Serrano Ardila - ');

  const emailLink = document.createElement('a');
  emailLink.className = 'footer__link';
  emailLink.href = 'mailto:jorgeandres.serrano@gmail.com';
  emailLink.textContent = 'jorgeandres.serrano@gmail.com';
  contactDetails.append(emailLink);

  footer.append(contactDetails);
  page.append(footer);

  app.append(page);
}

void loadManifest().then(renderPage);
