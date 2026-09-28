import { describe, it, expect } from 'vitest';
import { ApiError, retryDelayMs } from '../src/core/api.ts';

describe('retryDelayMs', () => {
  it('waits as long as Spotify asked on a rate limit', () => {
    expect(retryDelayMs(new ApiError(429, { error: 'rate_limited', retryAfter: 7 }))).toBe(7000);
  });
  it('waits 30 s on a rate limit that names no wait', () => {
    expect(retryDelayMs(new ApiError(429, { error: 'rate_limited' }))).toBe(30000);
  });
  it('honors the Retry-After header even without a JSON body', () => {
    expect(retryDelayMs(new ApiError(429, null, 90))).toBe(90000);
  });
  it('prefers the header over a conflicting body', () => {
    expect(retryDelayMs(new ApiError(429, { retryAfter: 7 }, 90))).toBe(90000);
  });
  it.each([Infinity, -1, 0, 'invalid'])('ignores invalid retry delays: %s', (retryAfter) => {
    expect(retryDelayMs(new ApiError(429, { retryAfter }))).toBe(30000);
  });
  it('waits 30 s after any other failure, offline included', () => {
    expect(retryDelayMs(new ApiError(502, { error: 'spotify_unavailable' }))).toBe(30000);
    expect(retryDelayMs(new TypeError('Failed to fetch'))).toBe(30000);
  });
});
