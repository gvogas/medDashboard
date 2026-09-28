// Wires the modules together and routes every event. Views render; the controllers
// beside them (session, theme, sync-status, study-controller, keyboard) decide what happens.
// The study timer's run and its focus screen are React's (src/data/study-timer.ts).

import * as store from './store.js';
import { data } from './store.js';
import * as sync from './sync.js';
import { useTypePrefs } from './model.js';
import { $ } from './dom.js';
import { notify } from '../../bridge.ts';
import { setSide, watchSidebar } from '../../data/sidebar.ts';
import { flush as flushTyping } from '../../data/item-edit.ts';
import * as spotify from '../../data/spotify/player.ts';
import * as web from '../../data/spotify/web-player.ts';
import { followSystem } from './theme.js';
import { refreshAfterSync, runHeldRefresh, pointerPressed, pointerReleased, runReviews } from './sync-status.js';
import { boot, showSignIn, signOut, onStoreEvent, onStorage } from './session.js';
import { commitUndo, finishDelete } from './study-controller.js';
import { onKeydown } from './keyboard.js';

/* what is typed in the item sheet is saved before the page goes */
window.addEventListener('pagehide', () => { flushTyping(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushTyping(); commitUndo(); finishDelete().catch(() => {}); } });

/* ═════════ theme ═════════ */
useTypePrefs(() => data.profile?.types || []);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', followSystem);

/* ═════════ sync ═════════ */
/* The status shows in the React top bar and Settings (src/data/sync.ts listens). */
sync.onPulled(async () => {
  await runReviews();
  refreshAfterSync();
});
document.addEventListener('focusout', runHeldRefresh);
document.addEventListener('pointerdown', pointerPressed, true);
for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, pointerReleased, true);
sync.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* ═════════ Spotify ═════════ */
/* The sidebar player, the Spotify page and the focus screen's music are React
   (components/spotify/, components/focus/) and redraw through useSpotify(). */
spotify.onState((s, kind) => {
  if (kind !== 'state') return;
  if (s.connected) web.start(); else if (s.loaded) web.stop();     /* the tab is a device only while connected */
  notify();   /* the top bar shows the device, Settings the connection */
});
web.onChange(() => {
  notify();   /* Settings says whether this tab is a device */
});
spotify.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* ═════════ session ═════════ */
store.subscribe(onStoreEvent);
window.addEventListener('storage', onStorage);

/* ═════════ events ═════════ */
/* A click outside the phone sidebar closes it. */
document.addEventListener('click', (e) => {
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn') && $('side').classList.contains('on')) setSide(false);
});

watchSidebar();

document.addEventListener('keydown', onKeydown);

boot();
