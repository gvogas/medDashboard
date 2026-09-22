import { describe, it, expect } from 'vitest';
import { ApiError, retryDelayMs } from '../public/js/api.js';

describe('retryDelayMs', () => {
  it('waits as long as Spotify asked on a rate limit', () => {
    expect(retryDelayMs(new ApiError(429, { error: 'rate_limited', retryAfter: 7 }))).toBe(7000);
  });
  it('waits 30 s on a rate limit that names no wait', () => {
    expect(retryDelayMs(new ApiError(429, { error: 'rate_limited' }))).toBe(30000);
  });
  it('waits 30 s after any other failure, offline included', () => {
    expect(retryDelayMs(new ApiError(502, { error: 'spotify_unavailable' }))).toBe(30000);
    expect(retryDelayMs(new TypeError('Failed to fetch'))).toBe(30000);
  });
});
