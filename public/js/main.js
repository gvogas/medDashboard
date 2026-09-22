// Boot, sign-in, and every event handler. Views render; this file decides what happens.

import { api, ApiError } from './api.js';
import * as store from './store.js';
import { data, course } from './store.js';
import * as sync from './sync.js';
import { ui, rememberUi } from './state.js';
import { ORDER, uid, isOpen, isComplete, normalizeItem } from './model.js';
import { iso, parse, addDays, today } from './dates.js';
import { $, autoGrow } from './dom.js';
import { render, renderView } from './views/render.js';
import { renderSidebar } from './views/sidebar.js';
import { renderStats, renderQuote, nextQuote } from './views/stats.js';
import { drawer, scrim, closeDrawer, drawerHasFocus } from './views/drawer-base.js';
import { openItem, newItem, current, saveDraft, touch, renderItemDrawer } from './views/drawer-item.js';
import { openCourse, renderCourseDrawer, saveCourseDraft, deleteCourseDraft } from './views/drawer-course.js';
import { openSettings, renderSettings, applyCoat, refreshSyncNote } from './views/drawer-settings.js';
import { renderSignIn, hideSignIn } from './views/signin.js';
import { importText } from './import.js';
import { schedule as drawOrnament } from './ornament.js';
import { parseTime } from './timepicker.js';
import { launch as fireworks } from './fireworks.js';

/* ═════════ theme ═════════ */
function setTheme(choice, { persist = true } = {}) {
  ui.theme = choice;
  if (window.__roundsApplyTheme) window.__roundsApplyTheme(choice);
  rememberUi();
  if (persist && data.profile && data.profile.theme !== choice) store.saveProfile({ theme: choice });
  if (ui.settings) renderSettings();
  drawOrnament();                     /* the ornament layer is drawn in the theme's teal */
}
function followSystem() { if (ui.theme === 'system') setTheme('system', { persist: false }); }
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', followSystem);

/* ═════════ sync status pill ═════════ */
const LABELS = { idle: 'Synced', pending: 'Saving…', syncing: 'Syncing…', offline: 'Offline', error: 'Sync problem', 'signed-out': 'Signed out' };
sync.onStatus((s) => {
  const pill = $('syncPill');
  pill.dataset.state = s.state;
  pill.textContent = LABELS[s.state] + (s.state === 'offline' && s.pending ? ' · ' + s.pending : '');
  pill.title = s.message || (s.state === 'offline' ? 'Changes are kept on this device until you are back online' : 'Sync now');
  refreshSyncNote();
});
sync.onPulled(() => { if (!drawerHasFocus()) { render(); if (ui.sel) renderItemDrawer(); if (ui.settings) renderSettings(); } });
sync.onUnauthenticated(() => showSignIn('Your session has ended. Sign in again.'));

/* ═════════ the quote tile turns its own page ═════════ */
const QUOTE_EVERY_MS = 25000;
setInterval(() => {
  if (document.visibilityState !== 'visible' || !data.profile) return;
  if (document.querySelector('.qcard:hover')) return;                 /* being read: leave it */
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  nextQuote();
}, QUOTE_EVERY_MS);

/* ═════════ boot ═════════ */
function rememberedSession() {
  try { return JSON.parse(localStorage.getItem('rounds.session') || 'null'); } catch { return null; }
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let profile = null;
  try {
    profile = await api.me();
  } catch (e) {
    if (!(e instanceof ApiError)) profile = rememberedSession();   /* offline: open what we have */
  }
  if (profile) await start(profile); else showSignIn();
}

async function start(profile) {
  await store.open(profile);
  hideSignIn();
  setTheme(data.profile.theme || ui.theme, { persist: false });
  applyCoat();
  ui.quoteIx = data.quotes.length ? Math.floor(Math.random() * data.quotes.length) : 0;
  render();
  drawOrnament();
  sync.init();
  sync.syncNow();
}

function showSignIn(error, username = '') {
  renderSignIn({ error, username });
}

async function signOut({ everywhere = false } = {}) {
  try { await (everywhere ? api.revokeAll() : api.signOut()); } catch {}
  const id = data.profile?.id;
  closeDrawer();
  await store.close();
  if (id) { try { await store.wipe(id); } catch {} }
  showSignIn();
}

$('signin').addEventListener('submit', async (e) => {
  if (e.target.id !== 'loginForm') return;
  e.preventDefault();
  const username = $('loginUser').value.trim(), password = $('loginPass').value;
  const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await start(await api.login(username, password));
  } catch (err) {
    showSignIn(!(err instanceof ApiError) ? 'You seem to be offline.'
      : err.status === 401 ? 'Wrong username or password.'
      : err.status === 429 ? 'Too many attempts. Try again in ' + Math.max(1, Math.ceil((err.body?.retryAfter || 60) / 60)) + ' min.'
      : err.status === 403 ? 'Sign in from the app itself, not from another site.'
      : 'Sign-in failed (' + (err.body?.error || err.status) + ').', username);
  }
});

/* ═════════ events ═════════ */
document.addEventListener('click', async (e) => {
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
  if ((el = e.target.closest('[data-type]'))) {
    const t = el.dataset.type, on = ORDER.filter((x) => ui.types[x]).length;
    if (ui.types[t] && on === ORDER.length) ORDER.forEach((x) => { ui.types[x] = (x === t); });
    else if (ui.types[t] && on === 1) ORDER.forEach((x) => { ui.types[x] = true; });
    else ui.types[t] = !ui.types[t];
    render(); return;
  }
  if ((el = e.target.closest('[data-course]'))) { ui.course = el.dataset.course; render(); return; }
  if ((el = e.target.closest('#viewSeg button'))) { ui.view = el.dataset.view; rememberUi(); render(); return; }
  if (e.target.closest('#menuBtn')) { $('side').classList.toggle('on'); return; }
  if (e.target.closest('#newBtn')) { newItem(ui.anchor); return; }
  if (e.target.closest('#today')) { ui.anchor = today(); render(); return; }
  if (e.target.closest('#prev') || e.target.closest('#next')) {
    const dir = e.target.closest('#prev') ? -1 : 1, a = parse(ui.anchor);
    ui.anchor = ui.view === 'month' ? iso(new Date(a.getFullYear(), a.getMonth() + dir, 1)) : iso(addDays(a, 7 * dir));
    render(); return;
  }
  if (e.target.closest('#syncPill')) { sync.syncNow(); return; }
  if (e.target.closest('#setBtn')) { ui.settings ? closeDrawer() : openSettings(); return; }
  if ((el = e.target.closest('[data-setopen]'))) { openSettings('o-name'); return; }
  if ((el = e.target.closest('[data-quotenext]'))) {
    const r = el.getBoundingClientRect();
    fireworks(r.left + r.width / 2, r.top + 4);
    if (!nextQuote()) openSettings('qText');
    return;
  }
  if ((el = e.target.closest('[data-themeset]'))) { setTheme(el.dataset.themeset); return; }
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
    }
    render(); return;
  }
  if ((el = e.target.closest('.row, tbody tr[data-id], .task .tx, .oh tbody tr'))) {
    const host = el.dataset.id ? el : el.closest('[data-id]');
    if (host && host.dataset.id) { openItem(host.dataset.id); return; }
  }
  if ((el = e.target.closest('[data-day]'))) { ui.anchor = el.dataset.day; ui.view = 'week'; rememberUi(); render(); return; }
  if ((el = e.target.closest('[data-sort]'))) {
    const k = el.dataset.sort;
    if (ui.sort.key === k) ui.sort.dir *= -1; else { ui.sort.key = k; ui.sort.dir = 1; }
    renderView(); return;
  }

  if ((el = e.target.closest('[data-act]'))) {
    const act = el.dataset.act, it = current();
    if (act === 'close' || act === 'cancel') closeDrawer();
    else if (act === 'save') saveDraft();
    else if (act === 'delete') { ui.confirm = 'item'; renderItemDrawer(); }
    else if (act === 'keep') { ui.confirm = null; ui.courseDraft ? renderCourseDrawer() : renderItemDrawer(); }
    else if (act === 'delete-yes' && it) { await store.deleteItem(it.id); closeDrawer(); }
    else if (act === 'addmtg' && ui.courseDraft) {
      ui.courseDraft.meetings = ui.courseDraft.meetings || [];
      ui.courseDraft.meetings.push({ id: uid(), kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: '' });
      renderCourseDrawer();
    }
    else if (act === 'addquote') addQuote();
    else if (act === 'course-save') saveCourseDraft();
    else if (act === 'course-delete') { ui.confirm = 'course'; renderCourseDrawer(); }
    else if (act === 'course-delete-yes' && ui.courseDraft) deleteCourseDraft();
    else if (act === 'signout') signOut();
    else if (act === 'signout-all') signOut({ everywhere: true });
    else if (act === 'import') runImport();
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
  if (!e.target.closest('#side') && !e.target.closest('#menuBtn')) $('side').classList.remove('on');
});

scrim.addEventListener('click', closeDrawer);

/* Some items name themselves from the course: office hours after the teacher, exams
   and tutorials after the class. Picking a course (or switching type) fills the title in, unless
   the title was typed by hand. */
function autoTitleFor(type, c) {
  if (!c) return '';
  if (type === 'office') return c.instructor ? c.instructor + ' — office hours' : '';
  if (type === 'exam') return c.name ? 'Exam — ' + c.name : '';
  if (type === 'tutoring') return c.name ? c.name + ' — tutorial' : '';
  return '';
}
function autoTitle(it, prevCourseId) {
  const next = autoTitleFor(it.type, course(it.courseId));
  if (!next) return;
  const wasAuto = ['office', 'exam', 'tutoring'].some((t) => it.title === autoTitleFor(t, course(prevCourseId)) || it.title === autoTitleFor(t, course(it.courseId)));
  if (it.title.trim() && !wasAuto) return;
  it.title = next;
  const ta = drawer.querySelector('.dtitle');
  if (ta) { ta.value = next; autoGrow(ta); }
  if (ui.draft) {
    const b = drawer.querySelector('[data-act="save"]'), h = drawer.querySelector('.dfoot .hint');
    if (b) b.disabled = false;
    if (h) h.textContent = 'Ready to save';
  }
}

/* A small show from an element, for finishing something. */
function celebrate(el) {
  const r = el.getBoundingClientRect();
  fireworks(r.left + r.width / 2, r.top + r.height / 2, { rockets: 2 });
}

function setStatus(it, status) {
  it.status = status;
  it.completedAt = status === 'todo' ? null : (it.completedAt || Date.now());
}

async function addQuote() {
  const t = $('qText'), s = $('qSrc');
  if (!t || !t.value.trim()) return;
  await store.saveQuote({ id: uid(), text: t.value.trim().replace(/^[“"']|[”"']$/g, ''), source: s ? s.value.trim() : '' });
  ui.quoteIx = data.quotes.length - 1;
  ui.focusField = 'qText';
  renderSettings(); renderQuote();
}

async function runImport() {
  const box = $('importText'), note = $('importNote');
  if (!box || !box.value.trim()) { if (note) note.textContent = 'Paste the prototype’s data first.'; return; }
  note.textContent = 'Importing…';
  try {
    const n = await importText(box.value);
    ui.importText = '';
    render(); applyCoat(); renderSettings();
    const done = $('importNote'); if (done) done.textContent = '';
    $('syncNote').textContent = 'Imported ' + n.courses + ' courses, ' + n.items + ' items and ' + n.quotes + ' quotes.';
  } catch (err) {
    note.textContent = err instanceof ApiError
      ? (err.status === 409 ? 'Already imported.' : 'Rejected: ' + (err.body?.field || err.body?.error || err.status))
      : err.message;
  }
}

document.addEventListener('input', async (e) => {
  const d = e.target.dataset || {};

  if (d.of) {                             /* what the coat says */
    await store.saveProfile({ coat: { [d.of]: e.target.value } });
    const prev = $(d.of === 'name' ? 'coatPrevName' : 'coatPrevRole');
    if (prev) prev.textContent = e.target.value;
    renderSidebar(); return;
  }

  if (d.cf && ui.courseDraft) {           /* course fields */
    ui.courseDraft[d.cf] = d.cf === 'archived' ? e.target.checked : e.target.value;
    if (d.cf === 'name') autoGrow(e.target);
    const hint = drawer.querySelector('.dfoot .hint'), btn = drawer.querySelector('[data-act="course-save"]');
    if (btn) btn.disabled = !ui.courseDraft.name.trim();
    if (hint) hint.textContent = ui.courseDraft.name.trim() ? (ui.courseMode === 'new' ? 'Ready to save' : 'Unsaved changes') : 'Give it a name to save';
    return;
  }
  if (d.mf && ui.courseDraft) {           /* class meeting fields */
    const wrap = e.target.closest('[data-mid]'); if (!wrap) return;
    ui.courseDraft.meetings.forEach((m) => {
      if (m.id !== wrap.dataset.mid) return;
      m[d.mf] = d.mf === 'weekday' ? +e.target.value
        : d.mf === 'start' || d.mf === 'end' ? (parseTime(e.target.value) || m[d.mf])
        : e.target.value;
    });
    return;
  }
  if (d.f) {                              /* item fields */
    const it = current(); if (!it) return;
    if (d.f === 'recur') {
      it.recur = e.target.checked ? 'weekly' : null;
      it.weekday = it.recur ? parse(it.date).getDay() : null;
      if (!it.recur) it.recurUntil = null;
    } else if (d.f === 'grade') {
      it.grade = e.target.value === '' ? null : Math.max(0, Math.min(100, +e.target.value));
    } else if (d.f === 'courseId' || d.f === 'recurUntil') {
      const before = it.courseId;
      it[d.f] = e.target.value || null;
      if (d.f === 'courseId') autoTitle(it, before);
    } else if (d.f === 'status') {
      const wasDone = isComplete(it);
      setStatus(it, e.target.value);
      if (!wasDone && isComplete(it)) celebrate(e.target);
    } else if (d.f === 'start' || d.f === 'end') {
      it[d.f] = parseTime(e.target.value) || '';      /* half-typed stays out of the model until it parses */
    } else {
      it[d.f] = e.target.value;
      if (d.f === 'date' && it.recur === 'weekly') it.weekday = parse(it.date).getDay();
      if (d.f === 'type') autoTitle(it, it.courseId);
    }
    if (d.f === 'title') {
      autoGrow(e.target);
      if (ui.draft) {
        const b = drawer.querySelector('[data-act="save"]'), h = drawer.querySelector('.dfoot .hint');
        if (b) b.disabled = !it.title.trim();
        if (h) h.textContent = it.title.trim() ? 'Ready to save' : 'Give it a name to save';
      }
    }
    if (!ui.draft) { await touch(it); renderStats(); renderSidebar(); renderView(); }
    if (d.f === 'type' || d.f === 'status' || d.f === 'recur') renderItemDrawer();
    return;
  }
  if (d.cltext) {
    const s = current(); if (!s) return;
    s.checklist.forEach((x) => { if (x.id === d.cltext) x.text = e.target.value; });
    await touch(s);
    return;
  }
  if (e.target.id === 'importText') { ui.importText = e.target.value; return; }
  if (e.target.id === 'search') { ui.search = e.target.value; renderView(); return; }
});

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    if (ui.sel || ui.draft || ui.courseDraft || ui.settings) closeDrawer();
    return;
  }
  if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) {
    e.preventDefault(); $('search').focus(); return;
  }
  if (e.key !== 'Enter') return;

  if (e.target.id === 'clAdd' && e.target.value.trim()) {
    const it = current(); if (!it) return;
    if (it.checklist.length >= 50) return;
    it.checklist.push({ id: uid(), text: e.target.value.trim(), done: false });
    await touch(it);
    renderItemDrawer(); renderView();
    const box = $('clAdd'); if (box) box.focus();
    return;
  }
  if (e.target.id === 'linkUrl' || e.target.id === 'linkLabel') {
    const url = $('linkUrl').value.trim(); if (!url) return;
    const it2 = current(); if (!it2 || it2.links.length >= 20) return;
    const lab = $('linkLabel').value.trim();
    it2.links.push({ label: lab || url.replace(/^https?:\/\//, ''), url: /^https?:\/\//.test(url) ? url : 'https://' + url });
    await touch(it2);
    renderItemDrawer(); return;
  }
  if (e.target.id === 'qText' || e.target.id === 'qSrc') { e.preventDefault(); addQuote(); return; }
  if (e.target.id === 'quickTask' && e.target.value.trim()) {
    await store.saveItem(normalizeItem({ id: uid(), type: 'task', title: e.target.value.trim(), courseId: ui.course === 'all' ? null : ui.course, date: today(), status: 'todo' }));
    render();
    const q = $('quickTask'); if (q) q.focus();
    return;
  }
  if (ui.draft && e.target.classList.contains('dtitle')) { e.preventDefault(); saveDraft(); return; }
  if (ui.courseDraft && e.target.classList.contains('dtitle')) { e.preventDefault(); saveCourseDraft(); return; }
});

boot();
