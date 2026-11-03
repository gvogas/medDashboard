import { describe, it, expect } from 'vitest';
import { studyTimeline } from '../src/core/study-timeline.ts';

const t = (text, done = false) => ({ id: text, text, done });
const exam = (id, title, date, checklist, extra = {}) => ({ id, key: id, type: 'exam', title, date, status: 'open', checklist, ...extra });

describe('studyTimeline', () => {
  it('merges every open exam\'s plan into one date-ordered list', () => {
    const items = [
      exam('b', 'Biology', '2026-10-22', [t('Cells'), t('Genetics')]),
      exam('a', 'Algebra', '2026-10-21', [t('Limits')]),
    ];
    const tl = studyTimeline(items, '2026-10-20', [], 14);
    expect(tl.map((e) => [e.date, e.exam, e.topics])).toEqual([
      ['2026-10-20', 'Algebra', ['Limits']],
      ['2026-10-20', 'Biology', ['Cells']],
      ['2026-10-21', 'Biology', ['Genetics']],
    ]);
  });

  it('ignores exams that are not tests, are closed, are today or past, or have no date', () => {
    const items = [
      exam('x', 'Essay', '2026-10-25', [t('A')], { type: 'essay' }),
      exam('c', 'Done exam', '2026-10-25', [t('A')], { status: 'done' }),
      exam('p', 'Past', '2026-10-19', [t('A')]),
      exam('now', 'Today', '2026-10-20', [t('A')]),
      exam('n', 'No date', '', [t('A')]),
    ];
    expect(studyTimeline(items, '2026-10-20', [], 14)).toEqual([]);
  });

  it('keeps only the days within the window', () => {
    const items = [exam('a', 'Far', '2026-11-30', Array.from({ length: 40 }, (_, i) => t('T' + i)))];
    const tl = studyTimeline(items, '2026-10-20', [], 3);
    expect(tl.map((e) => e.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('respects rest weekdays', () => {
    // 2026-10-18 is a Sunday; rest on Sunday and Monday leaves Tuesday 20 first.
    const items = [exam('a', 'Quiz', '2026-10-21', [t('A')])];
    expect(studyTimeline(items, '2026-10-18', [0, 1], 14).map((e) => e.date)).toEqual(['2026-10-20']);
  });

  it('is empty with no exams', () => {
    expect(studyTimeline([], '2026-10-20', [], 14)).toEqual([]);
  });
});
