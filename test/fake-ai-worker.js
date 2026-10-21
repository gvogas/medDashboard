// The Worker as `npm run dev:fake-ai` runs it: worker/index.js with test/fake-ai.js in place
// of the remote-only AI binding. Never built for production: vite.config.ts uses this entry
// only when FAKE_AI is set.

import app from '../worker/index.js';
import { fakeAi } from './fake-ai.js';

const withAi = (env) => ({ ...env, AI: fakeAi(env.FAKE_AI) });

export default {
  fetch: (request, env, ctx) => app.fetch(request, withAi(env), ctx),
  scheduled: (controller, env, ctx) => app.scheduled(controller, withAi(env), ctx),
};
