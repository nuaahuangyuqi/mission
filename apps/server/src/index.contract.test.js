import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

function createPort() {
  return 3300 + Math.floor(Math.random() * 1000);
}

async function startServer(port) {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), `mission-contract-${port}-`));
  const dbPath = path.join(dbDir, 'mission-demo.sqlite');
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(serverDir, '..'),
    env: {
      ...process.env,
      MISSION_DB_FILE: dbPath,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.missionDbPath = dbPath;
  child.missionDbDir = dbDir;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`server did not start on port ${port}`));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    }

    function onStdout(chunk) {
      const text = String(chunk || '');
      if (text.includes(`http://localhost:${port}`)) {
        cleanup();
        resolve();
      }
    }

    function onStderr() {
      // Node SQLite still emits experimental warnings on stderr.
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`server exited early with code ${code}`));
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('exit', onExit);
  });

  return child;
}

async function stopServer(child) {
  if (!child || child.killed) {
    return;
  }

  await new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }, 5000).unref?.();
  });

  if (child.missionDbDir) {
    fs.rmSync(child.missionDbDir, { recursive: true, force: true });
  }
}

async function login(port) {
  const response = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: 'admin',
      password: '123456',
    }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie') || '';
}

async function createThreatOnlyPlanningTask(port, cookie, namePrefix = 'contract-task') {
  const fileContentBase64 = Buffer.from('东侧发现防空节点，北侧存在通信中继站。', 'utf8').toString('base64');
  const response = await fetch(`http://localhost:${port}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify({
      moduleKey: 'planning',
      name: `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      planningTemplateId: 'fire-strike-task',
      planningTaskDefinition: {
        id: `${namePrefix}-threat-only`,
        name: '上游结果测试任务',
        category: '测试',
        steps: [
          {
            id: 'step-threat-analysis',
            order: 1,
            name: '敌情威胁自动分析',
            algorithmId: 'enemy-threat-analysis',
            objective: '生成敌情结果',
            consumes: ['本地文件'],
            produces: ['威胁模型'],
          },
        ],
        defaultBindings: {
          'step-threat-analysis': 'enemy-threat-analysis:builtin',
        },
      },
      planningBindings: {
        'step-threat-analysis': 'enemy-threat-analysis:builtin',
      },
      planningAlgorithmInputs: {
        'enemy-threat-analysis': {
          builtinMethodKey: 'knowledge-fusion',
          selectedSourceIds: [],
          uploadedFiles: [
            {
              id: `${namePrefix}-file-1`,
              fileName: 'enemy-upstream.txt',
              fileExtension: '.txt',
              size: 66,
              fileContentBase64,
            },
          ],
          options: {
            analysisFocus: 'comprehensive',
            heatmapDensity: 'low',
            impactBias: 'balanced',
          },
        },
      },
    }),
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.ok(payload?.task?.id);
  return payload.task.id;
}

test('unknown authenticated api paths return json 404 instead of html shell', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const response = await fetch(`http://localhost:${port}/api/does-not-exist`, {
      headers: { cookie },
    });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.match(String(response.headers.get('content-type') || ''), /application\/json/i);
    assert.equal(payload.message, '接口不存在');
  } finally {
    await stopServer(child);
  }
});

test('task list omits planning payload blobs while task detail rehydrates uploaded files', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const fileContentBase64 = Buffer.from('name,count\nalpha,2\n', 'utf8').toString('base64');
    const createResponse = await fetch(`http://localhost:${port}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        moduleKey: 'planning',
        name: `contract-task-${Date.now()}`,
        planningTemplateId: 'fire-strike-task',
        planningAlgorithmInputs: {
          'enemy-threat-analysis': {
            builtinMethodKey: 'keyword-extract',
            selectedSourceIds: [],
            uploadedFiles: [
              {
                id: 'contract-file-1',
                fileName: 'contract.csv',
                fileExtension: '.csv',
                size: 19,
                fileContentBase64,
              },
            ],
            options: {},
          },
        },
      }),
    });

    assert.equal(createResponse.status, 201);
    const createdPayload = await createResponse.json();
    const taskId = createdPayload?.task?.id;
    assert.ok(taskId);

    const listResponse = await fetch(`http://localhost:${port}/api/tasks?module=planning&mine=1`, {
      headers: { cookie },
    });
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    const listedTask = (listPayload.tasks || []).find((item) => Number(item.id) === Number(taskId));
    assert.ok(listedTask);
    assert.equal(Object.prototype.hasOwnProperty.call(listedTask, 'planningAlgorithmInputs'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(listedTask, 'planningTaskDefinition'), false);

    const detailResponse = await fetch(`http://localhost:${port}/api/tasks/${taskId}`, {
      headers: { cookie },
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    const uploadedFiles = detailPayload?.task?.planningAlgorithmInputs?.['enemy-threat-analysis']?.uploadedFiles || [];
    assert.equal(uploadedFiles.length, 1);
    assert.equal(uploadedFiles[0].fileContentBase64, fileContentBase64);
  } finally {
    await stopServer(child);
  }
});

test('planning task instances can be renamed', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const taskId = await createThreatOnlyPlanningTask(port, cookie, 'rename-task');
    const nextName = `renamed-planning-task-${Date.now()}`;

    const renameResponse = await fetch(`http://localhost:${port}/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        name: nextName,
        sharedContext: { name: nextName },
      }),
    });
    assert.equal(renameResponse.status, 200);
    const renamePayload = await renameResponse.json();
    assert.equal(renamePayload?.task?.name, nextName);

    const detailResponse = await fetch(`http://localhost:${port}/api/tasks/${taskId}`, {
      headers: { cookie },
    });
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload?.task?.name, nextName);
    assert.equal(detailPayload?.task?.sharedContext?.name, nextName);
  } finally {
    await stopServer(child);
  }
});

test('planning upstream results include task run steps and validate realtime refs', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const fileContentBase64 = Buffer.from('东侧发现防空节点，北侧存在通信中继站。', 'utf8').toString('base64');
    const createResponse = await fetch(`http://localhost:${port}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        moduleKey: 'planning',
        name: `upstream-task-${Date.now()}`,
        planningTemplateId: 'fire-strike-task',
        planningTaskDefinition: {
          id: 'upstream-threat-only',
          name: '上游结果测试任务',
          category: '测试',
          steps: [
            {
              id: 'step-threat-analysis',
              order: 1,
              name: '敌情威胁自动分析',
              algorithmId: 'enemy-threat-analysis',
              objective: '生成敌情结果',
              consumes: ['本地文件'],
              produces: ['威胁模型'],
            },
          ],
          defaultBindings: {
            'step-threat-analysis': 'enemy-threat-analysis:builtin',
          },
        },
        planningBindings: {
          'step-threat-analysis': 'enemy-threat-analysis:builtin',
        },
        planningAlgorithmInputs: {
          'enemy-threat-analysis': {
            builtinMethodKey: 'knowledge-fusion',
            selectedSourceIds: [],
            uploadedFiles: [
              {
                id: 'upstream-file-1',
                fileName: 'enemy-upstream.txt',
                fileExtension: '.txt',
                size: 66,
                fileContentBase64,
              },
            ],
            options: {
              analysisFocus: 'comprehensive',
              heatmapDensity: 'low',
              impactBias: 'balanced',
            },
          },
        },
      }),
    });

    assert.equal(createResponse.status, 201);
    const createdPayload = await createResponse.json();
    const taskId = createdPayload?.task?.id;
    assert.ok(taskId);

    const evaluateResponse = await fetch(`http://localhost:${port}/api/planning/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: taskId,
        assessmentName: '上游结果测试执行',
      }),
    });
    assert.equal(evaluateResponse.status, 200);
    const evaluatedPayload = await evaluateResponse.json();
    const runId = evaluatedPayload.runId;
    assert.ok(runId);

    const listResponse = await fetch(`http://localhost:${port}/api/planning/realtime/upstream-results?algorithmId=enemy-threat-analysis`, {
      headers: { cookie },
    });
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    const taskRunStep = (listPayload.results || []).find((item) => (
      item.sourceType === 'task-run-step'
      && Number(item.taskId) === Number(taskId)
      && Number(item.runId) === Number(runId)
      && item.algorithmId === 'enemy-threat-analysis'
    ));
    assert.ok(taskRunStep);
    assert.deepEqual(taskRunStep.resultRef, {
      sourceType: 'task-run-step',
      taskId,
      runId,
      stepId: 'step-threat-analysis',
      algorithmId: 'enemy-threat-analysis',
    });

    const duplicateResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: taskId,
        algorithmId: 'force-grouping',
        inputResultRefs: [taskRunStep.resultRef, taskRunStep.resultRef],
      }),
    });
    assert.equal(duplicateResponse.status, 400);
    const duplicatePayload = await duplicateResponse.json();
    assert.equal(duplicatePayload.error.code, 'PLANNING_REALTIME_DUPLICATE_INPUT');

    const missingResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: taskId,
        algorithmId: 'force-grouping',
        inputResultRefs: [
          {
            sourceType: 'task-run-step',
            taskId,
            runId: runId + 99999,
            stepId: 'step-threat-analysis',
          },
        ],
      }),
    });
    assert.equal(missingResponse.status, 404);
    const missingPayload = await missingResponse.json();
    assert.equal(missingPayload.error.code, 'PLANNING_MISSING_DATA');
  } finally {
    await stopServer(child);
  }
});

test('planning realtime artifacts can be renamed and bulk deleted from upstream refs', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const taskId = await createThreatOnlyPlanningTask(port, cookie, 'artifact-manage-task');
    const consumerTaskId = await createThreatOnlyPlanningTask(port, cookie, 'artifact-consumer-task');

    const realtimeResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: taskId,
        algorithmId: 'enemy-threat-analysis',
        displayName: '待管理算法产物',
      }),
    });
    assert.equal(realtimeResponse.status, 201);
    const realtimePayload = await realtimeResponse.json();
    const artifactId = realtimePayload?.artifact?.id;
    assert.ok(artifactId);

    const nextDisplayName = `renamed-artifact-${Date.now()}`;
    const renameResponse = await fetch(`http://localhost:${port}/api/planning/realtime/artifacts/${artifactId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ displayName: nextDisplayName }),
    });
    assert.equal(renameResponse.status, 200);
    const renamePayload = await renameResponse.json();
    assert.equal(renamePayload?.artifact?.displayName, nextDisplayName);

    const beforeDeleteListResponse = await fetch(`http://localhost:${port}/api/planning/realtime/upstream-results?algorithmId=enemy-threat-analysis`, {
      headers: { cookie },
    });
    assert.equal(beforeDeleteListResponse.status, 200);
    const beforeDeleteListPayload = await beforeDeleteListResponse.json();
    const upstreamArtifact = (beforeDeleteListPayload.results || []).find((item) => (
      item.sourceType === 'realtime-artifact'
      && Number(item.artifactId) === Number(artifactId)
    ));
    assert.ok(upstreamArtifact);
    assert.equal(upstreamArtifact.displayName, nextDisplayName);

    const missingArtifactId = Number(artifactId) + 999999;
    const deleteResponse = await fetch(`http://localhost:${port}/api/planning/realtime/artifacts/bulk-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ artifactIds: [artifactId, missingArtifactId] }),
    });
    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json();
    assert.deepEqual(deletePayload.deletedArtifactIds, [artifactId]);
    assert.equal(deletePayload.deletedCount, 1);
    assert.deepEqual(deletePayload.missingArtifactIds, [missingArtifactId]);

    const artifactAfterDelete = await fetch(`http://localhost:${port}/api/planning/realtime/artifacts/${artifactId}`, {
      headers: { cookie },
    });
    assert.equal(artifactAfterDelete.status, 404);

    const afterDeleteListResponse = await fetch(`http://localhost:${port}/api/planning/realtime/upstream-results?algorithmId=enemy-threat-analysis`, {
      headers: { cookie },
    });
    assert.equal(afterDeleteListResponse.status, 200);
    const afterDeleteListPayload = await afterDeleteListResponse.json();
    assert.equal((afterDeleteListPayload.results || []).some((item) => (
      item.sourceType === 'realtime-artifact'
      && Number(item.artifactId) === Number(artifactId)
    )), false);

    const staleRealtimeRefResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: consumerTaskId,
        algorithmId: 'force-grouping',
        inputResultRefs: [upstreamArtifact.resultRef],
      }),
    });
    assert.equal(staleRealtimeRefResponse.status, 404);
    const staleRealtimeRefPayload = await staleRealtimeRefResponse.json();
    assert.equal(staleRealtimeRefPayload.error.code, 'PLANNING_MISSING_DATA');
  } finally {
    await stopServer(child);
  }
});

test('bulk deleting planning tasks removes runs, realtime artifacts, attachments, and upstream refs', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const taskId = await createThreatOnlyPlanningTask(port, cookie, 'delete-source-task');
    const consumerTaskId = await createThreatOnlyPlanningTask(port, cookie, 'delete-consumer-task');

    const evaluateResponse = await fetch(`http://localhost:${port}/api/planning/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: taskId,
        assessmentName: '删除链路完整执行',
      }),
    });
    assert.equal(evaluateResponse.status, 200);
    const evaluatedPayload = await evaluateResponse.json();
    const runId = evaluatedPayload.runId;
    assert.ok(runId);

    const realtimeResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: taskId,
        algorithmId: 'enemy-threat-analysis',
        displayName: '删除链路实时产物',
      }),
    });
    assert.equal(realtimeResponse.status, 201);
    const realtimePayload = await realtimeResponse.json();
    const artifactId = realtimePayload?.artifact?.id;
    assert.ok(artifactId);

    const beforeListResponse = await fetch(`http://localhost:${port}/api/planning/realtime/upstream-results?algorithmId=enemy-threat-analysis`, {
      headers: { cookie },
    });
    assert.equal(beforeListResponse.status, 200);
    const beforeListPayload = await beforeListResponse.json();
    const taskRunStep = (beforeListPayload.results || []).find((item) => (
      item.sourceType === 'task-run-step'
      && Number(item.taskId) === Number(taskId)
      && Number(item.runId) === Number(runId)
    ));
    const realtimeArtifact = (beforeListPayload.results || []).find((item) => (
      item.sourceType === 'realtime-artifact'
      && Number(item.taskId) === Number(taskId)
      && Number(item.artifactId) === Number(artifactId)
    ));
    assert.ok(taskRunStep);
    assert.ok(realtimeArtifact);

    const deleteResponse = await fetch(`http://localhost:${port}/api/tasks/bulk-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ taskIds: [taskId] }),
    });
    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json();
    assert.deepEqual(deletePayload.deletedTaskIds, [taskId]);
    assert.equal(deletePayload.deletedCount, 1);
    assert.ok(deletePayload.counts.taskRuns >= 1);
    assert.ok(deletePayload.counts.taskResults >= 1);
    assert.ok(deletePayload.counts.realtimeArtifacts >= 1);
    assert.ok(deletePayload.counts.taskAttachments >= 1);

    const detailAfterDelete = await fetch(`http://localhost:${port}/api/tasks/${taskId}`, {
      headers: { cookie },
    });
    assert.equal(detailAfterDelete.status, 404);

    const runsAfterDelete = await fetch(`http://localhost:${port}/api/tasks/${taskId}/runs`, {
      headers: { cookie },
    });
    assert.equal(runsAfterDelete.status, 404);

    const artifactAfterDelete = await fetch(`http://localhost:${port}/api/planning/realtime/artifacts/${artifactId}`, {
      headers: { cookie },
    });
    assert.equal(artifactAfterDelete.status, 404);

    const afterListResponse = await fetch(`http://localhost:${port}/api/planning/realtime/upstream-results`, {
      headers: { cookie },
    });
    assert.equal(afterListResponse.status, 200);
    const afterListPayload = await afterListResponse.json();
    assert.equal((afterListPayload.results || []).some((item) => Number(item.taskId) === Number(taskId)), false);

    const staleTaskRunRefResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: consumerTaskId,
        algorithmId: 'force-grouping',
        inputResultRefs: [taskRunStep.resultRef],
      }),
    });
    assert.equal(staleTaskRunRefResponse.status, 404);
    const staleTaskRunRefPayload = await staleTaskRunRefResponse.json();
    assert.equal(staleTaskRunRefPayload.error.code, 'PLANNING_MISSING_DATA');

    const staleRealtimeRefResponse = await fetch(`http://localhost:${port}/api/planning/realtime/steps/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        taskCenterId: consumerTaskId,
        algorithmId: 'force-grouping',
        inputResultRefs: [realtimeArtifact.resultRef],
      }),
    });
    assert.equal(staleRealtimeRefResponse.status, 404);
    const staleRealtimeRefPayload = await staleRealtimeRefResponse.json();
    assert.equal(staleRealtimeRefPayload.error.code, 'PLANNING_MISSING_DATA');
  } finally {
    await stopServer(child);
  }
});

test('bulk deleting planning tasks skips running runs and deletes the rest', async () => {
  const port = createPort();
  const child = await startServer(port);

  try {
    const cookie = await login(port);
    const normalTaskId = await createThreatOnlyPlanningTask(port, cookie, 'delete-normal-task');
    const runningTaskId = await createThreatOnlyPlanningTask(port, cookie, 'delete-running-task');
    const staleRunningTaskId = await createThreatOnlyPlanningTask(port, cookie, 'delete-stale-running-task');
    const dbPath = child.missionDbPath;
    const db = new DatabaseSync(dbPath);
    try {
      const nextRunId = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM task_runs').get()?.id || 1);
      db.prepare(`
        INSERT INTO task_runs (id, task_id, status, summary, error_code, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(nextRunId, runningTaskId, 'running', '{}', '', '', '2026-06-21 00:00');
      db.prepare('UPDATE tasks SET latest_run_id = ? WHERE id = ?').run(nextRunId, runningTaskId);

      const staleRunId = nextRunId + 1;
      const laterFailedRunId = nextRunId + 2;
      db.prepare(`
        INSERT INTO task_runs (id, task_id, status, summary, error_code, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(staleRunId, staleRunningTaskId, 'running', '{}', '', '', '2026-06-21 00:01');
      db.prepare(`
        INSERT INTO task_runs (id, task_id, status, summary, error_code, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(laterFailedRunId, staleRunningTaskId, 'failed', '{}', 'PLANNING_EXECUTION_TERMINATED', '规划任务已终止。', '2026-06-21 00:02');
      db.prepare('UPDATE tasks SET latest_run_id = ?, status = ? WHERE id = ?').run(laterFailedRunId, 'archived', staleRunningTaskId);
    } finally {
      db.close();
    }

    const deleteResponse = await fetch(`http://localhost:${port}/api/tasks/bulk-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ taskIds: [normalTaskId, runningTaskId, staleRunningTaskId] }),
    });
    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json();
    assert.deepEqual(deletePayload.deletedTaskIds, [normalTaskId, staleRunningTaskId]);
    assert.deepEqual(deletePayload.skippedRunningTaskIds, [runningTaskId]);
    assert.equal(deletePayload.deletedCount, 2);
    assert.equal(deletePayload.skippedCount, 1);

    const normalDetailResponse = await fetch(`http://localhost:${port}/api/tasks/${normalTaskId}`, {
      headers: { cookie },
    });
    assert.equal(normalDetailResponse.status, 404);

    const runningDetailResponse = await fetch(`http://localhost:${port}/api/tasks/${runningTaskId}`, {
      headers: { cookie },
    });
    assert.equal(runningDetailResponse.status, 200);

    const staleRunningDetailResponse = await fetch(`http://localhost:${port}/api/tasks/${staleRunningTaskId}`, {
      headers: { cookie },
    });
    assert.equal(staleRunningDetailResponse.status, 404);

    const runningOnlyDeleteResponse = await fetch(`http://localhost:${port}/api/tasks/bulk-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ taskIds: [runningTaskId] }),
    });
    assert.equal(runningOnlyDeleteResponse.status, 200);
    const runningOnlyDeletePayload = await runningOnlyDeleteResponse.json();
    assert.deepEqual(runningOnlyDeletePayload.deletedTaskIds, []);
    assert.deepEqual(runningOnlyDeletePayload.skippedRunningTaskIds, [runningTaskId]);
    assert.equal(runningOnlyDeletePayload.deletedCount, 0);
  } finally {
    await stopServer(child);
  }
});
