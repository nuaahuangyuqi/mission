#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const algorithmsDir = path.dirname(fileURLToPath(import.meta.url));
const venvDir = path.join(algorithmsDir, '.venv');
const stampPath = path.join(venvDir, '.mission-requirements.json');
const bootstrapPython = process.env.PLANNING_PYTHON_BOOTSTRAP_BIN || process.env.PYTHON || 'python3';
const venvPython = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

const requirementFiles = [
  path.join(algorithmsDir, 'requirements.txt'),
  path.join(algorithmsDir, 'enemy-threat-analysis', 'requirements.txt'),
  path.join(algorithmsDir, 'force-grouping', 'requirements.txt'),
].filter((filePath) => fs.existsSync(filePath));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: algorithmsDir,
    env: process.env,
    stdio: options.stdio || 'inherit',
    encoding: 'utf-8',
  });
  if (result.error) {
    console.error(`[algorithms venv] ${command} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[algorithms venv] ${command} ${args.join(' ')} exited with ${result.status}`);
    process.exit(result.status || 1);
  }
  return result;
}

function requirementsSignature() {
  return requirementFiles.map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      file: path.relative(algorithmsDir, filePath),
      mtimeMs: Math.round(stat.mtimeMs),
      size: stat.size,
    };
  });
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf-8'));
  } catch {
    return null;
  }
}

function ensureVenv() {
  if (!fs.existsSync(venvPython)) {
    console.error(`[algorithms venv] creating virtual environment: ${venvDir}`);
    run(bootstrapPython, ['-m', 'venv', venvDir]);
  }

  const signature = requirementsSignature();
  const previous = readStamp();
  if (JSON.stringify(previous?.requirements || []) === JSON.stringify(signature)) {
    return;
  }

  if (requirementFiles.length) {
    console.error('[algorithms venv] installing Python dependencies');
    run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
    for (const requirementsPath of requirementFiles) {
      run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
    }
  }

  fs.writeFileSync(
    stampPath,
    JSON.stringify({ updatedAt: new Date().toISOString(), requirements: signature }, null, 2),
    'utf-8',
  );
}

ensureVenv();

const existingPythonPath = process.env.PYTHONPATH || '';
const algorithmPythonPaths = [
  algorithmsDir,
  path.join(algorithmsDir, 'enemy-threat-analysis'),
  path.join(algorithmsDir, 'force-grouping'),
  path.join(algorithmsDir, 'airlanding_zone'),
  existingPythonPath,
].filter(Boolean);

const child = spawnSync(venvPython, process.argv.slice(2), {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VIRTUAL_ENV: venvDir,
    PYTHONPATH: algorithmPythonPaths.join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    PATH: `${path.dirname(venvPython)}${path.delimiter}${process.env.PATH || ''}`,
  },
  stdio: 'inherit',
});

if (child.error) {
  console.error(`[algorithms venv] ${venvPython} failed to start: ${child.error.message}`);
  process.exit(1);
}
process.exit(child.status ?? 0);
