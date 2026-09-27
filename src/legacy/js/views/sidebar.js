import { data } from '../store.js';
import { ui } from '../state.js';
import { typeList, isOpen, TYPE_COLOURS, TYPE_KINDS, MAX_CUSTOM_TYPES } from '../model.js';
import { activeCourses, typeOn } from '../query.js';
import { esc, $, setHTML } from '../dom.js';

const EYE = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.4"/></svg>';
const GRIP = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h10"/></svg>';
const KIND_NOTE = {
  todo: 'To do, then done, like Tasks.',
  event: 'Scheduled, attended or missed, like Labs.',
  graded: 'Open, submitted, graded, with a weight, like Assignments.',
};

/* Normal: one filter button per shown type. Editing: every type, with order, colour, name, hide and delete. */
function typeNav() {
  const types = typeList(ui.bg, data.items), counts = {}, used = {};
  data.items.forEach((it) => {
    used[it.type] = (used[it.type] || 0) + 1;
    if (ui.course !== 'all' && it.courseId !== ui.course) return;
    if (it.recur === 'weekly' || isOpen(it)) counts[it.type] = (counts[it.type] || 0) + 1;
  });
  const customs = types.filter((t) => t.custom).length;
  let html = '<div class="navlabel">Open items'
    + (ui.typeEdit ? '<button type="button" data-typeedit="0">Done</button>'
      : (customs < MAX_CUSTOM_TYPES ? '<button type="button" data-typeadd="1">+ Add</button>' : '')
        + '<button type="button" class="pen" data-typeedit="1" aria-label="Edit item types" title="Rename, recolour, reorder or hide">✎</button>')
    + '</div>';

  if (ui.typeEdit) {
    types.forEach((t) => {
      const n = used[t.id] || 0;
      html += '<div class="typerow' + (t.hidden ? ' off' : '') + '" data-accent="' + t.color + '">'
        + '<button type="button" class="grip" data-typegrip="' + t.id + '" aria-label="Reorder ' + esc(t.plural) + '. Drag, or use the up and down arrow keys" title="Drag to reorder">' + GRIP + '</button>'
        + '<button type="button" class="pip" data-typecolour="' + t.id + '" aria-label="Change colour of ' + esc(t.plural) + '" title="Next colour"></button>'
        + '<input type="text" data-typelabel="' + t.id + '" value="' + esc(t.label) + '" maxlength="24" aria-label="Name">'
        + '<button type="button" class="eye" data-typehide="' + t.id + '" aria-pressed="' + !t.hidden + '" aria-label="' + (t.hidden ? 'Show ' : 'Hide ') + esc(t.plural) + '" title="' + (t.hidden ? 'Hidden. Click to show' : 'Shown. Click to hide') + '">' + EYE + '</button>'
        + (t.custom
          ? (n ? '<span class="inuse" title="' + n + (n === 1 ? ' item uses' : ' items use') + ' it. Hide it instead">' + n + '</span>'
            : '<button type="button" class="del" data-typedel="' + t.id + '" aria-label="Delete ' + esc(t.plural) + '">✕</button>')
          : '<span class="inuse"></span>')
        + '</div>';
    });
    return html + '<span class="typenote">Hidden types leave the sidebar and the new-item list; their items stay.</span>';
  }

  types.forEach((t) => {
    if (t.hidden) return;
    const on = typeOn(t.id);
    html += '<button class="nav' + (on ? '' : ' dim') + '" type="button" data-type="' + t.id + '" aria-pressed="' + on + '" data-accent="' + t.color + '">'
      + '<i class="pip"></i><span class="lbl">' + esc(t.plural) + '</span><span class="ct">' + (counts[t.id] || 0) + '</span></button>';
  });

  const a = ui.typeAdd;
  if (a) {
    html += '<div class="typeform">'
      + '<input type="text" id="typeName" data-typename="1" value="' + esc(a.label) + '" maxlength="24" placeholder="Name, e.g. Quiz" aria-label="New type name">'
      + '<span class="swatchrow">' + TYPE_COLOURS.map((c) =>
          '<button class="swatch" type="button" data-typeaddcolour="' + c + '" data-accent="' + c + '" aria-pressed="' + (c === a.color) + '" aria-label="Colour ' + c + '"></button>').join('') + '</span>'
      + '<div class="seg">' + TYPE_KINDS.map(([k, label]) =>
          '<button type="button" data-typekind="' + k + '" aria-pressed="' + (k === a.kind) + '">' + label + '</button>').join('') + '</div>'
      + '<span class="typenote">' + KIND_NOTE[a.kind] + '</span>'
      + '<span class="acts"><button class="btn ghost" type="button" data-typeadd="0">Cancel</button>'
      + '<button class="btn" type="button" data-typesave="1"' + (a.label.trim() ? '' : ' disabled') + '>Add type</button></span>'
      + '</div>';
  }
  return html;
}

/** force: the type editor's own changes; otherwise a redraw leaves the list alone while someone types in it. */
export function renderSidebar(force = false) {
  const nav = $('typeNav');
  const active = nav.contains(document.activeElement) ? document.activeElement : null;
  if (!force && active?.tagName === 'INPUT') return drawRest();
  /* a redraw keeps the keyboard on the same control, say the handle being moved with the arrow keys */
  const key = active && Object.keys(active.dataset).find((k) => k.startsWith('type'));
  setHTML(nav, typeNav());
  if (key) nav.querySelector('[data-' + key + '="' + active.dataset[key] + '"]')?.focus();
  drawRest();
}

function drawRest() {

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
