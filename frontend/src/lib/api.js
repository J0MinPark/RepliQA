import { auth } from './firebase';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
// 세션 캡처(원격 브라우저)는 요청 사이에 브라우저 프로세스를 들고 있어야 해서 Vercel
// 서버리스 API(BASE_URL)가 아니라 Render의 영속 워커 프로세스가 직접 맡는다 — 그래서
// 별도 base URL이 필요하다. 로컬 개발은 워커가 API 서버와 다른 포트(WORKER_PORT, 기본
// 3002)에서 뜬다.
const WORKER_BASE_URL = import.meta.env.VITE_WORKER_BASE_URL || 'http://localhost:3002';

async function doFetch(baseUrl, path, { method = 'GET', body, forceRefreshToken = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const token = await user.getIdToken(forceRefreshToken);

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
  }
  return data;
}

const apiFetch = (path, opts) => doFetch(BASE_URL, path, opts);
const workerFetch = (path, opts) => doFetch(WORKER_BASE_URL, path, opts);

export const api = {
  bootstrapTenant: () => apiFetch('/api/tenants/bootstrap', { method: 'POST' }),
  me: () => apiFetch('/api/tenants/me'),
  deleteAccount: () => apiFetch('/api/tenants/me', { method: 'DELETE' }),
  createApiKey: () => apiFetch('/api/tenants/api-key', { method: 'POST' }),
  listUrls: () => apiFetch('/api/urls'),
  registerUrl: (url) => apiFetch('/api/urls', { method: 'POST', body: { url } }),
  verifyUrl: (id) => apiFetch(`/api/urls/${id}/verify`, { method: 'POST' }),
  setTestCredentials: (id, username, password) =>
    apiFetch(`/api/urls/${id}/test-credentials`, { method: 'PUT', body: { username, password } }),
  setTestPaymentMethod: (id, paymentMethod) =>
    apiFetch(`/api/urls/${id}/test-payment-method`, { method: 'PUT', body: paymentMethod }),
  setTestInbox: (id, config) => apiFetch(`/api/urls/${id}/test-inbox`, { method: 'PUT', body: config }),
  autoCreateTestInbox: (id) => apiFetch(`/api/urls/${id}/test-inbox/auto`, { method: 'POST' }),
  listPersonas: () => apiFetch('/api/personas'),
  listRoutes: (registeredUrlId) =>
    apiFetch(`/api/routes${registeredUrlId ? `?registeredUrlId=${registeredUrlId}` : ''}`),
  createRoute: (name, registeredUrlId, checkpoints) =>
    apiFetch('/api/routes', { method: 'POST', body: { name, registeredUrlId, checkpoints } }),
  createTestRun: (registeredUrlId, personaId, routeId) =>
    apiFetch('/api/test-runs', { method: 'POST', body: { registeredUrlId, personaId, routeId } }),
  runCheckpoint: (routeId, index, personaId) =>
    apiFetch(`/api/routes/${routeId}/checkpoints/${index}/run`, { method: 'POST', body: { personaId } }),
  getTestRun: (id) => apiFetch(`/api/test-runs/${id}`),
  getScreenshotUrl: (runId, label) => apiFetch(`/api/test-runs/${runId}/screenshots/${label}`),
  getUsageToday: () => apiFetch('/api/usage/today'),
  startSessionCapture: (registeredUrlId) =>
    workerFetch('/session-capture/start', { method: 'POST', body: { registeredUrlId } }),
  finishSessionCapture: (captureId) => workerFetch(`/session-capture/${captureId}/finish`, { method: 'POST' }),
  cancelSessionCapture: (captureId) => workerFetch(`/session-capture/${captureId}/cancel`, { method: 'POST' }),
  saveTestSession: (urlId, storageState) =>
    apiFetch(`/api/urls/${urlId}/test-session`, { method: 'PUT', body: { storageState } }),
};

export { apiFetch, workerFetch, WORKER_BASE_URL };
