// Boot, sign-in and sign-out: opening the account's local store, starting sync and
// Spotify, and starting over when the account changes in another tab.

import { api, ApiError, resetRequests, bindAccount } from './api.js';
import * as store from './store.js';
import { data } from './store.js';
import * as sync from './sync.js';
import { ui } from './state.js';
import { render } from './views/render.js';
import { closeDrawer } from './views/drawer-base.js';
import { toast } from './views/toast.js';
import { openSettings, renderSettings, applyCoat } from './views/drawer-settings.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import { renderSignIn, hideSignIn } from './views/signin.js';
import { schedule as drawOrnament } from './ornament.js';
import * as focus from './focus.js';
import { paint as paintStudy } from './views/study.js';
import { $ } from './dom.js';
import { setTheme, setBg } from './theme.js';
import { celebrateStudy, finishDelete } from './study-controller.js';
import { refreshAfterSync } from './sync-status.js';

function rememberedSession() {
  try { return JSON.parse(localStorage.getItem('rounds.session') || 'null'); } catch { return null; }
}

export async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  const profile = await sync.startingProfile(rememberedSession());
  if (profile) { try { await start(profile); } catch (e) { showSignIn(e.message); } } else showSignIn();
}

async function start(profile) {
  bindAccount(profile.id);
  await store.open(profile);
  hideSignIn();
  setTheme(data.profile.theme || ui.theme, { persist: false });
  setBg(data.profile.bg || ui.bg, { persist: false });
  applyCoat();
  ui.quoteIx = data.quotes.length ? Math.floor(Math.random() * data.quotes.length) : 0;
  await focus.load();
  if (focus.active()) ui.focus = true;       /* a run this device was in the middle of */
  render();
  paintStudy(false);
  drawOrnament();
  celebrateStudy();                             /* the first look only records where today stands */
  sync.init();
  sync.syncNow();
  spotify.start();
  const back = spotifyReturn();
  if (back) { ui.spotifyNote = back; openSettings('spotifyGrp'); }
}

/* Spotify's consent page sends the browser back to /#spotify=connected or =error. */
function spotifyReturn() {
  const m = location.hash.match(/^#spotify=(connected|error)$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m[1];
}

/** What the store reports: a change, a failed save, a sign-out, another tab's edit. */
export function onStoreEvent(evt) {
  if (evt.type === 'change' && data.profile) celebrateStudy();
  if (evt.type === 'save-error') toast('The change could not be saved on this device. ' + evt.message, { error: true, ms: 10000 });
  if (evt.type === 'signed-out') { sync.stop(); spotify.stop(); web.stop(); resetRequests(); location.reload(); }
  if (evt.type === 'remote' && data.profile) refreshAfterSync();
}

/* Another tab signed in as someone else, or out: this one starts over. */
export function onStorage(event) {
  if (event.key !== 'rounds.session' || !data.profile) return;
  let id;
  try { id = JSON.parse(event.newValue || 'null')?.id; } catch {}
  if (id !== data.profile.id) {
    sync.stop(); spotify.stop(); web.stop(); resetRequests();
    store.close().finally(() => location.reload());
  }
}

export function showSignIn(error, username = '') {
  renderSignIn({ error, username });
}

/* With unsynced edits or saved copies on this device, the first press asks in Settings;
   the second (`force`) erases them. */
export async function signOut({ everywhere = false, force = false } = {}) {
  await finishDelete();
  await store.reload();
  if (!force && (store.pendingCount() || store.conflicts.length)) { ui.signoutAsk = { everywhere }; renderSettings(); return; }
  ui.signoutAsk = null;
  sync.stop();
  spotify.stop();
  resetRequests();
  try { await (everywhere ? api.revokeAll() : api.signOut()); }
  catch {
    sync.init();
    spotify.start();
    toast('Sign-out failed. Check your connection and try again.', { error: true, ms: 8000 });
    return;
  }
  await sync.drain();
  focus.reset();
  const id = data.profile?.id;
  spotify.stop();
  web.stop();
  closeDrawer();
  if (id) {
    try { await store.wipe(id); }
    catch (e) { alert('You are signed out, but local cleanup is still pending. ' + e.message); }
  } else await store.close();
  location.reload(); // Clear every in-memory account cache at the session boundary.
}

export async function signIn(e) {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const username = $('loginUser').value.trim(), password = $('loginPass').value;
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    sync.stop();
    spotify.stop();
    resetRequests();
    await api.login(username, password);
    location.reload();
  } catch (err) {
    showSignIn(!(err instanceof ApiError) ? 'You seem to be offline.'
      : err.status === 401 ? 'Wrong username or password.'
      : err.status === 429 ? 'Too many attempts. Try again in ' + Math.max(1, Math.ceil((err.body?.retryAfter || 60) / 60)) + ' min.'
      : err.status === 403 ? 'Sign in from the app itself, not from another site.'
      : 'Sign-in failed (' + (err.body?.error || err.status) + ').', username);
  }
}
