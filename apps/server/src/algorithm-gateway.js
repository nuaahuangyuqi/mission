const GATEWAY_CONTRACT_VERSION = 'algorithm-gateway-v1';
const DEFAULT_GATEWAY_TIMEOUT_MS = resolvePositiveInteger(process.env.ALGORITHM_GATEWAY_TIMEOUT_MS, 15000);
const DEFAULT_EXTERNAL_ALGORITHM_VERSION = 'unknown';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function cloneData(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function resolvePositiveInteger(value, fallback) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return Math.round(normalized);
}

function uniqueTextList(list = []) {
  const values = [];
  for (const item of safeArray(list)) {
    const text = safeText(item);
    if (text && !values.includes(text)) {
      values.push(text);
    }
  }
  return values;
}

function nowText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function truncateText(text, limit = 8000) {
  const source = String(text || '');
  if (source.length <= limit) {
    return source;
  }
  return `${source.slice(0, limit)}...(truncated)`;
}

function toJsonText(payload, limit = 8000) {
  if (payload === undefined) {
    return '';
  }
  try {
    return truncateText(JSON.stringify(payload), limit);
  } catch {
    return truncateText(String(payload || ''), limit);
  }
}

function readEnvText(key) {
  if (!key) return '';
  return safeText(process.env[key]);
}

function nextAlgorithmCallLogId(db) {
  const row = db.prepare('SELECT MAX(id) AS maxId FROM algorithm_call_logs').get();
  return Math.max(Number(row?.maxId || 0) + 1, 1);
}

export function createGatewayError({
  code = 'ALGORITHM_GATEWAY_FAILED',
  type = 'algorithm_failed',
  status = 502,
  message = '外部算法调用失败。',
  details = {},
} = {}) {
  const error = new Error(safeText(message, '外部算法调用失败。'));
  error.code = safeText(code, 'ALGORITHM_GATEWAY_FAILED');
  error.type = safeText(type, 'algorithm_failed');
  error.status = Number.isFinite(Number(status)) ? Number(status) : 502;
  error.details = safeObject(details);
  return error;
}

export function buildStandardEngineCatalog({
  moduleKey = '',
  builtin = {},
  externals = [],
} = {}) {
  const normalizedModuleKey = safeText(moduleKey);
  const builtinEngine = {
    key: safeText(builtin.key, 'builtin'),
    type: safeText(builtin.type, 'builtin'),
    label: safeText(builtin.label, '内置算法引擎'),
    description: safeText(builtin.description),
    status: 'active',
    source: 'builtin',
    runtime: safeText(builtin.runtime, 'node'),
    endpoint: '',
    version: safeText(builtin.version, '1.0.0'),
    timeoutMs: 0,
    contractVersion: GATEWAY_CONTRACT_VERSION,
    moduleKey: normalizedModuleKey,
    legacyKeys: uniqueTextList(['builtin', ...safeArray(builtin.legacyKeys)]),
  };

  const externalEngines = safeArray(externals).map((item) => {
    const endpoint = readEnvText(item.endpointEnv);
    const versionFromEnv = readEnvText(item.versionEnv);
    const timeoutFromEnv = item.timeoutEnv ? readEnvText(item.timeoutEnv) : '';
    const timeoutMs = resolvePositiveInteger(
      timeoutFromEnv || item.timeoutMs,
      DEFAULT_GATEWAY_TIMEOUT_MS,
    );
    const key = safeText(item.key, `${safeText(item.runtime, 'external')}-service`);
    const status = endpoint ? 'active' : safeText(item.defaultStatus, 'planned');

    return {
      key,
      type: safeText(item.type, 'external-model'),
      label: safeText(item.label, key),
      description: endpoint
        ? safeText(item.activeDescription, item.description)
        : safeText(item.plannedDescription, item.description),
      status,
      source: 'external',
      runtime: safeText(item.runtime, key),
      endpoint,
      version: versionFromEnv || safeText(item.version, DEFAULT_EXTERNAL_ALGORITHM_VERSION),
      timeoutMs,
      contractVersion: GATEWAY_CONTRACT_VERSION,
      moduleKey: normalizedModuleKey,
      legacyKeys: uniqueTextList([key, ...safeArray(item.legacyKeys)]),
      projectName: safeText(item.projectName, item.label || key),
      projectPath: safeText(item.projectPath),
      supportedAlgorithmIds: uniqueTextList(item.supportedAlgorithmIds),
      projectAlgorithms: cloneData(safeArray(item.projectAlgorithms)),
      algorithmProfiles: cloneData(safeObject(item.algorithmProfiles)),
      parameterSchema: cloneData(safeArray(item.parameterSchema)),
      defaultOptions: cloneData(safeObject(item.defaultOptions)),
      inputContract: cloneData(safeArray(item.inputContract)),
      outputContract: cloneData(safeArray(item.outputContract)),
    };
  });

  return [builtinEngine, ...externalEngines];
}

export function resolveEngineByKey(catalog = [], requestedKey = 'builtin') {
  const normalized = safeText(requestedKey, 'builtin');
  const normalizedLower = normalized.toLowerCase();
  return safeArray(catalog).find((item) => (
    safeText(item.key) === normalized
    || safeArray(item.legacyKeys).some((alias) => safeText(alias).toLowerCase() === normalizedLower)
  )) || null;
}

export function buildAlgorithmGatewayMeta(engine = {}, patch = {}) {
  const normalizedPatch = safeObject(patch);
  const status = safeText(normalizedPatch.status, 'succeeded');
  return {
    contractVersion: safeText(engine.contractVersion, GATEWAY_CONTRACT_VERSION),
    requestId: safeText(normalizedPatch.requestId),
    moduleKey: safeText(engine.moduleKey),
    engineKey: safeText(engine.key, 'builtin'),
    engineLabel: safeText(engine.label),
    source: safeText(engine.source, 'builtin'),
    runtime: safeText(engine.runtime, 'node'),
    version: safeText(engine.version, '1.0.0'),
    status,
    timeoutMs: resolvePositiveInteger(normalizedPatch.timeoutMs, resolvePositiveInteger(engine.timeoutMs, DEFAULT_GATEWAY_TIMEOUT_MS)),
    durationMs: Math.max(Number(normalizedPatch.durationMs || 0), 0),
    httpStatus: Number.isFinite(Number(normalizedPatch.httpStatus)) ? Number(normalizedPatch.httpStatus) : null,
    errorCode: safeText(normalizedPatch.errorCode),
    errorMessage: safeText(normalizedPatch.errorMessage),
  };
}

export async function invokeExternalAlgorithm({
  engine = {},
  moduleKey = '',
  payload = {},
  assessmentName = '',
  algorithm = {},
  requestMeta = {},
  timeoutMs = 0,
} = {}) {
  if (!safeText(engine.endpoint)) {
    throw createGatewayError({
      code: 'ALGORITHM_GATEWAY_NOT_CONFIGURED',
      type: 'missing_data',
      status: 400,
      message: `${safeText(engine.label, '外部算法服务')}未配置访问地址。`,
      details: {
        moduleKey: safeText(moduleKey, engine.moduleKey),
        engineKey: safeText(engine.key),
      },
    });
  }

  const startedAt = Date.now();
  const requestId = `alg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const finalTimeoutMs = resolvePositiveInteger(
    timeoutMs || engine.timeoutMs,
    DEFAULT_GATEWAY_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), finalTimeoutMs);

  try {
    const requestBody = {
      contractVersion: GATEWAY_CONTRACT_VERSION,
      module: safeText(moduleKey, engine.moduleKey),
      moduleKey: safeText(moduleKey, engine.moduleKey),
      algorithm: {
        key: safeText(algorithm.key),
        name: safeText(algorithm.name),
        source: safeText(engine.source, 'external'),
        runtime: safeText(engine.runtime, 'external'),
        version: safeText(engine.version, DEFAULT_EXTERNAL_ALGORITHM_VERSION),
        engineKey: safeText(engine.key),
        engineLabel: safeText(engine.label),
      },
      request: {
        requestId,
        sentAt: new Date().toISOString(),
        timeoutMs: finalTimeoutMs,
        assessmentName: safeText(assessmentName, payload?.assessmentName || ''),
        ...safeObject(requestMeta),
      },
      payload: safeObject(payload),
    };

    const response = await fetch(engine.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const durationMs = Date.now() - startedAt;
    const contentType = safeText(response.headers.get('content-type'));
    let parsedBody = null;
    if (contentType.includes('application/json')) {
      parsedBody = await response.json().catch(() => ({}));
    } else {
      parsedBody = await response.text().catch(() => '');
    }

    if (!response.ok) {
      const structuredError = safeObject(parsedBody?.error);
      const message = safeText(
        structuredError.message
        || parsedBody?.message
        || parsedBody
        || `${safeText(engine.label)} 返回错误：${response.status}`,
      );
      throw createGatewayError({
        code: safeText(structuredError.code, 'ALGORITHM_GATEWAY_HTTP_ERROR'),
        type: safeText(structuredError.type, 'algorithm_failed'),
        status: response.status || 502,
        message,
        details: {
          moduleKey: safeText(moduleKey, engine.moduleKey),
          engineKey: safeText(engine.key),
          requestId,
          httpStatus: response.status || 502,
        },
      });
    }

    const structuredBody = safeObject(parsedBody);
    if (structuredBody.ok === false) {
      const structuredError = safeObject(structuredBody.error);
      throw createGatewayError({
        code: safeText(structuredError.code, 'ALGORITHM_GATEWAY_REMOTE_FAILED'),
        type: safeText(structuredError.type, 'algorithm_failed'),
        status: Number.isFinite(Number(structuredError.status)) ? Number(structuredError.status) : 502,
        message: safeText(
          structuredError.message
          || structuredBody.message
          || `${safeText(engine.label)} 返回失败状态。`,
        ),
        details: {
          moduleKey: safeText(moduleKey, engine.moduleKey),
          engineKey: safeText(engine.key),
          requestId,
        },
      });
    }

    const result = Object.prototype.hasOwnProperty.call(structuredBody, 'result')
      ? structuredBody.result
      : parsedBody;
    const remoteMeta = safeObject(structuredBody.meta);
    const callMeta = buildAlgorithmGatewayMeta(engine, {
      status: safeText(remoteMeta.status, 'succeeded'),
      requestId: safeText(remoteMeta.requestId, requestId),
      timeoutMs: resolvePositiveInteger(remoteMeta.timeoutMs, finalTimeoutMs),
      durationMs: resolvePositiveInteger(remoteMeta.durationMs, durationMs),
      httpStatus: Number.isFinite(Number(remoteMeta.httpStatus)) ? Number(remoteMeta.httpStatus) : response.status,
      errorCode: safeText(remoteMeta.errorCode),
      errorMessage: safeText(remoteMeta.errorMessage),
    });

    return {
      result,
      rawResponse: parsedBody,
      callMeta,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createGatewayError({
        code: 'ALGORITHM_GATEWAY_TIMEOUT',
        type: 'algorithm_failed',
        status: 504,
        message: `${safeText(engine.label, '外部算法服务')}调用超时（${finalTimeoutMs}ms）。`,
        details: {
          moduleKey: safeText(moduleKey, engine.moduleKey),
          engineKey: safeText(engine.key),
          timeoutMs: finalTimeoutMs,
          requestId,
        },
      });
    }

    if (error?.code && error?.type) {
      throw error;
    }

    throw createGatewayError({
      code: 'ALGORITHM_GATEWAY_NETWORK_ERROR',
      type: 'algorithm_failed',
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : 502,
      message: safeText(error?.message, `${safeText(engine.label, '外部算法服务')}调用失败。`),
      details: {
        moduleKey: safeText(moduleKey, engine.moduleKey),
        engineKey: safeText(engine.key),
        requestId,
      },
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function recordAlgorithmCall(db, entry = {}) {
  if (!db) {
    return null;
  }

  const normalized = safeObject(entry);
  try {
    const id = nextAlgorithmCallLogId(db);
    db.prepare(`
      INSERT INTO algorithm_call_logs (
        id,
        module_key,
        assessment_name,
        task_id,
        task_run_id,
        algorithm_key,
        algorithm_name,
        engine_key,
        engine_source,
        engine_runtime,
        engine_version,
        status,
        http_status,
        duration_ms,
        request_id,
        error_code,
        error_message,
        request_payload,
        response_payload,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      safeText(normalized.moduleKey),
      safeText(normalized.assessmentName),
      Number.isFinite(Number(normalized.taskId)) ? Number(normalized.taskId) : null,
      Number.isFinite(Number(normalized.taskRunId)) ? Number(normalized.taskRunId) : null,
      safeText(normalized.algorithmKey),
      safeText(normalized.algorithmName),
      safeText(normalized.engineKey),
      safeText(normalized.engineSource),
      safeText(normalized.engineRuntime),
      safeText(normalized.engineVersion),
      safeText(normalized.status, 'succeeded'),
      Number.isFinite(Number(normalized.httpStatus)) ? Number(normalized.httpStatus) : null,
      Number.isFinite(Number(normalized.durationMs)) ? Number(normalized.durationMs) : null,
      safeText(normalized.requestId),
      safeText(normalized.errorCode),
      safeText(normalized.errorMessage),
      toJsonText(normalized.requestPayload),
      toJsonText(normalized.responsePayload),
      nowText(),
    );
    return id;
  } catch {
    return null;
  }
}

export function summarizeAlgorithmPayload(payload = {}) {
  const source = safeObject(payload);
  const summary = {
    keys: Object.keys(source).slice(0, 20),
  };
  if (source.assessmentName) summary.assessmentName = safeText(source.assessmentName);
  if (Array.isArray(source.schemes)) summary.schemeCount = source.schemes.length;
  if (Array.isArray(source.methods)) summary.methodCount = source.methods.length;
  if (source.taskId) summary.taskId = safeText(source.taskId);
  if (source.engine) summary.engine = safeText(source.engine);
  return summary;
}
