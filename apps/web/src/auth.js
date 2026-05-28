import { reactive } from 'vue';

export const authState = reactive({
  token: '',
  user: null,
  ready: false,
  restoring: false,
});

function setSession(payload = {}) {
  authState.token = '';
  authState.user = payload.user || null;
}

async function readResponseError(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return payload.message || `Request failed: ${response.status}`;
  }

  return response.text().catch(() => `Request failed: ${response.status}`);
}

export function clearSessionState() {
  authState.token = '';
  authState.user = null;
}

export function getAuthHeaders() {
  return authState.token ? { Authorization: `Bearer ${authState.token}` } : {};
}

export async function login(credentials) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const payload = await response.json();
  setSession(payload);
  authState.ready = true;
  return payload;
}

export async function register(payload) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response));
  }

  const session = await response.json();
  setSession(session);
  authState.ready = true;
  return session;
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
  } finally {
    clearSessionState();
    authState.ready = true;
  }
}

export async function restoreSession() {
  if (authState.restoring) {
    return authState.user;
  }

  authState.restoring = true;
  try {
    const response = await fetch('/api/auth/me', {
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(await readResponseError(response));
    }

    const payload = await response.json();
    authState.user = payload.user || null;
    return authState.user;
  } catch {
    clearSessionState();
    return null;
  } finally {
    authState.ready = true;
    authState.restoring = false;
  }
}

