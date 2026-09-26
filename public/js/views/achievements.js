// The Achievements panel on the Study tab: a count, the three badges closest to done,
// then every group as round medals. Earned ones are filled and dated; locked ones are
// hollow with a ring for how far along they are. Last, your own: stickers you uploaded,
// tilted on when earned and grey until then. The badges come from achievements.js.

import { esc } from '../dom.js';
import { dayMonth } from '../dates.js';
import { GROUPS, nextUp } from '../achievements.js';
import { ACHIEVEMENT_LIMIT } from '../model.js';

const ICONS = {
  hours: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg>',
  streak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1 2.6 2.3 3.1C11 8.5 11.3 5.5 12 3z"/></svg>',
  days: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  tasks: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3L13 4.5"/></svg>',
  exams: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 2h6l2.5 2.5V14H4z"/><path d="M6 7h4.5M6 9.5h4.5M6 12h2.5" stroke-linecap="round"/></svg>',
  own: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5h10v6.5L9 13H3z"/><path d="M9 13V9h4"/></svg>',
  grades: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
};
const CHECK = '<span class="ok" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5l2.5 2.5L12 5.5"/></svg></span>';


/* the progress ring round a locked medal, drawn with SVG attributes (no inline style) */
function ring(frac) {
  if (!(frac > 0 && frac < 1)) return '';
  const c = 2 * Math.PI * 28;
  return '<svg class="ach-ring" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="28" stroke-dasharray="'
    + (c * frac).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 30 30)"/></svg>';
}

const medal = (b) => '<span class="md">' + (b.earned ? CHECK : ring(b.frac)) + esc(b.tier) + '</span>';

function badgeHtml(b) {
  const sub = b.earned ? dayMonth(b.earnedOn) : b.group === 'grades' ? b.progress : Math.floor(b.frac * 100) + '%';
  const label = b.name + ': ' + b.blurb + '. ' + (b.earned ? 'Earned ' + dayMonth(b.earnedOn) : b.progress);
  return '<li class="bd ' + (b.earned ? 'on' : 'off') + '" id="ach-' + esc(b.id) + '" title="' + esc(label) + '">'
    + medal(b) + '<span class="nm">' + esc(b.name) + '</span><span class="dt">' + esc(sub) + '</span></li>';
}

/* One of your own: its sticker, tilted a little (by its id, so it stays put) when earned. */
function ownHtml(b) {
  const tilt = [...b.ownId].reduce((t, ch) => t + ch.charCodeAt(0), 0) % 5;
  const sub = b.earned ? dayMonth(b.earnedOn) : b.progress;
  return '<li class="bd own ' + (b.earned ? 'on' : 'off') + '" id="ach-' + esc(b.id) + '">'
    + '<button type="button" class="stk-btn" data-ach-edit="' + esc(b.ownId) + '" aria-label="' + esc(b.name + ', ' + (b.earned ? 'earned ' + dayMonth(b.earnedOn) : b.progress) + '. Edit') + '">'
    + (b.sticker ? '<img class="stk t' + tilt + '" src="' + esc(b.sticker) + '" alt="" width="64" height="64" decoding="async">' : '<span class="md"></span>')
    + '<span class="nm">' + esc(b.name) + '</span><span class="dt">' + esc(sub) + '</span></button></li>';
}

function ownGroup(own) {
  const full = own.length >= ACHIEVEMENT_LIMIT;
  return '<div class="ach-grp ach-own g-own"><div class="grp-h"><span class="gi">' + ICONS.own + '</span><h4>Your own</h4>'
    + '<span class="gs">' + own.filter((b) => b.earned).length + ' / ' + own.length + '</span></div>'
    + (own.length ? '' : '<p class="hint ach-empty">Make your own: upload a sticker, then pick what earns it, hours on a course or a grade on an exam.</p>')
    + '<ul class="ach-badges">' + own.map(ownHtml).join('')
    + '<li class="bd add"><button type="button" class="stk-btn" data-ach-new' + (full ? ' disabled' : '') + '>'
    + '<span class="md" aria-hidden="true">+</span><span class="nm">New</span><span class="dt">' + (full ? ACHIEVEMENT_LIMIT + ' is the most' : 'sticker') + '</span></button></li>'
    + '</ul></div>';
}

/** The panel, from the lists achievements() and ownAchievements() return. */
export function achievementsHtml(builtIn, own = []) {
  const list = [...builtIn, ...own];
  const got = list.filter((b) => b.earned).length;
  const next = nextUp(builtIn);
  return '<section class="panel st-ach" aria-labelledby="achH">'
    + '<div class="ach-head"><h3 id="achH">Achievements</h3>'
    + '<span class="ach-count"><b>' + got + '</b> of ' + list.length + '</span>'
    + '<span class="ach-track" aria-hidden="true"><i data-width="' + (got / list.length * 100).toFixed(1) + '"></i></span></div>'
    + (next.length ? '<h4 class="ach-lab">Next up</h4><ul class="ach-next">' + next.map((b) => '<li class="nx g-' + b.group + '">'
      + '<span class="bd off" aria-hidden="true">' + medal(b) + '</span>'
      + '<span class="nx-tx"><b>' + esc(b.name) + '</b><span>' + esc(b.progress) + '</span>'
      + '<span class="nx-bar" aria-hidden="true"><i data-width="' + (b.frac * 100).toFixed(1) + '"></i></span></span></li>').join('') + '</ul>' : '')
    + '<div class="ach-groups">' + GROUPS.map(([g, name]) => {
      const mine = list.filter((b) => b.group === g);
      return '<div class="ach-grp g-' + g + '"><div class="grp-h"><span class="gi">' + ICONS[g] + '</span><h4>' + name + '</h4>'
        + '<span class="gs">' + mine.filter((b) => b.earned).length + ' / ' + mine.length + '</span></div>'
        + '<ul class="ach-badges">' + mine.map(badgeHtml).join('') + '</ul></div>';
    }).join('') + ownGroup(own) + '</div>'
    + '</section>';
}
