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
  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/me'),
  saveMe: (profile) => request('PUT', '/api/me', profile),
  devSession: (email) => request('POST', '/api/dev-session', { email }),
  signOut: () => request('DELETE', '/api/session'),
  sync: (since) => request('GET', `/api/sync?since=${since}`),
  put: (kind, id, row) => request('PUT', `/api/${kind}/${encodeURIComponent(id)}`, row),
  del: (kind, id) => request('DELETE', `/api/${kind}/${encodeURIComponent(id)}`),
  importAll: (payload) => request('POST', '/api/import', payload),
};
