import { data } from '../store.js';
import { ui } from '../state.js';
import { isOpen, isOverdue, isTest, tmeta } from '../model.js';
import { diffDays, today, dur } from '../dates.js';
import { activeCourses } from '../query.js';
import { esc, $, setHTML } from '../dom.js';
import { prepPace, prepLabel } from '../prep.js';

export function renderStats() {
  const TODAY = today();
  let nextExam = null, openAssign = 0, overdue = 0, labDone = 0, labAll = 0;
  data.items.forEach((it) => {
    /* the soonest open exam or quiz; on the same day, the earlier start */
    if (isTest(it.type) && isOpen(it) && diffDays(TODAY, it.date) >= 0
      && (!nextExam || it.date + (it.start || '~') < nextExam.date + (nextExam.start || '~'))) nextExam = it;
    if (it.type === 'assignment' && isOpen(it)) openAssign++;
    if (isOverdue(it)) overdue++;
    if (it.type === 'lab') { const h = dur(it.start, it.end); labAll += h; if (!isOpen(it)) labDone += h; }
  });
  let classH = 0, classN = 0;
  const courses = activeCourses();
  courses.forEach((c) => { (c.meetings || []).forEach((m) => { classH += dur(m.start, m.end); classN++; }); });
  const dd = nextExam ? diffDays(TODAY, nextExam.date) : null;
  const ddText = dd === null ? '—' : dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : dd + ' <small>days</small>';
  const prep = nextExam ? prepPace(nextExam, TODAY) : null;
  const cs = ui.bg === 'cs';
  /* Med: a heartbeat and a molecule. CS: a clock signal with one glitch, and a chip. */
  const ecg = '<svg class="ecg" viewBox="0 0 120 16" preserveAspectRatio="none" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">'
    + (cs ? '<path d="M0 12h8V4h8v8h8V4h8v8h4V2h2v12h2V4h8v8h8V4h8v8h8V4h8v8h4V2h2v12h2V4h8v8h8V4h6"/>'
          : '<path d="M0 11h13l2-2 3 5 3-3h9l3-7 3 13 3-6h11l2-2 3 5 3-3h10l3-7 3 13 3-6h13l2-2 3 5 3-3h9"/>') + '</svg>';
  const mol = '<svg class="mol" viewBox="0 0 60 60" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'
    + (cs ? '<rect x="16" y="16" width="28" height="28" rx="3"/><rect x="24" y="24" width="12" height="12" rx="1"/>'
          + '<path d="M23 16V8M30 16V8M37 16V8M23 44v8M30 44v8M37 44v8M16 23H8M16 30H8M16 37H8M44 23h8M44 30h8M44 37h8"/>'
          : '<path d="M30 6l14 8v16l-14 8-14-8V14z"/><circle cx="30" cy="22" r="7"/><path d="M44 30l12 7M16 30L4 37M30 38v14"/>') + '</svg>';

  setHTML($('stats'), ''
    + '<div class="stat hot"><div class="lab">Next exam / quiz</div><div class="val">' + ddText + '</div><div class="foot">'
      + (nextExam ? '<span class="ttag">' + esc(tmeta(nextExam.type).label) + '</span>' + esc(nextExam.title) : 'nothing scheduled')
      + (prep ? '<span class="prepline' + (prep.hot ? ' hot' : '') + '">' + esc(prepLabel(prep)) + '</span>' : '') + '</div>' + ecg + '</div>'
    + '<div class="stat"><div class="lab">Open assignments</div><div class="val">' + openAssign + '</div><div class="foot">across ' + courses.length + ' course' + (courses.length === 1 ? '' : 's') + '</div>' + mol + '</div>'
    + '<div class="stat' + (overdue ? ' hot' : '') + '"><div class="lab">Overdue</div><div class="val">' + overdue + '</div><div class="foot">' + (overdue ? 'needs attention today' : 'all clear') + '</div></div>'
    + '<div class="stat"><div class="lab">Class hours / week</div><div class="val">' + (Math.round(classH * 10) / 10) + '<small> h</small></div><div class="foot">' + classN + ' timetabled class' + (classN === 1 ? '' : 'es') + '</div></div>'
    + '<div class="stat"><div class="lab">Lab hours</div><div class="val">' + labDone.toFixed(0) + '<small>/' + labAll.toFixed(0) + ' h</small></div>'
      + '<div class="foot"><span class="meterwrap"><span class="meter" data-width="' + (labAll ? Math.round(labDone / labAll * 100) : 0) + '"></span></span></div></div>'
    + quoteCardHtml());
}

/* the quote tile, beside the stats */
function quoteCardHtml() {
  const qs = data.quotes || [];
  if (!qs.length) {
    return '<button class="stat qcard empty" type="button" data-quotenext>'
      + '<span class="qm">' + (ui.bg === 'cs' ? '/*' : '“') + '</span><span class="qt">Add a quote to keep here</span>'
      + '<span class="qs">Settings › Quotes</span></button>';
  }
  if (ui.quoteIx >= qs.length) ui.quoteIx = 0;
  const q = qs[ui.quoteIx];
  return '<button class="stat qcard" type="button" data-quotenext title="' + (qs.length > 1 ? 'Next quote' : 'Edit quotes in Settings') + '">'
    + '<span class="qm">' + (ui.bg === 'cs' ? '/*' : '“') + '</span>'
    + '<span class="qt">' + esc(q.text) + '</span>'
    + '<span class="qs">' + (q.source ? esc(q.source) : 'Unattributed')
    + (qs.length > 1 ? '<em>' + (ui.quoteIx + 1) + ' / ' + qs.length + '</em>' : '') + '</span></button>';
}

/** Redraw the tile. With `animate`, the new quote rises in (only on a real change). */
export function renderQuote(animate = false) {
  const card = document.querySelector('.qcard');
  if (!card) { renderStats(); return; }
  const focused = card.contains(document.activeElement);
  card.outerHTML = quoteCardHtml();
  const next = document.querySelector('.qcard');
  if (animate) next?.classList.add('swap');
  if (focused) next?.focus();   /* a click or Enter on the tile keeps the keyboard there */
}

/** Show the next quote, animated. Returns false if there is nothing to rotate to. */
export function nextQuote() {
  const n = data.quotes.length;
  if (n < 2) return false;
  ui.quoteIx = (ui.quoteIx + 1) % n;
  renderQuote(true);
  return true;
}
