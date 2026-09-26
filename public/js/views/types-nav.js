// The Open items editor in the sidebar: rename, recolour, hide, delete, add and reorder
// the item types, by drag or by keyboard.

import * as store from '../store.js';
import { data } from '../store.js';
import { ui } from '../state.js';
import { uid, typeList, typePrefsFrom, TYPE_COLOURS, MAX_CUSTOM_TYPES } from '../model.js';
import { $ } from '../dom.js';
import { render } from './render.js';
import { renderSidebar } from './sidebar.js';

/* The Open items editor: every change saves the whole list to the profile. */
async function saveTypes(list) {
  await store.saveProfile({ types: typePrefsFrom(list) });
  render();
  renderSidebar(true);
}

function typesOnScreen() {
  const list = typeList(ui.bg, data.items);
  document.querySelectorAll('#typeNav [data-typelabel]').forEach((box) => {
    const t = list.find((x) => x.id === box.dataset.typelabel), label = box.value.trim().slice(0, 24);
    if (t && (label || !t.custom)) t.label = label;
  });
  return list;
}

/* Save a new order (ids top to bottom), then put the keyboard back on the handle. */
export async function reorderTypes(ids, focusId) {
  const list = typesOnScreen();
  list.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await saveTypes(list);
  if (focusId) document.querySelector('#typeNav [data-typegrip="' + focusId + '"]')?.focus();
}

export const rowIds = () => [...document.querySelectorAll('#typeNav [data-typegrip]')].map((g) => g.dataset.typegrip);

/* Drag a ≡ handle (listening on the document: moving the row would drop a pointer capture): the row moves among the others as the pointer passes their middles; drop saves. */
function dragType(e, grip) {
  const row = grip.closest('.typerow'), nav = $('typeNav'), before = rowIds().join();
  e.preventDefault();
  row.classList.add('dragging');
  const move = (ev) => {
    const others = [...nav.querySelectorAll('.typerow')].filter((r) => r !== row);
    const next = others.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (next) { if (row.nextElementSibling !== next) nav.insertBefore(row, next); }
    else if (others.length) others[others.length - 1].after(row);
  };
  const drop = (ev) => {
    if (ev.type === 'pointerup') move(ev);   /* where it was let go, even if no move arrived */
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', drop);
    document.removeEventListener('pointercancel', drop);
    row.classList.remove('dragging');
    const ids = rowIds();
    if (ids.join() !== before) reorderTypes(ids);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', drop);
  document.addEventListener('pointercancel', drop);
}

export async function editTypes(el) {
  const list = typesOnScreen(), i = list.findIndex((t) => t.id === (el.dataset.typecolour || el.dataset.typehide || el.dataset.typedel));
  if (i < 0) return;
  const t = list[i];
  if (el.dataset.typecolour) {
    t.color = TYPE_COLOURS[(TYPE_COLOURS.indexOf(t.color) + 1) % TYPE_COLOURS.length];
  } else if (el.dataset.typehide) {
    t.hidden = !t.hidden; t.hiddenSet = true;
  } else if (el.dataset.typedel) {
    if (!t.custom || data.items.some((it) => it.type === t.id)) return;
    list.splice(i, 1);
  }
  await saveTypes(list);
  /* keep the keyboard where it was after the redraw */
  const again = document.querySelector('#typeNav [data-' + Object.keys(el.dataset).find((k) => k.startsWith('type')) + '="' + t.id + '"]');
  if (again) again.focus();
}

export async function addType() {
  const a = ui.typeAdd, label = a?.label.trim();
  if (!label) return;
  const list = typeList(ui.bg, data.items);
  if (list.filter((t) => t.custom).length >= MAX_CUSTOM_TYPES) return;
  list.push({ id: 'c-' + uid(), label: label.slice(0, 24), color: a.color, kind: a.kind, custom: true, hidden: false });
  ui.typeAdd = null;
  await saveTypes(list);
}

/** pointerdown anywhere: a press on a ≡ handle starts a drag. */
export function onGripDown(e) {
  const grip = e.target.closest?.('[data-typegrip]');
  if (grip && e.button === 0) dragType(e, grip);
}

/** A type's name box changed: save it, or put the old one back if it cannot be empty. */
export async function renameType(box) {
  const renamed = box.dataset.typelabel;
  const list = typesOnScreen(), t = list.find((x) => x.id === renamed);
  const label = box.value.trim().slice(0, 24);
  if (!t || (!label && t.custom)) { renderSidebar(true); return; }
  t.label = label;                       /* empty on a built-in: back to its own name */
  box.blur();
  await saveTypes(list);
}
