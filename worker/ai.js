// Calling Workers AI, for every read: the course outline (outline.js), the school calendar
// (school.js) and the class schedule (schedule.js). One place for what every call needs: a
// spent allowance answered as its own error, and the tokens each call used written to the
// log (Workers Logs), so the neuron cost of each kind of read can be seen:
//   gpt-oss-120b  31,818 neurons per million tokens in, 68,182 out
//   Llama 4 Scout 24,545 in, 77,273 out          (developers.cloudflare.com/workers-ai/platform/pricing)

import { HttpError } from './http.js';

/* Longer than any read seen so far (30 s), shorter than the browser's 120 s. */
export const TIMEOUT_MS = 100_000;

/** One model call. A spent allowance (error 4006) is a 429 of its own; no answer in `timeoutMs` a 504. */
export async function runModel(ai, model, input, what = 'ai', timeoutMs = TIMEOUT_MS) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new HttpError(504, { error: 'ai_timeout' })), timeoutMs); });
  let out;
  try {
    out = await Promise.race([ai.run(model, input), late]);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    /* 4006: the account's free daily neurons are spent; it resets at 00:00 UTC. */
    if (/\b4006\b|daily free allocation/i.test(e?.message || '')) throw new HttpError(429, { error: 'outline_quota' });
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const u = out?.usage;
  if (u) console.log(`${what}: ${model} in=${u.prompt_tokens ?? '?'} out=${u.completion_tokens ?? '?'}`);
  return out;
}

/** The model's answer as an object, or null: gpt-oss answers in JSON text, sometimes wrapped; JSON mode answers an object. */
export function modelJson(raw) {
  let o = raw;
  if (o && typeof o === 'object' && Array.isArray(o.choices)) o = o.choices[0]?.message?.content;
  if (typeof o === 'string') {
    const m = o.match(/\{[\s\S]*\}/);
    try { o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
  }
  return o && typeof o === 'object' ? o : null;
}

/* a line that is always a page number: "Page 3", "Page 3 of 12", "- 3 -" */
const PAGE_LABEL = /^(page \d+( of \d+)?|[-–] ?\d{1,3} ?[-–])$/i;
const BARE = /^\d{1,3}$/;
const OF = /^(\d{1,3}) ?\/ ?(\d{1,3})$/;

/**
 * A document's text with less to pay for. Only the "### Page N" markers the browser's PDF
 * reader writes (src/core/pdftext.ts) split pages; text without them (toMarkdown's) is one
 * page. Spaces and blank lines are squeezed and the page markers go. On a page's first or last
 * two lines: a page number goes ("Page 3", "- 3 -"; "3/12" or a bare "3" only when it is this
 * page's number of this many pages, a bare number allowed one off when the whole document is);
 * a line of 12 or more characters that heads (or ends) at least max(3, half the pages) pages,
 * a running header or footer, is kept the first time only. Lines inside a page are never
 * dropped, even when they repeat ("LEC", a room, a week number).
 */
export function tidyText(text) {
  const parts = String(text).replace(/\r\n?/g, '\n').split(/^#{1,6} ?Page (\d+)[^\S\n]*$/m);
  const lines = (p) => p.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const pages = [{ n: 1, lines: lines(parts[0]) }];
  for (let i = 1; i < parts.length; i += 2) pages.push({ n: Number(parts[i]), lines: lines(parts[i + 1]) });
  const kept = pages.filter((p) => p.lines.length);
  const count = kept.length;
  const heads = (p) => new Set(p.lines.slice(0, 2)), foots = (p) => new Set(p.lines.slice(-2));
  const tally = (pick) => {
    const m = new Map();
    for (const p of kept) for (const l of pick(p)) m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const onHeads = tally(heads), onFoots = tally(foots);
  const enough = Math.max(3, Math.ceil(count / 2));
  /* a bare page number one off from the markers, when most pages agree */
  const hits = (off) => kept.filter((p) => [...heads(p), ...foots(p)].some((l) => BARE.test(l) && Number(l) === p.n + off)).length;
  const offset = [-1, 1].find((off) => hits(off) >= Math.max(2, Math.ceil(count / 2)) && hits(off) > hits(0)) ?? 0;
  const pageNumber = (l, p) => {
    if (PAGE_LABEL.test(l)) return true;
    if (BARE.test(l)) return Number(l) === p.n + offset;
    const of = l.match(OF);
    return !!of && Number(of[1]) === p.n && Number(of[2]) === count;
  };
  const seen = new Set();
  return kept.map((p) => {
    const top = heads(p), end = foots(p);
    return p.lines.filter((l) => {
      if (!top.has(l) && !end.has(l)) return true;
      if (pageNumber(l, p)) return false;
      const running = l.length >= 12 && l.length <= 120
        && ((top.has(l) && onHeads.get(l) >= enough) || (end.has(l) && onFoots.get(l) >= enough));
      if (running) {
        if (seen.has(l)) return false;
        seen.add(l);
      }
      return true;
    }).join('\n');
  }).join('\n\n').trim();
}

const reply = (out) => out?.response ?? out;

/* the retry is skipped when less than this is left of the read's deadline */
export const MIN_RETRY_MS = 15_000;

/** The model stopped at max_tokens: chat-completions says so; Workers AI's own shape only counts. */
function cutOff(out, input) {
  if (out?.choices?.[0]?.finish_reason === 'length') return true;
  const used = out?.usage?.completion_tokens;
  return Number.isFinite(used) && Number.isFinite(input?.max_tokens) && used >= input.max_tokens;
}

/**
 * A model's answer, cleaned: `clean(answer)` makes it safe or throws the reader's 502. An
 * answer that is not JSON at all gets one more try, with that answer and a reminder; the
 * retry is part of the same read (no second claim) and of its one deadline, `timeoutMs`
 * (the browser gives up at 120 s). No retry when less than `minRetryMs` is left, or when the
 * answer was cut off at max_tokens (the retry would be too). JSON that `clean` finds empty is
 * not retried: the same document would give the same answer at the same cost.
 */
export async function askJson(ai, model, input, clean, what = 'ai', { timeoutMs = TIMEOUT_MS, minRetryMs = MIN_RETRY_MS } = {}) {
  const start = Date.now();
  const out = await runModel(ai, model, input, what, timeoutMs);
  const answer = reply(out);
  if (modelJson(answer)) return clean(answer);
  const left = timeoutMs - (Date.now() - start);
  if (left < minRetryMs || cutOff(out, input)) return clean(answer);
  const text = Array.isArray(answer?.choices) ? answer.choices[0]?.message?.content : answer;
  const said = typeof text === 'string' ? text : JSON.stringify(text ?? null);
  const again = reply(await runModel(ai, model, {
    ...input,
    messages: [...input.messages,
      { role: 'assistant', content: said.slice(0, 2000) },
      { role: 'user', content: 'That was not one valid JSON object. Answer again with only the JSON object, nothing else.' }],
  }, what + ' retry', left));
  return clean(again);
}

/** A list sent as one query value ("Fall 2026|Winter 2027"), trimmed, at most `max` of `len` characters. */
export const listParam = (value, sep, max, len) =>
  String(value || '').split(sep).map((s) => s.trim().slice(0, len)).filter(Boolean).slice(0, max);

/** What the app already knows, said to the model: the school's semester names and the student's course codes. */
export function knownContext({ terms = [], codes = [] } = {}) {
  return [
    terms.length ? 'The school\'s semesters are named ' + terms.map((t) => '"' + t + '"').join(', ') + '; when the document is for one of them, write term exactly as that name.' : '',
    codes.length ? 'The student\'s courses so far have the codes ' + codes.join(', ') + '; when a course is one of these, write its code exactly like that.' : '',
  ].filter(Boolean).join(' ');
}
