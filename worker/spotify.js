// Spotify, on behalf of one signed-in user. The browser never talks to Spotify: the
// Worker holds each user's tokens and makes every call. The refresh token is encrypted
// at rest under a key derived from SESSION_SECRET, so rotating that secret disconnects
// everyone, the way it signs everyone out.

import { HttpError } from './http.js';
import { getSpotifyTokens, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';

async function tokenKey(env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('spotify-refresh') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** base64(iv ‖ ciphertext), a fresh iv every time. */
export async function encryptToken(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

/** Throws if the ciphertext was made under another secret or was altered. */
export async function decryptToken(env, stored) {
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await tokenKey(env), bytes.slice(12));
  return new TextDecoder().decode(plain);
}
