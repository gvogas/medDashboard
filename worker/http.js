// Small HTTP helpers shared by every handler.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(body.error || 'error');
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const BODY_LIMIT = 1024 * 1024; // 1 MB

/** The request's JSON body, which must be an object. 413 over 1 MB, 400 if malformed. */
export async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > BODY_LIMIT) throw new HttpError(413, { error: 'too_large' });
  const text = await request.text();
  if (text.length > BODY_LIMIT) throw new HttpError(413, { error: 'too_large' });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, { error: 'invalid_json' });
  }
  // Every route takes an object; `null`, a list or a bare string is refused here once.
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, { error: 'invalid', field: 'body' });
  return body;
}

