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

/** The raw request body, refused over `limit` bytes. */
export async function readBytes(request, limit) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new HttpError(413, { error: 'too_large' });
  const reader = request.body?.getReader();
  const parts = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); throw new HttpError(413, { error: 'too_large' }); }
      parts.push(value);
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** The request's JSON body, which must be an object. 413 over 1 MB, 400 if malformed. */
export async function readJson(request) {
  let body;
  try { body = JSON.parse(new TextDecoder().decode(await readBytes(request, BODY_LIMIT))); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, { error: 'invalid_json' }); }
  // Every route takes an object; `null`, a list or a bare string is refused here once.
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, { error: 'invalid', field: 'body' });
  return body;
}
