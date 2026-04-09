import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(repositoryRoot, 'apps/desktop');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    childProcess.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const desktopWorkspaceArgs = ['run', 'build', '--workspace', '@mathhack/desktop'];
  await run('npm', desktopWorkspaceArgs, {
    cwd: repositoryRoot,
  });

  const builderScript = 'node';
  const baseBuilderArgs = [
    resolve(repositoryRoot, 'scripts/run-electron-builder.mjs'),
    '--config',
    'electron-builder.yml',
    '--publish',
    'never',
  ];

  await run(builderScript, [...baseBuilderArgs, '--mac'], {
    cwd: desktopDirectory,
  });

  await run(builderScript, [...baseBuilderArgs, '--win', '--x64'], {
    cwd: desktopDirectory,
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
