// The Rounds tab as a Spotify device, through Spotify's Web Playback SDK. The SDK is
// loaded once the user is connected and asks the Worker for a short-lived token; the
// refresh token never reaches the page. Rounds only plays here after a click.
// See docs/superpowers/specs/2026-09-22-spotify-web-playback-design.md.

import { api } from './api.js';

const SDK = 'https://sdk.scdn.co/spotify-player.js';
const NAME = 'Rounds';

/** status: off, loading, ready, unsupported, needs_reconnect or no_premium. */
export const state = { status: 'off', deviceId: null };

let player = null;
let listener = () => {};

export function onChange(fn) { listener = fn; }

function set(status, deviceId = null) {
  if (state.status === status && state.deviceId === deviceId) return;
  state.status = status;
  state.deviceId = deviceId;
  listener(state);
}

/**
 * Where a click should send music: 'here' when the Rounds device is ready and nothing
 * else is active, 'offer' when music is on another device, null otherwise.
 */
export function playTarget(poller, web) {
  if (!web || web.status !== 'ready' || !web.deviceId) return null;
  if (!poller.deviceId) return 'here';
  return poller.deviceId === web.deviceId ? null : 'offer';
}

/* Spotify does not support the SDK in phone browsers. */
function isPhone() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') return navigator.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function create() {
  if (state.status !== 'loading' || player || !window.Spotify) return;
  player = new window.Spotify.Player({
    name: NAME,
    volume: 0.8,
    getOAuthToken: (give) => { api.spotifyToken().then((t) => give(t.token)).catch(() => {}); },
  });
  player.addListener('ready', ({ device_id }) => set('ready', device_id));
  player.addListener('not_ready', () => set('loading'));
  player.addListener('initialization_error', () => set('unsupported'));
  player.addListener('authentication_error', () => set('needs_reconnect'));
  player.addListener('account_error', () => set('no_premium'));
  player.connect();
}

/** Load the SDK and register the device. Safe to call again; does nothing once started. */
export function start() {
  if (state.status !== 'off') return;
  if (isPhone()) { set('unsupported'); return; }
  set('loading');
  if (window.Spotify) { create(); return; }
  window.onSpotifyWebPlaybackSDKReady = create;
  if (document.querySelector(`script[src="${SDK}"]`)) return;
  const s = document.createElement('script');
  s.src = SDK;
  s.async = true;
  s.onerror = () => { s.remove(); if (state.status === 'loading') set('unsupported'); };
  document.head.appendChild(s);
}

/** Call inside a click, before any await, so the browser lets the tab make sound. */
export function activate() {
  try { if (player && player.activateElement) player.activateElement(); } catch {}
}

/** On sign-out or disconnect: drop the device. */
export function stop() {
  if (player) { try { player.disconnect(); } catch {} player = null; }
  set('off');
}
