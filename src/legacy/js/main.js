// Wires the modules together and routes every event. Views render; the controllers
// beside them (session, theme, sync-status, study-controller, keyboard) decide what happens.

import * as store from './store.js';
import { data } from './store.js';
import * as sync from './sync.js';
import { ui } from './state.js';
import { useTypePrefs } from './model.js';
import { $, restoreFocus } from './dom.js';
import { render, renderView } from './views/render.js';
import { notify } from '../../bridge.ts';
import { drawer, scrim, closeDrawer } from './views/drawer-base.js';
import { setSide, watchSidebar } from '../../data/sidebar.ts';
import { flush as flushTyping } from '../../data/item-edit.ts';
import { openCourse, openSettings } from '../../data/actions.ts';
import { renderSessionDrawer, editSession, saveSessionDraft } from './views/drawer-session.js';
import { achievementClick, editAchievement } from './views/drawer-achievement.js';
import { leaderboardClick } from './views/leaderboard.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import { renderPlayer } from './views/player.js';
import * as spotView from './views/spotify-view.js';
import * as focus from './focus.js';
import { followSystem } from './theme.js';
import { refreshAfterSync, runHeldRefresh, pointerPressed, pointerReleased, runReviews } from './sync-status.js';
import { boot, showSignIn, signOut, onStoreEvent, onStorage } from './session.js';
import { onFocusTick, commitUndo, finishDelete, deleteWithUndo, studyClick, studyChange } from './study-controller.js';
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

/* ═════════ the Spotify badge on the coat ═════════ */
spotify.onState((s, kind) => {
  renderPlayer(s, kind);
  if (kind !== 'state') return;
  if (s.connected) web.start(); else if (s.loaded) web.stop();     /* the tab is a device only while connected */
  if (ui.view === 'spotify' || ui.focus) spotView.onPlayerState();
  notify();   /* the top bar shows the device, Settings the connection */
});
web.onChange(() => {
  renderPlayer(spotify.state);
  notify();   /* Settings says whether this tab is a device */
});
spotView.onChange(() => { if (ui.view === 'spotify' || ui.focus) renderView(); });   /* the view keeps its own scroll and caret */
spotify.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* ═════════ session ═════════ */
store.subscribe(onStoreEvent);
window.addEventListener('storage', onStorage);

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-spot-form]')) return;
  e.preventDefault();
  spotView.typed('');                               /* no delayed search after this one */
  spotView.search(e.target.querySelector('[data-spot-q]').value);
});

/* ═════════ the study timer ═════════ */
focus.onTick(onFocusTick);

/* ═════════ events ═════════ */
/* Most clicks redraw what was clicked. Focus then goes back to the same control in the
   new markup, or to the drawer itself when that control is gone (a question answered),
   so a keyboard user is not dropped to the top of the page. */
document.addEventListener('click', async (e) => {
  const was = document.activeElement, inDrawer = drawer.contains(was);
  await onClick(e);
  restoreFocus(was, inDrawer && drawer.classList.contains('on') ? drawer : null);
});
async function onClick(e) {
  let el;
  if ((el = e.target.closest('[data-newcourse]'))) { openCourse(null); return; }
  if ((el = e.target.closest('[data-editcourse]'))) { openCourse(el.dataset.editcourse); return; }
  if (await studyClick(e)) return;
  if (await achievementClick(e)) return;
  if (await leaderboardClick(e)) return;
  if ((el = e.target.closest('[data-spotify]'))) {
    const act = el.dataset.spotify;
    if (act !== 'connect') web.activate();          /* inside the click, so the tab may make sound */
    if (act === 'connect') openSettings('spotifyGrp');
    else if (act === 'here') spotify.playHere();
    else if (act === 'previous') spotify.previous();
    else spotify.control(act);
    return;
  }
  if (spotView.devicesOpen() && !e.target.closest('.spot-devs, [data-spot-devices]')) spotView.closeDevices();
  if ((el = e.target.closest('[data-spot-pane]'))) { el.dataset.spotPane === 'queue' ? spotView.openQueue(true) : spotView.openHome(); return; }
  if ((el = e.target.closest('[data-spot-pl]'))) { spotView.openPlaylist(el.dataset.spotPl, el.dataset.spotName); return; }
  if ((el = e.target.closest('[data-spot-album]'))) { spotView.openAlbum(el.dataset.spotAlbum); return; }
  if ((el = e.target.closest('[data-spot-artist]'))) { spotView.openArtist(el.dataset.spotArtist); return; }
  if ((el = e.target.closest('[data-spot-refresh]'))) { spotView.refresh(el.dataset.spotRefresh); return; }
  if ((el = e.target.closest('[data-spot-more]'))) { spotView.more(el.dataset.spotMore); return; }
  if ((el = e.target.closest('[data-spot-play]'))) { web.activate(); spotView.play(el.dataset.spotPlay, el.dataset.spotCtx, el.dataset.spotList); return; }
  if ((el = e.target.closest('[data-spot-queue]'))) { spotView.queueAdd(el.dataset.spotQueue, el); return; }
  if (e.target.closest('[data-spot-shuffle]')) { spotView.toggleShuffle(); return; }
  if (e.target.closest('[data-spot-repeat]')) { spotView.cycleRepeat(); return; }
  if (e.target.closest('[data-spot-devices]')) { spotView.toggleDevices(); return; }
  if ((el = e.target.closest('[data-spot-device]'))) { web.activate(); spotView.pickDevice(el.dataset.spotDevice); return; }

  if ((el = e.target.closest('[data-act]'))) {
    const act = el.dataset.act;
    if (act === 'close' || act === 'cancel') closeDrawer();
    else if (act === 'keep' && ui.sessionDraft) {
      ui.confirm = null;
      renderSessionDrawer();
      drawer.querySelector('[data-act$="delete"]')?.focus();
    }
    else if (act === 'session-save') saveSessionDraft();
    else if (act === 'session-delete') { ui.confirm = 'session'; renderSessionDrawer(); drawer.querySelector('[data-act="keep"]')?.focus(); }
    else if (act === 'session-delete-yes' && ui.sessionDraft) { const id = ui.sessionDraft.id; closeDrawer(); deleteWithUndo(id); }
    return;
  }
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn') && $('side').classList.contains('on')) setSide(false);
}

watchSidebar();
scrim.addEventListener('click', () => { if (drawer.classList.contains('on')) closeDrawer(); });   /* the legacy drawer's; the sheet and the sidebar take their own */

document.addEventListener('input', async (e) => {
  const d = e.target.dataset || {};
  if ('sd' in d) { editSession(d.sd, e.target.value); return; }     /* the Log study drawer */
  if ('ach' in d) { editAchievement(d.ach, e.target.value); return; } /* the achievement drawer */
  if ('spotVol' in d) { spotView.setVolume(+e.target.value); return; }
  if ('spotQ' in d) { spotView.typed(e.target.value); return; }
  if ('spotFilter' in d) { spotView.setFilter(e.target.value); return; }
});

document.addEventListener('change', (e) => { studyChange(e.target); });   /* the Study view's selects and flow */

document.addEventListener('keydown', onKeydown);

boot();
