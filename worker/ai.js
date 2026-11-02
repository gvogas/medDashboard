// Calling Workers AI, for every read: the course outline (outline.js), the school calendar
// (school.js) and the class schedule (schedule.js). One place for what every call needs: a
// spent allowance answered as its own error, and the tokens each call used written to the
// log (Workers Logs), so the neuron cost of each kind of read can be seen:
//   gpt-oss-120b  31,818 neurons per million tokens in, 68,182 out
//   Llama 4 Scout 24,545 in, 77,273 out          (developers.cloudflare.com/workers-ai/platform/pricing)

import { HttpError } from './http.js';
import { parseLoose } from '../src/core/study-answers.ts';

/* Longer than any read seen so far (30 s), shorter than the browser's 120 s. A read's deadline:
   it starts with the request (api.js), so the file's conversion, the model and its retry
   together stay inside it. */
export const TIMEOUT_MS = 100_000;

/** What is left of a read's deadline (a time in ms; none: all of TIMEOUT_MS); nothing left is the 504. */
export function timeLeft(deadline) {
  if (!deadline) return TIMEOUT_MS;
  const left = Math.min(TIMEOUT_MS, deadline - Date.now());
  if (left <= 0) throw new HttpError(504, { error: 'ai_timeout' });
  return left;
}

/** One model call. A spent allowance (error 4006) is a 429 of its own; no answer in `timeoutMs` a 504. */
export async function runModel(ai, model, input, what = 'ai', timeoutMs = TIMEOUT_MS) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new HttpError(504, { error: 'ai_timeout' }), { detail: model + ' gave no answer in ' + Math.round(timeoutMs / 1000) + ' s' })), timeoutMs); });
  let out;
  try {
    out = await Promise.race([ai.run(model, input), late]);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    /* 4006: the account's free daily neurons are spent; it resets at 00:00 UTC. */
    const said = String(e?.message || e).split('\n')[0].slice(0, 200);
    if (/\b4006\b|daily free allocation/i.test(said)) throw Object.assign(new HttpError(429, { error: 'outline_quota' }), { detail: model + ': ' + said });
    /* the model's name with Cloudflare's words, for the error log */
    throw new Error(model + ': ' + said);
  } finally {
    clearTimeout(timer);
  }
  const u = out?.usage;
  if (u) console.log(`${what}: ${model} in=${u.prompt_tokens ?? '?'} out=${u.completion_tokens ?? '?'}`);
  return out;
}

/**
 * The text or object a model answered with, from any of the shapes Workers AI hands back:
 * chat-completions ({choices: [{message: {content}}]}, content a string or a list of parts, or
 * a tool call's arguments), the Responses API ({output: [{content: [{text}]}]} or output_text)
 * and Workers AI's own ({response}, text or, in JSON mode, an object).
 */
export function modelAnswer(raw) {
  let o = raw;
  for (let i = 0; i < 4 && o && typeof o === 'object' && !Array.isArray(o); i++) {
    const msg = Array.isArray(o.choices) ? o.choices[0]?.message : null;
    const call = (msg?.tool_calls || o.tool_calls)?.[0];
    const said = Array.isArray(o.output)
      ? o.output.filter((p) => Array.isArray(p?.content)).flatMap((p) => p.content).map(partText).join('')
      : '';
    /* a reasoning model cut off at max_tokens has no content: '' then, not the whole reply */
    const next = msg ? (msg.content || call?.function?.arguments || call?.arguments || '')
      : 'response' in o && o.response != null && o.response !== '' ? o.response
      : typeof o.output_text === 'string' ? o.output_text
      : said || (call ? call.function?.arguments ?? call.arguments : undefined);
    if (next === undefined) break;
    o = next;
  }
  return Array.isArray(o) && o.length && o.every((p) => p && typeof p === 'object' && typeof p.text === 'string') ? o.map(partText).join('') : o;
}
const partText = (p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '');

/**
 * The model's answer as an object, or null: gpt-oss answers in JSON text, sometimes wrapped;
 * JSON mode answers an object. A bare list is the object's `items`; an answer that is the
 * schema itself with the values in its `properties` (a small model's slip) is unwrapped.
 */
export function modelJson(raw) {
  let o = modelAnswer(raw);
  if (typeof o === 'string') o = parseLoose(o);
  if (Array.isArray(o)) o = { items: o };
  if (o && typeof o === 'object' && o.type === 'object' && o.properties && typeof o.properties === 'object') {
    /* a real schema's properties are each {type: …}; an answer put there has values */
    if (!Object.values(o.properties).every((v) => v && typeof v === 'object' && 'type' in v)) o = o.properties;
  }
  return o && typeof o === 'object' ? o : null;
}

/** The start of what a model said, for the error log: enough to see what went wrong, never a whole document. */
export function answerSnippet(raw, max = 400) {
  const a = modelAnswer(raw);
  let s;
  try { s = typeof a === 'string' ? a : JSON.stringify(a ?? null); } catch { s = String(a); }
  return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

/* a line that is always a page number: "Page 3", "Page 3 of 12", "- 3 -" */
const PAGE_LABEL = /^(page \d+( of \d+)?|[-–] ?\d{1,3} ?[-–])$/i;
const BARE = /^\d{1,3}$/;
const OF = /^(\d{1,3}) ?\/ ?(\d{1,3})$/;

/**
 * A document's text with less to pay for. Only the "### Page N" markers the browser's PDF
 * reader writes (src/core/pdftext.ts) split pages; text without them (toMarkdown's) is one
 * page; text before the first marker is kept as it is, and is no page. Spaces and blank lines
 * are squeezed and the page markers go. On a page's first or last two lines: a page number goes
 * ("Page 3", "- 3 -"; "3/12" or a bare "3" only when it is this page's number of this many
 * pages, counting blank pages, a bare number allowed one off when the whole document is);
 * a line of 12 or more characters that heads (or ends) at least max(3, half the pages) pages,
 * a running header or footer, is kept the first time only. Lines inside a page are never
 * dropped, even when they repeat ("LEC", a room, a week number).
 */
export function tidyText(text) {
  const parts = String(text).replace(/\r\n?/g, '\n').split(/^#{1,6} ?Page (\d+)[^\S\n]*$/m);
  const lines = (p) => p.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const marked = parts.length > 1;
  const pages = [{ n: marked ? 0 : 1, lines: lines(parts[0]) }];
  for (let i = 1; i < parts.length; i += 2) pages.push({ n: Number(parts[i]), lines: lines(parts[i + 1]) });
  const kept = pages.filter((p) => p.lines.length);
  /* the pages counted and searched for headers: not the text before the first marker (page 0) */
  const counted = kept.filter((p) => p.n > 0);
  const count = counted.length;
  /* "3/12" counts the blank pages the reader skipped too: the highest marker says how many there are */
  const total = Math.max(count, ...counted.map((p) => p.n));
  const heads = (p) => new Set(p.lines.slice(0, 2)), foots = (p) => new Set(p.lines.slice(-2));
  const tally = (pick) => {
    const m = new Map();
    for (const p of counted) for (const l of pick(p)) m.set(l, (m.get(l) || 0) + 1);
    return m;
  };
  const onHeads = tally(heads), onFoots = tally(foots);
  const enough = Math.max(3, Math.ceil(count / 2));
  /* a bare page number one off from the markers, when most pages agree */
  const hits = (off) => counted.filter((p) => [...heads(p), ...foots(p)].some((l) => BARE.test(l) && Number(l) === p.n + off)).length;
  const offset = [-1, 1].find((off) => hits(off) >= Math.max(2, Math.ceil(count / 2)) && hits(off) > hits(0)) ?? 0;
  const pageNumber = (l, p) => {
    if (PAGE_LABEL.test(l)) return true;
    if (BARE.test(l)) return Number(l) === p.n + offset;
    const of = l.match(OF);
    return !!of && Number(of[1]) === p.n && Number(of[2]) === total;
  };
  const seen = new Set();
  return kept.map((p) => {
    if (!p.n) return p.lines.join('\n');
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

const reply = (out) => (out && typeof out === 'object' && out.response != null && out.response !== '' ? out.response : out);

/* An answer `clean` refused, said in the error log (its `detail`, never sent to the browser). */
function cleaned(clean, answer, model) {
  try {
    return clean(answer);
  } catch (e) {
    if (e instanceof HttpError && !e.detail) e.detail = model + ' answered: ' + answerSnippet(answer);
    throw e;
  }
}

/* the retry is skipped when less than this is left of the read's deadline */
const MIN_RETRY_MS = 15_000;

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
  if (modelJson(answer)) return cleaned(clean, answer, model);
  const left = timeoutMs - (Date.now() - start);
  if (left < minRetryMs || cutOff(out, input)) return cleaned(clean, answer, model);
  const text = modelAnswer(answer);
  const said = typeof text === 'string' ? text : JSON.stringify(text ?? null);
  const again = reply(await runModel(ai, model, {
    ...input,
    messages: [...input.messages,
      { role: 'assistant', content: said.slice(0, 2000) },
      { role: 'user', content: 'That was not one valid JSON object. Answer again with only the JSON object, nothing else.' }],
  }, what + ' retry', left));
  return cleaned(clean, again, model);
}

/** A list sent as one query value ("Fall 2026|Winter 2027"), trimmed, at most `max` of `len` characters. */
export const listParam = (value, sep, max, len) =>
  String(value || '').split(sep).map((s) => s.trim().slice(0, len)).filter(Boolean).slice(0, max);

/** A semester name sent with a read, made safe to quote to the model: no control characters, no quotes. */
export const cleanTerm = (t) => String(t || '').replace(/[\u0000-\u001f\u007f"'`\u2018\u2019\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();

/** What the app already knows, said to the model: the school's semester names and the student's course codes. */
export function knownContext({ terms = [], codes = [] } = {}) {
  return [
    terms.length ? 'The school\'s semesters are named ' + terms.map((t) => JSON.stringify(t)).join(', ') + '; when the document is for one of them, write term exactly as that name.' : '',
    codes.length ? 'The student\'s courses so far have the codes ' + codes.join(', ') + '; when a course is one of these, write its code exactly like that.' : '',
  ].filter(Boolean).join(' ');
}
