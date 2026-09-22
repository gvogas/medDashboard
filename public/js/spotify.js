// The Spotify strip's data. Polls the Worker while the tab is visible and online:
// every 5 s while something plays, every 20 s otherwise, and not at all once we know
// there is no connection (connecting reloads the page, which starts it again).
// Between polls the progress is advanced locally so the line moves.

import { api, ApiError } from './api.js';

const PLAYING_MS = 5000;
const IDLE_MS = 20000;
const BACKOFF_MS = 30000;
const SETTLE_MS = 300;        // Spotify's state lags a command by a moment

/** How long until the next poll; null stops polling. */
export function nextDelayMs(state) {
  if (!state || !state.connected) return null;
  return state.playing ? PLAYING_MS : IDLE_MS;
}

/** Previous, the way Spotify's own apps do it: a few seconds in, it restarts the track. */
export function previousAction(state) {
  return (state?.track?.progressMs ?? 0) > 3000 ? 'restart' : 'previous';
}

let state = null;             // the Worker's last answer, plus `stale`
let polledAt = 0;
let timer = null;
let ticker = null;
let running = false;
let wired = false;
let listener = () => {};
let signedOut = () => {};

/** fn(state, tick): tick is true for the once-a-second progress update. */
export function onState(fn) { listener = fn; }
export function onUnauthenticated(fn) { signedOut = fn; }

/** The last state, its progress advanced to now while playing. */
export function current() {
  if (!state?.track || !state.playing) return state;
  const progressMs = Math.min(state.track.durationMs, state.track.progressMs + (Date.now() - polledAt));
  return { ...state, track: { ...state.track, progressMs } };
}

function wake(ms) {
  clearTimeout(timer);
  timer = ms == null ? null : setTimeout(poll, ms);
}

/** Ask the Worker now. Hidden or offline, it waits for the tab or network to come back. */
export async function poll() {
  clearTimeout(timer);
  timer = null;
  if (!running || document.visibilityState !== 'visible' || navigator.onLine === false) return;
  try {
    const next = await api.spotifyPlayer();
    if (!running) return;
    state = { ...next, stale: false };
    polledAt = Date.now();
    listener(current(), false);
    wake(nextDelayMs(state));
  } catch (e) {
    if (!running) return;
    if (e instanceof ApiError && e.status === 401) { stop(); signedOut(); return; }
    if (state) { state = { ...state, stale: true }; listener(current(), false); }
    wake(e instanceof ApiError && e.status === 429 ? (Number(e.body?.retryAfter) || 30) * 1000 : BACKOFF_MS);
  }
}

function resume() {
  if (running && (!state || state.connected)) poll();
}

/** Start polling; resolves once the first answer is in. */
export function start() {
  if (running) return Promise.resolve();
  running = true;
  if (!wired) {
    wired = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
    window.addEventListener('online', resume);
  }
  ticker = setInterval(() => {
    if (state?.playing && document.visibilityState === 'visible') listener(current(), true);
  }, 1000);
  return poll();
}

export function stop() {
  running = false;
  clearTimeout(timer);
  timer = null;
  clearInterval(ticker);
  ticker = null;
  state = null;
}

/** Send a control, then look again shortly after. Throws for the caller to explain. */
export async function control(action) {
  try {
    await api.spotifyControl(action);
    if (state && (action === 'play' || action === 'pause')) {
      state = { ...current(), playing: action === 'play' };
      polledAt = Date.now();
      listener(current(), false);
    }
  } finally {
    wake(SETTLE_MS);
  }
}
