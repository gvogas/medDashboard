// Wires the modules together and routes every event. Views render; the controllers
// beside them (session, theme, sync-status, study-controller, keyboard) decide what happens.

import { api } from './api.js';
import * as store from './store.js';
import { data, course } from './store.js';
import * as sync from './sync.js';
import { ui, rememberUi } from './state.js';
import { uid, isOpen, tmeta, useTypePrefs } from './model.js';
import { schoolCal, termStart } from './query.js';
import { iso, parse, addDays, today } from './dates.js';
import { $, restoreFocus } from './dom.js';
import { render, renderView, renderHeader } from './views/render.js';
import { notify } from '../../bridge.ts';
import { renderStats, renderQuote, nextQuote } from './views/stats.js';
import { drawer, scrim, closeDrawer, drawerHasFocus, beforeClose, setSide, narrow } from './views/drawer-base.js';
import { openItem, newItem, current, saveDraft, touch, touchSoon, flushTouch, renderItemDrawer, noteStartBase, onItemInput, celebrate, setStatus, chainReview } from './views/drawer-item.js';
import { openKeys } from './views/keys.js';
import { renderSessionDrawer, editSession, saveSessionDraft } from './views/drawer-session.js';
import { achievementClick, editAchievement } from './views/drawer-achievement.js';
import { leaderboardClick } from './views/leaderboard.js';
import { schoolClick, editSchool, readSchoolFile } from './views/drawer-school.js';
import { launch as fireworks } from './fireworks.js';
import { openCourse, renderCourseDrawer, saveCourseDraft, leaveDrawer, onCourseInput } from './views/drawer-course.js';
import { toast } from './views/toast.js';
import { openSettings, renderSettings, applyCoat, refreshSpotifyGroup, feedAction, addQuote } from './views/drawer-settings.js';
import * as spotify from './spotify.js';
import * as web from './web-player.js';
import { renderPlayer } from './views/player.js';
import * as spotView from './views/spotify-view.js';
import { readSetting, writeSetting } from './reviews.js';
import { fillTopics } from './prep.js';
import { previewImport, editImport, commitImport, readOutlineFile } from './views/drawer-import.js';
import * as focus from './focus.js';
import { setTheme, setBg, followSystem } from './theme.js';
import { showSyncStatus, refreshAfterSync, runHeldRefresh, pointerPressed, pointerReleased, runReviews } from './sync-status.js';
import { boot, showSignIn, signOut, signIn, onStoreEvent, onStorage } from './session.js';
import { onFocusTick, commitUndo, finishDelete, deleteWithUndo, deleteLater, studyClick, studyChange, savePrefs } from './study-controller.js';
import { onKeydown } from './keyboard.js';

beforeClose.add(flushTouch);
document.addEventListener('focusin', noteStartBase);
document.addEventListener('focusout', (e) => { if (drawer.contains(e.target)) flushTouch(); });
window.addEventListener('pagehide', flushTouch);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flushTouch(); commitUndo(); finishDelete().catch(() => {}); } });

/* ═════════ theme ═════════ */
useTypePrefs(() => data.profile?.types || []);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', followSystem);

/* ═════════ sync status pill ═════════ */
sync.onStatus(showSyncStatus);
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
  if (ui.view === 'spotify' || ui.focus) { spotView.onPlayerState(); renderHeader(); }
});
web.onChange(() => {
  renderPlayer(spotify.state);
  if (ui.settings && !drawerHasFocus()) refreshSpotifyGroup();
});
spotView.onChange(() => { if (ui.view === 'spotify' || ui.focus) renderView(); });   /* the view keeps its own scroll and caret */
spotify.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* ═════════ the quote tile turns its own page ═════════ */
const QUOTE_EVERY_MS = 25000;
setInterval(() => {
  if (document.visibilityState !== 'visible' || !data.profile) return;
  if (document.querySelector('.qcard:hover, .qcard:focus-within')) return;   /* being read: leave it */
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  nextQuote();
}, QUOTE_EVERY_MS);

/* ═════════ session ═════════ */
store.subscribe(onStoreEvent);
window.addEventListener('storage', onStorage);

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-spot-form]')) return;
  e.preventDefault();
  spotView.typed('');                               /* no delayed search after this one */
  spotView.search(e.target.querySelector('[data-spot-q]').value);
});

$('signin').addEventListener('submit', signIn);

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
  if ((el = e.target.closest('[data-color]'))) {
    if (ui.courseDraft) { ui.courseDraft.color = el.dataset.color; renderCourseDrawer(); }
    return;
  }
  if ((el = e.target.closest('[data-mx]'))) {
    if (ui.courseDraft) {
      ui.courseDraft.meetings = ui.courseDraft.meetings.filter((m) => m.id !== el.dataset.mx);
      renderCourseDrawer();
    }
    return;
  }
  if (await studyClick(e)) return;
  if (await achievementClick(e)) return;
  if (await leaderboardClick(e)) return;
  if (await schoolClick(e)) return;
  if (e.target.closest('#menuBtn')) { setSide(!$('side').classList.contains('on')); return; }
  if (e.target.closest('#newBtn')) { newItem(ui.anchor); return; }
  if (e.target.closest('#today')) { ui.anchor = today(); render(); return; }
  if (e.target.closest('#prev') || e.target.closest('#next')) {
    const dir = e.target.closest('#prev') ? -1 : 1, a = parse(ui.anchor);
    ui.anchor = ui.view === 'month' ? iso(new Date(a.getFullYear(), a.getMonth() + dir, 1)) : iso(addDays(a, 7 * dir));
    render(); return;
  }
  if (e.target.closest('#syncPill')) { sync.syncNow(); return; }
  if (e.target.closest('#setBtn')) { ui.settings ? closeDrawer() : openSettings(); return; }
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
  if ((el = e.target.closest('[data-quotenext]'))) {
    const r = el.getBoundingClientRect();
    fireworks(r.left + r.width / 2, r.top + 4);
    if (!nextQuote()) openSettings('qText');
    return;
  }
  if ((el = e.target.closest('[data-themeset]'))) { setTheme(el.dataset.themeset); return; }
  if ((el = e.target.closest('[data-bgset]'))) { setBg(el.dataset.bgset); return; }
  if ((el = e.target.closest('[data-coatcolor]'))) {
    await store.saveProfile({ coat: { color: el.dataset.coatcolor } });
    applyCoat(); renderSettings(); return;
  }
  if ((el = e.target.closest('[data-qx]'))) {
    await store.deleteQuote(el.dataset.qx);
    if (ui.quoteIx >= data.quotes.length) ui.quoteIx = 0;
    renderSettings(); renderQuote(); return;
  }
  if ((el = e.target.closest('[data-add]'))) { e.stopPropagation(); newItem(el.dataset.add); return; }
  if ((el = e.target.closest('[data-toggle]'))) {
    const it = store.item(el.dataset.toggle);
    if (it) {
      const finishing = isOpen(it);
      if (finishing) celebrate(el);
      setStatus(it, finishing ? 'done' : 'todo');
      await touch(it);
      await chainReview(it);
    }
    render(); return;
  }
  if ((el = e.target.closest('.row, tbody tr[data-id], .task .tx, .oh tbody tr'))) {
    const host = el.dataset.id ? el : el.closest('[data-id]');
    if (host && host.dataset.id) { openItem(host.dataset.id); return; }
  }
  if (e.target.closest('[data-monthdeadlines]')) { ui.monthDeadlines = !ui.monthDeadlines; rememberUi(); renderView(); return; }
  if ((el = e.target.closest('[data-day]'))) { ui.anchor = el.dataset.day; ui.view = 'week'; rememberUi(); render(); return; }
  if ((el = e.target.closest('[data-sort]'))) {
    const k = el.dataset.sort;
    if (ui.sort.key === k) ui.sort.dir *= -1; else { ui.sort.key = k; ui.sort.dir = 1; }
    renderView(); return;
  }

  if ((el = e.target.closest('[data-act]'))) {
    const act = el.dataset.act, it = current();
    if (act === 'close') leaveDrawer();
    else if (act === 'cancel') closeDrawer();
    else if (act === 'save') saveDraft();
    else if (act === 'delete') { ui.confirm = 'item'; renderItemDrawer(); drawer.querySelector('[data-act="keep"]')?.focus(); }
    else if (act === 'keep') {
      const was = ui.confirm;
      ui.confirm = null;
      ui.sessionDraft ? renderSessionDrawer() : ui.courseDraft ? renderCourseDrawer() : renderItemDrawer();
      drawer.querySelector(was === 'discard' ? '.dtitle' : '[data-act$="delete"]')?.focus();
    }
    else if (act === 'session-save') saveSessionDraft();
    else if (act === 'session-delete') { ui.confirm = 'session'; renderSessionDrawer(); drawer.querySelector('[data-act="keep"]')?.focus(); }
    else if (act === 'session-delete-yes' && ui.sessionDraft) { const id = ui.sessionDraft.id; closeDrawer(); deleteWithUndo(id); }
    else if (act === 'delete-yes' && it) {
      const id = it.id, name = it.title.trim() || 'Item';
      closeDrawer();
      deleteLater('items', id, '“' + name + '”', () => store.deleteItem(id));
    }
    else if (act === 'addmtg' && ui.courseDraft) {
      ui.courseDraft.meetings = ui.courseDraft.meetings || [];
      ui.courseDraft.meetings.push({ id: uid(), kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: '' });
      renderCourseDrawer();
    }
    else if (act === 'addquote') addQuote();
    else if (act === 'course-save') saveCourseDraft();
    else if (act === 'course-delete') { ui.confirm = 'course'; renderCourseDrawer(); drawer.querySelector('[data-act="keep"]')?.focus(); }
    else if (act === 'course-delete-yes' && ui.courseDraft) {
      const c = ui.courseDraft;
      if (ui.course === c.id) ui.course = 'all';
      closeDrawer();
      deleteLater('courses', c.id, c.code || c.name || 'Course', () => store.deleteCourse(c.id));
    }
    else if (act === 'fill-topics' && it) {
      const c = course(it.courseId); if (!c) return;
      const r = fillTopics(it, c, data.items, termStart(), schoolCal());
      it.checklist = r.checklist;
      if (r.added) await touch(it);
      ui.fillNote = r.added ? 'Added ' + r.added + ' lecture' + (r.added === 1 ? '' : 's') + '.' + (r.left ? ' ' + r.left + ' more did not fit under the 50-step limit.' : '')
        : r.left ? 'The list is full: 50 steps is the most an item can hold.' : 'Every lecture before this ' + tmeta(it.type).label.toLowerCase() + ' is already listed.';
      renderItemDrawer(); renderStats(); renderView();
    }
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
  if ((el = e.target.closest('[data-cl]'))) {
    const s = current(); if (!s) return;
    s.checklist.forEach((x) => { if (x.id === el.dataset.cl) x.done = !x.done; });
    await touch(s);
    renderItemDrawer(); renderStats(); renderView(); return;
  }
  if ((el = e.target.closest('[data-clx]'))) {
    const s2 = current(); if (!s2) return;
    s2.checklist = s2.checklist.filter((x) => x.id !== el.dataset.clx);
    await touch(s2);
    renderItemDrawer(); renderView(); return;
  }
  if ((el = e.target.closest('[data-linkx]'))) {
    const s3 = current(); if (!s3) return;
    s3.links.splice(+el.dataset.linkx, 1);
    await touch(s3);
    renderItemDrawer(); return;
  }
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn') && $('side').classList.contains('on')) setSide(false);
}

narrow.addEventListener('change', () => setSide(false));
setSide(false);

scrim.addEventListener('click', () => { if ($('side').classList.contains('on') && !drawer.classList.contains('on')) setSide(false); else leaveDrawer(); });

let searchTimer = null;
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

  if (onCourseInput(e, d)) return;         /* the course drawer */
  if (d.f) { await onItemInput(e, d); return; }   /* item fields */
  if (d.cltext) {
    const s = current(); if (!s) return;
    s.checklist.forEach((x) => { if (x.id === d.cltext) x.text = e.target.value; });
    touchSoon(s, 'checklist');
    return;
  }
  if (e.target.id === 'search') {
    ui.search = e.target.value;
    clearTimeout(searchTimer);   /* redraw once typing pauses, not on every key */
    searchTimer = setTimeout(renderView, 120);
    return;
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
