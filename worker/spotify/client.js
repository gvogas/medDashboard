import { HttpError } from '../http.js';
import { freshAccessToken, refreshFor } from './tokens.js';
import { upstreamFetch, unavailable } from './transport.js';
const API = 'https://api.spotify.com/v1';
const notConnected = () => new HttpError(409, { error: 'not_connected' });
export async function spotifyFetch(env, userId, method, path, body) {
  const { token, row } = await freshAccessToken(env, userId);
  const call = async (bearer) => {
    const headers = { authorization: `Bearer ${bearer}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await upstreamFetch(env, 'api', `${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw unavailable();
    }
  };
  let res = await call(token);
  if (res.status === 401) res = await call((await refreshFor(env, userId, row)).accessToken);
  if (res.status === 401) throw notConnected();
  if (res.status >= 500) throw unavailable();
  return res;
}

// ── the player ──────────────────────────────────────────────────────────────

