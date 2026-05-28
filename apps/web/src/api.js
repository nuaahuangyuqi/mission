import { clearSessionState, getAuthHeaders } from './auth';

async function readResponseError(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    const structured = payload?.error && typeof payload.error === 'object' ? payload.error : {};
    return {
      message: structured.message || payload.message || `请求失败：${response.status}`,
      code: structured.code || '',
      type: structured.type || '',
      details: structured.details && typeof structured.details === 'object' ? structured.details : null,
    };
  }

  const text = await response.text().catch(() => '');
  return {
    message: text || `请求失败：${response.status}`,
    code: '',
    type: '',
    details: null,
  };
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorInfo = await readResponseError(response);
    const error = new Error(errorInfo.message);
    error.status = response.status;
    error.code = errorInfo.code;
    error.type = errorInfo.type;
    error.details = errorInfo.details;

    if (response.status === 401) {
      clearSessionState();
      const redirect = `${window.location.pathname}${window.location.search}`;
      if (window.location.pathname !== '/login') {
        window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
      }
    }

    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function requestNdjson(path, options = {}, handlers = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorInfo = await readResponseError(response);
    const error = new Error(errorInfo.message);
    error.status = response.status;
    error.code = errorInfo.code;
    error.type = errorInfo.type;
    error.details = errorInfo.details;
    if (response.status === 401) {
      clearSessionState();
      const redirect = `${window.location.pathname}${window.location.search}`;
      if (window.location.pathname !== '/login') {
        window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
      }
    }
    throw error;
  }

  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResult = null;
  let streamError = null;

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed);
    if (typeof handlers.onEvent === 'function') {
      handlers.onEvent(event);
    }
    if (event.type === 'result') {
      finalResult = event.result || null;
    }
    if (event.type === 'error') {
      const errorInfo = event.error || {};
      const error = new Error(errorInfo.message || event.message || '流式请求失败');
      error.status = errorInfo.status || 500;
      error.code = errorInfo.code || '';
      error.type = errorInfo.type || '';
      error.details = errorInfo.details || null;
      streamError = error;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      consumeLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeLine(buffer);
  }

  if (streamError) {
    throw streamError;
  }

  return finalResult;
}

export const api = {
  getOverview() {
    return request('/api/overview');
  },
  getCapabilityTemplate() {
    return request('/api/capability/template');
  },
  evaluateCapability(payload) {
    return request('/api/capability/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getActionTemplate() {
    return request('/api/action/template');
  },
  evaluateAction(payload) {
    return request('/api/action/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getConsumptionTemplate() {
    return request('/api/consumption/template');
  },
  evaluateConsumption(payload) {
    return request('/api/consumption/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getPlanningTemplate() {
    return request('/api/planning/template');
  },
  evaluatePlanning(payload) {
    return request('/api/planning/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  evaluatePlanningStream(payload, handlers = {}) {
    return requestNdjson('/api/planning/evaluate/stream', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, handlers);
  },
  validatePlanning(payload) {
    return request('/api/planning/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getSources(filters = {}) {
    const params = new URLSearchParams();
    if (filters.taskId) params.set('taskId', String(filters.taskId));
    return request(`/api/resource-sources${params.toString() ? `?${params.toString()}` : ''}`);
  },
  getSourcePreview(id) {
    return request(`/api/resource-sources/${id}/preview`);
  },
  importSource(payload) {
    return request('/api/resource-sources/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  importSourcesBatch(payload) {
    return request('/api/resource-import-batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getResourceImportBatches(filters = {}) {
    const params = new URLSearchParams();
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    if (filters.taskId) params.set('taskId', String(filters.taskId));
    return request(`/api/resource-import-batches${params.toString() ? `?${params.toString()}` : ''}`);
  },
  retryResourceImportBatchItem(batchId, itemId) {
    return request(`/api/resource-import-batches/${batchId}/items/${itemId}/retry`, {
      method: 'POST',
    });
  },
  deleteSource(id) {
    return request(`/api/resource-sources/${id}`, {
      method: 'DELETE',
    });
  },
  getIntelligence(filters = {}) {
    const params = new URLSearchParams();
    if (filters.camp && filters.camp !== 'all') {
      params.set('camp', filters.camp);
    }
    if (filters.category && filters.category !== 'all') {
      params.set('category', filters.category);
    }

    const query = params.toString();
    return request(`/api/intelligence${query ? `?${query}` : ''}`);
  },
  createIntelligence(payload) {
    return request('/api/intelligence', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateIntelligence(id, payload) {
    return request(`/api/intelligence/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteIntelligence(id) {
    return request(`/api/intelligence/${id}`, {
      method: 'DELETE',
    });
  },
  getEnvironment() {
    return request('/api/environment');
  },
  createEnvironment(payload) {
    return request('/api/environment', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateEnvironment(id, payload) {
    return request(`/api/environment/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteEnvironment(id) {
    return request(`/api/environment/${id}`, {
      method: 'DELETE',
    });
  },
  getExtractions() {
    return request('/api/extractions');
  },
  getKnowledgeGraph(query = '', mode = 'balanced') {
    const params = new URLSearchParams();
    if (query) {
      params.set('query', query);
    }
    if (mode) {
      params.set('mode', mode);
    }
    return request(`/api/knowledge-graph${params.toString() ? `?${params.toString()}` : ''}`);
  },
  getSituationEntities() {
    return request('/api/situation-entities');
  },
  createSituationEntity(payload) {
    return request('/api/situation-entities', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateSituationEntity(id, payload) {
    return request(`/api/situation-entities/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteSituationEntity(id) {
    return request(`/api/situation-entities/${id}`, {
      method: 'DELETE',
    });
  },
  getUsers() {
    return request('/api/users');
  },
  updateUser(id, payload) {
    return request(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  getTasks(filters = {}) {
    const params = new URLSearchParams();
    if (filters.module) params.set('module', filters.module);
    if (filters.status) params.set('status', filters.status);
    if (filters.query) params.set('query', filters.query);
    if (filters.mine) params.set('mine', '1');
    return request(`/api/tasks${params.toString() ? `?${params.toString()}` : ''}`);
  },
  createTask(payload) {
    return request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getTask(id) {
    return request(`/api/tasks/${id}`);
  },
  getTaskRuns(id, filters = {}) {
    const params = new URLSearchParams();
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.offset) params.set('offset', String(filters.offset));
    return request(`/api/tasks/${id}/runs${params.toString() ? `?${params.toString()}` : ''}`);
  },
  getTaskRunDetail(id, runId) {
    return request(`/api/tasks/${id}/runs/${runId}`);
  },
  updateTask(id, payload) {
    return request(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  submitTask(id) {
    return request(`/api/tasks/${id}/submit`, {
      method: 'POST',
    });
  },
  archiveTask(id) {
    return request(`/api/tasks/${id}/archive`, {
      method: 'POST',
    });
  },
};
