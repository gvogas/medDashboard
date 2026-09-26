// A study run on this device: starts, pauses, skips, stops, and logs its study time.
// The run record lives in IndexedDB's meta store, so a reload picks it up; only the
// finished session syncs. Views draw from read(); main.js listens with onTick().

import * as store from './store.js';
import * as timer from './timer.js';
import { uid } from './model.js';

const KEY = 'studyRun';
let run = null;            /* timer.start() plus { id, courseId, itemId } */
let ticker = null, lastStep = null, wake = null, audio = null;
const listeners = new Set();

/** fn(state, event): event is 'tick', 'step' (a new step began), 'start' or 'end'. */
export const onTick = (fn) => listeners.add(fn);
const emit = (event) => { const s = read(); for (const fn of listeners) fn(s, event); };

export const active = () => !!run;
export function read(now = Date.now()) {
  return run ? { ...timer.read(run, now), courseId: run.courseId, itemId: run.itemId, flow: run.flow } : null;
}

/** On sign-in: resume a run this device was in the middle of. */
export async function load() {
  run = (await store.meta.get(KEY)) || null;
  if (!run) return;
  if (timer.read(run).done) { await finish(); return; }
  lastStep = stepKey();
  tick();
  ensureTicking();
}

const save = () => store.meta.set(KEY, run);
const stepKey = () => { const s = timer.read(run); return s.round + ':' + s.index; };

function ensureTicking() {
  if (!ticker) ticker = setInterval(tick, 250);
}

function tick() {
  if (!run) return;
  const s = timer.read(run);
  if (s.done) { finish().catch(() => {}); return; }
  const key = s.round + ':' + s.index;
  if (key !== lastStep) {
    lastStep = key;
    chime(s.kind);
    emit('step');
  } else emit('tick');
}

/** Begin a run. Called inside the Start click, so full screen and sound are allowed. */
export async function begin(flow, courseId, itemId) {
  run = { ...timer.start(flow), id: uid(), courseId, itemId: itemId || null };
  lastStep = stepKey();
  unlockAudio();
  fullscreen(true);
  await save();
  holdScreen();
  ensureTicking();
  emit('start');
}

export async function togglePause() {
  if (!run) return;
  run = run.pausedAt === null ? timer.pause(run) : timer.resume(run);
  if (run.pausedAt === null) holdScreen(); else releaseScreen();
  await save();
  emit('tick');
}

export async function skip() {
  if (!run) return;
  run = timer.skip(run);
  await save();
  tick();
}

/** Stop & log: save the study time done so far. */
export const stop = () => finish();

async function finish() {
  if (!run) return;
  const ended = run;
  run = null;
  clearInterval(ticker); ticker = null;
  releaseScreen();
  fullscreen(false);
  // Another tab of this device may have logged this run already.
  const stored = await store.meta.get(KEY);
  if (stored?.id === ended.id) {
    await store.meta.set(KEY, null);
    const s = timer.read(ended);
    const minutes = timer.loggedMinutes(s);
    if (minutes >= 1) {
      await store.saveStudySession({
        id: ended.id, courseId: ended.courseId, itemId: ended.itemId,
        startedAt: ended.startedAt, studyMinutes: minutes, roundsDone: s.roundsDone,
      });
    }
  }
  if (!ended.pausedAt && timer.read(ended).done) chime('done');
  emit('end');
}

/* ── the screen: full screen and a wake lock, both optional ── */

export function fullscreen(on) {
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen?.()?.catch(() => {});
  } catch {}
}

async function holdScreen() {
  if (!run || run.pausedAt !== null || wake || !navigator.wakeLock) return;
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch { wake = null; }
}
function releaseScreen() { wake?.release().catch(() => {}); wake = null; }
/* The browser drops the lock when the tab is hidden; take it again on return. */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { holdScreen(); tick(); } });

/* ── a short chime when a step changes: two notes up for study, down for a break ── */

function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

function chime(kind) {
  if (!audio) return;
  const notes = kind === 'study' ? [523.25, 783.99] : kind === 'break' ? [659.25, 440] : [523.25, 659.25, 783.99];
  const t0 = audio.currentTime;
  notes.forEach((f, i) => {
    const osc = audio.createOscillator(), gain = audio.createGain(), t = t0 + i * 0.18;
    osc.type = 'sine'; osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(audio.destination);
    osc.start(t); osc.stop(t + 0.55);
  });
}

/** Signing out: forget the run without logging it. */
export function reset() {
  run = null;
  clearInterval(ticker); ticker = null;
  releaseScreen();
}
