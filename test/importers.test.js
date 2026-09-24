import { describe, it, expect } from 'vitest';
import { parseIcs } from '../public/js/importers/ics.js';
import { parseCsv, normDate } from '../public/js/importers/csv.js';
import { planImport, planOutline, planSummary, setWeek1, weekDate, guessKind, guessType, codeToken } from '../public/js/importers/plan.js';

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
});
