import { handleApi } from './api.js';
import { purgeTombstones } from './db.js';
import { purgeThrottle } from './throttle.js';
import { purgeLimits } from './limits.js';

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },

  // Nightly (see triggers.crons in wrangler.jsonc): drop tombstones older than 30 days.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeTombstones(env.DB, Date.now() - TOMBSTONE_TTL_MS));
    ctx.waitUntil(purgeThrottle(env.DB, Date.now() - 24 * 60 * 60 * 1000));
    ctx.waitUntil(purgeLimits(env.DB));
  },
};
