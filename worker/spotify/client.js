import { freshAccessToken, refreshFor, notConnected } from './tokens.js';
import { upstreamFetch, upstreamKey, unavailable } from './transport.js';
import { spotifyTokensStmt } from '../db.js';
import { cooldownStmt, secondsLeft } from '../limits.js';
const API = 'https://api.spotify.com/v1';
export async function spotifyFetch(env, userId, method, path, body) {
  // The token row and the upstream cooldown in one round trip.
  const [tokens, cooldown] = await env.DB.batch([spotifyTokensStmt(env.DB, userId), cooldownStmt(env.DB, upstreamKey(env, 'api'))]);
  const { token, row } = await freshAccessToken(env, userId, Date.now(), tokens.results[0] ?? null);
  let wait = secondsLeft(cooldown.results[0], Date.now());
  const call = (bearer) => {
    const headers = { authorization: `Bearer ${bearer}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const checked = wait;
    wait = null;   // a retry looks again
    return upstreamFetch(env, 'api', `${API}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }, checked);
  };
  let res = await call(token);
  if (res.status === 401) res = await call((await refreshFor(env, userId, row)).accessToken);
  if (res.status === 401) throw notConnected();
  if (res.status >= 500) throw unavailable();
  return res;
}
