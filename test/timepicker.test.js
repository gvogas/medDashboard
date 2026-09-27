import { describe, it, expect } from 'vitest';
import { parseTime, stepTime } from '../src/legacy/js/timepicker.js';

describe('parseTime', () => {
  it('accepts what people actually type', () => {
    expect(parseTime('8')).toBe('08:00');
    expect(parseTime('08')).toBe('08:00');
    expect(parseTime('8:30')).toBe('08:30');
    expect(parseTime('830')).toBe('08:30');
    expect(parseTime('0830')).toBe('08:30');
    expect(parseTime('1430')).toBe('14:30');
    expect(parseTime('14.30')).toBe('14:30');
    expect(parseTime('8:5')).toBe('08:05');
    expect(parseTime(' 9 ')).toBe('09:00');
  });

  it('understands am and pm', () => {
    expect(parseTime('8am')).toBe('08:00');
    expect(parseTime('8 pm')).toBe('20:00');
    expect(parseTime('12pm')).toBe('12:00');
    expect(parseTime('12am')).toBe('00:00');
    expect(parseTime('2:15p')).toBe('14:15');
  });

  it('returns empty for blank and null for nonsense', () => {
    expect(parseTime('')).toBe('');
    expect(parseTime('   ')).toBe('');
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('8:60')).toBeNull();
  });
});

describe('stepTime', () => {
  it('moves by a quarter hour and stays inside the day', () => {
    expect(stepTime('08:00', 1)).toBe('08:15');
    expect(stepTime('08:10', 1)).toBe('08:15');
    expect(stepTime('08:10', -1)).toBe('08:00');
    expect(stepTime('23:45', 1)).toBe('23:45');
    expect(stepTime('00:00', -1)).toBe('00:00');
    expect(stepTime('', 1)).toBe('09:00');
  });
});
