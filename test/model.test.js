import { describe, it, expect } from 'vitest';
import { normalizeItem, shiftEnd } from '../public/js/model.js';

describe('normalizeItem keeps times and dates the server accepts', () => {
  it('moves an end that is not after the start to an hour later', () => {
    expect(normalizeItem({ date: '2026-09-24', start: '11:00', end: '10:00' }).end).toBe('12:00');
    expect(normalizeItem({ date: '2026-09-24', start: '11:00', end: '11:00' }).end).toBe('12:00');
    expect(normalizeItem({ date: '2026-09-24', start: '23:30', end: '09:00' }).end).toBe('23:59');
    expect(normalizeItem({ date: '2026-09-24', start: '09:00', end: '10:00' }).end).toBe('10:00');
    expect(normalizeItem({ date: '2026-09-24', start: '', end: '10:00' }).end).toBe('10:00');
    expect(normalizeItem({ date: '2026-09-24', start: '23:59', end: '10:00' }).end).toBe('');
  });

  it('drops a repeat-until date that is before the item date', () => {
    expect(normalizeItem({ date: '2026-09-24', recur: 'weekly', recurUntil: '2026-09-01' }).recurUntil).toBe(null);
    expect(normalizeItem({ date: '2026-09-24', recur: 'weekly', recurUntil: '2026-12-01' }).recurUntil).toBe('2026-12-01');
  });
});

describe('shiftEnd', () => {
  it('keeps the length when the start moves', () => {
    expect(shiftEnd('09:00', '10:30', '11:00')).toBe('12:30');
    expect(shiftEnd('09:00', '10:00', '23:30')).toBe('23:59');
  });
  it('leaves the end alone when there was no full range before', () => {
    expect(shiftEnd('', '10:00', '11:00')).toBe('10:00');
    expect(shiftEnd('09:00', '', '11:00')).toBe('');
  });
});
