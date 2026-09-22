import { describe, it, expect } from 'vitest';
import { playTarget } from '../public/js/web-player.js';

const ready = { status: 'ready', deviceId: 'roundsdev' };

describe('playTarget', () => {
  it('plays here when Rounds is ready and nothing else is active', () => {
    expect(playTarget({ deviceId: null }, ready)).toBe('here');
  });

  it('offers Play here when music is on another device', () => {
    expect(playTarget({ deviceId: 'phone' }, ready)).toBe('offer');
  });

  it('does nothing when Rounds is already the device, or is not ready', () => {
    expect(playTarget({ deviceId: 'roundsdev' }, ready)).toBe(null);
    for (const status of ['off', 'loading', 'unsupported', 'needs_reconnect', 'no_premium']) {
      expect(playTarget({ deviceId: null }, { status, deviceId: null }), status).toBe(null);
    }
  });
});
