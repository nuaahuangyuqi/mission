import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const webBuildDir = path.join(rootDir, 'apps', 'web', 'dist', 'client');
const webIndex = path.join(webBuildDir, 'index.html');
const isWin = process.platform === 'win32';
const forceWebBuild = process.env.MISSION_FORCE_WEB_BUILD === '1';

function runNpm(args) {
  if (isWin) {
    return spawnSync('cmd.exe', ['/c', 'npm', ...args], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawnSync('npm', args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
}

function spawnNpm(args) {
  if (isWin) {
    return spawn('cmd.exe', ['/c', 'npm', ...args], {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    });
  }

  return spawn('npm', args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
}

const hasWebBuild = fs.existsSync(webIndex);
const shouldBuildWeb = forceWebBuild || !hasWebBuild;

if (shouldBuildWeb) {
  console.log(
    forceWebBuild
      ? '[start] MISSION_FORCE_WEB_BUILD=1, rebuilding @mission/web before startup.'
      : '[start] Web build artifact is missing, building @mission/web before startup.',
  );

  const buildResult = runNpm(['run', 'build', '--workspace', '@mission/web']);
  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
} else {
  console.log('[start] Reusing existing web build artifact at apps/web/dist/client.');
}

const child = spawnNpm(['run', 'start', '--workspace', '@mission/server']);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
