import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { evaluateAction, getActionTemplate } from './action.js';
import { evaluateCapability, getCapabilityTemplate } from './capability.js';
import { evaluateConsumption, getConsumptionTemplate } from './consumption.js';
import {
  evaluatePlanning,
  evaluatePlanningRealtimeStep,
  getPlanningTemplate,
  testPlanningLlm,
  validatePlanning,
} from './planning.js';
import {
  buildKnowledgeGraph,
  createDatabase,
  createImportedSource,
  createIntegerId,
  createSituationId,
  filterKnowledgeGraph,
  mapEnvironment,
  mapExtraction,
  mapImportBatch,
  mapImportBatchItem,
  mapIntelligence,
  mapPlanningRealtimeArtifact,
  mapSituationEntity,
  mapTask,
  mapTaskResult,
  mapTaskRun,
  mapSource,
  mapSourcePreview,
  nowText,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDist = path.resolve(__dirname, '../../web/dist/client');
const webPublic = path.resolve(__dirname, '../../web/public');
const webIndex = path.join(webDist, 'index.html');

const app = express();
const db = createDatabase();
const port = Number(process.env.PORT || 3100);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const SESSION_COOKIE_NAME = 'mission_session';
const SESSION_COOKIE_PATH = '/';
const SESSION_COOKIE_SAME_SITE = 'Lax';
const EXPIRED_COOKIE_DATE = 'Thu, 01 Jan 1970 00:00:00 GMT';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '25mb' }));

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;

  const derivedHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const source = Buffer.from(originalHash, 'hex');
  const target = Buffer.from(derivedHash, 'hex');
  return source.length === target.length && crypto.timingSafeEqual(source, target);
}

function nowIso() {
  return new Date().toISOString();
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO user_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    expiresAt,
    nowIso(),
  );
  return { token, expiresAt };
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  if (!raw) return {};
  return raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((accumulator, item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex <= 0) return accumulator;
      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      try {
        accumulator[key] = decodeURIComponent(value);
      } catch {
        accumulator[key] = value;
      }
      return accumulator;
    }, {});
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https';
}

function buildSessionCookie(token, expiresAt, req) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${SESSION_COOKIE_PATH}`,
    'HttpOnly',
    `SameSite=${SESSION_COOKIE_SAME_SITE}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildClearedSessionCookie(req) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${SESSION_COOKIE_PATH}`,
    'HttpOnly',
    `SameSite=${SESSION_COOKIE_SAME_SITE}`,
    `Expires=${EXPIRED_COOKIE_DATE}`,
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function setSessionCookie(res, req, token, expiresAt) {
  res.setHeader('Set-Cookie', buildSessionCookie(token, expiresAt, req));
}

function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', buildClearedSessionCookie(req));
}

function cleanupExpiredSessions() {
  db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(nowIso());
}

function initAuthSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const adminId = createIntegerId(db, 'users', 1);
    db.prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      adminId,
      'admin',
      hashPassword('123456'),
      'admin',
      'active',
      nowText(),
    );
  }

  cleanupExpiredSessions();
}

function getUserByToken(token) {
  if (!token) return null;
  cleanupExpiredSessions();
  const row = db.prepare(`
    SELECT users.*
    FROM user_sessions
    INNER JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token = ?
      AND user_sessions.expires_at > ?
  `).get(token, nowIso());

  if (!row || row.status !== 'active') {
    db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
    return null;
  }

  return row;
}

function readToken(req) {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }

  return parseCookies(req)[SESSION_COOKIE_NAME] || '';
}

function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ message: '未登录或登录状态已失效' });
    return;
  }

  const user = getUserByToken(token);
  if (!user) {
    clearSessionCookie(res, req);
    res.status(401).json({ message: '会话已过期，请重新登录' });
    return;
  }

  req.user = mapUser(user);
  req.authToken = token;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: '未登录或登录状态已失效' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: '当前账号无权执行该操作' });
      return;
    }

    next();
  };
}

const requireAdmin = requireRole('admin');
const TASK_MODULE_KEYS = ['planning', 'capability', 'action', 'consumption'];
const TASK_STATUS_KEYS = ['draft', 'submitted', 'archived'];
const TASK_PLANNING_TEMPLATE_IDS = ['fire-strike-task', 'air-assault-task'];
const TASK_RUN_STATUS_KEYS = ['created', 'running', 'succeeded', 'failed'];
const PLANNING_STAGE_KEYS = ['library', 'flow', 'execute'];
const PLANNING_ERROR_TYPES = ['missing_data', 'missing_upstream', 'algorithm_failed', 'permission_denied'];
const PLANNING_REALTIME_ARTIFACT_STATUS_KEYS = ['succeeded', 'failed', 'draft'];

function sanitizeNonNegativeInteger(value, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) {
    return fallback;
  }
  return Math.round(next);
}

function createDefaultSharedContext() {
  return {
    name: '联合任务 1',
    missionType: 'fire-strike',
    objective: '压制目标区域防空与火力节点，形成后续行动通道。',
    description: '能力、行动、消耗三个子模块共享同一任务上下文。',
    blueEquipment: {
      attackHelicopters: 6,
      transportHelicopters: 6,
      escortHelicopters: 2,
      reconHelicopters: 1,
      groundVehicles: 18,
      supportEquipment: 14,
      commandSeats: 4,
      medicalTeams: 2,
      troops: 96,
      rockets: 96,
      missiles: 24,
      fuel: 3600,
    },
    redEquipment: {
      airDefenseUnits: 6,
      fireStrikeUnits: 8,
      armoredUnits: 14,
      reconNodes: 5,
      electronicWarfareNodes: 3,
    },
  };
}

function sanitizeSharedContext(source = {}) {
  const fallback = createDefaultSharedContext();
  const missionType = ['fire-strike', 'air-assault'].includes(String(source?.missionType || ''))
    ? String(source.missionType)
    : fallback.missionType;

  return {
    name: String(source?.name || fallback.name),
    missionType,
    objective: String(source?.objective || fallback.objective),
    description: String(source?.description || fallback.description),
    blueEquipment: {
      attackHelicopters: sanitizeNonNegativeInteger(source?.blueEquipment?.attackHelicopters, fallback.blueEquipment.attackHelicopters),
      transportHelicopters: sanitizeNonNegativeInteger(source?.blueEquipment?.transportHelicopters, fallback.blueEquipment.transportHelicopters),
      escortHelicopters: sanitizeNonNegativeInteger(source?.blueEquipment?.escortHelicopters, fallback.blueEquipment.escortHelicopters),
      reconHelicopters: sanitizeNonNegativeInteger(source?.blueEquipment?.reconHelicopters, fallback.blueEquipment.reconHelicopters),
      groundVehicles: sanitizeNonNegativeInteger(source?.blueEquipment?.groundVehicles, fallback.blueEquipment.groundVehicles),
      supportEquipment: sanitizeNonNegativeInteger(source?.blueEquipment?.supportEquipment, fallback.blueEquipment.supportEquipment),
      commandSeats: sanitizeNonNegativeInteger(source?.blueEquipment?.commandSeats, fallback.blueEquipment.commandSeats),
      medicalTeams: sanitizeNonNegativeInteger(source?.blueEquipment?.medicalTeams, fallback.blueEquipment.medicalTeams),
      troops: sanitizeNonNegativeInteger(source?.blueEquipment?.troops, fallback.blueEquipment.troops),
      rockets: sanitizeNonNegativeInteger(source?.blueEquipment?.rockets, fallback.blueEquipment.rockets),
      missiles: sanitizeNonNegativeInteger(source?.blueEquipment?.missiles, fallback.blueEquipment.missiles),
      fuel: sanitizeNonNegativeInteger(source?.blueEquipment?.fuel, fallback.blueEquipment.fuel),
    },
    redEquipment: {
      airDefenseUnits: sanitizeNonNegativeInteger(source?.redEquipment?.airDefenseUnits, fallback.redEquipment.airDefenseUnits),
      fireStrikeUnits: sanitizeNonNegativeInteger(source?.redEquipment?.fireStrikeUnits, fallback.redEquipment.fireStrikeUnits),
      armoredUnits: sanitizeNonNegativeInteger(source?.redEquipment?.armoredUnits, fallback.redEquipment.armoredUnits),
      reconNodes: sanitizeNonNegativeInteger(source?.redEquipment?.reconNodes, fallback.redEquipment.reconNodes),
      electronicWarfareNodes: sanitizeNonNegativeInteger(source?.redEquipment?.electronicWarfareNodes, fallback.redEquipment.electronicWarfareNodes),
    },
  };
}

function mergeSharedContextPatch(current = {}, patch = {}) {
  const currentNormalized = sanitizeSharedContext(current);
  return sanitizeSharedContext({
    ...currentNormalized,
    ...patch,
    blueEquipment: {
      ...(currentNormalized.blueEquipment || {}),
      ...(patch?.blueEquipment || {}),
    },
    redEquipment: {
      ...(currentNormalized.redEquipment || {}),
      ...(patch?.redEquipment || {}),
    },
  });
}

function normalizeTaskModule(value, fallback = 'planning') {
  const normalized = String(value || fallback).trim();
  return TASK_MODULE_KEYS.includes(normalized) ? normalized : fallback;
}

function normalizeTaskStatus(value, fallback = 'draft') {
  const normalized = String(value || fallback).trim();
  return TASK_STATUS_KEYS.includes(normalized) ? normalized : fallback;
}

function normalizePlanningTemplateId(value, fallback = 'fire-strike-task') {
  const normalized = String(value || fallback).trim();
  if (!normalized) return fallback;
  if (TASK_PLANNING_TEMPLATE_IDS.includes(normalized)) return normalized;
  return normalized;
}

function normalizePlanningStageKey(value, fallback = 'library') {
  const normalized = String(value || fallback).trim();
  return PLANNING_STAGE_KEYS.includes(normalized) ? normalized : fallback;
}

function normalizeTaskRunStatus(value, fallback = 'succeeded') {
  const normalized = String(value || fallback).trim();
  return TASK_RUN_STATUS_KEYS.includes(normalized) ? normalized : fallback;
}

function canAccessTask(task, user) {
  if (!task || !user) return false;
  return user.role === 'admin' || Number(task.ownerUserId) === Number(user.id);
}

function getTaskRowById(taskId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

function readTaskById(taskId, options = {}) {
  const row = getTaskRowById(taskId);
  return row ? hydrateTaskPlanningState(mapTask(row), options) : null;
}

function createPlanningError({
  code = 'PLANNING_ALGORITHM_FAILED',
  type = 'algorithm_failed',
  status = 400,
  message = '规划执行失败',
  details = {},
} = {}) {
  const error = new Error(String(message || '规划执行失败'));
  error.status = Number.isInteger(Number(status)) ? Number(status) : 400;
  error.code = String(code || 'PLANNING_ALGORITHM_FAILED');
  error.type = PLANNING_ERROR_TYPES.includes(type) ? type : 'algorithm_failed';
  error.details = details && typeof details === 'object' ? details : {};
  return error;
}

function normalizePlanningError(error, fallbackMessage = '规划执行失败') {
  const status = Number.isInteger(Number(error?.status)) ? Number(error.status) : 400;
  const rawType = String(error?.type || '').trim();
  const type = PLANNING_ERROR_TYPES.includes(rawType) ? rawType : (
    status === 401 || status === 403 ? 'permission_denied' : 'algorithm_failed'
  );
  const code = String(error?.code || (
    type === 'missing_data'
      ? 'PLANNING_MISSING_DATA'
      : type === 'missing_upstream'
        ? 'PLANNING_MISSING_UPSTREAM'
        : type === 'permission_denied'
          ? 'PLANNING_PERMISSION_DENIED'
          : 'PLANNING_ALGORITHM_FAILED'
  ));
  const message = String(error?.message || fallbackMessage || '规划执行失败');
  const details = error?.details && typeof error.details === 'object' ? error.details : {};

  return {
    code,
    type,
    status,
    message,
    details,
  };
}

function sendPlanningError(res, error, fallbackMessage = '规划执行失败') {
  const normalized = normalizePlanningError(error, fallbackMessage);
  res.status(normalized.status).json({
    message: normalized.message,
    error: normalized,
  });
}

function setupPlanningEventStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function writePlanningEvent(res, type, payload = {}) {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify({
    ...safeObject(payload),
    type,
    timestamp: payload?.timestamp || nowIso(),
  }).replace(/\u2028|\u2029/g, '');
  res.write(`event: ${type}\n`);
  res.write(`data: ${data}\n\n`);
}

function createTaskRun(taskId, status = 'running', summary = {}, {
  errorCode = '',
  errorMessage = '',
} = {}) {
  const runId = createIntegerId(db, 'task_runs', 1);
  const createdAt = nowText();
  db.prepare(`
    INSERT INTO task_runs (id, task_id, status, summary, error_code, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    taskId,
    normalizeTaskRunStatus(status, 'running'),
    JSON.stringify(summary || {}),
    String(errorCode || ''),
    String(errorMessage || ''),
    createdAt,
  );
  db.prepare('UPDATE tasks SET latest_run_id = ?, updated_at = ? WHERE id = ?').run(runId, createdAt, taskId);
  const created = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId);
  return created ? mapTaskRun(created) : null;
}

function finalizeTaskRun(runId, status = 'succeeded', summary = {}, {
  errorCode = '',
  errorMessage = '',
} = {}) {
  const current = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId);
  if (!current) {
    return null;
  }
  const updatedAt = nowText();
  db.prepare(`
    UPDATE task_runs
    SET status = ?, summary = ?, error_code = ?, error_message = ?, created_at = ?
    WHERE id = ?
  `).run(
    normalizeTaskRunStatus(status, current.status || 'failed'),
    JSON.stringify(summary || {}),
    String(errorCode || ''),
    String(errorMessage || ''),
    updatedAt,
    runId,
  );
  db.prepare('UPDATE tasks SET latest_run_id = ?, updated_at = ? WHERE id = ?').run(runId, updatedAt, current.task_id);
  const updated = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId);
  return updated ? mapTaskRun(updated) : null;
}

function saveTaskResult(taskId, runId, resultPayload = {}) {
  const current = db.prepare('SELECT * FROM task_results WHERE run_id = ?').get(runId);
  const createdAt = nowText();

  if (current) {
    db.prepare('UPDATE task_results SET result_payload = ?, created_at = ? WHERE run_id = ?').run(
      JSON.stringify(resultPayload || {}),
      createdAt,
      runId,
    );
  } else {
    const id = createIntegerId(db, 'task_results', 1);
    db.prepare('INSERT INTO task_results (id, task_id, run_id, result_payload, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      taskId,
      runId,
      JSON.stringify(resultPayload || {}),
      createdAt,
    );
  }

  const row = db.prepare('SELECT * FROM task_results WHERE run_id = ?').get(runId);
  return row ? mapTaskResult(row) : null;
}

function getRecentTaskRuns(taskId, limit = 5, offset = 0) {
  const rows = db.prepare(`
    SELECT task_runs.*, task_results.id AS result_id
    FROM task_runs
    LEFT JOIN task_results ON task_results.run_id = task_runs.id
    WHERE task_runs.task_id = ?
    ORDER BY task_runs.id DESC
    LIMIT ? OFFSET ?
  `).all(taskId, limit, offset);

  return rows.map((row) => ({
    ...mapTaskRun(row),
    hasResult: Boolean(row.result_id),
  }));
}

function getTaskRunDetail(taskId, runId) {
  const runRow = db.prepare('SELECT * FROM task_runs WHERE id = ? AND task_id = ?').get(runId, taskId);
  if (!runRow) {
    return null;
  }
  const resultRow = db.prepare('SELECT * FROM task_results WHERE run_id = ?').get(runId);
  return {
    run: {
      ...mapTaskRun(runRow),
      hasResult: Boolean(resultRow),
    },
    result: resultRow ? mapTaskResult(resultRow) : null,
  };
}

function buildTaskPayload(task, { includePlanningState = true } = {}) {
  const latestRun = Number.isInteger(Number(task.latestRunId))
    ? db.prepare('SELECT * FROM task_runs WHERE id = ?').get(task.latestRunId)
    : null;
  const latestResult = latestRun
    ? db.prepare('SELECT id FROM task_results WHERE run_id = ?').get(latestRun.id)
    : null;

  const payload = {
    ...task,
    latestRun: latestRun ? {
      ...mapTaskRun(latestRun),
      hasResult: Boolean(latestResult),
    } : null,
  };

  if (!includePlanningState) {
    delete payload.planningTaskDefinition;
    delete payload.planningBindings;
    delete payload.planningAlgorithmInputs;
  }

  return payload;
}

function buildPlanningRunSummary(payload = {}) {
  const summary = payload?.execution?.summary || {};
  return {
    assessmentName: payload.assessmentName || '',
    generatedAt: payload.generatedAt || '',
    completedSteps: Number(summary.completedSteps || 0),
    implementedSteps: Number(summary.implementedSteps || 0),
    placeholderSteps: Number(summary.placeholderSteps || 0),
    sequenceIntegrity: Number(payload?.diagnostics?.sequenceIntegrity || 0),
  };
}

function resolvePlanningTemplateDefinition(templateId) {
  const planningTemplate = getPlanningTemplate();
  const tasks = Array.isArray(planningTemplate?.tasks) ? planningTemplate.tasks : [];
  return tasks.find((item) => item.id === String(templateId || '')) || tasks[0] || null;
}

function normalizePlanningTaskDefinition(rawDefinition = {}, planningTemplateId = 'fire-strike-task') {
  const fallback = resolvePlanningTemplateDefinition(planningTemplateId);
  const hasSteps = Array.isArray(rawDefinition?.steps) && rawDefinition.steps.length > 0;

  if (!hasSteps && fallback) {
    return JSON.parse(JSON.stringify(fallback));
  }

  const base = hasSteps ? rawDefinition : fallback || {};
  const steps = Array.isArray(base.steps) ? base.steps : [];
  return {
    id: String(base.id || planningTemplateId || `planning-task-${Date.now()}`),
    name: String(base.name || fallback?.name || '任务规划模板'),
    category: String(base.category || fallback?.category || '任务模板'),
    description: String(base.description || fallback?.description || ''),
    initialInputs: Array.isArray(base.initialInputs) ? base.initialInputs : [],
    finalDeliverables: Array.isArray(base.finalDeliverables) ? base.finalDeliverables : [],
    steps: steps.map((step, index) => ({
      id: String(step?.id || `step-${index + 1}`),
      order: Number(step?.order || index + 1),
      name: String(step?.name || step?.algorithmId || `步骤 ${index + 1}`),
      algorithmId: String(step?.algorithmId || ''),
      objective: String(step?.objective || ''),
      consumes: Array.isArray(step?.consumes) ? step.consumes : [],
      produces: Array.isArray(step?.produces) ? step.produces : [],
    })),
    defaultBindings: base?.defaultBindings && typeof base.defaultBindings === 'object'
      ? base.defaultBindings
      : {},
  };
}

function normalizePlanningBindings(bindings = {}, taskDefinition = {}) {
  const normalized = bindings && typeof bindings === 'object' ? { ...bindings } : {};
  const steps = Array.isArray(taskDefinition?.steps) ? taskDefinition.steps : [];
  for (const step of steps) {
    if (!normalized[step.id]) {
      normalized[step.id] = `${step.algorithmId}:builtin`;
    }
  }
  return normalized;
}

function normalizePlanningAlgorithmInputs(rawInputs = {}) {
  return rawInputs && typeof rawInputs === 'object' ? rawInputs : {};
}

function normalizePlanningAssessmentName(value, fallback = '') {
  const next = String(value || fallback).trim();
  return next || String(fallback || '').trim() || '任务规划评估';
}

function normalizePlanningTaskState({
  planningTemplateId = 'fire-strike-task',
  planningTaskDefinition = {},
  planningBindings = {},
  planningAlgorithmInputs = {},
  planningAssessmentName = '',
  fallbackName = '',
  planningStageKey = 'library',
} = {}) {
  const normalizedTaskDefinition = normalizePlanningTaskDefinition(planningTaskDefinition, planningTemplateId);
  const normalizedBindings = normalizePlanningBindings(planningBindings, normalizedTaskDefinition);
  const normalizedAlgorithmInputs = normalizePlanningAlgorithmInputs(planningAlgorithmInputs);
  return {
    planningTemplateId: normalizePlanningTemplateId(planningTemplateId, 'fire-strike-task'),
    planningTaskDefinition: normalizedTaskDefinition,
    planningBindings: normalizedBindings,
    planningAlgorithmInputs: normalizedAlgorithmInputs,
    planningAssessmentName: normalizePlanningAssessmentName(planningAssessmentName, fallbackName),
    planningStageKey: normalizePlanningStageKey(planningStageKey, 'library'),
  };
}

function buildPlanningPayloadFromTask(task, payload = {}) {
  const normalized = normalizePlanningTaskState({
    planningTemplateId: task?.planningTemplateId || payload?.planningTemplateId || 'fire-strike-task',
    planningTaskDefinition: task?.planningTaskDefinition || payload?.taskDefinition || {},
    planningBindings: task?.planningBindings || payload?.bindings || {},
    planningAlgorithmInputs: task?.planningAlgorithmInputs || payload?.algorithmInputs || {},
    planningAssessmentName: payload?.assessmentName || task?.planningAssessmentName || task?.name || '',
    fallbackName: task?.name || '',
    planningStageKey: task?.planningStageKey || payload?.planningStageKey || 'library',
  });

  return {
    assessmentName: normalized.planningAssessmentName,
    taskDefinition: normalized.planningTaskDefinition,
    bindings: normalized.planningBindings,
    algorithmInputs: normalized.planningAlgorithmInputs,
    taskCenterId: Number.isFinite(Number(payload?.taskCenterId)) ? Number(payload.taskCenterId) : null,
    taskRunId: Number.isFinite(Number(payload?.taskRunId)) ? Number(payload.taskRunId) : null,
  };
}

function normalizeRealtimeArtifactStatus(value, fallback = 'succeeded') {
  const normalized = String(value || fallback).trim();
  return PLANNING_REALTIME_ARTIFACT_STATUS_KEYS.includes(normalized) ? normalized : fallback;
}

function normalizeRealtimeArtifactIds(value = []) {
  return [...new Set(safeArray(value).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
}

function normalizePlanningInputResultRefs(value = []) {
  return safeArray(value)
    .map((item) => safeObject(item))
    .map((item) => {
      const sourceType = String(item.sourceType || item.type || '').trim();
      if (sourceType === 'realtime-artifact') {
        const id = Number(item.id || item.artifactId);
        return Number.isInteger(id) && id > 0
          ? { sourceType, id }
          : null;
      }

      if (sourceType === 'task-run-step') {
        const taskId = Number(item.taskId);
        const runId = Number(item.runId);
        const stepId = String(item.stepId || '').trim();
        const algorithmId = String(item.algorithmId || '').trim();
        if (!Number.isInteger(taskId) || taskId <= 0 || !Number.isInteger(runId) || runId <= 0 || (!stepId && !algorithmId)) {
          return null;
        }
        return {
          sourceType,
          taskId,
          runId,
          stepId,
          algorithmId,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function canAccessRealtimeArtifact(artifact, user) {
  if (!artifact || !user) return false;
  return Number(artifact.ownerUserId) === Number(user.id);
}

function readPlanningRealtimeArtifactById(artifactId) {
  const row = db.prepare('SELECT * FROM planning_realtime_artifacts WHERE id = ?').get(artifactId);
  return row ? mapPlanningRealtimeArtifact(row) : null;
}

function listPlanningRealtimeArtifacts(user, filters = {}) {
  const conditions = ['owner_user_id = ?'];
  const params = [Number(user.id)];
  const taskId = Number(filters.taskId);
  const limit = Math.min(Math.max(Number(filters.limit) || 80, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const algorithmId = String(filters.algorithmId || '').trim();
  const query = String(filters.query || '').trim();

  if (Number.isInteger(taskId) && taskId > 0) {
    conditions.push('task_id = ?');
    params.push(taskId);
  }
  if (algorithmId) {
    conditions.push('algorithm_id = ?');
    params.push(algorithmId);
  }
  if (query) {
    conditions.push(`(
      display_name LIKE ?
      OR description LIKE ?
      OR task_name LIKE ?
      OR algorithm_name LIKE ?
      OR step_name LIKE ?
    )`);
    const token = `%${query}%`;
    params.push(token, token, token, token, token);
  }

  const whereClause = conditions.join(' AND ');
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM planning_realtime_artifacts WHERE ${whereClause}`).get(...params);
  const rows = db.prepare(`
    SELECT *
    FROM planning_realtime_artifacts
    WHERE ${whereClause}
    ORDER BY updated_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    artifacts: rows.map(mapPlanningRealtimeArtifact),
    total: Number(totalRow?.total || 0),
    limit,
    offset,
  };
}

function normalizePlanningUpstreamResultItem(source = {}) {
  const sourceType = String(source.sourceType || 'realtime-artifact');
  const taskId = Number(source.taskId || 0) || null;
  const runId = Number(source.runId || 0) || null;
  const artifactId = Number(source.artifactId || 0) || null;
  const stepId = String(source.stepId || '');
  const algorithmId = String(source.algorithmId || '');
  const displayName = String(source.displayName || source.stepName || source.algorithmName || '前置算法结果');
  return {
    id: source.id || (
      sourceType === 'task-run-step'
        ? `task-run-step:${taskId || ''}:${runId || ''}:${stepId || algorithmId}`
        : `realtime-artifact:${artifactId || ''}`
    ),
    sourceType,
    artifactId,
    taskId,
    taskName: String(source.taskName || ''),
    runId,
    runStatus: String(source.runStatus || source.status || ''),
    displayName,
    description: String(source.description || ''),
    algorithmId,
    algorithmName: String(source.algorithmName || ''),
    stepId,
    stepName: String(source.stepName || ''),
    bindingId: String(source.bindingId || ''),
    bindingName: String(source.bindingName || ''),
    status: String(source.status || 'succeeded'),
    summary: String(source.summary || ''),
    createdAt: String(source.createdAt || ''),
    updatedAt: String(source.updatedAt || source.createdAt || ''),
    resultRef: sourceType === 'task-run-step'
      ? { sourceType, taskId, runId, stepId, algorithmId }
      : { sourceType, id: artifactId },
  };
}

function mapRealtimeArtifactToUpstreamResult(artifact = {}) {
  const resultPayload = safeObject(artifact.resultPayload);
  const step = safeObject(resultPayload.step);
  return normalizePlanningUpstreamResultItem({
    sourceType: 'realtime-artifact',
    artifactId: artifact.id,
    taskId: artifact.taskId,
    taskName: artifact.taskName,
    displayName: artifact.displayName,
    description: artifact.description,
    algorithmId: artifact.algorithmId,
    algorithmName: artifact.algorithmName,
    stepId: artifact.stepId,
    stepName: artifact.stepName,
    bindingId: artifact.bindingId,
    bindingName: artifact.bindingName,
    status: artifact.status,
    summary: step.summary || resultPayload.summary || '',
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  });
}

function mapTaskRunStepToUpstreamResult({ task = {}, run = {}, result = {}, step = {} } = {}) {
  return normalizePlanningUpstreamResultItem({
    sourceType: 'task-run-step',
    taskId: task.id,
    taskName: task.name,
    runId: run.id,
    runStatus: run.status,
    displayName: `${step.stepName || step.algorithm?.name || '单算法结果'} #${run.id}`,
    description: result?.assessmentName || run.summary?.assessmentName || '',
    algorithmId: step.algorithm?.id || '',
    algorithmName: step.algorithm?.name || '',
    stepId: step.stepId || '',
    stepName: step.stepName || '',
    bindingId: step.binding?.id || '',
    bindingName: step.binding?.name || '',
    status: run.status,
    summary: step.summary || '',
    createdAt: run.createdAt,
    updatedAt: result.generatedAt || run.createdAt,
  });
}

function listPlanningTaskRunStepResults(user, filters = {}) {
  const conditions = ["tasks.module_key = 'planning'", "task_results.result_payload != ''"];
  const params = [];
  const taskId = Number(filters.taskId);
  const algorithmId = String(filters.algorithmId || '').trim();
  const query = String(filters.query || '').trim().toLowerCase();
  const rowLimit = Math.min(Math.max(Number(filters.rowLimit) || 120, 1), 300);

  if (user.role !== 'admin') {
    conditions.push('tasks.owner_user_id = ?');
    params.push(Number(user.id));
  }
  if (Number.isInteger(taskId) && taskId > 0) {
    conditions.push('tasks.id = ?');
    params.push(taskId);
  }

  const rows = db.prepare(`
    SELECT
      tasks.id AS task_id,
      tasks.name AS task_name,
      tasks.owner_user_id AS owner_user_id,
      task_runs.id AS run_id,
      task_runs.status AS run_status,
      task_runs.summary AS run_summary,
      task_runs.created_at AS run_created_at,
      task_results.result_payload AS result_payload,
      task_results.created_at AS result_created_at
    FROM task_results
    JOIN task_runs ON task_runs.id = task_results.run_id
    JOIN tasks ON tasks.id = task_results.task_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY task_results.created_at DESC, task_results.id DESC
    LIMIT ?
  `).all(...params, rowLimit);

  return rows.flatMap((row) => {
    const resultPayload = parseJsonText(row.result_payload, {});
    const runSummary = parseJsonText(row.run_summary, {});
    const steps = safeArray(resultPayload?.execution?.steps);
    return steps.map((step) => mapTaskRunStepToUpstreamResult({
      task: {
        id: row.task_id,
        name: row.task_name,
        ownerUserId: row.owner_user_id,
      },
      run: {
        id: row.run_id,
        status: row.run_status,
        summary: runSummary,
        createdAt: row.run_created_at,
      },
      result: {
        ...safeObject(resultPayload),
        generatedAt: resultPayload.generatedAt || row.result_created_at,
      },
      step,
    }));
  }).filter((item) => {
    if (algorithmId && item.algorithmId !== algorithmId) return false;
    if (!query) return true;
    return [
      item.displayName,
      item.description,
      item.taskName,
      item.algorithmName,
      item.stepName,
      item.summary,
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function listPlanningUpstreamResults(user, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 120, 1), 240);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const realtime = listPlanningRealtimeArtifacts(user, {
    taskId: filters.taskId,
    algorithmId: filters.algorithmId,
    query: filters.query,
    limit: 200,
    offset: 0,
  }).artifacts.map(mapRealtimeArtifactToUpstreamResult);
  const taskRunSteps = listPlanningTaskRunStepResults(user, filters);
  const results = [...realtime, ...taskRunSteps]
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));

  return {
    results: results.slice(offset, offset + limit),
    total: results.length,
    limit,
    offset,
  };
}

function resolveRealtimeTaskAccess(taskCenterId, user) {
  const id = Number(taskCenterId);
  if (!Number.isInteger(id) || id <= 0) {
    throw createPlanningError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 400,
      message: '实时生成必须挂靠一个规划任务实例。',
      details: { taskCenterId },
    });
  }

  const task = readTaskById(id);
  if (!task) {
    throw createPlanningError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 404,
      message: '未找到对应的规划任务实例。',
      details: { taskCenterId: id },
    });
  }
  if (!canAccessTask(task, user)) {
    throw createPlanningError({
      code: 'PLANNING_PERMISSION_DENIED',
      type: 'permission_denied',
      status: 403,
      message: '当前账号无权访问该规划任务实例。',
      details: { taskCenterId: id },
    });
  }
  return task;
}

function assertUniqueRealtimeArtifactAlgorithms(artifacts = []) {
  const seen = new Map();
  for (const artifact of safeArray(artifacts)) {
    const algorithmId = String(artifact.algorithmId || '').trim();
    if (!algorithmId) continue;
    if (seen.has(algorithmId)) {
      throw createPlanningError({
        code: 'PLANNING_REALTIME_DUPLICATE_INPUT',
        type: 'missing_data',
        status: 400,
        message: '同一算法类型一次只能选择一个输入产物，请删除重复的上游产物后再执行。',
        details: {
          algorithmId,
          artifactIds: [seen.get(algorithmId), artifact.id],
        },
      });
    }
    seen.set(algorithmId, artifact.id);
  }
}

function readPlanningRealtimeInputArtifacts(inputArtifactIds = [], user) {
  const ids = normalizeRealtimeArtifactIds(inputArtifactIds);
  const artifacts = ids.map((id) => readPlanningRealtimeArtifactById(id));
  const missingId = ids.find((id, index) => !artifacts[index]);
  if (missingId) {
    throw createPlanningError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 404,
      message: '选择的实时生成产物不存在。',
      details: { artifactId: missingId },
    });
  }

  const forbidden = artifacts.find((artifact) => !canAccessRealtimeArtifact(artifact, user));
  if (forbidden) {
    throw createPlanningError({
      code: 'PLANNING_PERMISSION_DENIED',
      type: 'permission_denied',
      status: 403,
      message: '当前账号无权访问所选实时生成产物。',
      details: { artifactId: forbidden.id },
    });
  }

  assertUniqueRealtimeArtifactAlgorithms(artifacts);
  return artifacts;
}

function resolveTaskRunStepResultRef(ref = {}, user) {
  const task = readTaskById(ref.taskId);
  if (!task) {
    throw createPlanningError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 404,
      message: '选择的任务执行结果不存在。',
      details: { taskId: ref.taskId, runId: ref.runId, stepId: ref.stepId },
    });
  }
  if (!canAccessTask(task, user)) {
    throw createPlanningError({
      code: 'PLANNING_PERMISSION_DENIED',
      type: 'permission_denied',
      status: 403,
      message: '当前账号无权访问所选任务执行结果。',
      details: { taskId: ref.taskId, runId: ref.runId, stepId: ref.stepId },
    });
  }

  const detail = getTaskRunDetail(ref.taskId, ref.runId);
  const resultPayload = safeObject(detail?.result?.resultPayload);
  const step = safeArray(resultPayload?.execution?.steps).find((item) => (
    (ref.stepId && String(item.stepId || '') === ref.stepId)
    || (ref.algorithmId && String(item.algorithm?.id || '') === ref.algorithmId)
  ));
  if (!detail || !step) {
    throw createPlanningError({
      code: 'PLANNING_MISSING_DATA',
      type: 'missing_data',
      status: 404,
      message: '选择的任务执行记录中没有对应算法结果。',
      details: { taskId: ref.taskId, runId: ref.runId, stepId: ref.stepId, algorithmId: ref.algorithmId },
    });
  }

  return {
    id: `task-run-step:${ref.taskId}:${ref.runId}:${step.stepId || step.algorithm?.id || ''}`,
    sourceType: 'task-run-step',
    ownerUserId: task.ownerUserId,
    taskId: task.id,
    taskName: task.name,
    displayName: `${step.stepName || step.algorithm?.name || '单算法结果'} #${ref.runId}`,
    description: resultPayload.assessmentName || detail.run?.summary?.assessmentName || '',
    algorithmId: step.algorithm?.id || '',
    algorithmName: step.algorithm?.name || '',
    stepId: step.stepId || '',
    stepName: step.stepName || '',
    bindingId: step.binding?.id || '',
    bindingName: step.binding?.name || '',
    status: detail.run?.status || 'succeeded',
    inputArtifactIds: [],
    resultPayload: {
      ok: true,
      sourceType: 'task-run-step',
      assessmentName: resultPayload.assessmentName || '',
      generatedAt: resultPayload.generatedAt || detail.result?.createdAt || '',
      task: {
        id: task.id,
        name: task.name,
      },
      run: {
        id: ref.runId,
        status: detail.run?.status || '',
      },
      step,
      structuredOutput: safeObject(step.structuredOutput),
    },
    createdAt: detail.run?.createdAt || '',
    updatedAt: detail.result?.createdAt || detail.run?.createdAt || '',
  };
}

function readPlanningRealtimeInputResultRefs(inputResultRefs = [], user) {
  const refs = normalizePlanningInputResultRefs(inputResultRefs);
  if (safeArray(inputResultRefs).length !== refs.length) {
    throw createPlanningError({
      code: 'PLANNING_INVALID_INPUT_REF',
      type: 'missing_data',
      status: 400,
      message: '前置算法结果引用格式无效。',
      details: { inputResultRefs },
    });
  }
  const artifacts = refs.map((ref) => {
    if (ref.sourceType === 'realtime-artifact') {
      const artifact = readPlanningRealtimeArtifactById(ref.id);
      if (!artifact) {
        throw createPlanningError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 404,
          message: '选择的实时生成产物不存在。',
          details: { artifactId: ref.id },
        });
      }
      if (!canAccessRealtimeArtifact(artifact, user)) {
        throw createPlanningError({
          code: 'PLANNING_PERMISSION_DENIED',
          type: 'permission_denied',
          status: 403,
          message: '当前账号无权访问所选实时生成产物。',
          details: { artifactId: artifact.id },
        });
      }
      return artifact;
    }
    return resolveTaskRunStepResultRef(ref, user);
  });

  assertUniqueRealtimeArtifactAlgorithms(artifacts);
  return artifacts;
}

function normalizeRealtimeEditablePayload(value) {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw createPlanningError({
        code: 'PLANNING_INVALID_JSON',
        type: 'missing_data',
        status: 400,
        message: '保存的实时生成 JSON 不是有效格式。',
        details: {},
      });
    }
  }
  if (value && typeof value === 'object') {
    return value;
  }
  throw createPlanningError({
    code: 'PLANNING_INVALID_JSON',
    type: 'missing_data',
    status: 400,
    message: '实时生成 JSON 只能保存为对象或数组。',
    details: {},
  });
}

function buildRealtimeStepPayloadFromTask(task, body = {}, inputArtifacts = []) {
  const basePayload = buildPlanningPayloadFromTask(task, {
    ...body,
    taskCenterId: task.id,
  });
  const algorithmId = String(body.algorithmId || '').trim();
  const stepId = String(body.stepId || '').trim();
  const algorithmInput = safeObject(body.algorithmInput);
  const algorithmInputs = {
    ...safeObject(basePayload.algorithmInputs),
    ...safeObject(body.algorithmInputs),
  };

  if (algorithmId) {
    algorithmInputs[algorithmId] = {
      ...safeObject(algorithmInputs[algorithmId]),
      ...algorithmInput,
    };
  }

  return {
    ...basePayload,
    assessmentName: String(body.assessmentName || basePayload.assessmentName || `${task.name}实时生成`),
    taskCenterId: task.id,
    algorithmId,
    stepId,
    bindingId: String(body.bindingId || '').trim(),
    bindings: {
      ...safeObject(basePayload.bindings),
      ...safeObject(body.bindings),
      ...(stepId && body.bindingId ? { [stepId]: String(body.bindingId) } : {}),
    },
    algorithmInput,
    algorithmInputs,
    inputArtifactIds: inputArtifacts.map((artifact) => artifact.id),
    inputResultRefs: normalizePlanningInputResultRefs(body.inputResultRefs),
    inputArtifacts,
  };
}

function buildRealtimeDisplayName(result = {}, fallback = '实时生成产物') {
  const explicit = String(result.displayName || '').trim();
  if (explicit) return explicit.slice(0, 120);
  const stepName = String(result?.step?.stepName || fallback || '实时生成产物').trim() || '实时生成产物';
  return `${stepName}-${nowText()}`.slice(0, 120);
}

function savePlanningRealtimeArtifact(user, task, result, inputArtifactIds = [], options = {}) {
  const id = createIntegerId(db, 'planning_realtime_artifacts', 1);
  const step = safeObject(result.step);
  const algorithm = safeObject(step.algorithm);
  const binding = safeObject(step.binding);
  const createdAt = nowText();
  const displayName = String(options.displayName || buildRealtimeDisplayName(result, step.stepName)).trim() || buildRealtimeDisplayName(result);
  const description = String(options.description || '').trim();
  const status = normalizeRealtimeArtifactStatus(options.status || 'succeeded');

  db.prepare(`
    INSERT INTO planning_realtime_artifacts (
      id,
      owner_user_id,
      task_id,
      task_name,
      display_name,
      description,
      algorithm_id,
      algorithm_name,
      step_id,
      step_name,
      binding_id,
      binding_name,
      status,
      input_artifact_ids,
      result_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    Number(user.id),
    Number(task.id),
    String(task.name || result?.task?.name || ''),
    displayName,
    description,
    String(algorithm.id || ''),
    String(algorithm.name || ''),
    String(step.stepId || ''),
    String(step.stepName || ''),
    String(binding.id || ''),
    String(binding.name || ''),
    status,
    JSON.stringify(normalizeRealtimeArtifactIds(inputArtifactIds)),
    JSON.stringify(result || {}),
    createdAt,
    createdAt,
  );

  return readPlanningRealtimeArtifactById(id);
}

function validateCredentials(username, password) {
  if (!username || username.trim().length < 3) {
    return '用户名长度不能少于 3 个字符';
  }
  if (username.trim().length > 24) {
    return '用户名长度不能超过 24 个字符';
  }
  if (!password || password.length < 6) {
    return '密码长度不能少于 6 位';
  }
  return '';
}

function resolveExistingSourceId(rawSourceId, fallback = 1) {
  const normalizedSourceId = rawSourceId === undefined || rawSourceId === null || rawSourceId === ''
    ? fallback
    : rawSourceId;
  const sourceId = Number(normalizedSourceId);

  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    return { sourceId: null, message: '数据源 ID 无效' };
  }

  const source = db.prepare('SELECT id FROM sources WHERE id = ?').get(sourceId);
  if (!source) {
    return { sourceId: null, message: '未找到对应数据源' };
  }

  return { sourceId, message: '' };
}

function isForeignKeyConstraintError(error) {
  return String(error?.message || '').includes('FOREIGN KEY constraint failed');
}

function parseJsonText(text, fallback = {}) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePlanningTaskAttachment(file = {}, fallbackName = '未命名文件') {
  const source = safeObject(file);
  const fileName = String(source.fileName || fallbackName).trim() || fallbackName;
  return {
    ...source,
    id: String(source.id || `task-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    fileName,
    fileExtension: String(source.fileExtension || '').trim(),
    size: Math.max(0, Math.round(Number(source.size || 0))),
    fileContentBase64: String(source.fileContentBase64 || '').trim(),
  };
}

function splitPlanningAlgorithmInputsAndAttachments(rawInputs = {}) {
  const nextInputs = {};
  const attachments = [];

  for (const [algorithmId, rawInput] of Object.entries(safeObject(rawInputs))) {
    const input = safeObject(rawInput);
    const uploadedFiles = safeArray(input.uploadedFiles)
      .map((file, index) => normalizePlanningTaskAttachment(file, `上传文件-${index + 1}`))
      .filter((file) => file.fileContentBase64);

    nextInputs[algorithmId] = {
      ...input,
      uploadedFiles: [],
    };

    for (const file of uploadedFiles) {
      attachments.push({
        algorithmId: String(algorithmId || '').trim(),
        fileId: String(file.id || '').trim(),
        fileName: String(file.fileName || '').trim(),
        payload: file,
      });
    }
  }

  return {
    planningAlgorithmInputs: nextInputs,
    attachments,
  };
}

function appendPlanningAttachment(targetInputs, algorithmId, payload) {
  const normalizedAlgorithmId = String(algorithmId || '').trim();
  if (!normalizedAlgorithmId) {
    return;
  }

  const current = safeObject(targetInputs[normalizedAlgorithmId]);
  const uploadedFiles = safeArray(current.uploadedFiles);
  const normalizedPayload = normalizePlanningTaskAttachment(payload);
  if (uploadedFiles.some((item) => String(item?.id || '').trim() === normalizedPayload.id)) {
    return;
  }

  targetInputs[normalizedAlgorithmId] = {
    ...current,
    uploadedFiles: [...uploadedFiles, normalizedPayload],
  };
}

function mergePlanningAlgorithmInputsWithAttachments(rawInputs = {}, attachmentRows = []) {
  const merged = {};

  for (const [algorithmId, rawInput] of Object.entries(safeObject(rawInputs))) {
    const input = safeObject(rawInput);
    merged[algorithmId] = {
      ...input,
      uploadedFiles: safeArray(input.uploadedFiles),
    };
  }

  for (const row of safeArray(attachmentRows)) {
    appendPlanningAttachment(merged, row.algorithm_id, parseJsonText(row.file_payload, {}));
  }

  return merged;
}

function loadTaskAttachmentRows(taskId) {
  return db.prepare(`
    SELECT *
    FROM task_attachments
    WHERE task_id = ?
    ORDER BY id ASC
  `).all(taskId);
}

function saveTaskAttachments(taskId, attachments = []) {
  db.prepare('DELETE FROM task_attachments WHERE task_id = ?').run(taskId);
  if (!safeArray(attachments).length) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO task_attachments (
      id,
      task_id,
      algorithm_id,
      file_id,
      file_name,
      file_payload,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let nextAttachmentId = createIntegerId(db, 'task_attachments', 1);
  const createdAt = nowText();
  for (const attachment of attachments) {
    insert.run(
      nextAttachmentId,
      taskId,
      String(attachment.algorithmId || '').trim(),
      String(attachment.fileId || '').trim(),
      String(attachment.fileName || '').trim(),
      JSON.stringify(safeObject(attachment.payload)),
      createdAt,
    );
    nextAttachmentId += 1;
  }
}

function hydrateTaskPlanningState(task, { includeAttachments = true } = {}) {
  if (!task) {
    return null;
  }

  if (!includeAttachments) {
    return task;
  }

  const attachmentRows = loadTaskAttachmentRows(task.id);
  return {
    ...task,
    planningAlgorithmInputs: mergePlanningAlgorithmInputsWithAttachments(task.planningAlgorithmInputs, attachmentRows),
  };
}

function migrateInlinePlanningTaskUploads() {
  const rows = db.prepare('SELECT * FROM tasks').all();
  for (const row of rows) {
    const task = mapTask(row);
    const { planningAlgorithmInputs, attachments } = splitPlanningAlgorithmInputsAndAttachments(task.planningAlgorithmInputs);
    const stillHasInlineUploads = Object.values(safeObject(task.planningAlgorithmInputs))
      .some((item) => safeArray(item?.uploadedFiles).length > 0);

    if (!stillHasInlineUploads) {
      continue;
    }

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE tasks SET planning_algorithm_inputs = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(planningAlgorithmInputs),
        nowText(),
        task.id,
      );
      saveTaskAttachments(task.id, attachments);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function normalizeOptionalTaskId(rawValue) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function ensureImportTaskAccess(taskId, user) {
  if (!taskId) {
    return null;
  }

  const task = readTaskById(taskId, { includeAttachments: false });
  if (!task) {
    const error = new Error('未找到关联任务实例');
    error.status = 404;
    error.code = 'IMPORT_TASK_NOT_FOUND';
    throw error;
  }
  if (!canAccessTask(task, user)) {
    const error = new Error('当前账号无权关联该任务实例');
    error.status = 403;
    error.code = 'IMPORT_TASK_ACCESS_DENIED';
    throw error;
  }
  return task;
}

function createImportBatchKey() {
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function summarizeImportPayload(payload = {}) {
  return {
    name: String(payload.name || '').trim(),
    type: String(payload.type || '').trim(),
    format: String(payload.format || '').trim(),
    fileName: String(payload.fileName || '').trim(),
    description: String(payload.description || '').trim(),
    taskId: normalizeOptionalTaskId(payload.taskId),
  };
}

function summarizeImportResult(result = {}) {
  return {
    source: result?.source ? mapSource(result.source) : null,
    previewType: result?.preview?.preview_type || '',
    extractionCount: Array.isArray(result?.extractions) ? result.extractions.length : 0,
  };
}

function refreshImportBatchSummary(batchId) {
  const counters = db.prepare(`
    SELECT
      COUNT(*) AS totalCount,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeededCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
    FROM import_batch_items
    WHERE batch_id = ?
  `).get(batchId);
  const totalCount = Number(counters?.totalCount || 0);
  const succeededCount = Number(counters?.succeededCount || 0);
  const failedCount = Number(counters?.failedCount || 0);
  const status = failedCount > 0
    ? (succeededCount + failedCount >= totalCount ? 'finished_with_errors' : 'running')
    : (succeededCount >= totalCount ? 'succeeded' : 'running');

  db.prepare(`
    UPDATE import_batches
    SET total_count = ?,
        succeeded_count = ?,
        failed_count = ?,
        status = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    totalCount,
    succeededCount,
    failedCount,
    status,
    nowText(),
    batchId,
  );
}

function buildImportBatchResponse(batchRow, itemRows = []) {
  const batch = mapImportBatch(batchRow);
  const items = itemRows
    .map(mapImportBatchItem)
    .sort((left, right) => left.itemIndex - right.itemIndex)
    .map((item) => ({
      ...item,
      requestPayload: summarizeImportPayload(item.requestPayload),
    }));
  return { ...batch, items };
}

async function executeImportBatchItem(itemRow, { batchId, batchKey, userId }) {
  const itemId = Number(itemRow.id);
  const taskId = normalizeOptionalTaskId(itemRow.task_id);
  const requestPayload = parseJsonText(itemRow.request_payload, {});
  const attemptCount = Math.max(Number(itemRow.attempt_count || 0) + 1, 1);
  const runningAt = nowText();

  db.prepare(`
    UPDATE import_batch_items
    SET status = ?,
        attempt_count = ?,
        failure_reason = ?,
        updated_at = ?
    WHERE id = ?
  `).run('running', attemptCount, '', runningAt, itemId);

  try {
    const created = await createImportedSource(db, requestPayload, {
      taskId,
      importBatchKey: batchKey,
      createdByUserId: userId,
    });
    db.prepare(`
      UPDATE import_batch_items
      SET status = ?,
          source_id = ?,
          failure_reason = ?,
          result_payload = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      'succeeded',
      created?.source?.id ?? null,
      '',
      JSON.stringify(summarizeImportResult(created)),
      nowText(),
      itemId,
    );
  } catch (error) {
    db.prepare(`
      UPDATE import_batch_items
      SET status = ?,
          failure_reason = ?,
          result_payload = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      'failed',
      String(error?.message || '导入失败'),
      JSON.stringify({ message: String(error?.message || '导入失败') }),
      nowText(),
      itemId,
    );
  }

  refreshImportBatchSummary(batchId);
  return db.prepare('SELECT * FROM import_batch_items WHERE id = ?').get(itemId);
}

function getOverviewPayload() {
  const graph = buildKnowledgeGraph(db);
  return {
    title: '战场沙盘实验室',
    description: '面向学习交流的虚构态势数据服务与三维沙盘演示系统。',
    modules: [
      { key: 'data', name: '数据信息服务', status: 'active' },
      { key: 'capability', name: '能力计算模块', status: 'active' },
      { key: 'planning', name: '任务规划', status: 'active' },
    ],
    counts: {
      sources: db.prepare('SELECT COUNT(*) AS count FROM sources').get().count,
      intelligence: db.prepare('SELECT COUNT(*) AS count FROM intelligence').get().count,
      environment: db.prepare('SELECT COUNT(*) AS count FROM environment').get().count,
      graphNodes: graph.nodes.length,
      situationEntities: db.prepare('SELECT COUNT(*) AS count FROM situation_entities').get().count,
      users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      tasks: db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count,
    },
  };
}

initAuthSchema();
migrateInlinePlanningTaskUploads();
setInterval(cleanupExpiredSessions, 1000 * 60 * 30).unref?.();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'mission-learning-sandbox api ready' });
});

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const validationMessage = validateCredentials(username, password);
  if (validationMessage) {
    res.status(400).json({ message: validationMessage });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ message: '该用户名已被注册' });
    return;
  }

  const userId = createIntegerId(db, 'users', 1);
  const createdAt = nowText();
  db.prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    userId,
    username,
    hashPassword(password),
    'user',
    'active',
    createdAt,
  );

  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const session = createSession(userId);
  setSessionCookie(res, req, session.token, session.expiresAt);
  res.status(201).json({
    expiresAt: session.expiresAt,
    user: mapUser(createdUser),
  });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ message: '用户名或密码错误' });
    return;
  }

  if (user.status !== 'active') {
    res.status(403).json({ message: '当前账号已被禁用' });
    return;
  }

  const session = createSession(user.id);
  setSessionCookie(res, req, session.token, session.expiresAt);
  res.json({
    expiresAt: session.expiresAt,
    user: mapUser(user),
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(req.authToken);
  clearSessionCookie(res, req);
  res.status(204).end();
});

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

app.get('/api/users', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT id, username, role, status, created_at FROM users ORDER BY id').all();
  res.json(rows.map(mapUser));
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ message: '用户不存在' });
    return;
  }

  const nextRole = req.body?.role ?? current.role;
  const nextStatus = req.body?.status ?? current.status;
  if (!['admin', 'user'].includes(nextRole)) {
    res.status(400).json({ message: '角色必须为 admin 或 user' });
    return;
  }
  if (!['active', 'disabled'].includes(nextStatus)) {
    res.status(400).json({ message: '状态必须为 active 或 disabled' });
    return;
  }

  if (req.user.id === id && (nextRole !== 'admin' || nextStatus !== 'active')) {
    res.status(400).json({ message: '不能禁用或降级当前登录管理员账号' });
    return;
  }

  db.prepare('UPDATE users SET role = ?, status = ? WHERE id = ?').run(nextRole, nextStatus, id);
  if (nextStatus !== 'active') {
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
  }

  const updated = db.prepare('SELECT id, username, role, status, created_at FROM users WHERE id = ?').get(id);
  res.json(mapUser(updated));
});

app.get('/api/overview', (_req, res) => {
  res.json(getOverviewPayload());
});

app.get('/api/tasks', (req, res) => {
  const where = [];
  const params = [];
  const moduleFilter = String(req.query.module || '').trim();
  const statusFilter = String(req.query.status || '').trim();
  const keyword = String(req.query.query || '').trim();
  const forceMine = String(req.query.mine || '').trim() === '1';

  if (TASK_MODULE_KEYS.includes(moduleFilter)) {
    where.push('module_key = ?');
    params.push(moduleFilter);
  }

  if (TASK_STATUS_KEYS.includes(statusFilter)) {
    where.push('status = ?');
    params.push(statusFilter);
  }

  if (keyword) {
    where.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  if (req.user.role !== 'admin' || forceMine) {
    where.push('owner_user_id = ?');
    params.push(req.user.id);
  }

  const sql = `
    SELECT *
    FROM tasks
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY updated_at DESC, id DESC
  `;
  const rows = db.prepare(sql).all(...params);
  const tasks = rows.map(mapTask).map((task) => buildTaskPayload(task, { includePlanningState: false }));
  res.json({ tasks });
});

app.post('/api/tasks', (req, res) => {
  const payload = req.body || {};
  const now = nowText();
  const id = createIntegerId(db, 'tasks', 1);
  const name = String(payload.name || '').trim() || `任务 ${id}`;
  const moduleKey = normalizeTaskModule(payload.moduleKey, 'planning');
  const description = String(payload.description || '').trim();
  const status = normalizeTaskStatus(payload.status, 'draft');
  const planningState = normalizePlanningTaskState({
    planningTemplateId: payload.planningTemplateId || 'fire-strike-task',
    planningTaskDefinition: payload.planningTaskDefinition || {},
    planningBindings: payload.planningBindings || {},
    planningAlgorithmInputs: payload.planningAlgorithmInputs || {},
    planningAssessmentName: payload.planningAssessmentName || payload.assessmentName || name,
    fallbackName: name,
    planningStageKey: payload.planningStageKey || 'library',
  });
  const detachedPlanningState = splitPlanningAlgorithmInputsAndAttachments(planningState.planningAlgorithmInputs);
  const sharedContext = sanitizeSharedContext({
    ...payload.sharedContext,
    name: payload?.sharedContext?.name || name,
  });

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO tasks (
        id,
        name,
        module_key,
        planning_template_id,
        planning_assessment_name,
        planning_stage_key,
        planning_task_definition,
        planning_bindings,
        planning_algorithm_inputs,
        status,
        description,
        owner_user_id,
        shared_context,
        latest_run_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      name,
      moduleKey,
      planningState.planningTemplateId,
      planningState.planningAssessmentName,
      planningState.planningStageKey,
      JSON.stringify(planningState.planningTaskDefinition),
      JSON.stringify(planningState.planningBindings),
      JSON.stringify(detachedPlanningState.planningAlgorithmInputs),
      status,
      description,
      req.user.id,
      JSON.stringify(sharedContext),
      now,
      now,
    );
    saveTaskAttachments(id, detachedPlanningState.attachments);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const createdTask = readTaskById(id);
  res.status(201).json({ task: buildTaskPayload(createdTask), recentRuns: [] });
});

app.get('/api/tasks/:id', (req, res) => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ message: '任务 ID 无效' });
    return;
  }

  const task = readTaskById(taskId);
  if (!task) {
    res.status(404).json({ message: '未找到任务' });
    return;
  }
  if (!canAccessTask(task, req.user)) {
    res.status(403).json({ message: '当前账号无权访问该任务' });
    return;
  }

  const recentRuns = getRecentTaskRuns(taskId, 5);
  const summaryRow = db.prepare(`
    SELECT
      COUNT(*) AS totalRuns,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedRuns,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeededRuns
    FROM task_runs
    WHERE task_id = ?
  `).get(taskId);
  res.json({
    task: buildTaskPayload(task),
    recentRuns,
    runSummary: {
      totalRuns: Number(summaryRow?.totalRuns || 0),
      failedRuns: Number(summaryRow?.failedRuns || 0),
      succeededRuns: Number(summaryRow?.succeededRuns || 0),
    },
  });
});

app.get('/api/tasks/:id/runs', (req, res) => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ message: '任务 ID 无效' });
    return;
  }

  const task = readTaskById(taskId);
  if (!task) {
    res.status(404).json({ message: '未找到任务' });
    return;
  }
  if (!canAccessTask(task, req.user)) {
    res.status(403).json({ message: '当前账号无权访问该任务' });
    return;
  }

  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.round(limitRaw), 1), 100)
    : 20;
  const offset = Number.isFinite(offsetRaw)
    ? Math.max(Math.round(offsetRaw), 0)
    : 0;
  const runs = getRecentTaskRuns(taskId, limit, offset);
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM task_runs WHERE task_id = ?').get(taskId)?.count || 0);

  res.json({
    taskId,
    runs,
    total,
    limit,
    offset,
  });
});

app.get('/api/tasks/:id/runs/:runId', (req, res) => {
  const taskId = Number(req.params.id);
  const runId = Number(req.params.runId);
  if (!Number.isInteger(taskId) || taskId <= 0 || !Number.isInteger(runId) || runId <= 0) {
    res.status(400).json({ message: '任务 ID 或执行记录 ID 无效' });
    return;
  }

  const task = readTaskById(taskId);
  if (!task) {
    res.status(404).json({ message: '未找到任务' });
    return;
  }
  if (!canAccessTask(task, req.user)) {
    res.status(403).json({ message: '当前账号无权访问该任务' });
    return;
  }

  const detail = getTaskRunDetail(taskId, runId);
  if (!detail) {
    res.status(404).json({ message: '未找到执行记录' });
    return;
  }

  res.json({
    taskId,
    ...detail,
  });
});

app.put('/api/tasks/:id', (req, res) => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ message: '任务 ID 无效' });
    return;
  }

  const current = readTaskById(taskId);
  if (!current) {
    res.status(404).json({ message: '未找到任务' });
    return;
  }
  if (!canAccessTask(current, req.user)) {
    res.status(403).json({ message: '当前账号无权修改该任务' });
    return;
  }

  const patch = req.body || {};
  const now = nowText();
  const nextName = typeof patch.name === 'string' && patch.name.trim()
    ? patch.name.trim()
    : current.name;
  const nextModule = patch.moduleKey ? normalizeTaskModule(patch.moduleKey, current.moduleKey) : current.moduleKey;
  const nextPlanningTemplateId = patch.planningTemplateId
    ? normalizePlanningTemplateId(patch.planningTemplateId, current.planningTemplateId)
    : current.planningTemplateId;
  const nextDescription = typeof patch.description === 'string' ? patch.description : current.description;
  const nextStatus = patch.status ? normalizeTaskStatus(patch.status, current.status) : current.status;
  const hasPlanningTaskDefinitionPatch = Object.prototype.hasOwnProperty.call(patch, 'planningTaskDefinition');
  const hasPlanningBindingsPatch = Object.prototype.hasOwnProperty.call(patch, 'planningBindings');
  const hasPlanningInputsPatch = Object.prototype.hasOwnProperty.call(patch, 'planningAlgorithmInputs');
  const hasPlanningAssessmentPatch = Object.prototype.hasOwnProperty.call(patch, 'planningAssessmentName')
    || Object.prototype.hasOwnProperty.call(patch, 'assessmentName');
  const hasPlanningStagePatch = Object.prototype.hasOwnProperty.call(patch, 'planningStageKey');
  const shouldResetTaskDefinitionByTemplate = patch.planningTemplateId && !hasPlanningTaskDefinitionPatch;
  const planningState = normalizePlanningTaskState({
    planningTemplateId: nextPlanningTemplateId,
    planningTaskDefinition: shouldResetTaskDefinitionByTemplate
      ? {}
      : (hasPlanningTaskDefinitionPatch ? patch.planningTaskDefinition : current.planningTaskDefinition),
    planningBindings: hasPlanningBindingsPatch ? patch.planningBindings : current.planningBindings,
    planningAlgorithmInputs: hasPlanningInputsPatch ? patch.planningAlgorithmInputs : current.planningAlgorithmInputs,
    planningAssessmentName: hasPlanningAssessmentPatch
      ? (patch.planningAssessmentName || patch.assessmentName)
      : current.planningAssessmentName,
    fallbackName: nextName,
    planningStageKey: hasPlanningStagePatch ? patch.planningStageKey : current.planningStageKey,
  });
  const detachedPlanningState = splitPlanningAlgorithmInputsAndAttachments(planningState.planningAlgorithmInputs);
  const nextSharedContext = patch.sharedContext
    ? mergeSharedContextPatch(current.sharedContext, patch.sharedContext)
    : current.sharedContext;

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE tasks
      SET name = ?,
          module_key = ?,
          planning_template_id = ?,
          planning_assessment_name = ?,
          planning_stage_key = ?,
          planning_task_definition = ?,
          planning_bindings = ?,
          planning_algorithm_inputs = ?,
          status = ?,
          description = ?,
          shared_context = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      nextName,
      nextModule,
      planningState.planningTemplateId,
      planningState.planningAssessmentName,
      planningState.planningStageKey,
      JSON.stringify(planningState.planningTaskDefinition),
      JSON.stringify(planningState.planningBindings),
      JSON.stringify(detachedPlanningState.planningAlgorithmInputs),
      nextStatus,
      nextDescription,
      JSON.stringify(nextSharedContext),
      now,
      taskId,
    );
    saveTaskAttachments(taskId, detachedPlanningState.attachments);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const updated = readTaskById(taskId);
  res.json({ task: buildTaskPayload(updated) });
});

app.post('/api/tasks/:id/submit', (req, res) => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ message: '任务 ID 无效' });
    return;
  }
  const current = readTaskById(taskId);
  if (!current) {
    res.status(404).json({ message: '未找到任务' });
    return;
  }
  if (!canAccessTask(current, req.user)) {
    res.status(403).json({ message: '当前账号无权提交该任务' });
    return;
  }
  if (current.status === 'archived') {
    res.status(409).json({ message: '已归档任务不可提交' });
    return;
  }

  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('submitted', nowText(), taskId);
  const updated = readTaskById(taskId);
  res.json({ task: buildTaskPayload(updated) });
});

app.post('/api/tasks/:id/archive', (req, res) => {
  const taskId = Number(req.params.id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    res.status(400).json({ message: '任务 ID 无效' });
    return;
  }
  const current = readTaskById(taskId);
  if (!current) {
    res.status(404).json({ message: '未找到任务' });
    return;
  }
  if (!canAccessTask(current, req.user)) {
    res.status(403).json({ message: '当前账号无权归档该任务' });
    return;
  }

  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('archived', nowText(), taskId);
  const updated = readTaskById(taskId);
  res.json({ task: buildTaskPayload(updated) });
});

app.get('/api/capability/template', (_req, res) => {
  res.json(getCapabilityTemplate());
});

app.post('/api/capability/evaluate', async (req, res) => {
  try {
    res.json(await evaluateCapability(req.body || {}, { db }));
  } catch (error) {
    const normalized = {
      code: String(error?.code || 'CAPABILITY_EVALUATE_FAILED'),
      type: String(error?.type || 'algorithm_failed'),
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : 400,
      message: String(error?.message || '能力评估计算失败'),
      details: error?.details && typeof error.details === 'object' ? error.details : {},
    };
    res.status(normalized.status).json({
      message: normalized.message,
      error: normalized,
    });
  }
});

app.get('/api/action/template', (_req, res) => {
  res.json(getActionTemplate());
});

app.post('/api/action/evaluate', async (req, res) => {
  try {
    res.json(await evaluateAction(req.body || {}, { db }));
  } catch (error) {
    const normalized = {
      code: String(error?.code || 'ACTION_EVALUATE_FAILED'),
      type: String(error?.type || 'algorithm_failed'),
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : 400,
      message: String(error?.message || '作战行动评估计算失败'),
      details: error?.details && typeof error.details === 'object' ? error.details : {},
    };
    res.status(normalized.status).json({
      message: normalized.message,
      error: normalized,
    });
  }
});

app.get('/api/consumption/template', (_req, res) => {
  res.json(getConsumptionTemplate());
});

app.post('/api/consumption/evaluate', async (req, res) => {
  try {
    res.json(await evaluateConsumption(req.body || {}, { db }));
  } catch (error) {
    const normalized = {
      code: String(error?.code || 'CONSUMPTION_EVALUATE_FAILED'),
      type: String(error?.type || 'algorithm_failed'),
      status: Number.isFinite(Number(error?.status)) ? Number(error.status) : 400,
      message: String(error?.message || '消耗计算评估失败'),
      details: error?.details && typeof error.details === 'object' ? error.details : {},
    };
    res.status(normalized.status).json({
      message: normalized.message,
      error: normalized,
    });
  }
});

app.get('/api/planning/template', (_req, res) => {
  res.json(getPlanningTemplate());
});

app.post('/api/planning/llm/test', async (req, res) => {
  try {
    res.json(await testPlanningLlm(req.body || {}));
  } catch (error) {
    sendPlanningError(res, error, '大模型配置测试失败');
  }
});

app.get('/api/planning/realtime/artifacts', (req, res) => {
  try {
    const result = listPlanningRealtimeArtifacts(req.user, {
      taskId: req.query.taskId,
      algorithmId: req.query.algorithmId,
      query: req.query.query || req.query.keyword,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    sendPlanningError(res, error, '实时生成产物列表读取失败');
  }
});

app.get('/api/planning/realtime/upstream-results', (req, res) => {
  try {
    const result = listPlanningUpstreamResults(req.user, {
      taskId: req.query.taskId,
      algorithmId: req.query.algorithmId,
      query: req.query.query || req.query.keyword,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (error) {
    sendPlanningError(res, error, '前置算法结果列表读取失败');
  }
});

app.get('/api/planning/realtime/artifacts/:id', (req, res) => {
  try {
    const artifact = readPlanningRealtimeArtifactById(Number(req.params.id));
    if (!artifact) {
      throw createPlanningError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 404,
        message: '实时生成产物不存在。',
        details: { artifactId: req.params.id },
      });
    }
    if (!canAccessRealtimeArtifact(artifact, req.user)) {
      throw createPlanningError({
        code: 'PLANNING_PERMISSION_DENIED',
        type: 'permission_denied',
        status: 403,
        message: '当前账号无权访问该实时生成产物。',
        details: { artifactId: artifact.id },
      });
    }
    res.json({ artifact });
  } catch (error) {
    sendPlanningError(res, error, '实时生成产物读取失败');
  }
});

app.patch('/api/planning/realtime/artifacts/:id', (req, res) => {
  try {
    const artifact = readPlanningRealtimeArtifactById(Number(req.params.id));
    if (!artifact) {
      throw createPlanningError({
        code: 'PLANNING_MISSING_DATA',
        type: 'missing_data',
        status: 404,
        message: '实时生成产物不存在。',
        details: { artifactId: req.params.id },
      });
    }
    if (!canAccessRealtimeArtifact(artifact, req.user)) {
      throw createPlanningError({
        code: 'PLANNING_PERMISSION_DENIED',
        type: 'permission_denied',
        status: 403,
        message: '当前账号无权编辑该实时生成产物。',
        details: { artifactId: artifact.id },
      });
    }

    const body = req.body || {};
    const updates = [];
    const params = [];
    if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
      const displayName = String(body.displayName || '').trim();
      if (!displayName) {
        throw createPlanningError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 400,
          message: '实时生成产物名称不能为空。',
          details: { artifactId: artifact.id },
        });
      }
      updates.push('display_name = ?');
      params.push(displayName.slice(0, 120));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      updates.push('description = ?');
      params.push(String(body.description || '').trim().slice(0, 2000));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'resultPayload')) {
      updates.push('result_payload = ?');
      params.push(JSON.stringify(normalizeRealtimeEditablePayload(body.resultPayload)));
    }

    if (updates.length) {
      updates.push('updated_at = ?');
      params.push(nowText(), artifact.id);
      db.prepare(`UPDATE planning_realtime_artifacts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    res.json({ artifact: readPlanningRealtimeArtifactById(artifact.id) });
  } catch (error) {
    sendPlanningError(res, error, '实时生成产物保存失败');
  }
});

app.post('/api/planning/realtime/steps/evaluate', async (req, res) => {
  const body = req.body || {};
  try {
    const task = resolveRealtimeTaskAccess(body.taskCenterId || body.taskId, req.user);
    const inputArtifacts = [
      ...readPlanningRealtimeInputArtifacts(body.inputArtifactIds, req.user),
      ...readPlanningRealtimeInputResultRefs(body.inputResultRefs, req.user),
    ];
    assertUniqueRealtimeArtifactAlgorithms(inputArtifacts);
    const payload = buildRealtimeStepPayloadFromTask(task, body, inputArtifacts);
    const result = await evaluatePlanningRealtimeStep(payload, { db });
    const artifact = savePlanningRealtimeArtifact(req.user, task, result, result.inputArtifactIds || [], {
      displayName: body.displayName,
      description: body.description,
      status: 'succeeded',
    });
    res.status(201).json({
      ok: true,
      artifact,
      result,
    });
  } catch (error) {
    sendPlanningError(res, error, '实时生成单步执行失败');
  }
});

app.post('/api/planning/realtime/steps/evaluate/stream', async (req, res) => {
  setupPlanningEventStream(res);

  const body = req.body || {};
  let task = null;
  let streamFinished = false;
  const abortController = new AbortController();
  const events = {
    emit(type, eventPayload) {
      writePlanningEvent(res, type, eventPayload);
    },
  };
  res.on('close', () => {
    if (!streamFinished) {
      abortController.abort();
    }
  });

  try {
    writePlanningEvent(res, 'run-start', {
      taskCenterId: body.taskCenterId || body.taskId || null,
      assessmentName: body.assessmentName || '',
      phase: 'realtime-initializing',
      realtime: true,
    });

    task = resolveRealtimeTaskAccess(body.taskCenterId || body.taskId, req.user);
    const inputArtifacts = [
      ...readPlanningRealtimeInputArtifacts(body.inputArtifactIds, req.user),
      ...readPlanningRealtimeInputResultRefs(body.inputResultRefs, req.user),
    ];
    assertUniqueRealtimeArtifactAlgorithms(inputArtifacts);
    const payload = buildRealtimeStepPayloadFromTask(task, body, inputArtifacts);
    const result = await evaluatePlanningRealtimeStep(payload, { db, events, signal: abortController.signal });
    const artifact = savePlanningRealtimeArtifact(req.user, task, result, result.inputArtifactIds || [], {
      displayName: body.displayName,
      description: body.description,
      status: 'succeeded',
    });

    writePlanningEvent(res, 'final', {
      ok: true,
      artifact,
      result,
      taskCenterId: task.id,
      realtime: true,
    });
    writePlanningEvent(res, 'done', {
      status: 'succeeded',
      taskCenterId: task.id,
      artifactId: artifact.id,
      realtime: true,
    });
    streamFinished = true;
    res.end();
  } catch (error) {
    const normalizedError = normalizePlanningError(error, '实时生成单步执行失败');
    writePlanningEvent(res, 'error', {
      taskCenterId: task?.id || body.taskCenterId || body.taskId || null,
      code: normalizedError.code,
      errorType: normalizedError.type,
      status: normalizedError.status,
      message: normalizedError.message,
      details: normalizedError.details,
      realtime: true,
    });
    writePlanningEvent(res, 'done', {
      status: 'failed',
      taskCenterId: task?.id || body.taskCenterId || body.taskId || null,
      realtime: true,
    });
    streamFinished = true;
    res.end();
  }
});

app.post('/api/planning/validate', async (req, res) => {
  const body = req.body || {};
  const taskCenterId = Number(body.taskCenterId);
  const hasTaskCenterId = Number.isInteger(taskCenterId) && taskCenterId > 0;

  try {
    let payload = body;
    if (hasTaskCenterId) {
      const task = readTaskById(taskCenterId);
      if (!task) {
        throw createPlanningError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 404,
          message: '未找到对应的规划任务实例。',
          details: { taskCenterId },
        });
      }
      if (!canAccessTask(task, req.user)) {
        throw createPlanningError({
          code: 'PLANNING_PERMISSION_DENIED',
          type: 'permission_denied',
          status: 403,
          message: '当前账号无权访问该规划任务实例。',
          details: { taskCenterId },
        });
      }

      payload = buildPlanningPayloadFromTask(task, body);
    }

    const validation = await validatePlanning(payload, { db });
    res.json({
      ok: true,
      taskCenterId: hasTaskCenterId ? taskCenterId : null,
      task: validation.task,
      summary: validation.summary,
      checks: validation.checks,
    });
  } catch (error) {
    sendPlanningError(res, error, '规划前置校验失败');
  }
});

app.post('/api/planning/evaluate', async (req, res) => {
  const body = req.body || {};
  const taskCenterId = Number(body.taskCenterId);
  const hasTaskCenterId = Number.isInteger(taskCenterId) && taskCenterId > 0;
  let task = null;
  let run = null;

  try {
    let payload = body;
    if (hasTaskCenterId) {
      task = readTaskById(taskCenterId);
      if (!task) {
        throw createPlanningError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 404,
          message: '未找到对应的规划任务实例。',
          details: { taskCenterId },
        });
      }
      if (!canAccessTask(task, req.user)) {
        throw createPlanningError({
          code: 'PLANNING_PERMISSION_DENIED',
          type: 'permission_denied',
          status: 403,
          message: '当前账号无权执行该规划任务实例。',
          details: { taskCenterId },
        });
      }

      payload = buildPlanningPayloadFromTask(task, body);
      run = createTaskRun(taskCenterId, 'running', {
        assessmentName: payload.assessmentName,
        generatedAt: nowIso(),
        phase: 'validating',
      });
      payload.taskCenterId = taskCenterId;
      payload.taskRunId = run?.id || null;
      await validatePlanning(payload, { db });
    }

    const response = await evaluatePlanning(payload, { db });
    if (run && task) {
      finalizeTaskRun(run.id, 'succeeded', buildPlanningRunSummary(response));
      saveTaskResult(task.id, run.id, response);
    }

    res.json({
      ...response,
      runId: run?.id || null,
      taskCenterId: task?.id || null,
    });
  } catch (error) {
    const normalizedError = normalizePlanningError(error, '智能任务规划计算失败');
    if (run && task) {
      finalizeTaskRun(run.id, 'failed', {
        assessmentName: body.assessmentName || task.planningAssessmentName || task.name,
        generatedAt: nowIso(),
        phase: 'failed',
        message: normalizedError.message,
        type: normalizedError.type,
      }, {
        errorCode: normalizedError.code,
        errorMessage: normalizedError.message,
      });
    }
    sendPlanningError(res, normalizedError, '智能任务规划计算失败');
  }
});

app.post('/api/planning/evaluate/stream', async (req, res) => {
  setupPlanningEventStream(res);

  const body = req.body || {};
  const taskCenterId = Number(body.taskCenterId);
  const hasTaskCenterId = Number.isInteger(taskCenterId) && taskCenterId > 0;
  let task = null;
  let run = null;
  let payload = body;
  let streamFinished = false;
  const abortController = new AbortController();
  const events = {
    emit(type, eventPayload) {
      writePlanningEvent(res, type, eventPayload);
    },
  };
  res.on('close', () => {
    if (!streamFinished) {
      abortController.abort();
    }
  });

  try {
    writePlanningEvent(res, 'run-start', {
      taskCenterId: hasTaskCenterId ? taskCenterId : null,
      assessmentName: body.assessmentName || '',
      phase: 'initializing',
    });

    if (hasTaskCenterId) {
      task = readTaskById(taskCenterId);
      if (!task) {
        throw createPlanningError({
          code: 'PLANNING_MISSING_DATA',
          type: 'missing_data',
          status: 404,
          message: '未找到对应的规划任务实例。',
          details: { taskCenterId },
        });
      }
      if (!canAccessTask(task, req.user)) {
        throw createPlanningError({
          code: 'PLANNING_PERMISSION_DENIED',
          type: 'permission_denied',
          status: 403,
          message: '当前账号无权执行该规划任务实例。',
          details: { taskCenterId },
        });
      }

      payload = buildPlanningPayloadFromTask(task, body);
      run = createTaskRun(taskCenterId, 'running', {
        assessmentName: payload.assessmentName,
        generatedAt: nowIso(),
        phase: 'validating',
      });
      payload.taskCenterId = taskCenterId;
      payload.taskRunId = run?.id || null;
      writePlanningEvent(res, 'run-start', {
        taskCenterId,
        runId: run?.id || null,
        assessmentName: payload.assessmentName,
        phase: 'created',
      });
    }

    writePlanningEvent(res, 'validation', {
      runId: run?.id || null,
      taskCenterId: task?.id || null,
      status: 'running',
      message: '规划前置校验开始。',
    });
    const validation = await validatePlanning(payload, { db });
    writePlanningEvent(res, 'validation', {
      runId: run?.id || null,
      taskCenterId: task?.id || null,
      status: 'succeeded',
      summary: validation.summary,
      checks: validation.checks,
      message: '规划前置校验通过。',
    });

    const response = await evaluatePlanning(payload, { db, events, signal: abortController.signal });
    if (run && task) {
      finalizeTaskRun(run.id, 'succeeded', buildPlanningRunSummary(response));
      saveTaskResult(task.id, run.id, response);
    }

    writePlanningEvent(res, 'final', {
      ...response,
      runId: run?.id || null,
      taskCenterId: task?.id || null,
    });
    writePlanningEvent(res, 'done', {
      runId: run?.id || null,
      taskCenterId: task?.id || null,
      status: 'succeeded',
    });
    streamFinished = true;
    res.end();
  } catch (error) {
    const normalizedError = normalizePlanningError(error, '智能任务规划计算失败');
    if (run && task) {
      finalizeTaskRun(run.id, 'failed', {
        assessmentName: payload.assessmentName || body.assessmentName || task.planningAssessmentName || task.name,
        generatedAt: nowIso(),
        phase: 'failed',
        message: normalizedError.message,
        type: normalizedError.type,
      }, {
        errorCode: normalizedError.code,
        errorMessage: normalizedError.message,
      });
    }
    writePlanningEvent(res, 'error', {
      runId: run?.id || null,
      taskCenterId: task?.id || null,
      code: normalizedError.code,
      errorType: normalizedError.type,
      status: normalizedError.status,
      message: normalizedError.message,
      details: normalizedError.details,
    });
    writePlanningEvent(res, 'done', {
      runId: run?.id || null,
      taskCenterId: task?.id || null,
      status: 'failed',
    });
    streamFinished = true;
    res.end();
  }
});
app.get('/api/resource-sources', (req, res) => {
  const taskId = normalizeOptionalTaskId(req.query.taskId);
  const rows = taskId
    ? db.prepare('SELECT * FROM sources WHERE task_id = ? ORDER BY updated_at DESC, id DESC').all(taskId)
    : db.prepare('SELECT * FROM sources ORDER BY updated_at DESC, id DESC').all();
  res.json(rows.map(mapSource));
});

app.get('/api/resource-sources/:id/preview', (req, res) => {
  const sourceId = Number(req.params.id);
  const sourceRow = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!sourceRow) {
    res.status(404).json({ message: '数据源不存在' });
    return;
  }

  const previewRow = db.prepare('SELECT * FROM source_contents WHERE source_id = ?').get(sourceId);
  res.json({
    source: mapSource(sourceRow),
    preview: previewRow ? mapSourcePreview(previewRow) : null,
  });
});

app.post('/api/resource-sources/import', requireAdmin, async (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.type) {
    res.status(400).json({ message: '导入数据源需要提供 name 和 type' });
    return;
  }

  try {
    const taskId = normalizeOptionalTaskId(payload.taskId);
    ensureImportTaskAccess(taskId, req.user);
    const created = await createImportedSource(db, payload, {
      taskId,
      createdByUserId: req.user.id,
    });
    res.status(201).json({
      source: mapSource(created.source),
      preview: mapSourcePreview(created.preview),
      extractions: created.extractions.map(mapExtraction),
    });
  } catch (error) {
    const status = Number.isInteger(Number(error?.status)) ? Number(error.status) : 400;
    res.status(status).json({ message: error?.message || '导入数据源失败' });
  }
});

app.get('/api/resource-import-batches', requireAdmin, (req, res) => {
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const taskId = normalizeOptionalTaskId(req.query.taskId);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 100) : 20;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.round(offsetRaw), 0) : 0;

  const where = [];
  const params = [];
  if (taskId) {
    where.push('task_id = ?');
    params.push(taskId);
  }

  const countRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM import_batches
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `).get(...params);
  const total = Number(countRow?.count || 0);

  const batchRows = db.prepare(`
    SELECT *
    FROM import_batches
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY updated_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  if (!batchRows.length) {
    res.json({
      total,
      limit,
      offset,
      batches: [],
    });
    return;
  }

  const batchIdList = batchRows.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0);
  const placeholders = batchIdList.map(() => '?').join(', ');
  const itemRows = db.prepare(`
    SELECT *
    FROM import_batch_items
    WHERE batch_id IN (${placeholders})
    ORDER BY batch_id DESC, item_index ASC, id ASC
  `).all(...batchIdList);

  const itemsByBatchId = new Map();
  for (const row of itemRows) {
    const key = Number(row.batch_id);
    const list = itemsByBatchId.get(key) || [];
    list.push(row);
    itemsByBatchId.set(key, list);
  }

  res.json({
    total,
    limit,
    offset,
    batches: batchRows.map((row) => buildImportBatchResponse(row, itemsByBatchId.get(Number(row.id)) || [])),
  });
});

app.post('/api/resource-import-batches', requireAdmin, async (req, res) => {
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    res.status(400).json({ message: '批量导入至少需要一条导入项。' });
    return;
  }

  const batchTaskId = normalizeOptionalTaskId(payload.taskId);
  try {
    ensureImportTaskAccess(batchTaskId, req.user);
  } catch (error) {
    const status = Number.isInteger(Number(error?.status)) ? Number(error.status) : 400;
    res.status(status).json({ message: error?.message || '关联任务校验失败。' });
    return;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const sourceType = String(item.type || '').trim();
    if (!sourceType) {
      res.status(400).json({ message: `第 ${index + 1} 条导入项缺少 type。` });
      return;
    }
    const itemTaskId = normalizeOptionalTaskId(item.taskId ?? batchTaskId);
    try {
      ensureImportTaskAccess(itemTaskId, req.user);
    } catch (error) {
      const status = Number.isInteger(Number(error?.status)) ? Number(error.status) : 400;
      res.status(status).json({ message: `第 ${index + 1} 条导入项任务校验失败：${error?.message || '任务不可访问'}` });
      return;
    }
  }

  const now = nowText();
  const batchId = createIntegerId(db, 'import_batches', 1);
  const batchKey = createImportBatchKey();
  db.prepare(`
    INSERT INTO import_batches (
      id, batch_key, task_id, created_by_user_id, status, total_count, succeeded_count, failed_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    batchId,
    batchKey,
    batchTaskId,
    req.user.id,
    'running',
    items.length,
    0,
    0,
    now,
    now,
  );

  let nextItemId = createIntegerId(db, 'import_batch_items', 1);
  const insertedItemIds = [];
  const insertItem = db.prepare(`
    INSERT INTO import_batch_items (
      id, batch_id, item_index, task_id, source_name, source_type, file_name, status, attempt_count, failure_reason, source_id, request_payload, result_payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const itemTaskId = normalizeOptionalTaskId(item.taskId ?? batchTaskId);
    const requestPayload = {
      ...item,
      taskId: itemTaskId,
      name: String(item.name || '').trim() || `批量导入-${index + 1}`,
      type: String(item.type || '').trim(),
    };

    insertItem.run(
      nextItemId,
      batchId,
      index + 1,
      itemTaskId,
      requestPayload.name,
      requestPayload.type,
      String(requestPayload.fileName || '').trim(),
      'pending',
      0,
      '',
      null,
      JSON.stringify(requestPayload),
      JSON.stringify({}),
      now,
      now,
    );
    insertedItemIds.push(nextItemId);
    nextItemId += 1;
  }

  for (const itemId of insertedItemIds) {
    const row = db.prepare('SELECT * FROM import_batch_items WHERE id = ?').get(itemId);
    if (!row) continue;
    await executeImportBatchItem(row, {
      batchId,
      batchKey,
      userId: req.user.id,
    });
  }

  const batchRow = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  const itemRows = db.prepare('SELECT * FROM import_batch_items WHERE batch_id = ? ORDER BY item_index ASC, id ASC').all(batchId);
  res.status(201).json({
    batch: buildImportBatchResponse(batchRow, itemRows),
  });
});

app.post('/api/resource-import-batches/:batchId/items/:itemId/retry', requireAdmin, async (req, res) => {
  const batchId = Number(req.params.batchId);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(batchId) || batchId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
    res.status(400).json({ message: '批次 ID 或导入项 ID 无效。' });
    return;
  }

  const batchRow = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  if (!batchRow) {
    res.status(404).json({ message: '未找到导入批次。' });
    return;
  }

  const itemRow = db.prepare('SELECT * FROM import_batch_items WHERE id = ? AND batch_id = ?').get(itemId, batchId);
  if (!itemRow) {
    res.status(404).json({ message: '未找到导入项。' });
    return;
  }

  const taskId = normalizeOptionalTaskId(itemRow.task_id);
  try {
    ensureImportTaskAccess(taskId, req.user);
    await executeImportBatchItem(itemRow, {
      batchId,
      batchKey: String(batchRow.batch_key || ''),
      userId: req.user.id,
    });
  } catch (error) {
    const status = Number.isInteger(Number(error?.status)) ? Number(error.status) : 400;
    res.status(status).json({ message: error?.message || '重试导入失败。' });
    return;
  }

  const refreshedBatch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  const refreshedItems = db.prepare('SELECT * FROM import_batch_items WHERE batch_id = ? ORDER BY item_index ASC, id ASC').all(batchId);
  const refreshedItem = mapImportBatchItem(db.prepare('SELECT * FROM import_batch_items WHERE id = ?').get(itemId));
  res.json({
    batch: buildImportBatchResponse(refreshedBatch, refreshedItems),
    item: {
      ...refreshedItem,
      requestPayload: summarizeImportPayload(refreshedItem.requestPayload),
    },
  });
});

app.delete('/api/resource-sources/:id', requireAdmin, (req, res) => {
  const sourceId = Number(req.params.id);
  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId);
  if (!source) {
    res.status(404).json({ message: '未找到对应数据源' });
    return;
  }

  const intelCount = db.prepare('SELECT COUNT(*) AS count FROM intelligence WHERE source_id = ?').get(sourceId).count;
  const environmentCount = db.prepare('SELECT COUNT(*) AS count FROM environment WHERE source_id = ?').get(sourceId).count;
  if (intelCount > 0 || environmentCount > 0) {
    res.status(409).json({ message: '数据源仍被情报或环境记录引用，无法删除' });
    return;
  }

  db.prepare('DELETE FROM extractions WHERE source_id = ?').run(sourceId);
  db.prepare('DELETE FROM source_contents WHERE source_id = ?').run(sourceId);
  db.prepare('UPDATE import_batch_items SET source_id = NULL, updated_at = ? WHERE source_id = ?').run(nowText(), sourceId);
  db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
  res.status(204).end();
});

app.get('/api/intelligence', (req, res) => {
  const camp = req.query.camp?.toString();
  const category = req.query.category?.toString();
  let sql = 'SELECT * FROM intelligence WHERE 1 = 1';
  const params = [];

  if (camp) {
    sql += ' AND camp = ?';
    params.push(camp);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY updated_at DESC, id DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(mapIntelligence));
});

app.post('/api/intelligence', requireAdmin, (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.category || !payload.role) {
    res.status(400).json({ message: '情报记录需要 name/category/role' });
    return;
  }

  const id = createIntegerId(db, 'intelligence', 1001);
  const sourceIdResolution = resolveExistingSourceId(payload.sourceId, 1);
  if (sourceIdResolution.message) {
    res.status(400).json({ message: sourceIdResolution.message });
    return;
  }

  const sourceId = sourceIdResolution.sourceId;
  const record = {
    id,
    camp: payload.camp || 'blue',
    category: payload.category,
    name: payload.name,
    role: payload.role,
    latitude: Number(payload.latitude || 18.5),
    longitude: Number(payload.longitude || 148.5),
    strength: Number(payload.strength || 1),
    readiness: payload.readiness || '待命',
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    sourceId,
    notes: payload.notes || '',
    updatedAt: nowText(),
  };

  try {
    db.prepare('INSERT INTO intelligence (id, camp, category, name, role, latitude, longitude, strength, readiness, tags, source_id, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      record.id,
      record.camp,
      record.category,
      record.name,
      record.role,
      record.latitude,
      record.longitude,
      record.strength,
      record.readiness,
      JSON.stringify(record.tags),
      record.sourceId,
      record.notes,
      record.updatedAt,
    );

    const created = db.prepare('SELECT * FROM intelligence WHERE id = ?').get(id);
    res.status(201).json(mapIntelligence(created));
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      res.status(400).json({ message: '未找到对应数据源' });
      return;
    }

    res.status(500).json({ message: '新增情报记录失败' });
  }
});

app.put('/api/intelligence/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM intelligence WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ message: '情报记录不存在' });
    return;
  }

  const sourceIdResolution = resolveExistingSourceId(req.body?.sourceId ?? current.source_id, 1);
  if (sourceIdResolution.message) {
    res.status(400).json({ message: sourceIdResolution.message });
    return;
  }

  const payload = {
    camp: req.body?.camp ?? current.camp,
    name: req.body?.name ?? current.name,
    role: req.body?.role ?? current.role,
    category: req.body?.category ?? current.category,
    readiness: req.body?.readiness ?? current.readiness,
    strength: Number(req.body?.strength ?? current.strength),
    latitude: Number(req.body?.latitude ?? current.latitude),
    longitude: Number(req.body?.longitude ?? current.longitude),
    notes: req.body?.notes ?? current.notes,
    sourceId: sourceIdResolution.sourceId,
    tags: Array.isArray(req.body?.tags) ? req.body.tags : JSON.parse(current.tags),
    updatedAt: nowText(),
  };

  try {
    db.prepare('UPDATE intelligence SET camp = ?, name = ?, role = ?, category = ?, readiness = ?, strength = ?, latitude = ?, longitude = ?, notes = ?, source_id = ?, tags = ?, updated_at = ? WHERE id = ?').run(
      payload.camp,
      payload.name,
      payload.role,
      payload.category,
      payload.readiness,
      payload.strength,
      payload.latitude,
      payload.longitude,
      payload.notes,
      payload.sourceId,
      JSON.stringify(payload.tags),
      payload.updatedAt,
      id,
    );

    const updated = db.prepare('SELECT * FROM intelligence WHERE id = ?').get(id);
    res.json(mapIntelligence(updated));
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      res.status(400).json({ message: '未找到对应数据源' });
      return;
    }

    res.status(500).json({ message: '更新情报记录失败' });
  }
});

app.delete('/api/intelligence/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM intelligence WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ message: '情报记录不存在' });
    return;
  }

  db.prepare('DELETE FROM intelligence WHERE id = ?').run(id);
  res.status(204).end();
});

app.get('/api/environment', (_req, res) => {
  const rows = db.prepare('SELECT * FROM environment ORDER BY updated_at DESC, id DESC').all();
  res.json(rows.map(mapEnvironment));
});

app.post('/api/environment', requireAdmin, (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.kind || !payload.geometryType || !payload.geometry) {
    res.status(400).json({ message: '环境记录需要提供 name、kind 和 geometry' });
    return;
  }

  const sourceIdResolution = resolveExistingSourceId(payload.sourceId, 1);
  if (sourceIdResolution.message) {
    res.status(400).json({ message: sourceIdResolution.message });
    return;
  }

  const record = {
    id: createIntegerId(db, 'environment', 301),
    kind: payload.kind,
    name: payload.name,
    geometryType: payload.geometryType,
    geometry: payload.geometry,
    weather: payload.weather || 'General Environment',
    riskLevel: payload.riskLevel || 'Medium',
    notes: payload.notes || '',
    sourceId: sourceIdResolution.sourceId,
    updatedAt: nowText(),
  };

  db.prepare('INSERT INTO environment (id, kind, name, geometry_type, geometry, weather, risk_level, updated_at, notes, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    record.id,
    record.kind,
    record.name,
    record.geometryType,
    JSON.stringify(record.geometry),
    record.weather,
    record.riskLevel,
    record.updatedAt,
    record.notes,
    record.sourceId,
  );

  const created = db.prepare('SELECT * FROM environment WHERE id = ?').get(record.id);
  res.status(201).json(mapEnvironment(created));
});

app.put('/api/environment/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM environment WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ message: '未找到环境记录' });
    return;
  }

  const sourceIdResolution = resolveExistingSourceId(req.body?.sourceId ?? current.source_id, 1);
  if (sourceIdResolution.message) {
    res.status(400).json({ message: sourceIdResolution.message });
    return;
  }

  const payload = {
    kind: req.body?.kind ?? current.kind,
    name: req.body?.name ?? current.name,
    geometryType: req.body?.geometryType ?? current.geometry_type,
    geometry: req.body?.geometry ?? JSON.parse(current.geometry),
    weather: req.body?.weather ?? current.weather,
    riskLevel: req.body?.riskLevel ?? current.risk_level,
    notes: req.body?.notes ?? current.notes,
    sourceId: sourceIdResolution.sourceId,
    updatedAt: nowText(),
  };

  db.prepare('UPDATE environment SET kind = ?, name = ?, geometry_type = ?, geometry = ?, weather = ?, risk_level = ?, updated_at = ?, notes = ?, source_id = ? WHERE id = ?').run(
    payload.kind,
    payload.name,
    payload.geometryType,
    JSON.stringify(payload.geometry),
    payload.weather,
    payload.riskLevel,
    payload.updatedAt,
    payload.notes,
    payload.sourceId,
    id,
  );

  const updated = db.prepare('SELECT * FROM environment WHERE id = ?').get(id);
  res.json(mapEnvironment(updated));
});

app.delete('/api/environment/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM environment WHERE id = ?').get(id);
  if (!current) {
    res.status(404).json({ message: '未找到环境记录' });
    return;
  }

  db.prepare('DELETE FROM environment WHERE id = ?').run(id);
  res.status(204).end();
});

app.get('/api/extractions', (_req, res) => {
  const rows = db.prepare("SELECT * FROM extractions ORDER BY CASE WHEN created_at = '' THEN 1 ELSE 0 END, created_at DESC, id DESC").all();
  res.json(rows.map(mapExtraction));
});

app.get('/api/knowledge-graph', (req, res) => {
  const query = (req.query.query?.toString() || '').trim();
  const mode = (req.query.mode?.toString() || 'balanced').trim();
  const graph = buildKnowledgeGraph(db, { mode });
  res.json(filterKnowledgeGraph(graph, query));
});

app.get('/api/situation-entities', (_req, res) => {
  const rows = db.prepare('SELECT * FROM situation_entities ORDER BY id').all();
  res.json(rows.map(mapSituationEntity));
});

app.post('/api/situation-entities', requireAdmin, (req, res) => {
  const payload = {
    id: createSituationId(),
    name: req.body.name || '新建态势要素',
    type: req.body.type || 'unit',
    camp: req.body.camp || 'neutral',
    layerKey: req.body.layerKey || 'symbols',
    color: req.body.color || '#a3e635',
    geometryType: req.body.geometryType || 'point',
    coordinates: req.body.coordinates || [148.0, 18.0],
    radius: req.body.radius ?? null,
    annotation: req.body.annotation || '',
    visible: req.body.visible === false ? 0 : 1,
    meta: req.body.meta || {},
  };

  db.prepare('INSERT INTO situation_entities (id, name, type, camp, layer_key, color, geometry_type, coordinates, radius, annotation, visible, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    payload.id,
    payload.name,
    payload.type,
    payload.camp,
    payload.layerKey,
    payload.color,
    payload.geometryType,
    JSON.stringify(payload.coordinates),
    payload.radius,
    payload.annotation,
    payload.visible,
    JSON.stringify(payload.meta),
  );

  const created = db.prepare('SELECT * FROM situation_entities WHERE id = ?').get(payload.id);
  res.status(201).json(mapSituationEntity(created));
});

app.put('/api/situation-entities/:id', requireAdmin, (req, res) => {
  const current = db.prepare('SELECT * FROM situation_entities WHERE id = ?').get(req.params.id);
  if (!current) {
    res.status(404).json({ message: '态势要素不存在' });
    return;
  }

  const payload = {
    name: req.body.name ?? current.name,
    type: req.body.type ?? current.type,
    camp: req.body.camp ?? current.camp,
    layerKey: req.body.layerKey ?? current.layer_key,
    color: req.body.color ?? current.color,
    geometryType: req.body.geometryType ?? current.geometry_type,
    coordinates: req.body.coordinates ?? JSON.parse(current.coordinates),
    radius: req.body.radius ?? current.radius,
    annotation: req.body.annotation ?? current.annotation,
    visible: typeof req.body.visible === 'boolean' ? Number(req.body.visible) : current.visible,
    meta: req.body.meta ?? JSON.parse(current.meta || '{}'),
  };

  db.prepare('UPDATE situation_entities SET name = ?, type = ?, camp = ?, layer_key = ?, color = ?, geometry_type = ?, coordinates = ?, radius = ?, annotation = ?, visible = ?, meta = ? WHERE id = ?').run(
    payload.name,
    payload.type,
    payload.camp,
    payload.layerKey,
    payload.color,
    payload.geometryType,
    JSON.stringify(payload.coordinates),
    payload.radius,
    payload.annotation,
    payload.visible,
    JSON.stringify(payload.meta),
    req.params.id,
  );

  const updated = db.prepare('SELECT * FROM situation_entities WHERE id = ?').get(req.params.id);
  res.json(mapSituationEntity(updated));
});

app.delete('/api/situation-entities/:id', requireAdmin, (req, res) => {
  const exists = db.prepare('SELECT id FROM situation_entities WHERE id = ?').get(req.params.id);
  if (!exists) {
    res.status(404).json({ message: '态势要素不存在' });
    return;
  }

  db.prepare('DELETE FROM situation_entities WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.use('/api', (_req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

if (fs.existsSync(webIndex)) {
  if (fs.existsSync(webPublic)) {
    app.use(express.static(webPublic));
  }
  app.use(express.static(webDist));
  app.use((_req, res) => {
    res.sendFile(webIndex);
  });
}

app.listen(port, () => {
  console.log(`mission-learning-sandbox server running at http://localhost:${port}`);
});

