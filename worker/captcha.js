// The CAPTCHA that lets someone past a sign-in lock (worker/throttle.js): Cloudflare Turnstile.
// It is asked for only while a name is locked, so a user who mistypes a password never sees it.
// Off unless TURNSTILE_SECRET is set: then a locked name just stays locked, as before.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** True when `token` is a Turnstile answer that Cloudflare accepts for this request. */
export async function passesCaptcha(env, token, request) {
  if (!env.TURNSTILE_SECRET || typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    return (await res.json()).success === true;
  } catch (e) {
    console.error('turnstile:', e?.message || e);
    return false;
  }
}
