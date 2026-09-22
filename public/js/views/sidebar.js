import { data } from '../store.js';
import { ui } from '../state.js';
import { ORDER, tmeta, isOpen } from '../model.js';
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
    const m = tmeta(t);
    html += '<button class="nav' + (ui.types[t] ? '' : ' dim') + '" type="button" data-type="' + t + '" aria-pressed="' + (ui.types[t] ? 'true' : 'false') + '" style="--c:' + m.color + '">'
      + '<i class="pip"></i><span class="lbl">' + esc(m.plural) + '</span><span class="ct">' + counts[t] + '</span></button>';
  });
  $('typeNav').innerHTML = html;

  let ch = '<div class="navlabel">Courses<button type="button" data-newcourse="1">+ Add</button></div>'
    + '<button class="nav" type="button" data-course="all" aria-pressed="' + (ui.course === 'all' ? 'true' : 'false') + '"><span class="lbl">All courses</span></button>';
  activeCourses().forEach((c) => {
    const n = (c.meetings || []).length;
    ch += '<span class="course-line">'
      + '<button class="nav" type="button" data-course="' + esc(c.id) + '" aria-pressed="' + (ui.course === c.id ? 'true' : 'false') + '" style="--c:' + c.color + '">'
      + '<i class="pip"></i><span class="lbl">' + esc(c.name) + '</span><span class="ct">' + n + '</span></button>'
      + '<button class="cog" type="button" data-editcourse="' + esc(c.id) + '" aria-label="Edit ' + esc(c.name) + '">✎</button></span>';
  });
  ch += '<button class="addcourse" type="button" data-newcourse="1">+ New course</button>';
  $('courseNav').innerHTML = ch;

  const coat = data.profile ? data.profile.coat : { name: '', role: '' };
  $('ownerName').textContent = coat.name || data.profile?.displayName || 'Your name';
  $('ownerRole').textContent = coat.role;
}
