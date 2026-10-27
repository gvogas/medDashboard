import { handleApi } from './api.js';
import { purgeTombstones } from './db.js';
import { purgeThrottle } from './throttle.js';
import { purgeLimits } from './limits.js';
import { cronJob, purgeErrors } from './errors.js';
import { adminHousekeeping } from './admin.js';
import { purgeFriends } from './friends.js';
import { purgeRooms } from './rooms.js';
import { sendDigests } from './push.js';
import { TOMBSTONE_TTL_MS } from '../src/core/shared.ts';
import { DAY_MS } from './time.js';

const HOURLY = '0 * * * *';   /* the digests' schedule in wrangler.jsonc */
const NIGHTLY = '0 3 * * *';  /* the purge's: any other schedule runs nothing, so a changed cron can't purge hourly */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env, url, ctx);
    return env.ASSETS.fetch(request);
  },

  // Two schedules (triggers.crons in wrangler.jsonc). Hourly: the morning digests
  // (worker/push.js). Nightly: drop tombstones older than 30 days, old errors and audit
  // entries, and note the run for the Admin page's health panel.
  async scheduled(controller, env, ctx) {
    if (controller.cron === HOURLY) {
      ctx.waitUntil(cronJob(env.DB, 'digests', () => sendDigests(env, controller.scheduledTime || Date.now())));
      return;
    }
    if (controller.cron !== NIGHTLY) { console.error('scheduled: unknown cron', controller.cron); return; }
    /* each job on its own: one failing is logged (Admin → Errors, nightly) and the rest still run */
    const job = (name, fn) => ctx.waitUntil(cronJob(env.DB, name, fn));
    job('tombstones', () => purgeTombstones(env.DB, Date.now() - TOMBSTONE_TTL_MS));
    job('throttle', () => purgeThrottle(env.DB, Date.now() - DAY_MS));
    job('limits', () => purgeLimits(env.DB));
    job('errors', () => purgeErrors(env.DB));
    job('housekeeping', () => adminHousekeeping(env.DB));
    job('friends', () => purgeFriends(env.DB));
    job('rooms', () => purgeRooms(env.DB));
  },
};
