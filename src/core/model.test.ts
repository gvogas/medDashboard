import { afterEach, describe, expect, it, vi } from "vitest";
import { tmeta, useTypePrefs } from './model.ts';
import type { TypePref } from './types.ts';

afterEach(() => useTypePrefs(() => []));

describe('tmeta', () => {
  it('builds the type list once per set of prefs, not on every call', () => {
    const prefs: TypePref[] = [{ id: 'exam', label: 'Final' }];
    const get = vi.fn(() => prefs);
    useTypePrefs(get);
    expect(tmeta('exam').label).toBe('Final');
    const copy = tmeta('exam');
    expect(tmeta('exam')).toBe(copy);
    expect(tmeta('task').label).toBe('Task');
  });

  it('reads new prefs once the profile reloads them', () => {
    let prefs: TypePref[] = [{ id: 'exam', label: 'Final' }];
    useTypePrefs(() => prefs);
    expect(tmeta('exam').label).toBe('Final');
    prefs = [{ id: 'exam', label: 'Midterm' }];
    expect(tmeta('exam').label).toBe('Midterm');
  });

  it('falls back for an unknown type, with or without prefs', () => {
    useTypePrefs(() => undefined);
    expect(tmeta('nope').label).toBe('Task');
    expect(tmeta('c-abc').label).toBe('Item');
  });
});
