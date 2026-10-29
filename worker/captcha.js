// The CAPTCHA that lets someone past a sign-in lock (worker/throttle.js): Cloudflare Turnstile.
// It is asked for only while a name is locked, so a user who mistypes a password never sees it.
// Off unless TURNSTILE_SECRET is set: then a locked name just stays locked, as before.
//
// A token counts only when Cloudflare says it is valid, it was issued for the sign-in widget
// (action "login", set in src/components/sign-in-check.tsx) and on one of this deployment's own
// hostnames (TURNSTILE_HOSTNAMES, comma separated; none set means no token passes).

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const CAPTCHA_ACTION = 'login';
const VERIFY_TIMEOUT_MS = 10_000;

const hostnames = (env) => new Set(String(env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean));

/** The site key to offer a locked sign-in, or null: only when a solved check could actually pass. */
export function captchaSiteKey(env) {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET && hostnames(env).size ? env.TURNSTILE_SITE_KEY : null;
}

/** True when `token` is a Turnstile answer that Cloudflare accepts for this request. */
export async function passesCaptcha(env, token, request) {
  const allowed = hostnames(env);
  if (!captchaSiteKey(env) || typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) });
    if (!res.ok) throw new Error('siteverify ' + res.status);
    const result = await res.json();
    if (result.success === true && result.action === CAPTCHA_ACTION && allowed.has(result.hostname)) return true;
    // Cloudflare's codes say whether the token or the secret was wrong; neither is logged itself.
    console.warn('turnstile refused:', JSON.stringify({ codes: result['error-codes'] ?? [], action: result.action ?? null, hostname: result.hostname ?? null }));
    return false;
  } catch (e) {
    console.error('turnstile:', e?.message || e);
    return false;
  }
}
