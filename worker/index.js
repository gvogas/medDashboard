import { handleApi } from './api.js';
import { purgeTombstones } from './db.js';
import { purgeThrottle } from './throttle.js';
import { purgeLimits } from './limits.js';
import { purgeErrors } from './errors.js';
import { adminHousekeeping } from './admin.js';
import { purgeFriends } from './friends.js';
import { sendDigests } from './push.js';
import { TOMBSTONE_TTL_MS } from '../src/core/shared.ts';

const HOURLY = '0 * * * *';   /* the digests' schedule in wrangler.jsonc */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },

  // Two schedules (triggers.crons in wrangler.jsonc). Hourly: the morning digests
  // (worker/push.js). Nightly: drop tombstones older than 30 days, old errors and audit
  // entries, and note the run for the Admin page's health panel.
  async scheduled(controller, env, ctx) {
    if (controller.cron === HOURLY) {
      ctx.waitUntil(sendDigests(env, controller.scheduledTime || Date.now()));
      return;
    }
    ctx.waitUntil(purgeTombstones(env.DB, Date.now() - TOMBSTONE_TTL_MS));
    ctx.waitUntil(purgeThrottle(env.DB, Date.now() - 24 * 60 * 60 * 1000));
    ctx.waitUntil(purgeLimits(env.DB));
    ctx.waitUntil(purgeErrors(env.DB));
    ctx.waitUntil(adminHousekeeping(env.DB));
    ctx.waitUntil(purgeFriends(env.DB));
  },
};
