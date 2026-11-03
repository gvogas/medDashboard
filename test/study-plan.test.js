import { describe, it, expect } from 'vitest';
import { studyPlan } from '../src/core/study-plan.ts';

const t = (text, done = false) => ({ id: text, text, done });

describe('studyPlan', () => {
  it('spreads open topics over the days before the exam, in checklist order', () => {
    const exam = { date: '2026-10-24', checklist: [t('A'), t('B'), t('C'), t('D'), t('E', true)] };
    const p = studyPlan(exam, '2026-10-20', []);
    // Oct 20..23 are four study days; four open topics, one each.
    expect(p.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(p.days.flatMap((d) => d.topics)).toEqual(['A', 'B', 'C', 'D']);
    expect(p.open).toBe(4);
    expect(p.noStudyDays).toBe(false);
  });

  it('skips rest weekdays (0 = Sunday)', () => {
    // 2026-10-18 is a Sunday; rest on Sunday leaves Mon 19 and Tue 20 before the exam on Wed 21.
    const exam = { date: '2026-10-21', checklist: [t('A'), t('B')] };
    const p = studyPlan(exam, '2026-10-18', [0]);
    expect(p.days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-20']);
  });

  it('puts several topics on a day when there are more topics than days', () => {
    const exam = { date: '2026-10-22', checklist: Array.from({ length: 5 }, (_, i) => t('T' + i)) };
    const p = studyPlan(exam, '2026-10-20', []);
    expect(p.days.flatMap((d) => d.topics)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
    expect(p.days.length).toBe(2);
    expect(p.days.every((d) => d.topics.length >= 2 && d.topics.length <= 3)).toBe(true);
  });

  it('reports no study days when the exam is today or only rest days remain', () => {
    expect(studyPlan({ date: '2026-10-20', checklist: [t('A')] }, '2026-10-20', [])).toMatchObject({ days: [], open: 1, noStudyDays: true });
    expect(studyPlan({ date: '2026-10-19', checklist: [t('A')] }, '2026-10-18', [0])).toMatchObject({ days: [], noStudyDays: true });
  });

  it('plans nothing when every topic is done or there are none', () => {
    expect(studyPlan({ date: '2026-10-25', checklist: [t('A', true)] }, '2026-10-20', [])).toEqual({ days: [], open: 0, noStudyDays: false });
    expect(studyPlan({ date: '2026-10-25' }, '2026-10-20', [])).toEqual({ days: [], open: 0, noStudyDays: false });
  });
});
