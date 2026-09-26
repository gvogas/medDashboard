// The New / Edit achievement drawer: a sticker you upload and crop to a circle, a name,
// and what earns it, hours on one course or a grade on one exam or quiz.

import { data, course, item, saveAchievement, deleteAchievement } from '../store.js';
import { ui } from '../state.js';
import { isTest, uid, ACHIEVEMENT_LIMIT } from '../model.js';
import { esc, $ } from '../dom.js';
import { dayMonth } from '../dates.js';
import { ownAchievements } from '../achievements.js';
import { readPicture, drawSticker, dragCrop, stickerData } from '../sticker.js';
import { drawer, showDrawer, resetDrawerState, closeDrawer } from './drawer-base.js';
import { confirmFoot } from './bits.js';
import { toast } from './toast.js';
import { deleteLater } from '../study-controller.js';

const SHOWN = 208;            /* the crop preview, in CSS pixels */
let pic = null;               /* the picture being cropped; never stored */

/** Open the drawer: an achievement to edit by id, else a new one. */
function openAchievement(id) {
  resetDrawerState();
  const a = id ? data.achievements.find((x) => x.id === id) : null;
  if (!a && data.achievements.length >= ACHIEVEMENT_LIMIT) { toast('You have ' + ACHIEVEMENT_LIMIT + ' achievements, the most there can be.'); return; }
  const courses = data.courses.filter((c) => !c.archived);
  ui.achDraft = a ? { isNew: false, base: structuredClone(a), ...structuredClone(a), crop: null }
    : { isNew: true, base: null, id: uid(), name: '', sticker: '', rule: 'hours', courseId: courses[0]?.id || null, itemId: null, target: 10, crop: null };
  pic = null;
  renderAchievementDrawer(true);
}

const tests = () => data.items.filter((it) => isTest(it.type)).sort((a, b) => a.date.localeCompare(b.date));

function valid(d) {
  const top = d.rule === 'grade' ? 100 : 1000;
  return !!d.name.trim() && !!d.sticker && Number.isInteger(d.target) && d.target >= 1 && d.target <= top
    && (d.rule === 'hours' ? !!d.courseId : !!d.itemId) && !d.crop;
}

/** Where it stands now, in a line, as the panel would show it. */
function standing(d) {
  if (!(d.rule === 'hours' ? d.courseId : d.itemId)) return d.rule === 'hours' ? 'Pick a course.' : 'Pick an exam or quiz.';
  const [b] = ownAchievements([{ ...d, name: d.name || 'This' }], data.study_sessions, data.items, data.courses);
  return b.earned ? 'Already earned, on ' + dayMonth(b.earnedOn) + '. It goes on straight away.' : b.progress + ' so far.';
}

function stickerSection(d) {
  if (d.crop) {
    return '<div class="ach-crop">'
      + '<canvas id="achCrop" class="crop-stage" width="' + SHOWN * 2 + '" height="' + SHOWN * 2 + '" tabindex="0" aria-label="The picture in the circle. Drag it, or use the arrow keys, to move it." role="img"></canvas>'
      + '<label class="zoom"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="' + d.crop.zoom + '" data-ach="zoom"></label>'
      + '<span class="crop-acts"><button type="button" class="btn ghost" data-act="ach-crop-cancel">Cancel</button>'
      + '<button type="button" class="btn go" data-act="ach-crop-done">Use this</button></span>'
      + '<p class="hint">Drag the picture to move it in the circle.</p></div>';
  }
  return '<div class="ach-pick">'
    + (d.sticker ? '<img class="stk" src="' + esc(d.sticker) + '" alt="Your sticker" width="88" height="88">' : '<span class="stk-blank" aria-hidden="true">?</span>')
    + '<span><label class="btn ghost file-btn">' + (d.sticker ? 'Change picture' : 'Upload a picture')
    + '<input type="file" accept="image/*" id="achFile" class="sr-only"></label>'
    + '<span class="hint">A photo or any picture. It is cut to a circle, kept small, and only you can see it.</span></span></div>';
}

function ruleFields(d) {
  if (d.rule === 'hours') {
    const courses = data.courses.filter((c) => !c.archived || c.id === d.courseId);
    return '<label for="ad-course">Course</label><select id="ad-course" data-ach="courseId">'
      + (d.courseId && !course(d.courseId) ? '<option value="">Course removed</option>' : '')
      + courses.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === d.courseId ? ' selected' : '') + '>' + esc(c.code + ' · ' + c.name) + '</option>').join('') + '</select>'
      + '<label for="ad-target">Hours</label><span class="pair"><input id="ad-target" type="number" inputmode="numeric" min="1" max="1000" data-ach="target" value="' + d.target + '"><span>hours studied</span></span>';
  }
  const list = tests();
  return '<label for="ad-item">Exam or quiz</label><select id="ad-item" data-ach="itemId">'
    + '<option value="">' + (list.length ? 'Pick one' : 'No exams or quizzes yet') + '</option>'
    + (d.itemId && !item(d.itemId) ? '<option value="" selected>Exam removed</option>' : '')
    + list.map((it) => '<option value="' + esc(it.id) + '"' + (it.id === d.itemId ? ' selected' : '') + '>' + esc((course(it.courseId)?.code ? course(it.courseId).code + ' · ' : '') + it.title) + '</option>').join('') + '</select>'
    + '<label for="ad-target">Grade</label><span class="pair"><input id="ad-target" type="number" inputmode="numeric" min="1" max="100" data-ach="target" value="' + d.target + '"><span>or more</span></span>';
}

function renderAchievementDrawer(focus) {
  const d = ui.achDraft;
  if (!d) return;
  const head = '<div class="dhead" data-accent="#E8B33A">'
    + '<span class="kind">' + (d.isNew ? 'New achievement' : 'Edit achievement') + '</span><span></span>'
    + '<button class="icon-btn" type="button" data-act="close" aria-label="Close">✕</button></div>';
  const body = '<div class="dbody adraw">'
    + '<div class="dsec"><h4>Sticker</h4>' + stickerSection(d) + '</div>'
    + '<div class="fields">'
      + '<label for="ad-name">Name</label><input id="ad-name" type="text" maxlength="40" data-ach="name" value="' + esc(d.name) + '" placeholder="20 hours on Neuro">'
      + '<span class="flabel">Earned when</span><span class="seg ach-rule" role="group" aria-label="Earned when">'
        + '<button type="button" data-ach-rule="hours" aria-pressed="' + (d.rule === 'hours') + '"><b>Study hours</b>on one course</button>'
        + '<button type="button" data-ach-rule="grade" aria-pressed="' + (d.rule === 'grade') + '"><b>A grade</b>on one exam or quiz</button></span>'
      + ruleFields(d)
    + '</div>'
    + '<p class="sd-hint" id="adHint" role="status">' + esc(standing(d)) + '</p>'
    + '</div>';
  const foot = ui.confirm === 'achievement'
    ? confirmFoot('Delete this achievement?', 'ach-delete-yes')
    : '<div class="dfoot"><span class="hint">' + footHint(d) + '</span>'
      + (d.isNew ? '' : '<button class="btn ghost" type="button" data-act="ach-delete">Delete</button>')
      + '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>'
      + '<button class="btn go" type="button" data-act="ach-save"' + (valid(d) ? '' : ' disabled') + '>' + (d.isNew ? 'Add' : 'Save') + '</button></div>';
  showDrawer(head + body + foot);
  if (d.crop) paintCrop();
  else if (focus) (d.sticker ? $('ad-name') : drawer.querySelector('.file-btn'))?.focus();
}

const footHint = (d) => d.crop ? 'Finish the crop first' : !d.sticker ? 'Upload a sticker' : !d.name.trim() ? 'Give it a name' : valid(d) ? (d.isNew ? 'Ready to add' : 'Unsaved changes') : 'Not ready yet';

/** Keep the line and the footer in step with what is typed, without a redraw. */
function refresh() {
  const d = ui.achDraft;
  if (!d) return;
  const hint = $('adHint'); if (hint) hint.textContent = standing(d);
  const save = drawer.querySelector('[data-act="ach-save"]'); if (save) save.disabled = !valid(d);
  const tip = drawer.querySelector('.dfoot .hint'); if (tip && ui.confirm !== 'achievement') tip.textContent = footHint(d);
}

function paintCrop() {
  const c = $('achCrop');
  if (c && pic && ui.achDraft?.crop) drawSticker(c, pic, ui.achDraft.crop);
}

/** A field changed: `name` is its data-ach, `value` what it holds now. */
export function editAchievement(name, value) {
  const d = ui.achDraft;
  if (!d) return;
  if (name === 'zoom' && d.crop) { d.crop.zoom = Math.max(1, Math.min(3, +value)); paintCrop(); return; }
  if (name === 'target') d.target = value === '' ? 0 : Math.round(+value);
  else if (name === 'courseId' || name === 'itemId') d[name] = value || null;
  else if (name === 'name') d.name = value;
  refresh();
}

async function pickFile(file) {
  const d = ui.achDraft;
  if (!d || !file) return;
  const got = await readPicture(file);
  if (!got) { toast('That picture could not be read. Try a JPG or PNG.', { error: true }); return; }
  pic = got;
  d.crop = { x: 0, y: 0, zoom: 1 };
  renderAchievementDrawer();
}

function finishCrop() {
  const d = ui.achDraft;
  if (!d?.crop || !pic) return;
  const url = stickerData(pic, d.crop);
  if (!url) { toast('That picture is too detailed to keep small. Try zooming in, or another picture.', { error: true }); return; }
  d.sticker = url;
  d.crop = null;
  pic = null;
  renderAchievementDrawer();
  $('ad-name')?.focus();
}

async function save() {
  const d = ui.achDraft;
  if (!d || !valid(d)) return;
  await saveAchievement({
    ...(d.base || {}), id: d.id, name: d.name.trim(), sticker: d.sticker, rule: d.rule,
    courseId: d.rule === 'hours' ? d.courseId : null, itemId: d.rule === 'grade' ? d.itemId : null, target: d.target,
  });
  closeDrawer();
}

/** Clicks for achievements, in the panel and the drawer. True when it was one. */
export async function achievementClick(e) {
  let el;
  if (e.target.closest('[data-ach-new]')) { openAchievement(null); return true; }
  if ((el = e.target.closest('[data-ach-edit]'))) { openAchievement(el.dataset.achEdit); return true; }
  const d = ui.achDraft;
  if (!d) return false;
  if ((el = e.target.closest('[data-ach-rule]'))) {
    if (d.rule !== el.dataset.achRule) {
      d.rule = el.dataset.achRule;
      d.target = d.rule === 'grade' ? 90 : 10;
      if (d.rule === 'hours') d.courseId = d.courseId || data.courses.find((c) => !c.archived)?.id || null;
      renderAchievementDrawer();
      drawer.querySelector('[data-ach-rule="' + d.rule + '"]')?.focus();
    }
    return true;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'ach-save') { await save(); return true; }
  if (act === 'ach-crop-done') { finishCrop(); return true; }
  if (act === 'ach-crop-cancel') { d.crop = null; pic = null; renderAchievementDrawer(); return true; }
  if (act === 'ach-delete') { ui.confirm = 'achievement'; renderAchievementDrawer(); drawer.querySelector('[data-act="keep"]')?.focus(); return true; }
  if (act === 'keep') { ui.confirm = null; renderAchievementDrawer(); drawer.querySelector('[data-act="ach-delete"]')?.focus(); return true; }
  if (act === 'ach-delete-yes') {
    const id = d.id, name = d.name.trim() || 'Achievement';
    closeDrawer();
    deleteLater('achievements', id, '“' + name + '”', () => deleteAchievement(id));
    return true;
  }
  return false;
}

/* The picture and the crop: a file chosen, and the drag that moves it in the circle. */
drawer.addEventListener('change', (e) => { if (e.target.id === 'achFile') pickFile(e.target.files?.[0]); });
let drag = null;
drawer.addEventListener('pointerdown', (e) => {
  if (e.target.id !== 'achCrop' || !ui.achDraft?.crop) return;
  drag = { x: e.clientX, y: e.clientY };
  e.target.setPointerCapture(e.pointerId);
});
drawer.addEventListener('pointermove', (e) => {
  const d = ui.achDraft;
  if (!drag || !d?.crop || !pic) return;
  d.crop = dragCrop(d.crop, pic, e.clientX - drag.x, e.clientY - drag.y, e.target.getBoundingClientRect().width || SHOWN);
  drag = { x: e.clientX, y: e.clientY };
  paintCrop();
});
const endDrag = () => { drag = null; };
drawer.addEventListener('pointerup', endDrag);
drawer.addEventListener('pointercancel', endDrag);
/* the arrow keys move it too, for a keyboard */
drawer.addEventListener('keydown', (e) => {
  const d = ui.achDraft, step = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
  if (e.target.id !== 'achCrop' || !step || !d?.crop || !pic) return;
  e.preventDefault();
  d.crop = dragCrop(d.crop, pic, step[0], step[1], SHOWN);
  paintCrop();
});
