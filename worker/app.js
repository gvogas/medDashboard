// The iPhone and Mac apps. They load the front end from their own bundle, so their requests
// come from `capacitor://localhost` rather than this site, and iOS will not send this site's
// cookie from there. They sign in for a token instead and send it as `Authorization: Bearer`.
// A request from an app origin never authenticates with a cookie (handleApi drops it), so
// allowing these origins opens no way round the same-origin rule for the browser.

import { HttpError } from './http.js';

/* Capacitor's iOS origin, and its Android one for later. A browser cannot send either. */
export const APP_ORIGINS = ['capacitor://localhost', 'https://localhost'];

export const isAppOrigin = (origin) => APP_ORIGINS.includes(origin || '');

const ALLOW_HEADERS = 'authorization, content-type, if-match, x-rounds-user, x-rounds-app';
const EXPOSE_HEADERS = 'retry-after';

/** The CORS headers an app origin's request gets back; none for anything else. */
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!isAppOrigin(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-expose-headers': EXPOSE_HEADERS, vary: 'Origin' };
}

/** The answer to an app's CORS preflight, or null when the request is not one (another
    origin's OPTIONS gets the usual 405, with no CORS headers to let it through). */
export function preflight(request) {
  const origin = request.headers.get('origin');
  if (request.method !== 'OPTIONS' || !isAppOrigin(origin)) return null;
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      'access-control-allow-methods': 'GET, POST, PUT, DELETE',
      'access-control-allow-headers': ALLOW_HEADERS,
      'access-control-max-age': '86400',
    },
  });
}

/** An app's request with any cookie removed: the app signs in with its token alone. */
export function withoutCookie(request) {
  if (!request.headers.has('cookie')) return request;
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  return new Request(request, { headers });
}

/** '1.4.2' → [1, 4, 2]; null when it is not a plain version. */
export function parseVersion(raw) {
  const m = /^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/.exec(raw || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

const older = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Builds older than MIN_APP_VERSION get `426 update_required`, so a store build that no
 * longer understands the API says "please update" rather than failing oddly. The app sends
 * its version as `x-rounds-app`; the browser sends none and is never refused here.
 */
export function assertAppVersion(request, env) {
  const raw = request.headers.get('x-rounds-app');
  if (raw === null) return;
  const version = parseVersion(raw);
  if (!version) throw new HttpError(400, { error: 'invalid', field: 'x-rounds-app' });
  const min = parseVersion(env.MIN_APP_VERSION);
  if (min && older(version, min) < 0) throw new HttpError(426, { error: 'update_required', min: env.MIN_APP_VERSION });
}
