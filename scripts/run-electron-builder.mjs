import { spawn } from 'node:child_process';
import process from 'node:process';

const SIGNING_ENVIRONMENT_VARIABLES = [
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'CSC_KEY_PASSWORD',
  'CSC_LINK',
  'CSC_NAME',
  'WIN_CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
];

function hasExplicitSigningConfiguration(environment) {
  return SIGNING_ENVIRONMENT_VARIABLES.some(
    (variableName) => Boolean(environment[variableName]),
  );
}

const environment = {
  ...process.env,
};

if (!hasExplicitSigningConfiguration(environment)) {
  environment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const childProcess = spawn(command, ['electron-builder', ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
});

childProcess.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
