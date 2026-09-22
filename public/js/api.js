// The only file that knows the API's URLs. Same-origin, cookie session.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Resolves to the parsed JSON (or null for 204). Throws ApiError on 4xx/5xx, TypeError offline. */
export async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  me: () => request('GET', '/api/me'),
  saveMe: (profile) => request('PUT', '/api/me', profile),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  signOut: () => request('DELETE', '/api/session'),
  sync: (since) => request('GET', `/api/sync?since=${since}`),
  get: (kind, id) => request('GET', `/api/${kind}/${encodeURIComponent(id)}`),
  put: (kind, id, row) => request('PUT', `/api/${kind}/${encodeURIComponent(id)}`, row),
  revokeAll: () => request('POST', '/api/session/revoke-all'),
  del: (kind, id) => request('DELETE', `/api/${kind}/${encodeURIComponent(id)}`),
  importAll: (payload) => request('POST', '/api/import', payload),
};
