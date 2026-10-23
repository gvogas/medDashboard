// The Worker as the route tests run it: worker/index.js with Workers AI out of reach, as when
// Cloudflare's side is down. The real AI binding is remote-only, and every read the tests sent
// it printed "Binding AI needs to be run remotely"; this one fails the same way, quietly.
// Readers that need an answer are tested with test/fake-ai.js passed to them directly.

import app from '../worker/index.js';

const unreachable = async () => { throw new Error('Workers AI is not available in tests'); };
const AI = { run: unreachable, toMarkdown: unreachable };
const withoutAi = (env) => ({ ...env, AI });

export default {
  fetch: (request, env, ctx) => app.fetch(request, withoutAi(env), ctx),
  scheduled: (controller, env, ctx) => app.scheduled(controller, withoutAi(env), ctx),
};
