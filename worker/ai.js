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

/* a page's number on its own line: "Page 3", "Page 3 of 12", "- 3 -", "3/12", "3" */
const PAGE_NUMBER = /^(page \d+( of \d+)?|[-–]? ?\d{1,3} ?[-–]?|\d{1,3} ?\/ ?\d{1,3})$/i;

/**
 * A document's text with less to pay for. Pages are the "### Page N" markers the browser's
 * PDF reader writes (src/core/pdftext.ts). Spaces and blank lines are squeezed; the page
 * markers go; a page number on a page's first or last two lines goes; a line on the first or
 * last two lines of 3 or more pages (a running header or footer) is kept the first time only.
 * Lines inside a page are never dropped, even when they repeat ("LEC", a room, a week number).
 */
export function tidyText(text) {
  const pages = String(text).replace(/\r\n?/g, '\n').split(/^#{1,6} ?Page \d+[^\S\n]*$/m)
    .map((p) => p.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean))
    .filter((p) => p.length);
  const edges = (lines) => new Set([...lines.slice(0, 2), ...lines.slice(-2)]);
  const onPages = new Map();
  for (const p of pages) for (const l of edges(p)) onPages.set(l, (onPages.get(l) || 0) + 1);
  const seen = new Set();
  return pages.map((p) => {
    const ends = edges(p);
    return p.filter((l) => {
      if (!ends.has(l)) return true;
      if (PAGE_NUMBER.test(l)) return false;
      if (onPages.get(l) >= 3 && l.length <= 120) {
        if (seen.has(l)) return false;
        seen.add(l);
      }
      return true;
    }).join('\n');
  }).join('\n\n').trim();
}

const reply = (out) => out?.response ?? out;

/**
 * A model's answer, cleaned: `clean(answer)` makes it safe or throws the reader's 502. An
 * answer that is not JSON at all gets one more try, with that answer and a reminder; the
 * retry is part of the same read (no second claim). JSON that `clean` finds empty is not
 * retried: the same document would give the same answer at the same cost.
 */
export async function askJson(ai, model, input, clean, what = 'ai') {
  const answer = reply(await runModel(ai, model, input, what));
  if (modelJson(answer)) return clean(answer);
  const said = typeof answer === 'string' ? answer : JSON.stringify(answer ?? null);
  const again = reply(await runModel(ai, model, {
    ...input,
    messages: [...input.messages,
      { role: 'assistant', content: said.slice(0, 2000) },
      { role: 'user', content: 'That was not one valid JSON object. Answer again with only the JSON object, nothing else.' }],
  }, what + ' retry'));
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
