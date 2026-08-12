import { auth } from './firebase';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

async function apiFetch(path, { method = 'GET', body, forceRefreshToken = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const token = await user.getIdToken(forceRefreshToken);

  const res = await fetch(`${BASE_URL}${path}`, {
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

export const api = {
  bootstrapTenant: () => apiFetch('/api/tenants/bootstrap', { method: 'POST' }),
  me: () => apiFetch('/api/tenants/me'),
  createApiKey: () => apiFetch('/api/tenants/api-key', { method: 'POST' }),
  listUrls: () => apiFetch('/api/urls'),
  registerUrl: (url) => apiFetch('/api/urls', { method: 'POST', body: { url } }),
  verifyUrl: (id) => apiFetch(`/api/urls/${id}/verify`, { method: 'POST' }),
  setTestCredentials: (id, username, password) =>
    apiFetch(`/api/urls/${id}/test-credentials`, { method: 'PUT', body: { username, password } }),
  setTestPaymentMethod: (id, paymentMethod) =>
    apiFetch(`/api/urls/${id}/test-payment-method`, { method: 'PUT', body: paymentMethod }),
  listPersonas: () => apiFetch('/api/personas'),
  listRoutes: (registeredUrlId) =>
    apiFetch(`/api/routes${registeredUrlId ? `?registeredUrlId=${registeredUrlId}` : ''}`),
  createRoute: (name, registeredUrlId, checkpoints) =>
    apiFetch('/api/routes', { method: 'POST', body: { name, registeredUrlId, checkpoints } }),
  createTestRun: (registeredUrlId, personaId, routeId) =>
    apiFetch('/api/test-runs', { method: 'POST', body: { registeredUrlId, personaId, routeId } }),
  getTestRun: (id) => apiFetch(`/api/test-runs/${id}`),
  getUsageToday: () => apiFetch('/api/usage/today'),
};

export { apiFetch };
