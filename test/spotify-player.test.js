import { describe, it, expect } from 'vitest';
import { nextDelayMs, previousAction } from '../public/js/spotify.js';

describe('nextDelayMs', () => {
  it('polls every 5 s while playing', () => {
    expect(nextDelayMs({ connected: true, playing: true })).toBe(5000);
  });
  it('every 20 s when paused or idle', () => {
    expect(nextDelayMs({ connected: true, playing: false, track: null })).toBe(20000);
  });
  it('stops when not connected or unknown', () => {
    expect(nextDelayMs({ connected: false })).toBeNull();
    expect(nextDelayMs(null)).toBeNull();
  });
});

describe('previousAction', () => {
  it('restarts a track more than 3 s in', () => {
    expect(previousAction({ track: { progressMs: 3001 } })).toBe('restart');
  });
  it('goes back near the start, or with nothing playing', () => {
    expect(previousAction({ track: { progressMs: 2000 } })).toBe('previous');
    expect(previousAction({ track: null })).toBe('previous');
  });
});
