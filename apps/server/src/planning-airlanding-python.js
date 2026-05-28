import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_PROJECT_ROOT = path.resolve(__dirname, '../planning-python');
const AIRLANDING_ROOT = path.join(PYTHON_PROJECT_ROOT, 'airlanding_zone');
const AIRLANDING_SCRIPT = path.join(AIRLANDING_ROOT, 'main.py');
const APP_ROOT = path.resolve(__dirname, '../..');

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function emitProgress(onProgress, event = {}) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress({
      emittedAt: new Date().toISOString(),
      ...event,
    });
  } catch {
    // Python progress is best-effort and should never interrupt planning.
  }
}

function splitLogLines(chunkText = '') {
  return String(chunkText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveEnvText(keys = [], fallback = '') {
  for (const key of safeArray(keys)) {
    const value = safeText(process.env[key]);
    if (value) return value;
  }
  return fallback;
}

function resolvePythonBin() {
  return resolveEnvText(['PLANNING_AIRLANDING_PYTHON_BIN', 'PLANNING_THREAT_PYTHON_BIN', 'PYTHON_BIN'], 'python3');
}

async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTerrainRoot(payload = {}) {
  const options = safeObject(payload.options);
  const candidates = [
    safeText(payload.terrain_root),
    safeText(options.terrainRoot),
    safeText(process.env.PLANNING_TERRAIN_ROOT),
    safeText(process.env.AIRLANDING_TERRAIN_ROOT),
    path.join(APP_ROOT, 'web', 'terrain'),
    path.join(APP_ROOT, 'web', 'pubulic', 'terrain'),
    path.join(APP_ROOT, 'web', 'public', 'terrain'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const terrainRoot = path.resolve(candidate);
    if (await ensureFileExists(path.join(terrainRoot, 'layer.json'))) {
      return terrainRoot;
    }
  }

  throw new Error(`未找到可用离线 terrain/layer.json，已检查：${candidates.map((item) => path.resolve(item)).join(' / ')}`);
}

async function runPythonJsonScript(scriptPath, args = [], envPatch = {}, options = {}) {
  const pythonBin = resolvePythonBin();
  const timeoutMs = Number(process.env.PLANNING_AIRLANDING_PYTHON_TIMEOUT_MS || options.timeoutMs || 600000);
  const phase = safeText(options.phase, 'airlanding-python');
  const title = safeText(options.title, path.basename(scriptPath));
  const onProgress = options.onProgress;

  return new Promise((resolve, reject) => {
    emitProgress(onProgress, {
      phase: `${phase}:start`,
      channel: 'process',
      level: 'info',
      title,
      message: `启动 Python 子进程：${path.basename(scriptPath)}`,
    });

    const child = spawn(pythonBin, [scriptPath, ...args], {
      cwd: AIRLANDING_ROOT,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONPATH: [
          PYTHON_PROJECT_ROOT,
          AIRLANDING_ROOT,
          process.env.PYTHONPATH || '',
        ].filter(Boolean).join(path.delimiter),
        ...envPatch,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`Python 智能机降算法执行超时（${timeoutMs}ms）`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      const chunkText = chunk.toString('utf8');
      stderr += chunkText;
      if (chunkText) {
        emitProgress(onProgress, {
          phase: `${phase}:stream`,
          channel: 'terminal',
          level: 'info',
          title,
          message: chunkText,
        });
      }
      for (const line of splitLogLines(chunkText)) {
        emitProgress(onProgress, {
          phase: `${phase}:log`,
          channel: 'process',
          level: 'info',
          title,
          message: line,
        });
      }
    });

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const output = safeText(stdout);
      let parsed = null;
      try {
        parsed = output ? JSON.parse(output) : null;
      } catch {
        parsed = null;
      }

      if (code !== 0) {
        const message = safeText(parsed?.error || stderr || output, '无可用错误信息');
        emitProgress(onProgress, {
          phase: `${phase}:failed`,
          channel: 'terminal',
          level: 'error',
          title,
          message: `${message}\n`,
        });
        reject(new Error(`Python 智能机降算法退出异常（code=${code}）：${message}`));
        return;
      }

      if (!parsed || parsed.error) {
        const message = safeText(parsed?.error || stderr || output, 'Python 智能机降算法未返回有效 JSON 结果。');
        emitProgress(onProgress, {
          phase: `${phase}:failed`,
          channel: 'terminal',
          level: 'error',
          title,
          message: `${message}\n`,
        });
        reject(new Error(message));
        return;
      }

      emitProgress(onProgress, {
        phase: `${phase}:complete`,
        channel: 'process',
        level: 'success',
        title,
        message: `${path.basename(scriptPath)} 执行完成。`,
      });
      resolve(parsed);
    });
  });
}

export async function runAirlandingPythonPipeline({
  payload = {},
  onProgress = null,
  timeoutMs = 600000,
} = {}) {
  const processEvents = [];
  const emit = (event = {}) => {
    const normalized = {
      emittedAt: new Date().toISOString(),
      ...event,
    };
    processEvents.push(normalized);
    emitProgress(onProgress, normalized);
  };

  if (!await ensureFileExists(AIRLANDING_SCRIPT)) {
    throw new Error('未找到已集成的 Python 智能机降算法脚本。');
  }

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-airlanding-'));

  try {
    emit({
      phase: 'airlanding-input:start',
      channel: 'process',
      level: 'info',
      title: '智能机降算法',
      message: '正在整理机降需求、威胁目标和系统离线 terrain 输入。',
    });

    const terrainRoot = await resolveTerrainRoot(payload);
    const inputPayload = {
      ...safeObject(payload),
      terrain_root: terrainRoot,
    };
    const inputPath = path.join(workspaceDir, 'airlanding-input.json');
    await fs.writeFile(inputPath, JSON.stringify(inputPayload, null, 2), 'utf8');

    emit({
      phase: 'airlanding-input:complete',
      channel: 'process',
      level: 'success',
      title: '智能机降输入已生成',
      message: `已接入离线 terrain ${path.basename(terrainRoot)}，目标 ${safeArray(inputPayload.targets).length} 个。`,
      data: {
        terrainRoot,
        targetCount: safeArray(inputPayload.targets).length,
      },
    });

    const pipeline = await runPythonJsonScript(AIRLANDING_SCRIPT, [inputPath], {
      AIRLANDING_DEM_PROVIDER: 'local_cesium_terrain',
      PLANNING_TERRAIN_ROOT: terrainRoot,
    }, {
      phase: 'airlanding-python',
      title: '智能机降算法',
      onProgress: emit,
      timeoutMs,
    });

    emit({
      phase: 'airlanding-output:complete',
      channel: 'output',
      level: 'success',
      title: '智能机降算法输出完成',
      message: `输出候选 ${Number(pipeline.candidate_count || safeArray(pipeline.candidates).length || 0)} 个，优选机降区 ${safeArray(pipeline.zones).length} 个。`,
      data: {
        candidateCount: Number(pipeline.candidate_count || 0),
        zoneCount: safeArray(pipeline.zones).length,
      },
    });

    return {
      pipeline,
      processEvents,
      integrationMeta: {
        runtime: 'python-subprocess',
        pythonBin: resolvePythonBin(),
        projectRoot: PYTHON_PROJECT_ROOT,
        scriptPath: AIRLANDING_SCRIPT,
        terrainRoot,
      },
    };
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
}
