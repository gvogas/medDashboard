// Password hashing: PBKDF2-HMAC-SHA256, a random 16-byte salt per user.
// Workers cap PBKDF2 at 100,000 iterations per call, which is also what fits
// the free plan's CPU budget, so that is the work factor. Stored as
// `pbkdf2$<iterations>$<salt>$<hash>` with base64url parts.
// No imports: scripts/add-user.mjs runs this same code under Node.

const ITERATIONS = 100000;
const HASH_BYTES = 32;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

/** True only for the right password against a well-formed stored hash. */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > ITERATIONS) return false;
  let salt, expected;
  try {
    salt = fromB64url(parts[2]);
    expected = fromB64url(parts[3]);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** Usernames: 3–32 characters, letters, digits, dot, dash, underscore. Lower-cased. */
export function normalizeUsername(raw) {
  const u = String(raw ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(u) ? u : null;
}
