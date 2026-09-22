import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/config', () => {
  it('tells the page which sign-in methods exist, without a session', async () => {
    const res = await SELF.fetch('http://localhost/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ googleClientId: 'test-client-id.apps.googleusercontent.com', devLogin: true });
  });

  it('never offers dev login off localhost', async () => {
    const res = await SELF.fetch('http://rounds.example.workers.dev/api/config');
    expect((await res.json()).devLogin).toBe(false);
  });
});
