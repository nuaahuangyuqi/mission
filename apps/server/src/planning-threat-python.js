import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_PROJECT_ROOT = path.resolve(__dirname, '../planning-python');
const THEAT_ANALYZE_ROOT = path.join(PYTHON_PROJECT_ROOT, 'theat_analyze');
const ANALYZE_SCRIPT = path.join(THEAT_ANALYZE_ROOT, 'analyze.py');
const GENERATE_ASSESSMENT_SCRIPT = path.join(THEAT_ANALYZE_ROOT, 'generate_assessment.py');

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
    // Progress reporting must never interrupt the planning pipeline.
  }
}

function splitLogLines(chunkText = '') {
  return String(chunkText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sanitizeFilePart(value, fallback = 'document') {
  const normalized = safeText(value, fallback)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
}

function resolveEnvText(keys = [], fallback = '') {
  for (const key of safeArray(keys)) {
    const value = safeText(process.env[key]);
    if (value) return value;
  }
  return fallback;
}

function resolveIntegrationMode() {
  const mode = resolveEnvText(['PLANNING_THREAT_PYTHON_MODE'], 'auto').toLowerCase();
  if (['off', 'auto', 'required'].includes(mode)) {
    return mode;
  }
  return 'auto';
}

function resolvePythonBin() {
  return resolveEnvText(['PLANNING_THREAT_PYTHON_BIN', 'PYTHON_BIN'], 'python3');
}

function resolveAnalyzeEnv(llmConfig = {}) {
  const config = safeObject(llmConfig);
  return {
    pythonBin: resolvePythonBin(),
    model: safeText(config.analysisModel) || resolveEnvText(['THREAT_ANALYSIS_LLM_MODEL', 'TV20_LLM_MODEL'], 'qwen-flash'),
    apiKey: safeText(config.apiKey) || resolveEnvText(
      ['THREAT_ANALYSIS_OPENAI_API_KEY', 'TV20_OPENAI_API_KEY', 'DASHSCOPE_API_KEY'],
      '',
    ),
    baseUrl: safeText(config.baseUrl) || resolveEnvText(['THREAT_ANALYSIS_OPENAI_BASE_URL', 'TV20_OPENAI_BASE_URL'], ''),
  };
}

function resolveAssessmentEnv(llmConfig = {}) {
  const config = safeObject(llmConfig);
  return {
    model: safeText(config.assessmentModel) || resolveEnvText(['THREAT_ASSESSMENT_LLM_MODEL', 'TV20_STAGE2_MODEL', 'THREAT_ANALYSIS_LLM_MODEL', 'TV20_LLM_MODEL'], 'qwen-plus'),
    apiKey: safeText(config.apiKey) || resolveEnvText(
      ['THREAT_ASSESSMENT_OPENAI_API_KEY', 'THREAT_ANALYSIS_OPENAI_API_KEY', 'TV20_OPENAI_API_KEY', 'DASHSCOPE_API_KEY'],
      '',
    ),
    baseUrl: safeText(config.baseUrl) || resolveEnvText(['THREAT_ASSESSMENT_OPENAI_BASE_URL', 'THREAT_ANALYSIS_OPENAI_BASE_URL', 'TV20_OPENAI_BASE_URL'], ''),
  };
}

function previewPayloadToText(preview = {}) {
  const payload = safeObject(preview.payload);

  if (preview.previewType === 'document') {
    return [
      payload.title,
      payload.description,
      payload.content,
      ...safeArray(payload.paragraphs),
    ].filter(Boolean).join('\n');
  }

  if (preview.previewType === 'workbook') {
    return safeArray(payload.sheets)
      .map((sheet) => [
        sheet.name,
        sheet.summary,
        ...safeArray(sheet.rows).slice(0, 10).map((row) => safeArray(row).join(' / ')),
      ].filter(Boolean).join('\n'))
      .join('\n\n');
  }

  if (preview.previewType === 'table') {
    return [
      safeArray(payload.columns).join(' / '),
      ...safeArray(payload.rows).slice(0, 12).map((row) => safeArray(row).join(' / ')),
    ].filter(Boolean).join('\n');
  }

  if (preview.previewType === 'json') {
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify(payload, null, 2);
}

function buildSourceDocumentText(sourceBundle = {}, source = {}) {
  const sourceId = Number(source.id);
  const previews = safeArray(sourceBundle.selectedPreviews).filter((item) => Number(item.sourceId) === sourceId);
  const extractions = safeArray(sourceBundle.selectedExtractions).filter((item) => Number(item.sourceId) === sourceId);
  const environment = safeArray(sourceBundle.selectedEnvironment).filter((item) => Number(item.sourceId) === sourceId);

  return [
    `数据源名称：${safeText(source.name, `资源 ${sourceId}`)}`,
    `数据源类型：${safeText(source.type, 'unknown')}`,
    `数据源说明：${safeText(source.description, '无')}`,
    '',
    ...previews.flatMap((item, index) => ([
      `===== 资源预览 ${index + 1} =====`,
      previewPayloadToText(item),
      '',
    ])),
    ...extractions.flatMap((item, index) => ([
      `===== 抽取结果 ${index + 1} =====`,
      safeText(item.title, `抽取 ${index + 1}`),
      safeText(item.summary),
      safeText(item.text),
      '',
    ])),
    ...environment.flatMap((item, index) => ([
      `===== 环境要素 ${index + 1} =====`,
      `名称：${safeText(item.name, `环境 ${index + 1}`)}`,
      `类型：${safeText(item.kind, safeText(item.type, 'unknown'))}`,
      `天气/描述：${safeText(item.weather, safeText(item.description, safeText(item.notes)))}`,
      '',
    ])),
  ].filter(Boolean).join('\n');
}

function buildIntelligenceDocumentText(redIntelligence = []) {
  const entries = safeArray(redIntelligence).map((item, index) => [
    `===== 敌情情报 ${index + 1} =====`,
    `名称：${safeText(item.name, `敌方节点 ${index + 1}`)}`,
    `类别：${safeText(item.category, 'unknown')}`,
    `角色：${safeText(item.role, 'unknown')}`,
    `位置：${Number(item.latitude || 0).toFixed(6)}, ${Number(item.longitude || 0).toFixed(6)}`,
    `强度：${safeText(item.strength, '0')}`,
    `战备：${safeText(item.readiness, 'unknown')}`,
    `标签：${safeArray(item.tags).join(' / ')}`,
    `备注：${safeText(item.notes, '无')}`,
    '',
  ].join('\n'));
  return entries.join('\n');
}

function buildUploadedText(normalizedFile = {}) {
  const drafts = safeArray(normalizedFile.extractionDrafts);
  if (!drafts.length) {
    return safeText(normalizedFile.summary);
  }

  return drafts.map((draft, index) => [
    `===== 文件片段 ${index + 1} =====`,
    safeText(draft.title, safeText(normalizedFile.fileName, `上传文件 ${index + 1}`)),
    safeText(draft.summary),
    safeText(draft.text),
    '',
  ].filter(Boolean).join('\n')).join('\n');
}

async function ensureFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeDocument(workspaceDir, fileName, content, encoding = 'utf8') {
  const targetPath = path.join(workspaceDir, sanitizeFilePart(fileName));
  await fs.writeFile(targetPath, content, encoding);
  return targetPath;
}

async function materializeInputFiles({
  workspaceDir,
  sourceBundle = {},
  redIntelligence = [],
  rawUploadedFiles = [],
  uploadedFiles = [],
}) {
  const documentPaths = [];
  const rawFilesById = new Map(safeArray(rawUploadedFiles).map((item) => [String(item.id || ''), item]));

  for (const source of safeArray(sourceBundle.selectedSources)) {
    const content = buildSourceDocumentText(sourceBundle, source);
    if (!safeText(content)) continue;
    documentPaths.push(await writeDocument(
      workspaceDir,
      `source-${sanitizeFilePart(source.name || source.id, `source-${source.id}`)}.txt`,
      content,
    ));
  }

  const intelligenceText = buildIntelligenceDocumentText(redIntelligence);
  if (safeText(intelligenceText)) {
    documentPaths.push(await writeDocument(workspaceDir, 'selected-red-intelligence.txt', intelligenceText));
  }

  for (const normalizedFile of safeArray(uploadedFiles)) {
    const fileId = String(normalizedFile.id || '');
    const rawFile = rawFilesById.get(fileId) || {};
    const fileName = safeText(normalizedFile.fileName || rawFile.fileName || rawFile.name, `upload-${documentPaths.length + 1}.txt`);
    const extension = safeText(normalizedFile.fileExtension || rawFile.fileExtension || path.extname(fileName)).toLowerCase();
    const originalBase64 = safeText(rawFile.fileContentBase64);

    if (originalBase64 && ['.docx', '.txt'].includes(extension)) {
      const targetPath = path.join(workspaceDir, sanitizeFilePart(fileName));
      await fs.writeFile(targetPath, Buffer.from(originalBase64, 'base64'));
      documentPaths.push(targetPath);
      continue;
    }

    const text = buildUploadedText(normalizedFile);
    if (!safeText(text)) continue;
    const targetName = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`;
    documentPaths.push(await writeDocument(workspaceDir, targetName, text));
  }

  return documentPaths;
}

async function runPythonJsonScript(scriptPath, args = [], envPatch = {}, options = {}) {
  const pythonBin = resolvePythonBin();
  const timeoutMs = Number(process.env.PLANNING_THREAT_PYTHON_TIMEOUT_MS || options.timeoutMs || 300000);
  const phase = safeText(options.phase, 'python-process');
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
      cwd: THEAT_ANALYZE_ROOT,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
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
      reject(new Error(`Python 威胁分析执行超时（${timeoutMs}ms）`));
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
        emitProgress(onProgress, {
          phase: `${phase}:failed`,
          channel: 'process',
          level: 'error',
          title,
          message: `Python 脚本退出异常（code=${code}）`,
        });
        reject(new Error(`Python 脚本退出异常（code=${code}）：${safeText(parsed?.error || stderr || output, '无可用错误信息')}`));
        return;
      }

      if (!parsed || parsed.error) {
        emitProgress(onProgress, {
          phase: `${phase}:failed`,
          channel: 'process',
          level: 'error',
          title,
          message: safeText(parsed?.error || stderr || output, 'Python 脚本未返回有效 JSON 结果。'),
        });
        reject(new Error(safeText(parsed?.error || stderr || output, 'Python 脚本未返回有效 JSON 结果。')));
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

export async function runThreatPythonPipeline({
  taskName = '',
  sourceBundle = {},
  redIntelligence = [],
  rawUploadedFiles = [],
  uploadedFiles = [],
  forceRequired = false,
  onProgress = null,
  llmConfig = {},
}) {
  const mode = forceRequired ? 'required' : resolveIntegrationMode();
  const processEvents = [];
  const emit = (event = {}) => {
    const normalized = {
      emittedAt: new Date().toISOString(),
      ...event,
    };
    processEvents.push(normalized);
    emitProgress(onProgress, normalized);
  };

  if (mode === 'off') {
    return null;
  }

  const analyzeEnv = resolveAnalyzeEnv(llmConfig);
  if (!analyzeEnv.apiKey) {
    if (mode === 'required') {
      throw new Error('未配置大模型 API Key，无法启用 Python 威胁分析集成。');
    }
    return null;
  }

  if (!analyzeEnv.baseUrl) {
    if (mode === 'required') {
      throw new Error('未配置大模型 Base URL，无法启用 Python 威胁分析集成。');
    }
    return null;
  }

  if (!await ensureFileExists(ANALYZE_SCRIPT) || !await ensureFileExists(GENERATE_ASSESSMENT_SCRIPT)) {
    if (mode === 'required') {
      throw new Error('未找到已集成的 Python 威胁分析脚本。');
    }
    return null;
  }

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mission-threat-analysis-'));

  try {
    emit({
      phase: 'python-input:start',
      channel: 'process',
      level: 'info',
      title: '大模型威胁分析',
      message: '正在整理资源库、敌情情报与本地上传文件。',
    });

    const inputDir = path.join(workspaceDir, 'inputs');
    const reportsDir = path.join(workspaceDir, 'reports');
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(reportsDir, { recursive: true });

    const documentPaths = await materializeInputFiles({
      workspaceDir: inputDir,
      sourceBundle,
      redIntelligence,
      rawUploadedFiles,
      uploadedFiles,
    });

    if (!documentPaths.length) {
      if (mode === 'required') {
        throw new Error('Python 威胁分析未生成任何可供解析的输入文档。');
      }
      return null;
    }

    emit({
      phase: 'python-input:complete',
      channel: 'process',
      level: 'success',
      title: '输入材料已生成',
      message: `已生成 ${documentPaths.length} 份 Python 管道输入文档。`,
      data: {
        inputDocumentCount: documentPaths.length,
      },
    });

    const pipeline = await runPythonJsonScript(ANALYZE_SCRIPT, documentPaths, {
      TV20_LLM_MODEL: analyzeEnv.model,
      TV20_OPENAI_API_KEY: analyzeEnv.apiKey,
      TV20_OPENAI_BASE_URL: analyzeEnv.baseUrl,
    }, {
      phase: 'python-stage-one',
      title: '阶段一：目标抽取与威胁场计算',
      onProgress: emit,
    });

    const stageOnePayload = {
      ...safeObject(pipeline),
      doc_paths: documentPaths,
    };
    const stageOnePath = path.join(workspaceDir, 'stage-one-result.json');
    await fs.writeFile(stageOnePath, JSON.stringify(stageOnePayload, null, 2), 'utf8');

    const assessmentEnv = resolveAssessmentEnv(llmConfig);
    let assessment = null;
    try {
      assessment = await runPythonJsonScript(GENERATE_ASSESSMENT_SCRIPT, [stageOnePath], {
        TV20_STAGE2_MODEL: assessmentEnv.model,
        TV20_OPENAI_API_KEY: assessmentEnv.apiKey,
        TV20_OPENAI_BASE_URL: assessmentEnv.baseUrl,
        TV20_STAGE2_OUTPUT_DIR: reportsDir,
      }, {
        phase: 'python-stage-two',
        title: '阶段二：敌情二次研判',
        onProgress: emit,
      });
    } catch (error) {
      if (mode === 'required') {
        throw error;
      }
      emit({
        phase: 'python-stage-two:skipped',
        channel: 'process',
        level: 'warning',
        title: '阶段二研判未完成',
        message: safeText(error?.message, '第二阶段未返回可用结果。'),
      });
    }

    let docxBase64 = '';
    let docxFileName = '';
    const docxPath = safeText(assessment?.assessment_docx_path);
    if (docxPath && await ensureFileExists(docxPath)) {
      docxBase64 = (await fs.readFile(docxPath)).toString('base64');
      docxFileName = path.basename(docxPath);
    }

    emit({
      phase: 'python-output:complete',
      channel: 'output',
      level: 'success',
      title: '大模型分析输出完成',
      message: `识别目标 ${safeArray(pipeline?.targets).length} 个，威胁评分 ${Number(pipeline?.total_score || 0).toFixed(1)}。`,
      data: {
        targetCount: safeArray(pipeline?.targets).length,
        totalScore: Number(pipeline?.total_score || 0),
        hasDocx: Boolean(docxBase64),
      },
    });

    return {
      mode,
      pipeline,
      assessment: safeObject(assessment),
      documentPaths,
      docxBase64,
      docxFileName,
      processEvents,
      integrationMeta: {
        runtime: 'python-subprocess',
        pythonBin: analyzeEnv.pythonBin,
        projectRoot: PYTHON_PROJECT_ROOT,
        llmModel: analyzeEnv.model,
        llmBaseUrl: analyzeEnv.baseUrl,
        stage2Model: assessmentEnv.model,
      },
      taskName: safeText(taskName),
    };
  } catch (error) {
    if (mode === 'required') {
      throw error;
    }
    return null;
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
}
