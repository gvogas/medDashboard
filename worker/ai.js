// Calling Workers AI, for every read: the course outline (outline.js), the school calendar
// (school.js) and the class schedule (schedule.js). One place for what every call needs: a
// spent allowance answered as its own error, and the tokens each call used written to the
// log (Workers Logs), so the neuron cost of each kind of read can be seen:
//   gpt-oss-120b  31,818 neurons per million tokens in, 68,182 out
//   Llama 4 Scout 24,545 in, 77,273 out          (developers.cloudflare.com/workers-ai/platform/pricing)

import { HttpError } from './http.js';

/** One model call. A spent allowance (error 4006) is a 429 of its own. */
export async function runModel(ai, model, input, what = 'ai') {
  let out;
  try {
    out = await ai.run(model, input);
  } catch (e) {
    /* 4006: the account's free daily neurons are spent; it resets at 00:00 UTC. */
    if (/\b4006\b|daily free allocation/i.test(e?.message || '')) throw new HttpError(429, { error: 'outline_quota' });
    throw e;
  }
  const u = out?.usage;
  if (u) console.log(`${what}: ${model} in=${u.prompt_tokens ?? '?'} out=${u.completion_tokens ?? '?'}`);
  return out;
}
