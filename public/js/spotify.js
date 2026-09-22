// Polls the Worker for what is playing on the signed-in user's Spotify and sends
// the controls. Owns one timer and the last state; the badge only renders it.

import { api, ApiError, retryDelayMs } from './api.js';
import * as web from './web-player.js';

export const state = {
  connected: false, playing: false, track: null, device: null, deviceId: null,
  volume: null, supportsVolume: false,
  stale: false, error: null, loaded: false,
};

const ERROR_SHOWN_MS = 4000;
const AFTER_CONTROL_MS = 300;

let active = false;
let timer = null;
let ticker = null;
let errorTimer = null;
let polledAt = 0;
let baseProgress = 0;
let listener = () => {};
let onSignedOut = () => {};
let wired = false;

/** 5 s while playing, 20 s when connected but quiet, null when not connected. */
export function nextDelayMs(s) {
  if (!s.connected) return null;
  return s.playing ? 5000 : 20000;
}

export function onState(fn) { listener = fn; }
export function onUnauthenticated(fn) { onSignedOut = fn; }

function emit(kind) { listener(state, kind); }

function canPoll() {
  return active && document.visibilityState === 'visible' && navigator.onLine !== false;
}

function schedule(ms) {
  clearTimeout(timer);
  timer = null;
  if (ms == null || !active) return;
  timer = setTimeout(poll, ms);
}

function apply(s) {
  state.connected = !!s.connected;
  state.playing = !!s.playing;
  state.track = s.track || null;
  state.device = s.device || null;
  state.deviceId = s.deviceId || null;
  state.volume = typeof s.volume === 'number' ? s.volume : null;
  state.supportsVolume = !!s.supportsVolume;
  state.stale = false;
  state.loaded = true;
  polledAt = Date.now();
  baseProgress = state.track ? state.track.progressMs : 0;
}

export async function poll() {
  clearTimeout(timer);
  if (!canPoll()) return;
  try {
    apply(await api.spotifyPlayer());
    emit('state');
    schedule(nextDelayMs(state));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { stop(); onSignedOut(); return; }
    state.stale = true;
    state.loaded = true;
    emit('state');
    schedule(retryDelayMs(e));
  }
}

/* Between polls the progress line keeps moving on its own. */
function tick() {
  if (!state.playing || !state.track || state.stale) return;
  state.track.progressMs = Math.min(state.track.durationMs, baseProgress + (Date.now() - polledAt));
  emit('tick');
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  window.addEventListener('online', poll);
}

export function start() {
  if (active) return;
  active = true;
  wire();
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  poll();
}

export function stop() {
  active = false;
  clearTimeout(timer); timer = null;
  clearInterval(ticker); ticker = null;
  clearTimeout(errorTimer); errorTimer = null;
  Object.assign(state, { connected: false, playing: false, track: null, device: null, deviceId: null, volume: null, supportsVolume: false, stale: false, error: null, loaded: false });
}

export function disconnected() {
  apply({ connected: false });
  emit('state');
  schedule(null);
}

function showError(code) {
  state.error = code;
  emit('state');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { state.error = null; emit('state'); }, ERROR_SHOWN_MS);
}

const noDevice = (e) => e instanceof ApiError && e.status === 404 && e.body?.error === 'no_device';

/**
 * Send a command with `send(deviceId)`. When Spotify has no active device and the
 * Rounds tab can play, send it once more to the Rounds device. `nothing` is the
 * error code for a second 404, when Rounds has nothing to play.
 */
export async function onRoundsIfIdle(send, nothing = 'no_device') {
  try {
    return await send(null);
  } catch (e) {
    if (!noDevice(e) || web.state.status !== 'ready' || !web.state.deviceId) throw e;
  }
  try {
    return await send(web.state.deviceId);
  } catch (e) {
    throw e instanceof ApiError && e.status === 404 ? new ApiError(404, { error: nothing }) : e;
  }
}

/* A command failed: sign out, forget the connection, or say why in the badge. False when there is nothing more to do. */
function failed(e) {
  if (e instanceof ApiError && e.status === 401) { stop(); onSignedOut(); return false; }
  if (e instanceof ApiError && e.status === 409) { disconnected(); return false; }
  showError(e instanceof ApiError ? (e.body?.error || 'spotify_unavailable') : 'offline');
  return true;
}

/** One of play, pause, next, previous, restart. Never throws; failures show in the badge. */
export async function control(action) {
  if (action === 'play' || action === 'pause') {          /* answer the click before Spotify does */
    state.playing = action === 'play';
    polledAt = Date.now();
    baseProgress = state.track ? state.track.progressMs : 0;
    emit('state');
  }
  try {
    await onRoundsIfIdle((deviceId) => api.spotifyControl(action, deviceId), 'nothing_to_resume');
  } catch (e) {
    if (!failed(e)) return;
  }
  schedule(AFTER_CONTROL_MS);
}

/** Move what is playing on another device into the Rounds tab. */
export async function playHere() {
  if (web.state.status !== 'ready') return;
  web.activate();
  try {
    await api.spotifyTransfer(web.state.deviceId);
  } catch (e) {
    if (!failed(e)) return;
  }
  schedule(AFTER_CONTROL_MS);
}

/** Like the Spotify app: previous restarts the track once it is a few seconds in. */
export function previous() {
  return control(state.track && state.track.progressMs > 3000 ? 'restart' : 'previous');
}
