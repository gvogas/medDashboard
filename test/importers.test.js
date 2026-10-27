import { describe, it, expect } from 'vitest';
import { parseIcs } from '../src/core/importers/ics.ts';
import { parseCsv, normDate } from '../src/core/importers/csv.ts';
import { courseScore, matchCourse, remapCourse, planImport, planOutline, planSchedule, planSummary, setWeek1, weekDate, guessKind, guessType, codeToken } from '../src/core/importers/plan.ts';
import { normalizeCourse } from '../src/core/model.ts';

const pad = (n) => String(n).padStart(2, '0');

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//University//Timetable//EN',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:1@uni',
  'SUMMARY:PHARM101 Pharmacology Lecture',
  'LOCATION:Lecture Theatre 2\\, Main Building',
  'DTSTART;TZID=Europe/London:20260914T090000',
  'DTEND;TZID=Europe/London:20260914T100000',
  'RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=MO,WE',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:2@uni',
  'SUMMARY:ANAT Dissection lab with a very long description that the export',
  '  folds onto a second line',
  'DTSTART:20260915T140000',
  'DTEND:20260915T170000',
  'RRULE:FREQ=WEEKLY',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:3@uni',
  'SUMMARY:PHARM101 Midterm exam',
  'DTSTART:20261020T130000Z',
  'DTEND:20261020T150000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:4@uni',
  'SUMMARY:Reading week',
  'DTSTART;VALUE=DATE:20261026',
  'DTEND;VALUE=DATE:20261031',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:5@uni',
  'SUMMARY:ANAT Cancelled session',
  'STATUS:CANCELLED',
  'DTSTART:20260916T090000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcs', () => {
  const events = parseIcs(ICS);

  it('reads events and skips cancelled ones', () => {
    expect(events.map((e) => e.summary)).toEqual([
      'PHARM101 Pharmacology Lecture',
      'ANAT Dissection lab with a very long description that the export folds onto a second line',
      'PHARM101 Midterm exam',
      'Reading week',
    ]);
  });

  it('unescapes text and keeps TZID times as written', () => {
    expect(events[0]).toMatchObject({ location: 'Lecture Theatre 2, Main Building', date: '2026-09-14', start: '09:00', end: '10:00', weekly: true, weekdays: [1, 3] });
  });

  it('takes the weekday from DTSTART when BYDAY is missing', () => {
    expect(events[1]).toMatchObject({ weekly: true, weekdays: [2], start: '14:00', end: '17:00' });
  });

  it('moves UTC times to local time', () => {
    const d = new Date(Date.UTC(2026, 9, 20, 13, 0));
    expect(events[2]).toMatchObject({ weekly: false, start: pad(d.getHours()) + ':' + pad(d.getMinutes()) });
  });

  it('reads all-day events as a date without times', () => {
    expect(events[3]).toMatchObject({ date: '2026-10-26', start: '', end: '', weekly: false });
  });

  it('accepts LF-only files', () => {
    expect(parseIcs(ICS.replace(/\r\n/g, '\n'))).toHaveLength(4);
  });

  it('keeps the event title when an alarm inside it has a summary of its own', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:PHARM101 Midterm exam', 'DTSTART:20261020T130000',
      'BEGIN:VALARM', 'ACTION:EMAIL', 'SUMMARY:Alarm notification', 'TRIGGER:-P0DT0H30M0S', 'END:VALARM',
      'LOCATION:Hall A', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    expect(parseIcs(ics)).toMatchObject([{ summary: 'PHARM101 Midterm exam', location: 'Hall A', start: '13:00' }]);
  });
});

describe('parseCsv', () => {
  it('reads quoted fields, semicolons and European dates', () => {
    const rows = parseCsv('Type;Course;Title;Date;Start;End;Room;Weight\nclass;PHARM;"Lecture; intro";14/09/2026;9;10:00;LT2;\nexam;PHARM;"Midterm ""A""";2026-10-20;14:00;16:00;Hall A;30\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'class', course: 'PHARM', title: 'Lecture; intro', date: '2026-09-14', start: '09:00', end: '10:00', room: 'LT2', weight: null });
    expect(rows[1]).toMatchObject({ type: 'exam', title: 'Midterm "A"', weight: 30 });
  });

  it('fills missing columns and skips blank lines', () => {
    const rows = parseCsv('title,date\r\nRead chapter 3,2026-09-20\r\n\r\n');
    expect(rows).toEqual([{ type: '', course: '', title: 'Read chapter 3', date: '2026-09-20', start: '', end: '', room: '', weight: null }]);
  });

  it('normalises dates', () => {
    expect(normDate('2026-9-4')).toBe('2026-09-04');
    expect(normDate('4.9.2026')).toBe('2026-09-04');
    expect(normDate('next week')).toBe('');
  });
});

describe('guessing', () => {
  it('guesses class kinds and item types', () => {
    expect(guessKind('ANAT dissection lab')).toBe('Lab');
    expect(guessKind('PBL group 4')).toBe('PBL');
    expect(guessKind('Cardio')).toBe('Lecture');
    expect(guessType('OSCE station practice')).toBe('exam');
    expect(guessType('Essay due')).toBe('assignment');
    expect(guessType('Coffee with tutor')).toBe('task');
    expect(codeToken(' pharm101 Lecture')).toBe('PHARM101');
  });
});

describe('planImport', () => {
  const data = {
    courses: [{ id: 'c1', code: 'ANAT', name: 'Anatomy', color: '#E4749B', meetings: [{ id: 'm1', kind: 'Lab', weekday: 2, start: '14:00', end: '17:00', room: '' }] }],
    items: [],
  };

  it('matches courses by code, proposes new ones and skips known classes', () => {
    const plan = planImport(parseIcs(ICS), data, 'ics');
    const pharm = plan.courses.find((c) => c.code === 'PHARM101');
    expect(pharm).toMatchObject({ isNew: true, name: 'Pharmacology Lecture' });
    expect(pharm.meetings.map((m) => m.weekday)).toEqual([1, 3]);
    expect(pharm.meetings[0]).toMatchObject({ kind: 'Lecture', start: '09:00', end: '10:00', room: 'Lecture Theatre 2, Main Building' });
    expect(plan.courses.find((c) => c.code === 'ANAT')).toBeUndefined();   /* its lab is already there */
    const exam = plan.items.find((i) => i.row.type === 'exam');
    expect(exam.row.courseId).toBe(pharm.id);
    const week = plan.items.find((i) => i.row.title === 'Reading week');
    expect(week.row).toMatchObject({ courseId: null, type: 'task' });
    expect(planSummary(plan)).toBe('1 new course · 2 classes · 2 items');
  });

  it('gives a class with no end an hour, and knows it again on a second import', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:PHYS Lecture', 'DTSTART:20260914T090000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const first = planImport(parseIcs(ics), { courses: [], items: [] }, 'ics');
    expect(first.courses[0].meetings[0]).toMatchObject({ weekday: 1, start: '09:00', end: '10:00' });
    const saved = { courses: [normalizeCourse({ ...first.courses[0], meetings: first.courses[0].meetings })], items: [] };
    expect(planImport(parseIcs(ics), saved, 'ics').courses).toEqual([]);
  });

  it('marks duplicates unticked', () => {
    const withItem = { ...data, items: [{ courseId: null, title: 'Reading week', date: '2026-10-26' }] };
    const plan = planImport(parseIcs(ICS), withItem, 'ics');
    expect(plan.items.find((i) => i.row.title === 'Reading week')).toMatchObject({ duplicate: true, include: false });
  });

  it('caps a course at twelve classes and says so', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ type: 'class', course: 'BIG', title: 'Lecture', date: '2026-09-14', start: pad(7 + i) + ':00', end: pad(8 + i) + ':00', room: '', weight: null }));
    const plan = planImport(rows, { courses: [], items: [] }, 'csv');
    expect(plan.courses[0].meetings).toHaveLength(12);
    expect(plan.notes.filter((n) => /12 classes/.test(n))).toHaveLength(2);
  });

  it('keeps CSV item types and weights, and creates a named course', () => {
    const plan = planImport(parseCsv('type,course,title,date,weight\nassignment,BIOC,Essay,2026-10-01,20'), { courses: [], items: [] }, 'csv');
    expect(plan.courses[0]).toMatchObject({ code: 'BIOC', isNew: true });
    expect(plan.items[0].row).toMatchObject({ type: 'assignment', weight: 20, courseId: plan.courses[0].id });
  });
});

describe('planOutline', () => {
  const outline = {
    code: 'PHARM101', name: 'Principles of Pharmacology', instructor: 'Dr. Ada Okafor', term: 'Autumn 2026', termStart: '2026-09-07', truncated: false,
    classes: [
      { kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: 'LT2' },
      { kind: 'Lab', weekday: 4, start: '14:00', end: '17:00', room: 'Lab B' },
    ],
    assessments: [
      { title: 'Midterm exam', type: 'exam', date: '2026-10-20', start: '', end: '', room: '', weight: 30 },
      { title: 'Final exam', type: 'exam', date: '', start: '', end: '', room: '', weight: 50 },
    ],
  };

  it('proposes the course with its teacher, classes and dated assessments', () => {
    const plan = planOutline(outline, { courses: [], items: [] });
    expect(plan.courses).toHaveLength(1);
    const c = plan.courses[0];
    expect(c).toMatchObject({ code: 'PHARM101', name: 'Principles of Pharmacology', instructor: 'Dr. Ada Okafor', term: 'Autumn 2026', isNew: true, keep: true });
    expect(c.meetings.map((m) => [m.kind, m.weekday, m.start, m.room])).toEqual([['Lecture', 1, '09:00', 'LT2'], ['Lab', 4, '14:00', 'Lab B']]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].row).toMatchObject({ type: 'exam', title: 'Midterm exam', weight: 30, courseId: c.id });
    expect(plan.notes.join(' ')).toContain('Final exam (50%)');
    expect(planSummary(plan)).toBe('1 new course · 2 classes · 1 item');
    expect(plan.termStart).toBe('2026-09-07');
  });

  it('adds to an existing course with the same code', () => {
    const plan = planOutline(outline, { courses: [{ id: 'c1', code: 'pharm101', name: 'Pharm', color: '#E4749B', meetings: [] }], items: [] });
    expect(plan.courses[0]).toMatchObject({ id: 'c1', isNew: false });
    expect(plan.items[0].row.courseId).toBe('c1');
  });

  it('turns office hours into weekly office-hours items', () => {
    const plan = planOutline({ ...outline, officeHours: [{ weekday: 1, start: '16:00', end: '17:00', room: 'SP 265' }] }, { courses: [], items: [] });
    const oh = plan.items.find((i) => i.row.type === 'office');
    expect(oh.row).toMatchObject({ title: 'Dr. Ada Okafor — office hours', recur: 'weekly', weekday: 1, start: '16:00', where: 'SP 265', date: '2026-09-07' });
    expect(oh.include).toBe(true);
  });

  it('dates week-numbered items from week 1, or waits for it', () => {
    const weekly = { ...outline, termStart: '', assessments: [{ title: 'Assignment 1', type: 'assignment', date: '', week: 7, start: '', end: '', room: '', weight: 12.5 }] };
    const waiting = planOutline(weekly, { courses: [], items: [] });
    const a1 = waiting.items.find((i) => i.row.title === 'Assignment 1');
    expect(a1).toMatchObject({ week: 7, include: false });
    expect(a1.row.date).toBe('');
    setWeek1(waiting, '2026-08-26');                     /* a Wednesday: week 1 is Mon 24 Aug */
    expect(a1.row.date).toBe('2026-10-05');
    expect(a1.include).toBe(true);
    expect(planOutline(weekly, { courses: [], items: [] }, '2026-08-24').items.find((i) => i.week).row.date).toBe('2026-10-05');
    expect(weekDate('2026-08-24', 1)).toBe('2026-08-24');
  });

  it('uses the existing course when the outline adds nothing but the course', () => {
    const plan = planOutline({ ...outline, classes: [], assessments: [] }, { courses: [{ id: 'c1', code: 'PHARM101', name: 'Pharm', color: '#E4749B', meetings: [] }], items: [] });
    expect(plan.courses[0]).toMatchObject({ id: 'c1', isNew: false });
  });

  it('still offers the course when nothing is dated', () => {
    const plan = planOutline({ ...outline, code: '', classes: [], assessments: [] }, { courses: [], items: [] });
    expect(plan.courses[0]).toMatchObject({ code: 'PRIN', keep: true });
    expect(planSummary(plan)).toBe('1 new course · 0 classes · 0 items');
  });

  it("marks the plan as an outline and keeps an existing course's semester", () => {
    const plan = planOutline(outline, { courses: [{ id: 'c1', code: 'PHARM101', name: 'Pharm', color: '#E4749B', term: 'Fall 2026', meetings: [] }], items: [] });
    expect(plan.kind).toBe('outline');
    expect(plan.courses[0].term).toBe('Fall 2026');
  });
});

describe('planSchedule', () => {
  const read = { term: 'Fall 2026', courses: [
    { code: 'CHEM271', name: 'Organic Chemistry I', classes: [
      { kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' },
      { kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' },
    ] },
    { code: '', name: 'Waves', classes: [{ kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' }] },
    { code: 'BIOL266', name: 'Cell Biology', classes: [{ kind: 'Tutorial', weekday: 3, start: '15:00', end: '16:00', room: '' }] },
  ] };
  const data = () => ({ items: [], courses: [
    { id: 'c1', code: 'CHEM271', name: 'Organic Chem', color: '#E4749B', term: 'Winter 2027', meetings: [{ id: 'm0', kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' }] },
    { id: 'c2', code: 'PHYS205', name: 'waves ', color: '#4F74D9', term: '', meetings: [] },
  ] });

  it('matches courses by code, then by name, and proposes the rest with the semester given', () => {
    const plan = planSchedule(read, data(), 'Fall 2026');
    expect(plan.kind).toBe('schedule');
    expect(plan.courses.map((c) => [c.id === 'c1' || c.id === 'c2' ? c.id : 'new', c.code, c.isNew, c.term]))
      .toEqual([['c1', 'CHEM271', false, 'Winter 2027'], ['c2', 'PHYS205', false, ''], ['new', 'BIOL266', true, 'Fall 2026']]);
    expect(plan.courses[2].name).toBe('Cell Biology');
    expect(plan.items).toEqual([]);
  });

  it("lists all the timetable's classes for a course of yours, ticked, to replace the ones it has", () => {
    const chem = planSchedule(read, data(), '').courses[0];
    expect(chem.meetings.map((m) => [m.kind, m.weekday, m.start, m.room, m.include])).toEqual([['Lecture', 2, '08:30', 'H-110', true], ['Lab', 5, '13:00', 'SP-265', true]]);
    expect(chem).toMatchObject({ replace: true, had: [expect.objectContaining({ id: 'm0' })] });
  });

  it('still lists a course whose classes are all there, unticked, so its semester can be set', () => {
    const d = data();
    d.courses[0].meetings.push({ id: 'm1', kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' });
    const plan = planSchedule({ term: '', courses: [read.courses[0]] }, d, '');
    expect(plan.courses.map((c) => [c.id, c.meetings.map((m) => m.include), c.replace])).toEqual([['c1', [false, false], undefined]]);
  });

  it('keeps a course to 12 classes and says what was dropped', () => {
    const classes = Array.from({ length: 13 }, (_, i) => ({ kind: 'Lecture', weekday: 1 + (i % 5), start: String(8 + Math.floor(i / 5)).padStart(2, '0') + ':00', end: '', room: '' }));
    const plan = planSchedule({ term: '', courses: [{ code: 'MANY', name: 'Many', classes }] }, { items: [], courses: [] }, '');
    expect(plan.courses[0].meetings).toHaveLength(12);
    expect(plan.notes.join(' ')).toContain('already has 12 classes');
  });

  it('merges two courses read with the same code, whatever its case or spaces, into one', () => {
    const lec = { kind: 'Lecture', weekday: 1, start: '09:00', end: '10:00', room: 'A' };
    const lab = { kind: 'Lab', weekday: 3, start: '13:00', end: '16:00', room: 'B' };
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'Tutorial', weekday: 1 + (i % 5), start: String(11 + Math.floor(i / 5)).padStart(2, '0') + ':30', end: '', room: '' }));
    const plan = planSchedule({ term: '', courses: [
      { code: 'MATH 205', name: 'Calculus', classes: [lec, lab] },
      { code: 'math205', name: 'Calculus II', classes: [lec, ...many] },
    ] }, { items: [], courses: [] }, 'Fall 2026');
    expect(plan.courses).toHaveLength(1);
    expect(plan.courses[0]).toMatchObject({ code: 'MATH205', name: 'Calculus', isNew: true, term: 'Fall 2026' });
    const keys = plan.courses[0].meetings.map((m) => [m.weekday, m.start, m.end].join(' '));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(0, 2)).toEqual(['1 09:00 10:00', '3 13:00 16:00']);
    expect(plan.courses[0].meetings).toHaveLength(12);
    expect(plan.notes.join(' ')).toContain('MATH205 already has 12 classes');
  });

  it('gives a new course with no code one of its own, never one already taken', () => {
    const lec = (weekday) => [{ kind: 'Lecture', weekday, start: '09:00', end: '10:00', room: '' }];
    const d = { items: [], courses: [{ id: 'w', code: 'WAVE', name: 'Wave Mechanics', color: '#4F74D9', term: '', meetings: [] }] };
    const plan = planSchedule({ term: '', courses: [
      { code: '', name: 'Organic Chemistry', classes: lec(1) },
      { code: '', name: 'Organic Physics', classes: lec(2) },
      { code: '', name: 'Waves', classes: lec(3) },
      { code: 'ORGA3', name: 'Organ Music', classes: lec(4) },
      { code: '', name: 'organic  chemistry', classes: lec(5) },
    ] }, d, '');
    expect(plan.courses.map((c) => [c.code, c.name, c.isNew, c.meetings.map((m) => m.weekday)])).toEqual([
      ['ORGA', 'Organic Chemistry', true, [1, 5]],
      ['ORGA2', 'Organic Physics', true, [2]],
      ['WAVE2', 'Waves', true, [3]],
      ['ORGA3', 'Organ Music', true, [4]],
    ]);
  });

  it('merges a course read twice into the one of yours it matches', () => {
    const plan = planSchedule({ term: '', courses: [
      { code: 'chem 271', name: 'Organic', classes: [{ kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: '' }] },
      { code: '', name: 'Organic Chem', classes: [{ kind: 'Tutorial', weekday: 4, start: '10:00', end: '11:00', room: '' }] },
    ] }, data(), '');
    expect(plan.courses.map((c) => [c.id, c.meetings.map((m) => m.kind)])).toEqual([['c1', ['Lab', 'Tutorial']]]);
  });
});

describe('matching a timetable course to one of yours', () => {
  const mine = [
    { id: 'gp', code: 'GP', name: 'Game Prog' }, { id: 'an', code: 'AN', name: 'Advanced Network' },
    { id: 'ws', code: 'WEB', name: 'Web Services' }, { id: 'iot', code: 'IOT', name: 'IoT' },
    { id: 'p1', code: 'PROG1', name: 'Programming 1' }, { id: 'cr', code: '', name: 'Le Contrat Racial' },
    { id: 'code', code: '420-511', name: 'Something else' },
  ];
  const to = (code, name) => matchCourse({ code, name }, mine)?.id ?? null;

  it('by code first, dashes, spaces and case aside, or one code the start of the other', () => {
    expect(to('420511VA', 'Web Services')).toBe('code');
    expect(to('gp', 'Unrelated')).toBe('gp');
    expect(courseScore({ code: '420-541-VA' }, { code: '420541va' })).toBe(1);
  });

  it('by name: an abbreviation, a plural, a title before its colon, initials, accents and case', () => {
    expect(to('420541VA', 'Game Programming 2')).toBe('gp');
    expect(to('420521VA', 'Advanced Networks')).toBe('an');
    expect(to('420531VA', 'IoT: Internet of Things')).toBe('iot');
    expect(to('X', 'Internet of Things')).toBe('iot');
    expect(to('345HSZVF', 'CONTRAT RACIAL (LE)')).toBe('cr');
  });

  it('not on one shared word, or another number', () => {
    expect(to('Y', 'Game Theory')).toBeNull();
    expect(to('Z', 'Programming 2')).toBeNull();
    expect(to('602E02MQ', 'Projet expérientiel')).toBeNull();
  });
});

describe('a timetable course put on another of yours', () => {
  const data = { items: [], courses: [
    { id: 'gp', code: 'GP', name: 'Game Prog', color: '#E4749B', term: 'Fall 2026', meetings: [{ id: 'old', kind: 'Lecture', weekday: 1, start: '10:30', end: '12:00', room: 'D-243' }] },
    { id: 'other', code: 'OTH', name: 'Other', color: '#4F74D9', term: '', meetings: [] },
  ] };
  const read = { term: '', courses: [{ code: '420541VA', name: 'Game Programming 2', classes: [
    { kind: 'Lab', weekday: 1, start: '10:00', end: '12:00', room: 'D-243' }, { kind: 'Lecture', weekday: 5, start: '10:00', end: '12:00', room: 'D-242' },
  ] }] };

  it('matches the abbreviated name, and offers to replace its wrong classes', () => {
    const plan = planSchedule(read, data, '');
    expect(plan.courses).toHaveLength(1);
    expect(plan.courses[0]).toMatchObject({ id: 'gp', isNew: false, replace: true, read: { code: '420541VA', name: 'Game Programming 2' } });
    expect(plan.courses[0].meetings.every((m) => m.include)).toBe(true);
  });

  it('moves to a new course, or to another of yours, keeping the classes', () => {
    const plan = planSchedule(read, data, '');
    const fresh = remapCourse(plan, 0, null, data).courses[0];
    expect(fresh).toMatchObject({ isNew: true, code: '420541VA', name: 'Game Programming 2', had: [] });
    expect(fresh.replace).toBeUndefined();
    expect(fresh.id).not.toBe('gp');
    expect(fresh.meetings).toHaveLength(2);
    const other = remapCourse(plan, 0, 'other', data).courses[0];
    expect(other).toMatchObject({ id: 'other', isNew: false, code: 'OTH' });
    expect(other.replace).toBeUndefined();          // nothing there to replace
    expect(remapCourse(remapCourse(plan, 0, null, data), 0, 'gp', data).courses[0]).toMatchObject({ id: 'gp', replace: true });
  });
});

describe('planImport: how a weekly class ends', () => {
  const ics = (rrule) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:ANAT101 Lecture', 'DTSTART:20260914T090000', 'DTEND:20260914T100000', 'RRULE:' + rrule, 'END:VEVENT', 'END:VCALENDAR'].join('\n');
  const plan = (rrule) => planImport(parseIcs(ics(rrule)), { courses: [], items: [] }, 'ics');

  it('skips every 2 weeks with a note, not as a weekly class', () => {
    const p = plan('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    expect(p.courses).toEqual([]);
    expect(p.notes).toEqual(['Skipped ANAT101 Lecture: it repeats every 2 weeks, and classes can only repeat weekly.']);
  });

  it('keeps a series that ends as a weekly class and says it has no end date', () => {
    const p = plan('FREQ=WEEKLY;BYDAY=MO;COUNT=10');
    expect(p.courses[0].meetings).toHaveLength(1);
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]).toContain('ANAT101 Lecture ends 2026-11-16');
  });

  it('adds no note for a series without an end', () => {
    expect(plan('FREQ=WEEKLY;BYDAY=MO').notes).toEqual([]);
  });
});
