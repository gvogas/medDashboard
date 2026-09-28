// Wires the modules together and routes every event. Views render; the controllers
// beside them (session, theme, sync-status, study-controller, keyboard) decide what happens.

import { api } from './api.js';
import * as store from './store.js';
import { data } from './store.js';
import * as sync from './sync.js';
import { ui } from './state.js';
import { useTypePrefs } from './model.js';
import { $, restoreFocus } from './dom.js';
import { render, renderView } from './views/render.js';
import { notify } from '../../bridge.ts';
import { drawer, scrim, closeDrawer, drawerHasFocus, setSide, narrow } from './views/drawer-base.js';
import { flush as flushTyping } from '../../data/item-edit.ts';
import { openCourse } from '../../data/actions.ts';
import { openKeys } from './views/keys.js';
import { renderSessionDrawer, editSession, saveSessionDraft } from './views/drawer-session.js';
import { achievementClick, editAchievement } from './views/drawer-achievement.js';
import { leaderboardClick } from './views/leaderboard.js';
import { schoolClick, editSchool, readSchoolFile } from './views/drawer-school.js';
import { toast } from './views/toast.js';
import { openSettings, renderSettings, refreshSyncNote, applyCoat, refreshSpotifyGroup, feedAction, addQuote } from './views/drawer-settings.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import { renderPlayer } from './views/player.js';
import * as spotView from './views/spotify-view.js';
import { readSetting, writeSetting } from './reviews.js';
import { previewImport, editImport, commitImport, readOutlineFile } from './views/drawer-import.js';
import * as focus from './focus.js';
import { setTheme, setBg, followSystem } from './theme.js';
import { refreshAfterSync, runHeldRefresh, pointerPressed, pointerReleased, runReviews } from './sync-status.js';
import { boot, showSignIn, signOut, onStoreEvent, onStorage } from './session.js';
import { onFocusTick, commitUndo, finishDelete, deleteWithUndo, studyClick, studyChange, savePrefs } from './study-controller.js';
import { onKeydown } from './keyboard.js';

/* what is typed in the item sheet is saved before the page goes */
window.addEventListener('pagehide', () => { flushTyping(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushTyping(); commitUndo(); finishDelete().catch(() => {}); } });

/* ═════════ theme ═════════ */
useTypePrefs(() => data.profile?.types || []);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', followSystem);

/* ═════════ sync ═════════ */
/* The status itself shows in the React top bar; Settings has a line about it too. */
sync.onStatus(refreshSyncNote);
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
  if (ui.settings && !drawerHasFocus()) refreshSpotifyGroup();
  if (ui.view === 'spotify' || ui.focus) { spotView.onPlayerState(); notify(); }   /* the top bar shows the device */
});
web.onChange(() => {
  renderPlayer(spotify.state);
  if (ui.settings && !drawerHasFocus()) refreshSpotifyGroup();
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
  if (await schoolClick(e)) return;
  if ((el = e.target.closest('[data-settab]'))) { ui.settingsTab = el.dataset.settab; renderSettings(); return; }
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
  if ((el = e.target.closest('[data-themeset]'))) { setTheme(el.dataset.themeset); return; }
  if ((el = e.target.closest('[data-bgset]'))) { setBg(el.dataset.bgset); return; }
  if ((el = e.target.closest('[data-coatcolor]'))) {
    await store.saveProfile({ coat: { color: el.dataset.coatcolor } });
    applyCoat(); renderSettings(); return;
  }
  if ((el = e.target.closest('[data-qx]'))) {
    await store.deleteQuote(el.dataset.qx);
    if (ui.quoteIx >= data.quotes.length) ui.quoteIx = 0;
    renderSettings(); notify(); return;
  }

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
    else if (act === 'addquote') addQuote();
    else if (act === 'session-delete-yes' && ui.sessionDraft) { const id = ui.sessionDraft.id; closeDrawer(); deleteWithUndo(id); }
    else if (act === 'import-paste') {
      const box = $('importText');
      const text = box ? box.value : '';
      if (!text.trim()) return;
      const error = previewImport(text);
      if (error) { ui.importNote = { text: error, error: true }; renderSettings(); }
    }
    else if (act === 'import-cancel') openSettings('importGrp');
    else if (act === 'import-confirm') {
      el.disabled = true;
      let note;
      try { note = { text: await commitImport() }; }
      catch (error) { note = { text: 'The import stopped part-way: ' + error.message, error: true }; }
      render();
      ui.importNote = note;
      openSettings('importGrp');
    }
    else if (act === 'export-data') {
      await store.reload();
      const blob = new Blob([JSON.stringify({ ...store.data, pending: await store.pending(), conflicts: store.conflicts }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'rounds-backup.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    else if (act === 'conflict-restore' || act === 'conflict-dismiss') {
      try { await store.resolveConflict(el.dataset.conflict, act === 'conflict-restore'); renderSettings(); }
      catch (error) { toast(error.message, { error: true, ms: 8000 }); }
    }
    else if (act === 'shortcuts') { closeDrawer(); openKeys(); }
    else if (act.startsWith('feed-')) feedAction(act);
    else if (act === 'signout') signOut();
    else if (act === 'signout-all') signOut({ everywhere: true });
    else if (act === 'signout-force') signOut({ everywhere: !!ui.signoutAsk?.everywhere, force: true });
    else if (act === 'signout-keep') { ui.signoutAsk = null; renderSettings(); }
    else if (act === 'spotify-disconnect') {
      try { await api.spotifyDisconnect(); }
      catch { toast('Spotify could not be disconnected. Try again when you are online.', { error: true, ms: 8000 }); return; }
      location.reload();
    }
    return;
  }
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn') && $('side').classList.contains('on')) setSide(false);
}

narrow.addEventListener('change', () => setSide(false));
setSide(false);

scrim.addEventListener('click', () => { if ($('side').classList.contains('on') && !drawer.classList.contains('on')) setSide(false); else closeDrawer(); });   /* the React sheet takes its own scrim clicks */

document.addEventListener('input', async (e) => {
  const d = e.target.dataset || {};
  if ('sd' in d) { editSession(d.sd, e.target.value); return; }     /* the Log study drawer */
  if ('ach' in d) { editAchievement(d.ach, e.target.value); return; } /* the achievement drawer */
  if (('sc' in d || 'sct' in d || 'scd' in d) && editSchool(e.target)) return;   /* the school calendar drawer */

  if ('reviews' in d) {
    const setting = readSetting(data.profile.id);
    writeSetting(data.profile.id, e.target.checked ? { on: true, through: setting.through && setting.on ? setting.through : null } : { on: false, through: null });
    await runReviews();
    renderSettings(); return;
  }
  if ('impM' in d || 'impI' in d || 'impType' in d || 'impWeek1' in d) { editImport(e.target); return; }

  if ('spotVol' in d) { spotView.setVolume(+e.target.value); return; }
  if ('spotQ' in d) { spotView.typed(e.target.value); return; }
  if ('spotFilter' in d) { spotView.setFilter(e.target.value); return; }

  if (d.of) {                             /* what the coat says */
    await store.saveProfile({ coat: { [d.of]: e.target.value } });
    const prev = $(d.of === 'name' ? 'coatPrevName' : 'coatPrevRole');
    if (prev) prev.textContent = e.target.value;
    notify(); return;
  }

});

document.addEventListener('change', async (e) => {
  if (await studyChange(e.target)) return;
  if (e.target.id === 'goalDayMin') { const v = Math.round(+e.target.value); if (v >= 1 && v <= 240) await savePrefs({ dayMin: v }); else renderSettings(); return; }
  if (e.target.id === 'goalCelebrate') { await savePrefs({ celebrate: e.target.checked }); return; }
  if (e.target.id === 'outlineFile' && e.target.files?.[0]) { readOutlineFile(e.target.files[0]); return; }
  if (e.target.id === 'schoolFile' && e.target.files?.[0]) { readSchoolFile(e.target.files[0]); return; }
  if (e.target.id !== 'importFile' || !e.target.files?.[0]) return;
  const file = e.target.files[0];
  if (file.size > 2_000_000) { ui.importNote = { text: 'That file is over 2 MB; export a single term instead.', error: true }; renderSettings(); return; }
  const error = previewImport(await file.text(), file.name);
  if (error) { ui.importNote = { text: error, error: true }; renderSettings(); }
});

document.addEventListener('keydown', onKeydown);

boot();
