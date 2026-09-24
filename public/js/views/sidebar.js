import { setHTML } from '../dom.js';
import { data } from '../store.js';
import { ui } from '../state.js';
import { ORDER, tmeta, isOpen, typeShown } from '../model.js';
import { activeCourses } from '../query.js';
import { esc, $ } from '../dom.js';

export function renderSidebar() {
  const counts = {};
  ORDER.forEach((t) => { counts[t] = 0; });
  data.items.forEach((it) => {
    if (ui.course !== 'all' && it.courseId !== ui.course) return;
    if (it.recur === 'weekly') { counts[it.type]++; return; }
    if (isOpen(it)) counts[it.type]++;
  });
  let html = '<div class="navlabel">Open items</div>';
  ORDER.forEach((t) => {
    if (!typeShown(t, ui.bg, data.items)) return;
    const m = tmeta(t);
    html += '<button class="nav' + (ui.types[t] ? '' : ' dim') + '" type="button" data-type="' + t + '" aria-pressed="' + (ui.types[t] ? 'true' : 'false') + '" data-accent="' + m.color + '">'
      + '<i class="pip"></i><span class="lbl">' + esc(m.plural) + '</span><span class="ct">' + counts[t] + '</span></button>';
  });
  setHTML($('typeNav'), html);

  let ch = '<div class="navlabel">Courses<button type="button" data-newcourse="1">+ Add</button></div>'
    + '<button class="nav" type="button" data-course="all" aria-pressed="' + (ui.course === 'all' ? 'true' : 'false') + '"><span class="lbl">All courses</span></button>';
  activeCourses().forEach((c) => {
    const n = (c.meetings || []).length;
    ch += '<span class="course-line">'
      + '<button class="nav" type="button" data-course="' + esc(c.id) + '" aria-pressed="' + (ui.course === c.id ? 'true' : 'false') + '" data-accent="' + c.color + '">'
      + '<i class="pip"></i><span class="lbl">' + esc(c.name) + '</span><span class="ct">' + n + '</span></button>'
      + '<button class="cog" type="button" data-editcourse="' + esc(c.id) + '" aria-label="Edit ' + esc(c.name) + '">✎</button></span>';
  });
  ch += '<button class="addcourse" type="button" data-newcourse="1">+ New course</button>';
  setHTML($('courseNav'), ch);

  const coat = data.profile ? data.profile.coat : { name: '', role: '' };
  $('ownerName').textContent = coat.name || data.profile?.displayName || 'Your name';
  $('ownerRole').textContent = coat.role;
  renderBadge(coat.name || data.profile?.displayName || 'Your name', coat.role, data.profile?.username || '');
}

/* ── the CS ID badge: an identicon and a barcode drawn from the username, so they
   stay the same for each person. CSS shows it only under data-bg="cs". ── */
function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function renderBadge(name, role, username) {
  const seed = username || name;
  const h = hash(seed);
  let cells = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const m = c < 3 ? c : 4 - c;                             /* mirrored, like a GitHub avatar */
    cells += '<i' + ((h >>> (r * 3 + m)) & 1 ? ' class="on"' : '') + '></i>';
  }
  const g = hash(seed + ':bars');
  let bars = '';
  for (let i = 0; i < 30; i++) {
    bars += '<i class="w' + (1 + ((g >>> (i % 29)) & 1) + ((i * 7 + g) % 3 === 0 ? 1 : 0)) + '"></i>';
    if (i % 3 === 2) bars += '<b></b>';
  }
  const [lead, ...rest] = role.split('·').map((x) => x.trim());
  setHTML($('idBadge'), '<div class="strip"><span>ROUNDS</span><span>STUDENT</span></div><i class="slot" aria-hidden="true"></i>'
    + '<div class="body"><span class="idc" aria-hidden="true">' + cells + '</span><span class="who">'
    + '<span class="nm">' + esc(name) + '<button class="editcoat" type="button" data-setopen="coat" aria-label="Edit the name on the badge">✎</button></span>'
    + (role ? '<span class="rl"><b>' + esc(lead) + '</b>' + (rest.length ? ' · ' + esc(rest.join(' · ')) : '') + '</span>' : '')
    + '</span></div>'
    + '<div class="foot"><span class="bars" aria-hidden="true">' + bars + '</span>'
    + (username ? '<span class="num">@' + esc(username) + '</span>' : '') + '</div>');
}
