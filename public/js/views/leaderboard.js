// The Leaderboard panel on the Study tab: study hours this week and all-time for
// everyone who has joined. Joining is opt-in, and a user who has not joined sees
// nobody. The totals come from the server; your own row uses this device's sessions,
// so a session that has not synced yet still counts.

import { esc, $, setHTML } from '../dom.js';
import { ui } from '../state.js';
import { data } from '../store.js';
import { api } from '../api.js';
import { monday, addDays, dayMonth, iso } from '../dates.js';

const STALE_MS = 60_000;

/** The viewer's Monday 00:00, the start of the week the server counts from. */
const weekStart = () => monday(new Date());

const hours = (min) => { const h = min / 60; return h >= 100 ? String(Math.round(h)) : String(Math.round(h * 10) / 10); };

/* your own minutes, from the sessions on this device */
function mine(since) {
  let week = 0, all = 0;
  for (const s of data.study_sessions) { all += s.studyMinutes; if (s.startedAt >= since) week += s.studyMinutes; }
  return { week, all };
}

/** The list for a tab, with your row set from this device and the order redone. */
function rows(tab) {
  const own = mine(weekStart().getTime())[tab];
  return ui.lb[tab].map((r) => (r.me ? { ...r, minutes: own } : r))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

function listHtml(tab) {
  const list = rows(tab), top = list[0]?.minutes || 1;
  let rank = 0, prev = null;
  return '<ol class="lb">' + list.map((r, i) => {
    if (r.minutes !== prev) { rank = i + 1; prev = r.minutes; }
    const medal = rank <= 3 && r.minutes > 0 ? ' r' + rank : '';
    return '<li class="' + (r.me ? 'me' : '') + (r.minutes ? '' : ' zero') + '">'
      + '<span class="rk' + medal + '">' + rank + '</span>'
      + '<span class="who"><span class="nm">' + esc(r.name) + (r.me ? '<span class="you">you</span>' : '') + '</span>'
      + '<span class="lb-bar"><i data-width="' + (r.minutes / top * 100).toFixed(1) + '"></i></span></span>'
      + '<span class="hrs">' + hours(r.minutes) + '<small>h</small></span></li>';
  }).join('') + '</ol>';
}

function inner() {
  const lb = ui.lb, head = '<h3>Leaderboard</h3>';
  if (!lb || (lb.loading && lb.joined === undefined)) return head + '<p class="lb-note">Loading…</p>';
  if (lb.offline) return head + '<p class="lb-note">The leaderboard needs a connection. Your own hours are still saved.</p>';
  if (lb.error && lb.joined === undefined) return head + '<p class="lb-note">' + esc(lb.error) + '</p>';
  const error = lb.error ? '<p class="lb-note err" role="alert">' + esc(lb.error) + '</p>' : '';
  if (!lb.joined) {
    return head + '<div class="lb-join"><p>See who has studied the most this week. When you join, others who have joined will see your name and study hours. You can leave at any time.</p>'
      + '<button type="button" class="btn" data-lb="join"' + (lb.busy ? ' disabled' : '') + '>Join the leaderboard</button>' + error + '</div>';
  }
  const tab = ui.lbTab === 'all' ? 'all' : 'week', mon = weekStart();
  const sub = tab === 'week'
    ? '<span>' + esc(dayMonth(iso(mon)) + ' – ' + dayMonth(iso(addDays(mon, 6)))) + '</span><span>Resets Monday</span>'
    : '<span>Since each person started</span><span>' + lb.all.length + (lb.all.length === 1 ? ' person' : ' people') + '</span>';
  return '<div class="lb-head">' + head
    + '<span class="seg" role="group" aria-label="Time range">'
    + '<button type="button" data-lb-tab="week" aria-pressed="' + (tab === 'week') + '">This week</button>'
    + '<button type="button" data-lb-tab="all" aria-pressed="' + (tab === 'all') + '">All-time</button></span></div>'
    + '<div class="lb-sub">' + sub + '</div>'
    + listHtml(tab) + error
    + '<div class="lb-foot"><span>Counts logged study time</span>'
    + '<button type="button" class="lb-leave" data-lb="leave"' + (lb.busy ? ' disabled' : '') + '>Leave the leaderboard</button></div>';
}

/** The panel for renderStudy; it fetches the totals when they are missing or a minute old. */
export function leaderboardHtml() {
  if (!ui.lb || (!ui.lb.loading && Date.now() - (ui.lb.at || 0) > STALE_MS)) queueMicrotask(load);
  return '<section class="panel st-lb" id="lbPanel" aria-label="Leaderboard">' + inner() + '</section>';
}

function refresh() {
  const el = $('lbPanel');
  if (el) setHTML(el, inner());
}

const valid = (b) => b && typeof b.joined === 'boolean' && ['week', 'all'].every((k) => Array.isArray(b[k])
  && b[k].every((r) => r && typeof r.name === 'string' && Number.isSafeInteger(r.minutes) && typeof r.me === 'boolean'));

async function load() {
  if (ui.lb?.loading) return;
  ui.lb = { ...ui.lb, loading: true, at: Date.now() };
  try {
    const b = await api.leaderboard(weekStart().getTime());
    if (!valid(b)) throw new Error('invalid');
    ui.lb = { joined: b.joined, week: b.week, all: b.all, at: Date.now() };
  } catch {
    ui.lb = navigator.onLine === false ? { offline: true, at: Date.now() }
      : { ...ui.lb, loading: false, error: 'Could not load the leaderboard. Try again in a minute.' };
  }
  refresh();
}

/** Clicks inside the panel: the week/all-time switch, Join and Leave. True when handled. */
export async function leaderboardClick(e) {
  const tab = e.target.closest('[data-lb-tab]');
  if (tab) { ui.lbTab = tab.dataset.lbTab; refresh(); return true; }
  const act = e.target.closest('[data-lb]');
  if (!act) return false;
  ui.lb = { ...ui.lb, busy: true, error: null };
  refresh();
  try {
    await api.leaderboardJoin(act.dataset.lb === 'join');
    ui.lb = { ...ui.lb, busy: false, loading: false };
    await load();
    $('lbPanel')?.querySelector(act.dataset.lb === 'join' ? '[data-lb="leave"]' : '[data-lb="join"]')?.focus();
  } catch {
    ui.lb = { ...ui.lb, busy: false, error: 'That did not go through. Try again when you are online.' };
    refresh();
  }
  return true;
}
