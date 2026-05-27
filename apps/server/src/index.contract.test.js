import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

function createPort() {
  return 3300 + Math.floor(Math.random() * 1000);
}

async function startServer(port) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(serverDir, '..'),
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
