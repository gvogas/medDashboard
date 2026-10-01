# Term Stage 7: Import with AI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An **Import with AI** button in the top bar opens a card with three kinds of file read by AI: a **class schedule** (new: a timetable PDF or a PNG/JPG screenshot becomes courses with their lectures, labs and tutorials), a **course outline** (as today, plus a semester picker beside the course) and a **school calendar** (as today; Settings keeps its entry). While a file is read, a card shows three steps ticking off, with Cancel; the reads left today are shown. Then, in a second part, **every AI read is made cheaper, sturdier and more accurate**: one shared way to call the models with a repair retry and a timeout, less text sent, what the app already knows told to the model, answers checked, and the same file read twice costing nothing.

**Architecture:** No database change. Worker: a new `worker/ai.js` (calling a model: the 4006 allowance error, the timeout, the tokens logged, JSON with one repair retry, text tidying) used by the outline (`worker/outline.js`), the school calendar (`worker/school.js`) and the new class schedule (`worker/schedule.js`). Two new routes beside `/api/outline` and `/api/school-calendar`, named as the master plan says: `POST /api/ai/schedule` (the body is the timetable's text or a JPEG/PNG) and `GET /api/ai/reads` (`{ left, limit }`). All three reads share the existing daily limit (`limitOutline`, 10 a day, key `outline:<user>`), claimed only just before a model runs. Browser: the reading card (`src/components/overlays.tsx` + `src/data/ai-read.ts`) gets steps and Cancel (an `AbortController` through `api.ts` to `fetch`); a new sheet `ai` (the card, `src/components/sheet/ai-sheet.tsx`) and a new sheet `schedule` (the preview, `schedule-sheet.tsx`); the plan (`src/core/importers/plan.ts`) gains `planSchedule`, which reuses `planImport`'s matching, its "no class twice" rule and its 12-class cap; `commitImport` also saves a course's semester (`term`). Screenshots are made smaller in the browser (`src/core/image.ts`: at most 1600 px on the long side, JPEG) before upload.

**The vision model (decided here): `@cf/meta/llama-4-scout-17b-16e-instruct`.**
- It reads images (`messages[].content[]` with `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,…" } }`; HTTP URLs are refused, so nothing is fetched from elsewhere), supports JSON mode (`response_format: { type: "json_schema", json_schema }`), has a 131k context and **no licence "agree" call** (Llama 3.2 Vision needs one). Source: the model's schema in the Cloudflare docs repo (`src/content/workers-ai-models/llama-4-scout-17b-16e-instruct.json`, read 1 October 2026) and https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/. **Its `max_tokens` defaults to 256**: always pass it.
- Price (https://developers.cloudflare.com/workers-ai/platform/pricing/): $0.27/M input tokens = **24,545 neurons/M**, $0.85/M output = **77,273 neurons/M**.
- **Estimate per screenshot read: about 110 neurons**, at most about 220. A 1600×1000 screenshot is about 12 tiles of 336 px plus a thumbnail, about 144 tokens each (Llama 4's image tiling) ≈ 1,900 tokens, plus about 600 prompt tokens: 2,500 × 24,545/M ≈ 61 neurons in; the answer for 6 courses and 15 classes is about 600 tokens ≈ 46 neurons out (`max_tokens` 2,000 caps it at 155). Task 13 measures the real figure from the reply's `usage`.
- Why not the others: Llama 3.2 11B Vision is cheaper on input (4,410/M) but has no JSON mode, needs the licence call and reads small text worse; Gemma 3 12B and Mistral Small 3.1 cost about 31,000 neurons/M in and have no clear image input on Workers AI; LLaVA 1.5 is too weak at reading tables.
- A **PDF timetable** goes through the text path (`@cf/openai/gpt-oss-120b`, as outlines) with `reasoning: { effort: "low" }`: about 1,500 tokens in (48 neurons) and 900 out with the thinking (61 neurons), **about 110 neurons**.

**Live model calls in this stage: at most 4, about 750 neurons in all** (7.5% of the 10,000 a day shared with the live site; memory: Workers AI quota). They are all in Task 13. Every test uses fakes and saved replies. Don't run the dev server's AI reads anywhere else; Task 14 re-uses Task 13's files, which the device cache (Task 12) answers without a read.

**CSP:** files are uploaded to the same origin (`connect-src 'self'` covers it) and images go to the model as data URIs inside the Worker; the page never loads an image from elsewhere and shows no preview of the picked picture (a `blob:` thumbnail would need `img-src blob:`), so `public/_headers` does not change. `createImageBitmap` and `canvas.toBlob` need no CSP source.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4, Vitest (Workers pool + jsdom), Cloudflare Workers + D1 + Workers AI.

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` §10 and "Not in this redesign". **Prototype:** `design/term-prototype.dc.html` (read, don't open): the top-bar button line 214; the Import with AI card 1210–1246 (the kind cards 1219–1231, the reads-left meter 1235–1238, Paste 1239–1243); the reading card 1248–1269 (the steps 1257–1261, the bar 1263, Cancel 1266); the preview 1271–1360 (the head 1273–1277, the headline 1281–1284, the outline's Course and **Semester** 1287–1296, the class schedule 1318–1340 with the badge 1325, the semester radio group 1327, the class rows 1329–1335 and the note 1338, the foot 1353–1357). Values: `runAi` and `stopAi` 1472–1481; `STAGES` 1984–1985; `SEMS`/`semPicker` 1987–1991; `SCHED` 1997–2004; the `ai` object 2010–2084 (the kinds 2013–2023, the busy titles 2024, the stages 2025–2027, `cancel` 2028, the headlines and sublines 2030–2032, the schedule rows 2042–2049, `verb`, `commitLabel` 2054–2058, the commit 2059–2083).

**Branch:** `term-7-import` off `term` (both at the Stage 6 merge; the branch exists).

**What the owner sees at the end:** "Import with AI" (a small accent spark and the words; the spark alone on a phone) beside the search box. It opens a card: "Give it a document and it finds the dates for you…", then three boxes — **Class schedule** ("Choose a PDF or image", "PDF, PNG or JPG · read by AI"), **Course outline**, **School calendar** — each with its icon, a line about it and a dashed drop area; under them a small meter "7 of 10 AI reads left today · pasting a calendar or CSV doesn't count"; and "Paste a calendar or CSV instead". Picking a file shows the reading card: a spinner, "Reading your timetable" in the serif, the file name in mono, three steps ("Reading the timetable", "Finding courses and class times", "Matching them to your courses") ticking off with the accent, a thin progress line, "Usually under half a minute · 12s" and Cancel (Escape too). A timetable opens "Read by AI · timetable.png", **Found 6 courses** in the serif, "With 13 new classes. Set each course's semester and untick anything that's wrong.", then one box per course with its colour, its code and name, **Matches your course** or **New course**, the semester picker (with a school calendar: Fall 2026 · Winter 2027 · Both semesters), and a row per class (kind, day, time in mono, room) with a tick; "Classes already on your board aren't added twice."; the foot "Nothing is saved until you add them", **Another file** and **Add 13 classes**. Adding writes the classes to the courses' timetables (new courses created), sets their semesters, and says "Added 13 classes to 6 courses". An outline opens today's import preview with a **Semester** picker under the course. The same file read again on this device answers at once and uses no read. On a phone the card, the preview and the reading card fit at 390 px.

**Not in this stage:**
- **"Try it with a sample …"** under each kind (prototype 1232): it would spend a read on a demo, or need canned answers shown as if read. Left out.
- **The outline preview's Course select and its restyle** ("Found 9 dates", the weight column, "Weights add up to 100%", prototype 1281–1316): today's import preview stays, matching the course by code; only the semester picker is added (spec §10: "as today, plus a semester picker").
- **The school calendar's summary preview** (prototype 1342–1349): a calendar read from the card opens today's school sheet, where it is checked and saved.
- **"Calendars don't count"** (prototype 1237): a school calendar costs the same neurons as an outline, so it still counts; the meter says pasting doesn't count.
- **"That didn't use up a read"** after Cancel (prototype 2028): the read is claimed when the file reaches the model and the Worker cannot take it back, so the card says "Stopped reading." and the meter shows what is left.
- **A thumbnail of the picked picture**: it would need `blob:` in the CSP's `img-src`.
- **A cache on the server** (a D1 table of answers by file hash): it would need a migration; the cache is on the device instead (Task 12).
- **Re-tuning the outline and calendar model** (gpt-oss's JSON mode, lower reasoning effort, a smaller model): the outline prompt was scored 20/21 on three real outlines as it is (study-tools spec §5a); changing it needs that scoring again, about 1,800 neurons. Their costs are logged from now on (Task 1), so it can be decided with numbers later.
- **HEIC pictures** (iPhone): browsers other than Safari can't open them; the card says to use PNG or JPG.
- **Several screenshots in one read**: one file per read.
- **The phone design pass**: the new card and preview work at phone width with today's sheet behaviour.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build` (CSP checks). `npm run check` runs all three. One file: `npx vitest run test/schedule.test.js`; the AI reads: `npx vitest run test/ai.test.js test/outline.test.js test/school.test.js test/schedule.test.js test/importers.test.js`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. First run `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell and stop any leftover `vite.js` on it. Don't run `npm run build` while it runs. Blank page titled "Rounds": unregister the old service worker (DevTools → Application). Local user: `termqa` / `termqa-local-1`. **Workers AI always runs remotely, even under `npm run dev`: every read in the dev server spends the live site's allowance.** Only Task 13 reads files with the real model.
3. **Line endings and encoding:** keep every file LF and UTF-8. Characters like `·`, `’`, `“ ”`, `–`, `—`, `✕`, `…` must be UTF-8: after writing a file, `file <path>` should not say "ISO-8859" or "CRLF"; if Vite then serves a stale copy, touch the file.
4. **Commits:** end each message with these two lines (the commit commands below pass them as a second `-m`):
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
   `Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry`
   Commit only on `term-7-import`. The owner has said to finish everything: Task 15 merges and pushes after the review. This stage touches no database.
5. **Tests find text.** When a task changes a word or a role, `rg -n "<old words>" src test` and update the tests in the same commit.
6. **Workers tests never reach Cloudflare:** `vitest.config.js` sets `remoteBindings: false`, so `env.AI` is missing in route tests (a read that reaches the model answers 503) and the readers are tested with a fake `ai` passed in (`fakeAi` in `test/outline.test.js`).
7. **Colours** go through tokens: `bg-primary` (`--accent`), `bg-secondary` (`--accent-soft`), `text-accent-foreground`, `text-foreground`, `text-ink-2`, `text-muted-foreground`, `border-border`, `bg-line-2`, `bg-muted`, `bg-card`. A colour that comes from data goes through `style` (as `accent()` in `src/components/views/bits.tsx`); a width too (`style={{ width }}`: the CSP allows styles set through the DOM, not `style` attributes in HTML).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `worker/ai.js` | create | calling a model: 4006 → 429, the timeout, tokens logged; JSON with one repair retry; `modelJson`; tidying text |
| `worker/schedule.js` | create | the class schedule: schema, prompts, `cleanSchedule`, text path and vision path |
| `worker/outline.js` | modify | `cleanCode`, `cleanKind`, `cleanClasses` shared; `askModel` through `worker/ai.js`; images refused; dates checked; semesters and codes in the prompt |
| `worker/school.js` | modify | through `askModel`'s new shape |
| `worker/limits.js` | modify | `readsLeft` |
| `worker/api.js` | modify | `POST /api/ai/schedule`, `GET /api/ai/reads`; `terms` and `codes` passed to the readers |
| `test/ai.test.js` | create | `runModel`, `askJson`, `tidyText` |
| `test/schedule.test.js` | create | the schedule reader and its route |
| `test/fixtures/timetable.html`, `test/fixtures/outline.txt` | create | the files for the one live check (Task 13) |
| `test/fixtures/schedule-vision-reply.json`, `schedule-text-reply.json` | create (Task 13) | the real replies, saved |
| `test/outline.test.js`, `test/school.test.js`, `test/limits.test.js`, `test/endpoints.test.js`, `test/importers.test.js`, `test/api-client.test.js` | modify | the new behaviour |
| `src/core/api.ts` | modify | a request's own `signal`; `readSchedule`, `aiReads`; `terms`/`codes` |
| `src/core/image.ts`, `src/core/image.test.ts` | create | a screenshot made smaller |
| `src/core/importers/plan.ts` | modify | `Schedule`, `planSchedule`, `Plan.kind`, a course's `term` |
| `src/data/ai-read.ts` | modify (rewrite) | the reading card's steps, Cancel, the reads left, the device cache |
| `src/data/ai-cache.ts`, `src/data/ai-cache.test.ts` | create | answers remembered on this device by file hash |
| `src/data/ai-context.ts` | create | the semesters and course codes sent with a read |
| `src/data/import-edit.ts` | modify | `defaultTerm`, `commitImport` saves `term`, the outline's steps, `back` to the card |
| `src/data/schedule-edit.ts` | create | reading a timetable, `scheduleCount`, `commitSchedule` |
| `src/data/school-edit.ts` | modify | the calendar's steps; the note key |
| `src/data/overlay.ts`, `src/data/types.ts`, `src/data/ui.ts`, `src/data/actions.ts`, `src/data/session.ts` | modify | sheets `ai` and `schedule`; `aiLeft`, `aiNote`, `scheduleBusy`; `openAiImport`; the cache forgotten on sign-out |
| `src/components/overlays.tsx`, `overlays.test.tsx` | modify | the reading card |
| `src/components/sheet/ai-sheet.tsx` | create | the Import with AI card |
| `src/components/sheet/schedule-sheet.tsx` | create | the class schedule preview |
| `src/components/sheet/import-sheet.tsx` | modify | the outline's semester; back to the card |
| `src/components/sheet/sheet.tsx` | modify | the two new sheets |
| `src/components/sheet/ai-import.test.tsx` | create | the card, the schedule preview, reading a timetable |
| `src/components/sheet/settings-sheet.tsx`, `settings-sheet.test.tsx` | modify | reads left in Import; the outline's semester |
| `src/components/top-bar.tsx`, `top-bar.test.tsx` | modify | the Import with AI button |
| `src/data/settings-data.test.ts` | modify | `commitImport` with a semester; `defaultTerm` |

---

# Part A — The class schedule and the Import with AI card

### Task 1: Reads left, and one way to call a model

**Files:**
- Create: `worker/ai.js`, `test/ai.test.js`
- Modify: `worker/outline.js`, `worker/limits.js`, `worker/api.js`
- Modify: `test/limits.test.js`, `test/endpoints.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/ai.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { runModel } from '../worker/ai.js';

describe('runModel', () => {
  it('passes the input through and logs the tokens used', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const reply = { response: 'ok', usage: { prompt_tokens: 1200, completion_tokens: 300 } };
    const ai = { run: vi.fn(async () => reply) };
    expect(await runModel(ai, '@cf/x', { messages: [] }, 'outline')).toBe(reply);
    expect(ai.run).toHaveBeenCalledWith('@cf/x', { messages: [] });
    expect(log).toHaveBeenCalledWith('outline: @cf/x in=1200 out=300');
    log.mockRestore();
  });

  it("answers 429 outline_quota when the account's allowance is spent, and passes other errors on", async () => {
    await expect(runModel({ run: async () => { throw new Error('AiError: 4006: daily free allocation'); } }, '@cf/x', {}))
      .rejects.toMatchObject({ status: 429, body: { error: 'outline_quota' } });
    await expect(runModel({ run: async () => { throw new Error('boom'); } }, '@cf/x', {})).rejects.toThrow('boom');
  });
});
```

In `test/limits.test.js`, add `readsLeft` and `OUTLINE_DAILY_LIMIT` to the import from `../worker/limits.js`, and add at the end:

```js
describe('AI reads left', () => {
  it('counts the reads of the window down, and comes back when it ends', async () => {
    const api = await signIn('reads-left');
    expect(await (await api('/api/ai/reads')).json()).toEqual({ left: OUTLINE_DAILY_LIMIT, limit: OUTLINE_DAILY_LIMIT });
    await env.DB.prepare('INSERT INTO request_limits VALUES (?, ?, ?)').bind('outline:u-reads-left', 3, Date.now() + 60000).run();
    expect(await (await api('/api/ai/reads')).json()).toEqual({ left: OUTLINE_DAILY_LIMIT - 3, limit: OUTLINE_DAILY_LIMIT });
    expect(await readsLeft(env.DB, 'u-reads-left', Date.now() + 61000)).toEqual({ left: OUTLINE_DAILY_LIMIT, limit: OUTLINE_DAILY_LIMIT });
  });
});
```

In `test/endpoints.test.js`, add `['GET', '/api/ai/reads'],` to `protectedRoutes` after `['POST', '/api/session/revoke-all'],`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/ai.test.js test/limits.test.js test/endpoints.test.js`
Expected: FAIL: `worker/ai.js` does not exist; `readsLeft` is not exported; `/api/ai/reads` answers 404.

- [ ] **Step 3: `worker/ai.js`**

```js
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
```

- [ ] **Step 4: The outline through it**

In `worker/outline.js`, add `import { runModel } from './ai.js';` under the `HttpError` import, and replace the `try { … } catch (e) { … }` at the end of `askModel` with:

```js
  const out = await runModel(ai, MODEL, { messages: messages(text), max_tokens: MAX_TOKENS, temperature: 0 }, 'outline');
  return { answer: out?.response ?? out, truncated };
```

(The 4006 test in `test/outline.test.js` keeps passing: the mapping moved into `runModel`.)

- [ ] **Step 5: `readsLeft` and the route**

In `worker/limits.js`, after `limitOutline`, add:

```js
/** The AI reads (outlines, calendars, timetables) left in the person's window: { left, limit }. */
export async function readsLeft(db, userId, now = Date.now()) {
  const row = await db.prepare('SELECT hits, reset_at FROM request_limits WHERE key = ?').bind(`outline:${userId}`).first();
  const used = row && row.reset_at > now ? row.hits : 0;
  return { left: Math.max(0, OUTLINE_DAILY_LIMIT - used), limit: OUTLINE_DAILY_LIMIT };
}
```

In `worker/api.js`, import it (`import { limitLogin, limitOutline, readsLeft } from './limits.js';`) and add to `routes`, after the `/api/school-calendar` line:

```js
  ['GET', /^\/api\/ai\/reads$/, async ({ request, env }) => json(await readsLeft(env.DB, await requireUser(request, env)))],
```

Change the comment above `aiRead` to say "a course outline, a school calendar or a class schedule … All three count toward the same daily reads."

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/ai.test.js test/limits.test.js test/endpoints.test.js test/outline.test.js test/school.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/ai.js worker/outline.js worker/limits.js worker/api.js test/ai.test.js test/limits.test.js test/endpoints.test.js
git commit -m "The Worker says how many AI reads are left today; every model call goes through one place that logs its tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 2: Reading a timetable's text

**Files:**
- Create: `worker/schedule.js`, `test/schedule.test.js`
- Modify: `worker/outline.js`, `test/outline.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/schedule.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { cleanSchedule, readSchedule } from '../worker/schedule.js';
import { MODEL, cleanClasses } from '../worker/outline.js';

const TIMETABLE = 'Fall 2026 timetable. CHEM 271 Organic Chemistry I LEC Tue Thu 08:30-10:00 H-110. CHEM 271 LAB Fri 13:00-16:00 SP-265. PHYS 205 Waves LEC Mon 09:00-10:30 Hall B; TUT Wed 15:00-16:00 Room 2.04.';

/** A stand-in for env.AI that records what it was asked. */
function fakeAi(response) {
  const calls = [];
  return { calls, async run(model, input) { calls.push([model, input]); return { response }; }, async toMarkdown() { throw new Error('not used'); } };
}

const REPLY = {
  term: 'Fall 2026',
  courses: [
    { code: 'chem 271', name: 'Organic Chemistry I', classes: [
      { kind: 'Lecture', day: 'Tue', start: '8:30', end: '10:00', room: 'H-110' },
      { kind: 'Lecture', day: 'Thursday', start: '08:30', end: '10:00', room: 'H-110' },
      { kind: 'Lab', day: 'Fri', start: '1pm', end: '4pm', room: 'SP-265' },
    ] },
    { code: 'PHYS 205', name: 'Waves', classes: [
      { kind: 'Lecture', day: 'Mon', start: '09:00', end: '10:30', room: 'Hall B' },
      { kind: 'Tut', day: 'Wed', start: '15:00', end: '16:00', room: 'Room 2.04' },
    ] },
    { code: '', name: 'Study hall', classes: [] },
    { code: 'X', name: 'Ghost', classes: [{ kind: 'Lecture', day: 'Someday', start: '09:00' }] },
  ],
};

const fail = (raw) => { try { cleanSchedule(raw); } catch (e) { return [e.status, e.body.error]; } return null; };

describe('cleanSchedule', () => {
  it('normalises codes, days, times and kinds, and drops courses with no usable class', () => {
    expect(cleanSchedule(REPLY)).toEqual({
      term: 'Fall 2026',
      courses: [
        { code: 'CHEM271', name: 'Organic Chemistry I', classes: [
          { kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' },
          { kind: 'Lecture', weekday: 4, start: '08:30', end: '10:00', room: 'H-110' },
          { kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' },
        ] },
        { code: 'PHYS205', name: 'Waves', classes: [
          { kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' },
          { kind: 'Tutorial', weekday: 3, start: '15:00', end: '16:00', room: 'Room 2.04' },
        ] },
      ],
    });
  });

  it('answers 502 when there is no JSON or no class at all', () => {
    expect(fail('I cannot read this')).toEqual([502, 'schedule_unreadable']);
    expect(fail({ term: '', courses: [] })).toEqual([502, 'schedule_unreadable']);
    expect(fail({ courses: [{ code: 'A', name: 'B', classes: [] }] })).toEqual([502, 'schedule_unreadable']);
  });

  it('keeps 15 courses and 12 classes a course', () => {
    const many = { courses: Array.from({ length: 20 }, (_, i) => ({ code: 'C' + i, name: 'N', classes: Array.from({ length: 14 }, (_, j) => ({ kind: 'Lecture', day: 'Mon', start: String(8 + (j % 10)).padStart(2, '0') + ':' + (j < 10 ? '00' : '30') })) })) };
    const out = cleanSchedule(many);
    expect(out.courses).toHaveLength(15);
    expect(out.courses[0].classes).toHaveLength(12);
  });
});

describe('the class kinds', () => {
  it('reads the kinds timetables write', () => {
    const kinds = cleanClasses(['LEC', 'Lab', 'Laboratoire', 'TUT', 'TD', 'Seminar', 'PBL', 'Clinical skills', 'Cours', ''].map((kind, i) => ({ kind, day: 'Mon', start: String(8 + i).padStart(2, '0') + ':00' }))).map((c) => c.kind);
    expect(kinds).toEqual(['Lecture', 'Lab', 'Lab', 'Tutorial', 'Tutorial', 'Seminar', 'PBL', 'Clinical', 'Lecture', 'Lecture']);
  });
});

describe('readSchedule, text', () => {
  it("reads a timetable's text with the text model, thinking little, after claiming the read", async () => {
    const ai = fakeAi(REPLY);
    const claims = [];
    const out = await readSchedule(ai, { bytes: new TextEncoder().encode(TIMETABLE), type: 'text/plain', name: 't.pdf', today: '2026-09-01', claim: async () => { claims.push('claim'); } });
    const [model, input] = ai.calls[0];
    expect(model).toBe(MODEL);
    expect(input.reasoning).toEqual({ effort: 'low' });
    expect(input.max_tokens).toBe(3000);
    expect(input.messages[0].content).toContain('"courses"');
    expect(input.messages[1].content).toContain('Today is 2026-09-01.');
    expect(input.messages[1].content).toContain('CHEM 271 Organic Chemistry I');
    expect(claims).toEqual(['claim']);
    expect(out.courses.map((c) => c.code)).toEqual(['CHEM271', 'PHYS205']);
    expect(out).toMatchObject({ term: 'Fall 2026', truncated: false });
  });

  it('claims no read for a file with no text', async () => {
    const claim = vi.fn();
    await expect(readSchedule(fakeAi(REPLY), { bytes: new TextEncoder().encode('short'), type: 'text/plain', today: '2026-09-01', claim })).rejects.toMatchObject({ status: 422 });
    expect(claim).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/schedule.test.js`
Expected: FAIL: `worker/schedule.js` does not exist; `cleanClasses` is not exported.

- [ ] **Step 3: Share the code, kinds and classes in `worker/outline.js`**

Export `KINDS` and `clip` (`export const KINDS = …`, `export const clip = …`). After `cleanTime`, add:

```js
/** A class kind as the app keeps it, from the words timetables and outlines use. */
export function cleanKind(v) {
  const t = String(v || '').trim().toLowerCase();
  const exact = KINDS.find((k) => k.toLowerCase() === t);
  if (exact) return exact;
  if (/\bpbl\b|problem[- ]based/.test(t)) return 'PBL';
  if (/\blab|laborato|practical/.test(t)) return 'Lab';
  if (/tut|^td$|\bdisc/.test(t)) return 'Tutorial';
  if (/semin/.test(t)) return 'Seminar';
  if (/clinic|ward|placement|bedside/.test(t)) return 'Clinical';
  return 'Lecture';
}

/** A course code as the app keeps it: at most 8 characters, "CHEM 271" → CHEM271, "420-521-VA" → 420521VA. */
export function cleanCode(v) {
  let code = clip(v, 24).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (code.length > 8) code = code.replace(/-/g, '');
  return code.slice(0, 8);
}

/** Weekly classes as the model gave them, made safe: a weekday and a start each, an end only after the start, at most `max`. */
export function cleanClasses(list, max = 12) {
  return (Array.isArray(list) ? list : []).map((c) => {
    const start = cleanTime(c?.start), end = cleanTime(c?.end);
    return { kind: cleanKind(c?.kind), weekday: dayIndex(c?.day), start, end: end > start ? end : '', room: clip(c?.room, 40) };
  }).filter((c) => c.weekday >= 0 && c.start).slice(0, max);
}
```

In `cleanOutline`, replace the three lines that build `code` with `const code = cleanCode(o.code);`, and the `const classes = (…).map(…).filter(…).slice(0, 12);` block with `const classes = cleanClasses(o.classes);`. (`dayIndex` is defined above `clip`; keep the order so `cleanClasses` can use both.)

Give `askModel` options, so a reader can ask for less thinking or a smaller answer:

```js
export async function askModel(ai, { bytes, type, name, claim }, messages, { effort, maxTokens = MAX_TOKENS, what = 'outline' } = {}) {
  let text = (await outlineText(ai, bytes, type, name)).trim();
  if (text.length < 40) throw new HttpError(422, { error: 'outline_empty' });
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);
  if (claim) await claim();
  const out = await runModel(ai, MODEL, { messages: messages(text), max_tokens: maxTokens, temperature: 0, ...(effort ? { reasoning: { effort } } : {}) }, what);
  return { answer: out?.response ?? out, truncated };
}
```

In `test/outline.test.js`, in "converts a PDF with toMarkdown…", add `expect(input.reasoning).toBeUndefined();` under the `response_format` line (outlines keep the model's default thinking).

- [ ] **Step 4: `worker/schedule.js`**

```js
// Read a class schedule (the weekly timetable from a student portal) with Workers AI: each
// course and its lectures, labs and tutorials. Nothing is saved here; the browser shows the
// courses in the schedule preview and saves what the person ticks.
//
// A PDF arrives as text (read in the browser, like outlines) and goes to the text model,
// thinking little: a timetable needs reading, not reasoning. About 110 neurons a page.
// A screenshot arrives as a JPEG or PNG made smaller in the browser and goes to the vision
// model (Task 3). Both count against the same daily reads as outlines (limitOutline).

import { HttpError } from './http.js';
import { DAYS, KINDS, askModel, cleanClasses, cleanCode, clip, modelJson } from './outline.js';

const MAX_COURSES = 15;
const TEXT_TOKENS = 3000;

const SCHEMA = {
  type: 'object',
  properties: {
    term: { type: 'string' },
    courses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          name: { type: 'string' },
          classes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: KINDS },
                day: { type: 'string', enum: DAYS },
                start: { type: 'string' },
                end: { type: 'string' },
                room: { type: 'string' },
              },
              required: ['kind', 'day', 'start'],
            },
          },
        },
        required: ['code', 'name', 'classes'],
      },
    },
  },
  required: ['term', 'courses'],
};

/* What both paths are told. */
const RULES = [
  "You read a student's class schedule (a weekly timetable) and answer only with JSON matching the schema.",
  'term: the semester the timetable is for, e.g. "Fall 2026", or "" if it does not say.',
  'courses: one entry per course. code: the course code exactly as written, e.g. "CHEM 271" or "420-521-VA" ("" if there is none). name: the course title.',
  'classes: every weekly meeting of that course, one entry per weekday: kind (Lecture, Lab, Seminar, Tutorial, PBL or Clinical; "LEC" and "Cours" are Lecture, "LAB" is Lab, "TUT" and "TD" are Tutorial), day, start and end in 24-hour HH:MM, room as written ("" if none).',
  'A class that meets on Tuesday and Thursday is two entries. In a grid, a class runs from the row of its start time to the row of its end time.',
  'Leave out exams, office hours, breaks and anything that is not a weekly class. Never invent courses, times or rooms.',
];

function textPrompt(text, today) {
  return [
    { role: 'system', content: [...RULES, 'Answer with one JSON object, no other text, using exactly this JSON Schema: ' + JSON.stringify(SCHEMA)].join(' ') },
    { role: 'user', content: 'Today is ' + today + '.\n\nTimetable:\n\n' + text },
  ];
}

/** Whatever the model returned, made safe: {term, courses}. 502 when there is no class at all. */
export function cleanSchedule(raw) {
  const o = modelJson(raw);
  if (!o) throw new HttpError(502, { error: 'schedule_unreadable' });
  const courses = (Array.isArray(o.courses) ? o.courses : [])
    .map((c) => ({ code: cleanCode(c?.code), name: clip(c?.name, 80), classes: cleanClasses(c?.classes) }))
    .filter((c) => (c.code || c.name) && c.classes.length)
    .slice(0, MAX_COURSES);
  if (!courses.length) throw new HttpError(502, { error: 'schedule_unreadable' });
  return { term: clip(o.term, 40), courses };
}

export async function readSchedule(ai, { today, ...doc }) {
  const { answer, truncated } = await askModel(ai, doc, (text) => textPrompt(text, today), { effort: 'low', maxTokens: TEXT_TOKENS, what: 'schedule' });
  return { ...cleanSchedule(answer), truncated };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/schedule.test.js test/outline.test.js test/school.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/schedule.js worker/outline.js test/schedule.test.js test/outline.test.js
git commit -m "The Worker reads a timetable's text into courses and their weekly classes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 3: Reading a screenshot, and the route

**Files:**
- Modify: `worker/schedule.js`, `worker/api.js`
- Modify: `test/schedule.test.js`, `test/endpoints.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/schedule.test.js`, add to the imports: `import { SELF, env } from 'cloudflare:test';`, `import { signIn, BASE } from './helpers.js';`, `import { OUTLINE_DAILY_LIMIT } from '../worker/limits.js';`, and `VISION_MODEL, MAX_IMAGE_BYTES, toBase64` from `../worker/schedule.js`. Add:

```js
describe('readSchedule, a screenshot', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]);

  it('goes to the vision model as a data URI, in JSON mode, after claiming the read', async () => {
    const ai = fakeAi(REPLY);   /* in JSON mode the model answers an object */
    const claims = [];
    const out = await readSchedule(ai, { bytes: jpeg, type: 'image/jpeg', name: 'shot.jpg', today: '2026-09-01', claim: async () => { claims.push('claim'); } });
    const [model, input] = ai.calls[0];
    expect(model).toBe(VISION_MODEL);
    expect(input.messages[0]).toMatchObject({ role: 'system' });
    expect(input.messages[0].content).toContain('class schedule');
    const [text, image] = input.messages[1].content;
    expect(text).toMatchObject({ type: 'text' });
    expect(text.text).toContain('Today is 2026-09-01.');
    expect(image.type).toBe('image_url');
    expect(image.image_url.url.startsWith('data:image/jpeg;base64,/9j/4')).toBe(true);
    expect(input.response_format).toEqual({ type: 'json_schema', json_schema: expect.objectContaining({ type: 'object' }) });
    expect(input.max_tokens).toBe(2000);
    expect(claims).toEqual(['claim']);
    expect(out).toMatchObject({ term: 'Fall 2026', truncated: false });
    expect(out.courses).toHaveLength(2);
  });

  it('reads an answer that came back as JSON text too', async () => {
    const out = await readSchedule(fakeAi(JSON.stringify(REPLY)), { bytes: jpeg, type: 'image/png', today: '2026-09-01' });
    expect(out.courses[0].code).toBe('CHEM271');
  });

  it('refuses other pictures and big ones before claiming a read', async () => {
    const claim = vi.fn();
    await expect(readSchedule(fakeAi(REPLY), { bytes: jpeg, type: 'image/gif', today: '2026-09-01', claim }))
      .rejects.toMatchObject({ status: 415, body: { error: 'image_unsupported' } });
    await expect(readSchedule(fakeAi(REPLY), { bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), type: 'image/png', today: '2026-09-01', claim }))
      .rejects.toMatchObject({ status: 413, body: { error: 'too_large' } });
    expect(claim).not.toHaveBeenCalled();
  });

  it('writes base64 in chunks', () => {
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    const back = atob(toBase64(big));
    expect(back.length).toBe(100_000);
    expect(back.charCodeAt(99_999)).toBe(99_999 % 256);
  });
});

describe('POST /api/ai/schedule', () => {
  it('needs a session', async () => {
    const res = await SELF.fetch(`${BASE}/api/ai/schedule`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: TIMETABLE });
    expect(res.status).toBe(401);
  });

  it('refuses a picture it cannot read, and shares the daily reads with outlines', async () => {
    const call = await signIn('schedule-route');
    const gif = await call('/api/ai/schedule?name=a.gif', { method: 'POST', headers: { 'content-type': 'image/gif' }, body: 'GIF89a' });
    expect(gif.status).toBe(415);
    await env.DB.prepare('INSERT OR REPLACE INTO request_limits (key, hits, reset_at) VALUES (?, ?, ?)')
      .bind('outline:u-schedule-route', OUTLINE_DAILY_LIMIT, Date.now() + 3_600_000).run();
    const over = await call('/api/ai/schedule?name=t.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: TIMETABLE });
    expect(over.status).toBe(429);
    expect((await over.json()).error).toBe('outline_limit');
  });

  it('answers 503 when Workers AI is out of reach', async () => {
    const call = await signIn();
    const res = await call('/api/ai/schedule?name=t.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: TIMETABLE });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'outline_unavailable' });
  });
});
```

In `test/endpoints.test.js`, add `['POST', '/api/ai/schedule'],` to `protectedRoutes` after the `/api/ai/reads` line.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/schedule.test.js test/endpoints.test.js`
Expected: FAIL: `VISION_MODEL` is not exported; the route answers 404.

- [ ] **Step 3: The vision path**

In `worker/schedule.js`, add `import { runModel } from './ai.js';` and under `TEXT_TOKENS`:

```js
// A screenshot goes to Llama 4 Scout: it reads images given as data URIs (never URLs) and
// answers in JSON mode. About 110 neurons for a 1600 px screenshot: ~1,900 image tokens and
// ~600 prompt tokens in at 24,545 neurons/M, ~600 out at 77,273/M. Measured in Task 13.
export const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg)$/i;
const VISION_TOKENS = 2000;    /* its default is 256: too few for a timetable */

/** Bytes as base64, in chunks: String.fromCharCode(...bytes) overflows the stack on a large picture. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function askImage(ai, { bytes, type, claim }, today) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, { error: 'too_large' });
  if (claim) await claim();
  const out = await runModel(ai, VISION_MODEL, {
    messages: [
      { role: 'system', content: RULES.join(' ') },
      { role: 'user', content: [
        { type: 'text', text: 'Today is ' + today + '. Read this timetable.' },
        { type: 'image_url', image_url: { url: 'data:' + type.toLowerCase() + ';base64,' + toBase64(bytes) } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: VISION_TOKENS,
    temperature: 0,
  }, 'schedule');
  return out?.response ?? out;
}
```

Replace `readSchedule` with:

```js
export async function readSchedule(ai, { today, ...doc }) {
  if (/^image\//i.test(doc.type || '')) {
    /* toMarkdown would describe other pictures with a model of its own: refuse them here */
    if (!IMAGE_TYPES.test(doc.type)) throw new HttpError(415, { error: 'image_unsupported' });
    return { ...cleanSchedule(await askImage(ai, doc, today)), truncated: false };
  }
  const { answer, truncated } = await askModel(ai, doc, (text) => textPrompt(text, today), { effort: 'low', maxTokens: TEXT_TOKENS, what: 'schedule' });
  return { ...cleanSchedule(answer), truncated };
}
```

- [ ] **Step 4: The route**

In `worker/api.js`, add `import { readSchedule } from './schedule.js';` and to `routes`, after the `/api/school-calendar` line:

```js
  ['POST', /^\/api\/ai\/schedule$/, aiRead(readSchedule, 'schedule')],
```

(`aiRead` already reads at most 5 MB, passes the content type, claims through `limitOutline` and turns anything that is not an `HttpError` into 503 `outline_unavailable`.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/schedule.test.js test/endpoints.test.js test/outline.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/schedule.js worker/api.js test/schedule.test.js test/endpoints.test.js
git commit -m "POST /api/ai/schedule reads a timetable: its text with the text model, a screenshot with Llama 4 Scout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 4: The browser's side: a request that can be stopped, a smaller picture, the schedule's plan

**Files:**
- Modify: `src/core/api.ts`, `test/api-client.test.js`
- Create: `src/core/image.ts`, `src/core/image.test.ts`
- Modify: `src/core/importers/plan.ts`, `test/importers.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/api-client.test.js`, add inside `describe('browser API response contracts', …)`:

```js
  it('stops an AI read when its own signal is aborted, and sends a picture as it is', async () => {
    let seen;
    vi.stubGlobal('fetch', vi.fn((path, init) => {
      seen = { path, init };
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    }));
    const stop = new AbortController();
    const read = client.api.readSchedule(new Blob(['x'], { type: 'image/jpeg' }), { name: 't.png', today: '2026-10-01' }, stop.signal);
    stop.abort(new DOMException('Stopped', 'AbortError'));
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen.path).toBe('/api/ai/schedule?name=t.png&today=2026-10-01');
    expect(seen.init.headers['content-type']).toBe('image/jpeg');
  });

  it('asks how many AI reads are left', async () => {
    respond({ left: 7, limit: 10 });
    expect(await client.api.aiReads()).toEqual({ left: 7, limit: 10 });
    expect(fetch.mock.calls[0][0]).toBe('/api/ai/reads');
  });
```

Create `src/core/image.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { fitSize, shrinkImage, MAX_EDGE } from "./image"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("a screenshot made smaller", () => {
    it("keeps a small picture's size and scales a big one to 1600 px on its long side", () => {
        expect(MAX_EDGE).toBe(1600)
        expect(fitSize(1200, 800)).toEqual({ w: 1200, h: 800 })
        expect(fitSize(3200, 2000)).toEqual({ w: 1600, h: 1000 })
        expect(fitSize(1000, 4000)).toEqual({ w: 400, h: 1600 })
    })

    it("draws it on white as a JPEG", async () => {
        const close = vi.fn()
        vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 3200, height: 2000, close })))
        const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never)
        const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb, type) {
            cb(new Blob(["j"], { type: type as string }))
        })
        const out = await shrinkImage(new File(["png"], "t.png", { type: "image/png" }))
        expect(out.type).toBe("image/jpeg")
        expect(toBlob.mock.calls[0][1]).toBe("image/jpeg")
        expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1000)
        expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1000)
        expect(close).toHaveBeenCalled()
    })

    it("says so when the browser cannot open it", async () => {
        vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new DOMException("bad", "InvalidStateError") }))
        await expect(shrinkImage(new File(["x"], "t.heic", { type: "image/heic" })))
            .rejects.toMatchObject({ name: "FileError", message: "That picture could not be opened. Use a PNG or JPG screenshot." })
    })
})
```

In `test/importers.test.js`, add `planSchedule` to the import from `../src/core/importers/plan.ts`, and add at the end:

```js
describe('planSchedule', () => {
  const read = { term: 'Fall 2026', courses: [
    { code: 'CHEM271', name: 'Organic Chemistry I', classes: [
      { kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' },
      { kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' },
    ] },
    { code: '', name: 'Waves', classes: [{ kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' }] },
    { code: 'BIOL266', name: 'Cell Biology', classes: [{ kind: 'Tutorial', weekday: 3, start: '15:00', end: '16:00', room: '' }] },
  ] };
  const data = () => ({ items: [], courses: [
    { id: 'c1', code: 'CHEM271', name: 'Organic Chem', color: '#E4749B', term: 'Winter 2027', meetings: [{ id: 'm0', kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00', room: 'H-110' }] },
    { id: 'c2', code: 'PHYS205', name: 'waves ', color: '#4F74D9', term: '', meetings: [] },
  ] });

  it('matches courses by code, then by name, and proposes the rest with the semester given', () => {
    const plan = planSchedule(read, data(), 'Fall 2026');
    expect(plan.kind).toBe('schedule');
    expect(plan.courses.map((c) => [c.id === 'c1' || c.id === 'c2' ? c.id : 'new', c.code, c.isNew, c.term]))
      .toEqual([['c1', 'CHEM271', false, 'Winter 2027'], ['c2', 'PHYS205', false, ''], ['new', 'BIOL266', true, 'Fall 2026']]);
    expect(plan.courses[2].name).toBe('Cell Biology');
    expect(plan.items).toEqual([]);
  });

  it('leaves out the classes a course already has and ticks the rest', () => {
    const chem = planSchedule(read, data(), '').courses[0];
    expect(chem.meetings.map((m) => [m.kind, m.weekday, m.start, m.room, m.include])).toEqual([['Lab', 5, '13:00', 'SP-265', true]]);
  });

  it('still lists a course whose classes are all there, so its semester can be set', () => {
    const d = data();
    d.courses[0].meetings.push({ id: 'm1', kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' });
    const plan = planSchedule({ term: '', courses: [read.courses[0]] }, d, '');
    expect(plan.courses.map((c) => [c.id, c.meetings.length])).toEqual([['c1', 0]]);
  });

  it('keeps a course to 12 classes and says what was dropped', () => {
    const classes = Array.from({ length: 13 }, (_, i) => ({ kind: 'Lecture', weekday: 1 + (i % 5), start: String(8 + Math.floor(i / 5)).padStart(2, '0') + ':00', end: '', room: '' }));
    const plan = planSchedule({ term: '', courses: [{ code: 'MANY', name: 'Many', classes }] }, { items: [], courses: [] }, '');
    expect(plan.courses[0].meetings).toHaveLength(12);
    expect(plan.notes.join(' ')).toContain('already has 12 classes');
  });
});
```

Add to `describe('planOutline', …)`:

```js
  it('marks the plan as an outline and keeps an existing course's semester', () => {
    const plan = planOutline(outline, { courses: [{ id: 'c1', code: 'PHARM101', name: 'Pharm', color: '#E4749B', term: 'Fall 2026', meetings: [] }], items: [] });
    expect(plan.kind).toBe('outline');
    expect(plan.courses[0].term).toBe('Fall 2026');
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/api-client.test.js test/importers.test.js src/core/image.test.ts`
Expected: FAIL: `api.readSchedule`, `api.aiReads`, `planSchedule` and `src/core/image.ts` do not exist.

- [ ] **Step 3: A request with its own signal (`src/core/api.ts`)**

Change `request` and `send` to take a signal of the caller's, beside the session's:

```ts
export function request(method: string, path: string, body?: unknown, headers?: Record<string, string>, signal?: AbortSignal) {
  /* Account operations and the local connection check remain available during an API cooldown. */
  if (path.startsWith('/api/spotify/') && !['/api/spotify/token', '/api/spotify/status'].includes(path)) return spotifyRequest(method, path, body);
  return send(method, path, body, headers, signal);
}
```

In `send`, add the parameter `outer?: AbortSignal` after `extraHeaders`, and wire it like the session's signal:

```ts
  const abort = () => controller.abort(session.reason);
  /* the caller's own signal: Cancel on the reading card */
  const stop = () => controller.abort(outer!.reason);
  session.addEventListener('abort', abort, { once: true });
  outer?.addEventListener('abort', stop, { once: true });
```

then `outer?.throwIfAborted();` after `session.throwIfAborted();` at the top of the `try`, and `outer?.removeEventListener('abort', stop);` in the `finally`.

In `api`, give the AI reads the signal and add the two new calls (replace the `readOutline` and `readSchool` lines):

```ts
  readOutline: (file: Blob, { name, today, termStart }: { name: string; today: string; termStart?: string }, signal?: AbortSignal) =>
    request('POST', '/api/outline?' + new URLSearchParams({ name, today, ...(termStart ? { termStart } : {}) }), file, undefined, signal),
  readSchool: (file: Blob, { name, today }: { name: string; today: string }, signal?: AbortSignal) =>
    request('POST', '/api/school-calendar?' + new URLSearchParams({ name, today }), file, undefined, signal),
  readSchedule: (file: Blob, { name, today }: { name: string; today: string }, signal?: AbortSignal) =>
    request('POST', '/api/ai/schedule?' + new URLSearchParams({ name, today }), file, undefined, signal),
  aiReads: (): Promise<{ left: number; limit: number }> => request('GET', '/api/ai/reads'),
```

- [ ] **Step 4: `src/core/image.ts`**

```ts
// A screenshot made small enough to send: at most 1600 px on its long side, as a JPEG on
// white. A timetable stays readable at that size, and the vision model's cost grows with the
// picture (worker/schedule.js). Nothing here touches the network or the page.

export const MAX_EDGE = 1600

/** The size to draw at: the same, or scaled down so that the long side is `max`. */
export function fitSize(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
    const k = Math.min(1, max / Math.max(w, h))
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

const fileError = () => Object.assign(new Error("That picture could not be opened. Use a PNG or JPG screenshot."), { name: "FileError" })

/** The picture as a JPEG of at most MAX_EDGE px. A FileError when the browser cannot open it (HEIC, a damaged file). */
export async function shrinkImage(file: Blob): Promise<Blob> {
    let bmp: ImageBitmap
    try { bmp = await createImageBitmap(file) } catch { throw fileError() }
    try {
        const { w, h } = fitSize(bmp.width, bmp.height)
        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) throw fileError()
        /* a PNG's transparent parts would turn black in a JPEG */
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(bmp, 0, 0, w, h)
        const out = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85))
        if (!out) throw fileError()
        return out
    } finally {
        bmp.close()
    }
}
```

- [ ] **Step 5: `planSchedule` (`src/core/importers/plan.ts`)**

Add `kind` to `Plan` and a `term` to what the plan is checked against:

```ts
export interface PlanData { courses?: (Pick<Course, 'id' | 'code' | 'name' | 'color' | 'meetings'> & { term?: string })[]; items?: Pick<Item, 'type' | 'title' | 'date' | 'start' | 'courseId' | 'recur' | 'weekday'>[] }
```

```ts
export interface Plan { courses: PlanCourse[]; items: PlanItem[]; notes: string[]; week1?: string; termStart?: string; kind?: 'outline' | 'schedule' }
```

In `PlanCourse`, replace the comment `/* a new course from an outline */` with `/* a new course from an outline: its teacher and whether to keep it with nothing ticked; term: the semester to save (a new course's, or the one picked for a course that exists; undefined leaves it as it is) */`.

Under the `Outline` interface add:

```ts
/** A class schedule as the Worker reads it (worker/schedule.js). */
export interface Schedule {
  term?: string; truncated?: boolean;
  courses: { code: string; name: string; classes: { kind: string; weekday: number; start: string; end: string; room: string }[] }[];
}
```

In `planOutline`, after `if (pc.isNew) { … }` add:

```ts
  else pc.term = (data.courses || []).find((c) => c.id === pc!.id)?.term ?? '';
```

and before `return plan;` add `plan.kind = 'outline';`.

At the end of the file add:

```ts
/**
 * A class schedule read by the Worker → the plan: each course read matched to one of yours
 * by code, else by name ("Matches your course"), or proposed ("New course"); its classes as
 * meetings, ticked. planImport leaves out the classes a course already has and keeps a course
 * to 12. Every course found is listed, even when all its classes are there, so that its
 * semester can still be set: one that exists keeps its own `term`, a new one gets `term`.
 */
export function planSchedule(s: Schedule, data: PlanData, term = ''): Plan {
  const existing = data.courses || [];
  const norm = (t: unknown) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const rows: ImportRow[] = [];
  const matched: string[] = [];
  for (const c of s.courses) {
    const given = String(c.code || '').toUpperCase();
    const live = existing.find((x) => given && x.code.toUpperCase() === given) || existing.find((x) => c.name && norm(x.name) === norm(c.name));
    if (live) matched.push(live.id);
    const code = (live ? live.code : given || String(c.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'NEW').toUpperCase().slice(0, 8);
    for (const k of c.classes) {
      rows.push({ type: 'class', kind: k.kind, weekday: k.weekday, course: code, courseName: live ? live.name : (c.name || code), title: k.kind, date: '', start: k.start, end: k.end, room: k.room, weight: null });
    }
  }
  const plan = planImport(rows, data, 'csv');
  for (const id of matched) {
    if (plan.courses.some((c) => c.id === id)) continue;
    const live = existing.find((x) => x.id === id)!;
    plan.courses.push({ id: live.id, code: live.code, name: live.name, color: live.color, isNew: false, meetings: [] });
  }
  for (const pc of plan.courses) pc.term = pc.isNew ? term : (existing.find((x) => x.id === pc.id)?.term ?? '');
  if (s.truncated) plan.notes.push('The timetable was long, so only the first part was read. Check the last courses by hand.');
  plan.kind = 'schedule';
  return plan;
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run test/api-client.test.js test/importers.test.js src/core/image.test.ts`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors (callers of `api.readOutline` and `api.readSchool` still pass two arguments).

- [ ] **Step 7: Commit**

```bash
git add src/core/api.ts src/core/image.ts src/core/image.test.ts src/core/importers/plan.ts test/api-client.test.js test/importers.test.js
git commit -m "The browser can stop an AI read, makes a screenshot smaller, and plans a timetable's classes against your courses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---
### Task 5: The reading card: three steps, Cancel, and the reads left

**Files:**
- Modify (rewrite): `src/data/ai-read.ts`
- Modify: `src/components/overlays.tsx`, `src/components/overlays.test.tsx`
- Modify: `src/data/types.ts`, `src/data/ui.ts`
- Modify: `src/data/import-edit.ts`, `src/data/school-edit.ts` (their reads get a title and steps)

- [ ] **Step 1: Write the failing tests**

In `src/components/overlays.test.tsx`, make the fakes carry the reads left and the API's call:

```ts
const fake = vi.hoisted(() => {
    class ApiError extends Error {
        status: number; body: unknown
        constructor(status: number, body: unknown) { super("HTTP " + status); this.status = status; this.body = body }
    }
    return { ApiError, ui: { importNote: null as unknown, outlineBusy: false, aiLeft: null as number | null }, api: { aiReads: vi.fn(async () => ({ left: 7, limit: 10 })) } }
})
vi.mock("@/core/api", () => ({ ApiError: fake.ApiError, api: fake.api }))
```

Add `within` to the `@testing-library/react` import, and replace the whole `describe("the busy card", …)` with:

```tsx
describe("the reading card", () => {
    const STEPS = ["Reading the document", "Finding dates and deadlines", "Matching it to your courses"] as const
    const file = (name = "outline.docx") => new File(["x"], name, { type: "application/octet-stream" })
    const read = (call: (body: Blob, signal: AbortSignal) => Promise<unknown>, done = vi.fn(), refresh = vi.fn(), prepare?: (f: File) => Promise<Blob>) =>
        readWithAi(file(), { what: "outline", title: "Reading your course outline", steps: STEPS, flag: "outlineBusy", note: "importNote", errors: {}, prepare, call, done, refresh })
    const step = (card: HTMLElement, label: string) => within(card).getByText(label).closest("li")!

    it("ticks the steps off, counts the seconds, gives focus back to the sheet, and asks the reads left", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
        let answer!: (v: unknown) => void
        const done = vi.fn()
        act(() => openSheet({ kind: "course", id: null }))   /* the file was picked in the sheet */
        document.getElementById("panel")!.focus()
        let reading!: Promise<void>
        await act(async () => { reading = read(() => new Promise((r) => { answer = r }), done) })

        const card = screen.getByRole("alertdialog", { name: "Reading your course outline" })
        expect(card.textContent).toContain("outline.docx")
        expect(step(card, "Reading the document").textContent).toContain("(done)")
        expect(step(card, "Finding dates and deadlines").getAttribute("aria-current")).toBe("step")
        expect(step(card, "Matching it to your courses").getAttribute("aria-current")).toBeNull()
        expect(card.textContent).toContain("Usually under half a minute")
        expect(fake.ui.outlineBusy).toBe(true)
        expect(app().hasAttribute("inert")).toBe(true)
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(true)
        expect(document.activeElement).toBe(card)
        act(() => { vi.advanceTimersByTime(3000) })
        expect(card.textContent).toContain("3s")

        await act(async () => { answer({ ok: 1 }); await reading })
        expect(done).toHaveBeenCalledWith({ ok: 1 })
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(fake.ui.outlineBusy).toBe(false)
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(false)
        expect(document.activeElement?.id).toBe("panel")
        expect(fake.api.aiReads).toHaveBeenCalled()
        expect(fake.ui.aiLeft).toBe(7)
        act(() => closeSheet())
    })

    it("stops on Cancel: the request is aborted, nothing opens, and it says so", async () => {
        let seen!: AbortSignal
        const done = vi.fn()
        let reading!: Promise<void>
        await act(async () => {
            reading = read((_, signal) => new Promise((_, reject) => { seen = signal; signal.addEventListener("abort", () => reject(signal.reason)) }), done)
        })
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
        await act(async () => { await reading })
        expect(seen.aborted).toBe(true)
        expect(done).not.toHaveBeenCalled()
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(fake.ui.importNote).toEqual({ text: "Stopped reading.", error: false })
    })

    it("stops on Escape too", async () => {
        let reading!: Promise<void>
        await act(async () => {
            reading = read((_, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))))
        })
        fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
        await act(async () => { await reading })
        expect(fake.ui.importNote).toEqual({ text: "Stopped reading.", error: false })
    })

    it("puts what went wrong in the note", async () => {
        const refresh = vi.fn()
        await act(() => read(async () => { throw new fake.ApiError(429, { error: "outline_limit" }) }, vi.fn(), refresh))
        expect(fake.ui.importNote).toEqual({ text: "That is the limit of 10 AI reads for today (outlines, timetables and calendars). Try again tomorrow.", error: true })
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(refresh).toHaveBeenCalled()

        await act(() => read(async () => { throw new TypeError("Failed to fetch") }))
        expect(fake.ui.importNote).toEqual({ text: "You seem to be offline. Reading outlines needs a connection.", error: true })

        await act(() => read(vi.fn(), vi.fn(), vi.fn(), async () => { throw new Error("locked") }))
        expect(fake.ui.importNote).toEqual({ text: "That file could not be opened. Is it a damaged or locked PDF?", error: true })

        await act(() => read(vi.fn(), vi.fn(), vi.fn(), async () => { throw Object.assign(new Error("That picture could not be opened. Use a PNG or JPG screenshot."), { name: "FileError" }) }))
        expect(fake.ui.importNote).toEqual({ text: "That picture could not be opened. Use a PNG or JPG screenshot.", error: true })

        await act(() => readWithAi(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf"), {
            what: "outline", title: "", steps: STEPS, flag: "outlineBusy", note: "importNote", errors: {}, call: vi.fn(), done: vi.fn(), refresh: vi.fn(),
        }))
        expect(fake.ui.importNote).toEqual({ text: "That file is over 5 MB.", error: true })
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/overlays.test.tsx`
Expected: FAIL: there are no steps and no Cancel, and `readWithAi` takes no `steps`.

- [ ] **Step 3: The UI state**

In `src/data/types.ts`, in `Ui`, after `schoolBusy: boolean` add:

```ts
    /* a class schedule is being read */
    scheduleBusy: boolean
    /* the AI reads left today, as the Worker last said; null until asked */
    aiLeft: number | null
    /* what the Import with AI card has to say: a read stopped or gone wrong */
    aiNote: Note | null
```

In `src/data/ui.ts`, after `schoolAsk: false,` add:

```ts
    scheduleBusy: false,     /* a class schedule is being read */
    aiLeft: null,            /* the AI reads left today, as the Worker last said */
    aiNote: null,            /* the Import with AI card's last word */
```

- [ ] **Step 4: `src/data/ai-read.ts`**

Replace the file with:

```ts
// Reading a file with AI — a course outline, a school calendar, a class schedule — behind the
// reading card: three steps that tick off as they happen (the file made ready here, the AI's
// read, the match with your courses), and Cancel, which aborts the request. <Overlays> draws
// the card from useBusy(); while it is up, cover() keeps everything else inert.

import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { api, ApiError } from "@/core/api"
import { pdfText } from "@/core/pdftext"
import { notify } from "@/bridge"
import { cover } from "./overlay"
import { ui } from "./ui"
import type { Note, Ui } from "./types"

export interface Busy { title: string; file: string; steps: readonly string[]; step: number; started: number; cancel: () => void }

let busy: Busy | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }

export const getBusy = () => busy
export const useBusy = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, getBusy)

function showBusy(next: Omit<Busy, "started">) {
    if (!busy) cover(true)
    busy = { ...next, started: busy?.started ?? Date.now() }
    emit()
}

function hideBusy() {
    if (!busy) return
    /* the card held the keyboard: it goes back to the sheet the file was picked in */
    const had = !!document.getElementById("overlays")?.contains(document.activeElement)
    /* drawn now, so the sheet is no longer inert when focus goes back to it */
    flushSync(() => {
        busy = null
        cover(false)
        emit()
    })
    if (had) document.querySelector<HTMLElement>("#sheet [role=dialog]")?.focus({ preventScroll: true })
}

/* The Worker's answers shared by every read. */
const AI_ERRORS: Record<string, string> = {
    outline_unsupported: "That kind of file cannot be read. Try a PDF or Word document.",
    outline_unavailable: "The reader is not available right now. Try again later.",
    outline_limit: "That is the limit of 10 AI reads for today (outlines, timetables and calendars). Try again tomorrow.",
    outline_quota: "The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).",
    too_large: "That file is over 5 MB.",
}

type Flag = "outlineBusy" | "schoolBusy" | "scheduleBusy"
export type NoteKey = "importNote" | "schoolNote" | "aiNote"

export const MAX_FILE = 5 * 1024 * 1024
export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)

/** What most files are sent as: a PDF's text (the Worker's converter drops the text of many tables), anything else as it is. */
export const asSent = async (file: File): Promise<Blob> => (isPdf(file) ? new Blob([await pdfText(file)], { type: "text/plain" }) : file)

export interface AiRead<T> {
    /** "outline", "calendar" or "timetable", for the fallback messages */
    what: string
    /** the card's title: "Reading your course outline" */
    title: string
    /** the card's three steps: the file made ready, the AI's read, the match */
    steps: readonly [string, string, string]
    flag: Flag
    note: NoteKey
    /** messages by the API's error code, before the shared ones */
    errors: Record<string, string>
    /** the file as it is sent; asSent unless given */
    prepare?: (file: File) => Promise<Blob>
    /** the largest file taken, before `prepare`; 5 MB unless given (a screenshot may be bigger: it is made smaller) */
    maxBytes?: number
    call: (body: Blob, signal: AbortSignal) => Promise<T>
    done: (answer: T) => void
    refresh: () => void
}

/** The reads left today, as the Worker counts them, into ui.aiLeft. Offline it keeps what it knew. */
export async function refreshReads() {
    try {
        const r = await api.aiReads()
        ui.aiLeft = Number.isInteger(r?.left) ? r.left : null
        notify()
    } catch { /* offline or signed out */ }
}

/**
 * Read a file with AI behind the reading card. `prepare` makes the file ready (a PDF's text,
 * a smaller picture), `call(body, signal)` asks the Worker, and the answer goes to `done`.
 * While it runs ui[flag] is true; Cancel aborts the request; a problem goes in ui[note].
 */
export async function readWithAi<T>(file: File, { what, title, steps, flag, note, errors, prepare = asSent, maxBytes = MAX_FILE, call, done, refresh }: AiRead<T>) {
    const u = ui as Ui & Record<NoteKey, Note | null> & Record<Flag, boolean>
    if (file.size > maxBytes) { u[note] = { text: "That file is over " + Math.round(maxBytes / 1048576) + " MB.", error: true }; refresh(); return }
    const stop = new AbortController()
    const show = (step: number) => showBusy({ title, file: file.name, steps, step, cancel: () => stop.abort(new DOMException("Stopped reading", "AbortError")) })
    u[flag] = true; u[note] = null; refresh()
    try {
        show(0)
        let body: Blob
        try { body = await prepare(file) } catch (e) {
            const own = (e as Error)?.name === "FileError"
            throw Object.assign(new Error(own ? (e as Error).message : "That file could not be opened. Is it a damaged or locked PDF?"), { name: "FileError" })
        }
        stop.signal.throwIfAborted()
        show(1)
        const answer = await call(body, stop.signal)
        stop.signal.throwIfAborted()
        show(2)
        u[flag] = false; hideBusy()
        done(answer)
    } catch (err) {
        u[flag] = false; hideBusy()
        const failed = err instanceof ApiError ? err as ApiError & { body?: { error?: string }; status: number } : null
        const code = failed?.body?.error ?? ""
        u[note] = stop.signal.aborted ? { text: "Stopped reading.", error: false }
            : (err as Error)?.name === "FileError" ? { text: (err as Error).message, error: true }
            : {
                text: errors[code] || AI_ERRORS[code] || (failed
                    ? "The " + what + " could not be read (" + (code || failed.status) + ")."
                    : "You seem to be offline. Reading " + what + "s needs a connection."),
                error: true,
            }
        refresh()
    }
    await refreshReads()
}
```

- [ ] **Step 5: The card (`src/components/overlays.tsx`)**

Add `Button` to the import from `@/components/sheet/fields`, change "the busy card" in the file's opening comment to "the reading card", and replace `BusyCard` with:

```tsx
function BusyCard({ busy }: { busy: Busy }) {
    const card = useRef<HTMLDivElement>(null)
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(t)
    }, [])
    useEffect(() => { if (!card.current?.contains(document.activeElement)) card.current?.focus() }, [busy])
    const s = Math.floor((now - busy.started) / 1000)
    const pct = Math.round(((busy.step + 1) / (busy.steps.length + 0.3)) * 100)
    return (
        <div className={cn(BACKDROP, "z-[65]")}>
            <div
                ref={card}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="busyTitle"
                aria-describedby="busyNote"
                tabIndex={-1}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); busy.cancel() } }}
                className={cn(CARD, "flex max-w-[420px] flex-col gap-4 p-6 max-[420px]:p-5")}
            >
                <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="size-9 flex-none animate-spin rounded-full border-[3px] border-[var(--accent-soft)] border-t-[var(--accent)] [animation-duration:1s] motion-reduce:animate-none" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                        <h3 id="busyTitle" className="m-0 font-serif text-[20px] leading-tight font-medium text-foreground">{busy.title}</h3>
                        <span className="truncate font-mono text-[12px] text-muted-foreground">{busy.file}</span>
                    </span>
                </div>
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {busy.steps.map((label, i) => {
                        const done = i < busy.step, on = i === busy.step
                        return (
                            <li key={label} aria-current={on ? "step" : undefined}
                                className={cn("flex items-center gap-2.5 text-[13px]", done || on ? "text-foreground" : "text-muted-foreground", on && "font-semibold")}>
                                <span aria-hidden="true" className={cn("grid size-[18px] flex-none place-items-center rounded-full text-white",
                                    done ? "bg-primary" : on ? "bg-[color-mix(in_srgb,var(--accent)_45%,var(--panel))]" : "bg-border")}>
                                    {done && <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8.5 3 3 7-7" /></svg>}
                                </span>
                                {label}
                                {done && <span className="sr-only"> (done)</span>}
                            </li>
                        )
                    })}
                </ol>
                <p aria-live="polite" className="sr-only">{busy.steps[busy.step]}</p>
                <span aria-hidden="true" className="block h-1 overflow-hidden rounded-sm bg-line-2">
                    <span style={{ width: pct + "%" }} className="block h-1 bg-primary transition-[width] duration-1000 ease-out motion-reduce:transition-none" />
                </span>
                <div className="flex items-center justify-between gap-3">
                    <span id="busyNote" className="text-[12px] tabular-nums text-muted-foreground">Usually under half a minute{s >= 1 ? " · " + s + "s" : ""}</span>
                    <Button variant="ghost" onClick={busy.cancel}>Cancel</Button>
                </div>
            </div>
        </div>
    )
}
```

- [ ] **Step 6: The outline's and the calendar's reads**

In `src/data/import-edit.ts`, change `readOutlineFile` to:

```ts
/** A course outline, read by the Worker with AI, then previewed. */
export function readOutlineFile(file: File) {
    return readWithAi(file, {
        what: "outline", title: "Reading your course outline",
        steps: ["Reading the document", "Finding dates and deadlines", "Matching it to your courses"],
        flag: "outlineBusy", note: "importNote", refresh: notify,
        errors: {
            outline_empty: "No text was found in that file. A scanned outline needs to be a text PDF.",
            outline_unreadable: "The outline could not be understood. Try again, or import a CSV instead.",
        },
        call: (body, signal) => api.readOutline(body, { name: file.name, today: today(), termStart: termStart() || "" }, signal),
        done: (outline: Outline) => openSheet({ kind: "import", plan: planOutline(outline, data, termStart() || "") as ImportPlan, name: file.name }),
    })
}
```

In `src/data/school-edit.ts`, in `readSchoolFile`'s options replace `stage: "Finding the semesters, breaks and days off with AI…",` with `steps: ["Reading the PDF", "Finding semesters and breaks", "Checking the dates"],`, and its `call` with `call: (body, signal) => api.readSchool(body, { name: file.name, today: today() }, signal),`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `rg -n "stage:|Uploading your course|outlines and calendars" src test` — expected: nothing left.
Run: `npx vitest run src`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/data/ai-read.ts src/data/types.ts src/data/ui.ts src/data/import-edit.ts src/data/school-edit.ts src/components/overlays.tsx src/components/overlays.test.tsx
git commit -m "The reading card ticks off three steps, can be cancelled, and the reads left are asked after each read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 6: The outline's semester, and a course's semester saved with an import

**Files:**
- Modify: `src/data/import-edit.ts`, `src/components/sheet/import-sheet.tsx`
- Modify: `src/data/settings-data.test.ts`, `src/components/sheet/settings-sheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/data/settings-data.test.ts`, add `defaultTerm` to the import from `./import-edit`, and inside `describe("importing", …)`:

```ts
    it("saves a semester picked for a course that exists, even with no new classes", async () => {
        fake.data.courses = [normalizeCourse({ id: "old", code: "ANAT", name: "Anatomy", term: "", meetings: [] }, 0) as { id: string; meetings: unknown[] }]
        const p: ImportPlan = { notes: [], items: [], courses: [{ id: "old", code: "ANAT", name: "Anatomy", color: "#E4749B", isNew: false, meetings: [], term: "Fall 2026" }] }
        expect(await commitImport(p)).toBe("Imported 0 classes and 0 items.")
        expect(fake.rows.map((r) => [r.row.id, (r.row as unknown as { term: string }).term])).toEqual([["old", "Fall 2026"]])
        fake.rows = []
        p.courses[0].term = undefined
        await commitImport(p)
        expect(fake.rows).toEqual([])
    })

    it("gives a new course the semester its file names, else the current one", () => {
        const cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })
        expect(defaultTerm(cal, "fall 2026", "2027-02-01")).toBe("Fall 2026")
        expect(defaultTerm(cal, "", "2027-02-01")).toBe("Winter 2027")
        expect(defaultTerm(cal, "Autumn", "2026-10-01")).toBe("Fall 2026")
        expect(defaultTerm(null, "2026 Autumn", "2027-02-01")).toBe("2026 Autumn")
    })
```

In `src/components/sheet/settings-sheet.test.tsx`, let a test set the school calendar: add `cal: null as unknown,` to the hoisted `fake`, change the query mock to `vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => null }))`, add `fake.cal = null` to `afterEach`, add `import { normalizeSchool } from "@/core/school"`, and add inside `describe("the import sheet", …)`:

```tsx
    it("asks an outline's semester when there is a school calendar, and saves it with the course", async () => {
        fake.cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })
        const p = plan()
        p.kind = "outline"
        p.courses[0].keep = true
        p.courses[0].term = "Fall 2026"
        act(() => openSheet({ kind: "import", plan: p, name: "phys.pdf" }))
        const group = screen.getByRole("group", { name: "Semester for PHYS" })
        expect(within(group).getByRole("button", { name: "Fall 2026" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(within(group).getByRole("button", { name: "Winter 2027" }))
        expect(within(group).getByRole("button", { name: "Winter 2027" }).getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Import \d/ })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as { kind: string; row: { term: string } }[]
        expect(rows[0]).toMatchObject({ kind: "courses", row: { term: "Winter 2027" } })
    })

    it("asks no semester without a school calendar, or for a calendar file", () => {
        act(() => openSheet({ kind: "import", plan: { ...plan(), kind: "outline" }, name: "phys.pdf" }))
        expect(screen.queryByRole("group", { name: /^Semester/ })).toBeNull()
        fake.cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }] })
        act(() => openSheet({ kind: "import", plan: plan(), name: "cal.ics" }))
        expect(screen.queryByRole("group", { name: /^Semester/ })).toBeNull()
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/settings-data.test.ts src/components/sheet/settings-sheet.test.tsx`
Expected: FAIL: `defaultTerm` is not exported; a course with only a new semester is not saved; there is no Semester group.

- [ ] **Step 3: `defaultTerm` and the commit (`src/data/import-edit.ts`)**

Add `import { courseTerm, currentTerm, type SchoolCalendar } from "@/core/school"` and `schoolCal` to the import from `@/data/query`. After `MAX_BYTES` add:

```ts
/** A new course's semester: with a school calendar, the one its file names, else the current
    one; without one, the file's own words, as before. */
export function defaultTerm(cal: SchoolCalendar | null, named: string, day: string): string {
    if (!cal) return named
    return (courseTerm(cal, named) ?? currentTerm(cal, day))?.name ?? ""
}
```

In `readOutlineFile`, give a new course its semester when the preview opens:

```ts
        done: (outline: Outline) => {
            const plan = planOutline(outline, data, termStart() || "") as ImportPlan
            for (const c of plan.courses) if (c.isNew) c.term = defaultTerm(schoolCal(), c.term || "", today())
            openSheet({ kind: "import", plan, name: file.name })
        },
```

In `commitImport`, replace the course loop with one that also writes a semester picked for a course that exists:

```ts
    for (const c of plan.courses) {
        const add = c.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m)
        if (c.isNew) {
            if (!add.length && !(c.keep || wanted.has(c.id))) continue
            rows.push({ kind: "courses", row: normalizeCourse({ id: c.id, code: c.code, name: c.name, color: c.color, instructor: c.instructor || "", term: c.term || "", meetings: add }) as Course })
        } else {
            const live = store.course(c.id) as Course | null
            /* a semester picked in the preview; undefined (a calendar or CSV import) leaves it */
            const term = c.term ?? live?.term ?? ""
            if (!live || (!add.length && term === live.term)) continue
            rows.push({ kind: "courses", row: { ...live, term, meetings: [...live.meetings, ...add].slice(0, 12) } })
        }
        classes += add.length
    }
```

- [ ] **Step 4: The semester in the import preview (`src/components/sheet/import-sheet.tsx`)**

Import `schoolCal` beside `termStart` from `@/data/query`, `semesterOptions, semesterPicked` from `@/data/course-edit`, and `Segmented` from `./fields`. In `ImportSheet`, after `const n = importCount(plan)` add:

```tsx
    /* an outline's course gets a semester picker beside it, when there is a school calendar */
    const cal = plan.kind === "outline" ? schoolCal() : null
```

and in each course's `<Section>`, wrap the children in a fragment with the semester row first:

```tsx
                        <>
                            {cal && (
                                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                                    Semester
                                    <Segmented label={"Semester for " + c.code} value={semesterPicked(cal, c.term)} options={semesterOptions(cal)}
                                        onChange={(term) => { c.term = term; redraw() }} />
                                </div>
                            )}
                            <div>{/* the class and item rows, as they are */}</div>
                        </>
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/data/settings-data.test.ts src/components/sheet/settings-sheet.test.tsx test/importers.test.js`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/data/import-edit.ts src/components/sheet/import-sheet.tsx src/data/settings-data.test.ts src/components/sheet/settings-sheet.test.tsx
git commit -m "The outline preview asks the course's semester, and an import saves the semester picked" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 7: The class schedule preview

**Files:**
- Create: `src/data/schedule-edit.ts`, `src/components/sheet/schedule-sheet.tsx`, `src/components/sheet/ai-import.test.tsx`
- Modify: `src/data/overlay.ts`, `src/components/sheet/sheet.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/sheet/ai-import.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// The app is not booted: a store in memory, the reads, the API and the toast as fakes, the
// real planner and commit. The class schedule preview, reading a timetable, and (Task 8) the
// Import with AI card.
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as { id: string }[], study_sessions: [], achievements: [], quotes: [], profile: { id: "p", termStart: null } as Record<string, unknown> },
    ui: { view: "week", bg: "med", course: "all", search: "", types: {}, aiLeft: null as number | null, aiNote: null as unknown, importNote: null as unknown },
    cal: null as unknown,
}))
const legacy = vi.hoisted(() => ({ saveRows: vi.fn(async () => {}), saveProfile: vi.fn(), toast: vi.fn(), shrink: vi.fn(async () => new Blob(["j"], { type: "image/jpeg" })) }))
const ai = vi.hoisted(() => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(async (f: File) => f as Blob), MAX_FILE: 5 * 1024 * 1024 }))
vi.mock("@/core/store", () => ({
    data: fake.data, conflicts: [],
    course: (id: string) => fake.data.courses.find((c) => c.id === id) || null, item: () => null,
    saveRows: legacy.saveRows, saveProfile: legacy.saveProfile,
    subscribe: () => () => {},
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => null }))
vi.mock("@/core/api", () => ({ api: { readSchedule: vi.fn(), readOutline: vi.fn(), readSchool: vi.fn() } }))
vi.mock("@/data/ai-read", () => ai)
vi.mock("@/data/toast", () => ({ toast: legacy.toast }))
vi.mock("@/core/image", () => ({ shrinkImage: legacy.shrink }))
vi.mock("@/data/actions", () => ({ openSettings: vi.fn() }))

import { normalizeSchool } from "@/core/school"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import { Sheet } from "./sheet"

const CAL = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><div id="scrim"></div><div id="sheet"></div>'
    render(<Sheet />, { container: document.getElementById("sheet")! })
})
afterEach(() => {
    act(() => closeSheet())
    cleanup()
    vi.clearAllMocks()
    fake.cal = null
    fake.data.courses = []
    Object.assign(fake.ui, { aiLeft: null, aiNote: null, importNote: null })
})

const plan = (): ImportPlan => ({ kind: "schedule", notes: [], items: [], courses: [
    { id: "c1", code: "CHEM271", name: "Organic Chem", color: "#E4749B", isNew: false, term: "", meetings: [
        { id: "m1", kind: "Lab", weekday: 5, start: "13:00", end: "16:00", room: "SP-265", include: true }] },
    { id: "n1", code: "BIOL266", name: "Cell Biology", color: "#4F74D9", isNew: true, term: "Fall 2026", meetings: [
        { id: "m2", kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B", include: true },
        { id: "m3", kind: "Tutorial", weekday: 3, start: "15:00", end: "16:00", room: "", include: true }] },
] })
const CHEM = { id: "c1", code: "CHEM271", name: "Organic Chem", color: "#E4749B", instructor: "", term: "", archived: false, target: null, meetings: [] }
type Saved = { kind: string; row: { id: string; term: string; meetings: unknown[] } }[]

describe("the class schedule preview", () => {
    it("lists the courses with their badges and a tick per class, and adds the ticked ones", async () => {
        fake.data.courses = [CHEM]
        act(() => openSheet({ kind: "schedule", plan: plan(), name: "timetable.png" }))
        expect(await screen.findByRole("heading", { name: "Found 2 courses" })).toBeTruthy()
        expect(screen.getByText("timetable.png")).toBeTruthy()
        expect(within(screen.getByRole("region", { name: /CHEM271/ })).getByText("Matches your course")).toBeTruthy()
        expect(within(screen.getByRole("region", { name: /BIOL266/ })).getByText("New course")).toBeTruthy()
        expect(screen.queryByRole("group", { name: /^Semester/ })).toBeNull()   /* no school calendar */
        fireEvent.click(screen.getByRole("checkbox", { name: "Add BIOL266 Tutorial Wed 15:00" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 classes" })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as Saved
        expect(rows.map((r) => [r.row.id, r.row.meetings.length])).toEqual([["c1", 1], ["n1", 1]])
        expect(legacy.toast).toHaveBeenCalledWith("Added 2 classes to 2 courses")
        expect(getSheet()).toBeNull()
    })

    it("sets each course's semester when there is a school calendar", async () => {
        fake.cal = CAL
        fake.data.courses = [CHEM]
        act(() => openSheet({ kind: "schedule", plan: plan(), name: "timetable.png" }))
        const bio = await screen.findByRole("group", { name: "Semester for BIOL266" })
        expect(within(bio).getByRole("button", { name: "Fall 2026" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(within(bio).getByRole("button", { name: "Winter 2027" }))
        const chem = screen.getByRole("group", { name: "Semester for CHEM271" })
        expect(within(chem).getByRole("button", { name: "Both semesters" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(within(chem).getByRole("button", { name: "Fall 2026" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 3 classes" })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as Saved
        expect(rows.map((r) => [r.row.id, r.row.term])).toEqual([["c1", "Fall 2026"], ["n1", "Winter 2027"]])
    })

    it("says when a course's classes are all there, and goes back to the card for another file", async () => {
        const p = plan()
        p.courses[0].meetings = []
        act(() => openSheet({ kind: "schedule", plan: p, name: "timetable.png" }))
        expect(await screen.findByText("Its classes are already on your board.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Another file" }))
        expect(getSheet()).toEqual({ kind: "ai" })
    })
})

describe("reading a timetable", () => {
    it("sends a picture made smaller and a PDF as text, and opens the preview with the semester named", async () => {
        const { readScheduleFile } = await import("@/data/schedule-edit")
        const png = new File(["x"], "t.png", { type: "image/png" })
        void readScheduleFile(png)
        const cfg = ai.readWithAi.mock.calls[0][1] as { what: string; title: string; note: string; maxBytes: number; prepare: (f: File) => Promise<Blob>; done: (r: unknown) => void }
        expect(cfg).toMatchObject({ what: "timetable", title: "Reading your timetable", note: "aiNote", maxBytes: 20 * 1024 * 1024 })
        await cfg.prepare(png)
        expect(legacy.shrink).toHaveBeenCalledWith(png)
        const pdf = new File(["%PDF"], "t.pdf", { type: "application/pdf" })
        await cfg.prepare(pdf)
        expect(ai.asSent).toHaveBeenCalledWith(pdf)

        fake.cal = CAL
        act(() => cfg.done({ term: "Winter 2027", courses: [{ code: "BIOL266", name: "Cell Biology", classes: [{ kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "" }] }] }))
        expect(getSheet()).toMatchObject({ kind: "schedule", name: "t.png" })
        expect((getSheet() as { plan: ImportPlan }).plan.courses[0]).toMatchObject({ code: "BIOL266", isNew: true, term: "Winter 2027" })
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/ai-import.test.tsx`
Expected: FAIL: there is no `schedule` sheet and no `@/data/schedule-edit`.

- [ ] **Step 3: The two new sheets in `src/data/overlay.ts`**

Add to `SheetState`, after the `import` line:

```ts
    | { kind: "schedule"; plan: ImportPlan; name: string }
    | { kind: "ai" }
```

(`ai` is the Import with AI card; Task 8 draws it.)

- [ ] **Step 4: `src/data/schedule-edit.ts`**

```ts
// A class schedule read with AI (worker/schedule.js): the courses it found, matched to yours
// (core/importers/plan.ts, planSchedule), shown in the schedule sheet with a semester and a
// tick per class, and written on "Add N classes" through the import's commit. Nothing is
// saved before. A screenshot is made smaller here first (core/image.ts).

import { data } from "@/core/store"
import { today } from "@/core/dates"
import { planSchedule, type Schedule } from "@/core/importers/plan"
import { shrinkImage } from "@/core/image"
import { api } from "@/core/api"
import { schoolCal } from "@/data/query"
import { notify } from "@/bridge"
import { asSent, MAX_FILE, readWithAi, type NoteKey } from "./ai-read"
import { commitImport, defaultTerm, type ImportPlan } from "./import-edit"
import { closeSheet, openSheet } from "./overlay"
import { toast } from "./toast"

export const isImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|heic)$/i.test(f.name)

/** What "Add N classes" adds: the ticked classes. */
export const scheduleCount = (plan: ImportPlan) => plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length, 0)

/** A timetable was picked: read it with AI, then check it in the schedule sheet. */
export function readScheduleFile(file: File, note: NoteKey = "aiNote") {
    return readWithAi(file, {
        what: "timetable", title: "Reading your timetable",
        steps: ["Reading the timetable", "Finding courses and class times", "Matching them to your courses"],
        flag: "scheduleBusy", note, refresh: notify,
        prepare: (f) => (isImage(f) ? shrinkImage(f) : asSent(f)),
        /* a phone or retina screenshot can be over 5 MB; what is sent is a 1600 px JPEG */
        maxBytes: isImage(file) ? 4 * MAX_FILE : MAX_FILE,
        errors: {
            outline_empty: "No text was found in that PDF. Try a screenshot of the timetable instead.",
            schedule_unreadable: "No classes could be found in that timetable. Try a clearer screenshot, or the PDF.",
            image_unsupported: "That kind of picture cannot be read. Use a PNG or JPG screenshot.",
        },
        call: (body, signal) => api.readSchedule(body, { name: file.name, today: today() }, signal),
        done: (read: Schedule) => openSheet({
            kind: "schedule", name: file.name,
            plan: planSchedule(read, data, defaultTerm(schoolCal(), read.term || "", today())) as ImportPlan,
        }),
    })
}

/** Add the ticked classes and the semesters picked; a toast says what happened. */
export async function commitSchedule(plan: ImportPlan) {
    const n = scheduleCount(plan)
    const courses = plan.courses.filter((c) => c.meetings.some((m) => m.include)).length
    try {
        await commitImport(plan)
        closeSheet()
        toast("Added " + n + " class" + (n === 1 ? "" : "es") + " to " + courses + " course" + (courses === 1 ? "" : "s"))
    } catch (e) {
        toast("The classes were not all added: " + (e as Error).message, { error: true, ms: 8000 })
    }
}
```

- [ ] **Step 5: `src/components/sheet/schedule-sheet.tsx`**

```tsx
// The class schedule preview (spec §10): each course the timetable has, "Matches your course"
// or "New course", its semester (with a school calendar) and a tick per class; "Add N
// classes" writes them. The planner already left out the classes a course has.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { DOW, dayMonth } from "@/core/dates"
import type { SchoolCalendar } from "@/core/school"
import { schoolCal } from "@/data/query"
import { semesterOptions, semesterPicked } from "@/data/course-edit"
import { commitSchedule, scheduleCount } from "@/data/schedule-edit"
import { closeSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import { accent } from "@/components/views/bits"
import { Button, Segmented, SheetBody, SheetFoot, SheetHead, Warning } from "./fields"

const plural = (n: number, one: string, many = one + "s") => n + " " + (n === 1 ? one : many)

/** "Fall 2026: 8 Sep – 18 Dec · Winter 2027: 11 Jan – 23 Apr · Both semesters: all year." */
const semesterLine = (cal: SchoolCalendar) =>
    [...cal.terms.map((t) => t.name + ": " + dayMonth(t.start) + " – " + dayMonth(t.end)), (cal.terms.length === 2 ? "Both semesters" : "All year") + ": all year"].join(" · ") + "."

export function ScheduleSheet({ plan: initial, name }: { plan: ImportPlan; name: string }) {
    /* the plan is changed in place by the ticks and the semesters; `v` redraws */
    const [plan] = useState(initial)
    const [, setV] = useState(0)
    const redraw = () => setV((n) => n + 1)
    const [busy, setBusy] = useState(false)
    const cal = schoolCal()
    const n = scheduleCount(plan)
    const found = plan.courses.reduce((k, c) => k + c.meetings.length, 0)
    const again = () => openSheet({ kind: "ai" })
    const add = async () => { setBusy(true); await commitSchedule(plan); setBusy(false) }

    return (
        <>
            <SheetHead kind="Read by AI" onClose={closeSheet}>
                <span className="max-w-[220px] truncate font-mono text-[11.5px] text-muted-foreground">{name}</span>
            </SheetHead>
            <SheetBody className="gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="m-0 font-serif text-[26px] leading-[1.15] font-medium text-foreground">Found {plural(plan.courses.length, "course")}</h2>
                    <span className="text-[13px] text-ink-2">
                        {found
                            ? "With " + plural(found, "new class", "new classes") + ". " + (cal ? "Set each course’s semester and untick" : "Untick") + " anything that’s wrong."
                            : "Their classes are already on your board."}
                    </span>
                </div>
                {plan.notes.length > 0 && <Warning>{plan.notes.slice(0, 6).map((t, i) => <div key={i}>{t}</div>)}</Warning>}
                {plan.courses.map((c) => (
                    <section key={c.id} aria-label={c.code + " · " + c.name} className="flex flex-col gap-1.5 rounded-[10px] border border-border px-3.5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <i aria-hidden="true" style={accent(c.color)} className="size-2.5 flex-none rounded-[3px] bg-[var(--c,var(--ink-3))]" />
                            <span className="min-w-0 text-[14px] font-semibold text-foreground">{c.code} · {c.name}</span>
                            <span className={cn("inline-flex h-5 flex-none items-center rounded-full px-2 text-[11px] font-medium", c.isNew ? "bg-secondary text-accent-foreground" : "bg-muted text-ink-2")}>
                                {c.isNew ? "New course" : "Matches your course"}
                            </span>
                            {cal && (
                                <span className="ml-auto">
                                    <Segmented label={"Semester for " + c.code} value={semesterPicked(cal, c.term)} options={semesterOptions(cal)}
                                        onChange={(term) => { c.term = term; redraw() }} />
                                </span>
                            )}
                        </div>
                        {c.meetings.length === 0 && <span className="text-[12px] text-muted-foreground">Its classes are already on your board.</span>}
                        {c.meetings.map((m) => (
                            <label key={m.id} className={cn(ROW, !m.include && "opacity-50")}>
                                <input type="checkbox" checked={m.include} aria-label={"Add " + c.code + " " + m.kind + " " + DOW[m.weekday] + " " + m.start}
                                    onChange={(e) => { m.include = e.target.checked; redraw() }} className="m-0 size-[15px] accent-[var(--accent)]" />
                                <span className="truncate">{m.kind}</span>
                                <span className="text-ink-2">{DOW[m.weekday]}</span>
                                <span className="font-mono text-[12px] whitespace-nowrap">{m.start}–{m.end}</span>
                                <span className="truncate text-ink-2">{m.room}</span>
                            </label>
                        ))}
                    </section>
                ))}
                <span className="text-[12px] leading-normal text-muted-foreground">
                    {cal ? semesterLine(cal) + " " : ""}Classes already on your board aren’t added twice.
                </span>
            </SheetBody>
            <SheetFoot hint="Nothing is saved until you add them">
                <Button variant="ghost" onClick={again}>Another file</Button>
                <Button disabled={!n || busy} onClick={() => void add()}>Add {plural(n, "class", "classes")}</Button>
            </SheetFoot>
        </>
    )
}

/* tick · kind · day · time · room (prototype 1330); at phone width the columns narrow and the room truncates */
const ROW = "grid min-h-9 cursor-pointer grid-cols-[18px_68px_34px_96px_minmax(0,1fr)] items-center gap-2.5 rounded-md px-1.5 text-[13px] text-foreground hover:bg-muted max-[420px]:grid-cols-[18px_60px_30px_90px_minmax(0,1fr)] max-[420px]:gap-2"
```

- [ ] **Step 6: The sheet draws it (`src/components/sheet/sheet.tsx`)**

Add `const ScheduleSheet = lazyNamed(() => import("./schedule-sheet"), "ScheduleSheet")` beside the others. In `sheetLabel`, after the `import` line, add `if (s.kind === "schedule") return "Class schedule"` and `if (s.kind === "ai") return "Import with AI"`. In the `Suspense`, after the `ImportSheet` line, add:

```tsx
                {shown?.kind === "schedule" && <ScheduleSheet key={shown.name} plan={shown.plan} name={shown.name} />}
```

In the file's opening comment, list "an import, a class schedule, the Import with AI card," among what the sheet shows.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/components/sheet/ai-import.test.tsx src/components/sheet/sheet.test.tsx`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/data/schedule-edit.ts src/data/overlay.ts src/components/sheet/schedule-sheet.tsx src/components/sheet/sheet.tsx src/components/sheet/ai-import.test.tsx
git commit -m "The class schedule preview: the courses found, matched or new, a semester each and a tick per class; Add N classes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 8: The Import with AI card and the top-bar button

**Files:**
- Create: `src/components/sheet/ai-sheet.tsx`
- Modify: `src/components/sheet/sheet.tsx`, `src/components/sheet/import-sheet.tsx`, `src/components/sheet/settings-sheet.tsx`
- Modify: `src/data/import-edit.ts`, `src/data/school-edit.ts`, `src/data/overlay.ts`, `src/data/actions.ts`
- Modify: `src/components/top-bar.tsx`, `src/components/top-bar.test.tsx`
- Modify: `src/components/sheet/ai-import.test.tsx`, and the `@/data/ai-read` mocks in `settings-sheet.test.tsx`, `sheet.test.tsx`, `study-sheets.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/top-bar.test.tsx`, add `openAiImport: vi.fn(),` to the hoisted `actions`, and this test to the file's first `describe`:

```tsx
    it("opens Import with AI", () => {
        render(<TopBar />)
        fireEvent.click(screen.getByRole("button", { name: "Import with AI" }))
        expect(actions.openAiImport).toHaveBeenCalled()
    })
```

In `src/components/sheet/ai-import.test.tsx`, add:

```tsx
describe("the Import with AI card", () => {
    const pick = (label: string, file: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } })
    const cfg = (i = 0) => ai.readWithAi.mock.calls[i][1] as { what: string; note: string; done: (r: unknown) => void }

    it("offers the three kinds and the reads left, and reads each kind of file", async () => {
        fake.ui.aiLeft = 7
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByText("Class schedule")).toBeTruthy()
        expect(screen.getByText("Course outline")).toBeTruthy()
        expect(screen.getByText("School calendar")).toBeTruthy()
        expect(ai.refreshReads).toHaveBeenCalled()
        expect(screen.getByRole("meter", { name: "AI reads left today" }).getAttribute("aria-valuenow")).toBe("7")
        expect(screen.getByText(/7 of 10 AI reads left today/)).toBeTruthy()

        pick("Class schedule: Choose a PDF or image", new File(["x"], "t.png", { type: "image/png" }))
        pick("Course outline: Choose a file", new File(["x"], "o.pdf", { type: "application/pdf" }))
        pick("School calendar: Choose a PDF", new File(["x"], "c.pdf", { type: "application/pdf" }))
        expect([0, 1, 2].map((i) => [cfg(i).what, cfg(i).note])).toEqual([["timetable", "aiNote"], ["outline", "aiNote"], ["calendar", "aiNote"]])
    })

    it("opens an outline's preview that comes back to the card", async () => {
        act(() => openSheet({ kind: "ai" }))
        await screen.findByText("Course outline")
        pick("Course outline: Choose a file", new File(["x"], "o.pdf", { type: "application/pdf" }))
        act(() => cfg().done({ code: "PHYS205", name: "Waves", classes: [], assessments: [] }))
        expect(getSheet()).toMatchObject({ kind: "import", back: "ai" })
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
        expect(getSheet()).toEqual({ kind: "ai" })
    })

    it("says what went wrong, and stops offering reads when none are left", async () => {
        fake.ui.aiLeft = 0
        fake.ui.aiNote = { text: "Stopped reading.", error: false }
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByText("Stopped reading.")).toBeTruthy()
        expect((screen.getByLabelText("Class schedule: Choose a PDF or image") as HTMLInputElement).disabled).toBe(true)
        expect(screen.getByText(/No AI reads left today/)).toBeTruthy()
    })

    it("previews pasted CSV, and says when it cannot", async () => {
        act(() => openSheet({ kind: "ai" }))
        fireEvent.change(await screen.findByLabelText("Calendar or CSV text"), { target: { value: "nonsense" } })
        fireEvent.click(screen.getByRole("button", { name: "Preview" }))
        expect(screen.getByRole("alert").textContent).toMatch(/No rows were found/)
        fireEvent.change(screen.getByLabelText("Calendar or CSV text"), { target: { value: "type,course,title,date\nexam,PHYS205,Midterm,2026-10-20" } })
        fireEvent.click(screen.getByRole("button", { name: "Preview" }))
        expect(getSheet()).toMatchObject({ kind: "import", back: "ai" })
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/top-bar.test.tsx src/components/sheet/ai-import.test.tsx`
Expected: FAIL: there is no Import with AI button and the `ai` sheet draws nothing.

- [ ] **Step 3: The way back, and the note key**

In `src/data/overlay.ts`, change the `import` line of `SheetState` to `| { kind: "import"; plan: ImportPlan; name: string; back?: "ai" }`.

In `src/data/import-edit.ts` (import `type NoteKey` from `./ai-read`):
- `previewImport(text: string, name = "", back?: "ai")` opens `openSheet({ kind: "import", plan, name, ...(back ? { back } : {}) })`;
- `readOutlineFile(file: File, note: NoteKey = "importNote", back?: "ai")` passes `note` to `readWithAi` (in place of `"importNote"`), and its `done` opens `openSheet({ kind: "import", plan, name: file.name, ...(back ? { back } : {}) })`.

In `src/data/school-edit.ts` (import `type NoteKey` from `./ai-read`), `readSchoolFile(file: File, note: NoteKey = "schoolNote")` passes `note` to `readWithAi`.

In `src/data/actions.ts`, after `openSettings`, add:

```ts
/** The top bar's Import with AI: the card with the three kinds of file. */
export const openAiImport = () => openSheet({ kind: "ai" })
```

- [ ] **Step 4: The import preview goes back where it came from (`src/components/sheet/import-sheet.tsx`)**

Take `back` as a prop (`{ plan: initial, name, back }: { plan: ImportPlan; name: string; back?: "ai" }`), import `closeSheet, openSheet` from `@/data/overlay` and `toast` from `@/data/toast`, and replace `cancel` and `commit`:

```tsx
    const cancel = () => (back ? openSheet({ kind: "ai" }) : openSettings("importGrp"))

    const commit = async () => {
        setBusy(true)
        let note
        try { note = { text: await commitImport(plan), error: false } } catch (error) { note = { text: "The import stopped part-way: " + (error as Error).message, error: true } }
        notify()
        if (back) { closeSheet(); toast(note.text, { error: note.error }); return }
        ui.importNote = note
        openSettings("importGrp")
    }
```

In `src/components/sheet/sheet.tsx`, pass it: `<ImportSheet key={shown.name} plan={shown.plan} name={shown.name} back={shown.back} />`.

- [ ] **Step 5: The card (`src/components/sheet/ai-sheet.tsx`)**

```tsx
// Import with AI (spec §10), from the top bar: a class schedule, a course outline or a school
// calendar, each read by AI and shown in its preview before anything is saved; the reads left
// today; and pasting a calendar or CSV instead. Settings keeps its own Import and School
// calendar entries.

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { notify } from "@/bridge"
import { ui, useUi } from "@/data/ui"
import { refreshReads } from "@/data/ai-read"
import { previewImport, readOutlineFile } from "@/data/import-edit"
import { readSchoolFile } from "@/data/school-edit"
import { readScheduleFile } from "@/data/schedule-edit"
import { beforeSheetClose, closeSheet } from "@/data/overlay"
import { Button, SheetBody, SheetHead, TextArea } from "./fields"

export const READS = 10

const KINDS = [
    {
        id: "schedule", title: "Class schedule", pick: "Choose a PDF or image", note: "PDF, PNG or JPG · read by AI",
        blurb: "Your timetable from the student portal, as a PDF or a screenshot. It sets up your courses with every lecture, lab and tutorial: day, time and room.",
        icon: "M4 5h16v15H4zM4 10h16M9 10v10M14.5 10v10M4 15h16",
        accept: ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp",
        read: (f: File) => readScheduleFile(f, "aiNote"),
    },
    {
        id: "outline", title: "Course outline", pick: "Choose a file", note: "PDF, Word or text · read by AI",
        blurb: "The syllabus from your professor. It pulls out every quiz, exam, assignment and lab with its date and weight, and the class times.",
        icon: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
        accept: ".pdf,.docx,.doc,.txt,.md,.html,.odt,application/pdf",
        read: (f: File) => readOutlineFile(f, "aiNote", "ai"),
    },
    {
        id: "calendar", title: "School calendar", pick: "Choose a PDF", note: "PDF · read by AI",
        blurb: "Your school’s academic calendar. It finds each semester, reading weeks, holidays and exam periods, so classes stop repeating all year.",
        icon: "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4",
        accept: ".pdf,.docx,.txt,.html,application/pdf",
        read: (f: File) => readSchoolFile(f, "aiNote"),
    },
] as const

export function AiSheet() {
    const left = useUi((u) => u.aiLeft)
    const note = useUi((u) => u.aiNote)
    const [text, setText] = useState("")
    const none = left === 0

    useEffect(() => {
        void refreshReads()
        /* what the card said goes when it closes */
        const forget = () => { ui.aiNote = null }
        beforeSheetClose.add(forget)
        return () => { beforeSheetClose.delete(forget) }
    }, [])

    const paste = () => {
        if (!text.trim()) return
        const error = previewImport(text, "", "ai")
        if (error) { ui.aiNote = { text: error, error: true }; notify() }
    }

    return (
        <>
            <SheetHead kind="Import with AI" onClose={closeSheet} />
            <SheetBody className="gap-4">
                <p className="m-0 text-[13px] leading-normal text-ink-2">Give it a document and it finds the dates for you. You see everything before anything is saved.</p>
                {KINDS.map((k) => (
                    <section key={k.id} aria-labelledby={"ai-" + k.id + "-t"} className="flex flex-col gap-3 rounded-[10px] border border-border p-4 max-[420px]:p-3">
                        <div className="flex gap-3">
                            <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-lg bg-secondary text-primary">
                                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={k.icon} /></svg>
                            </span>
                            <span className="flex min-w-0 flex-col gap-[3px]">
                                <span id={"ai-" + k.id + "-t"} className="text-[14px] font-semibold text-foreground">{k.title}</span>
                                <span className="text-[12.5px] leading-[1.45] text-ink-2">{k.blurb}</span>
                            </span>
                        </div>
                        <label className={cn(
                            "relative flex h-[84px] flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-border bg-muted/40 text-[13px] text-foreground",
                            "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]",
                            none ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted",
                        )}>
                            <span className="flex items-center gap-1.5 font-medium">
                                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" /></svg>
                                {k.pick}
                            </span>
                            <span className="text-[11.5px] text-muted-foreground">{k.note}</span>
                            <input type="file" accept={k.accept} disabled={none} aria-label={k.title + ": " + k.pick}
                                className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void k.read(f) }} />
                        </label>
                    </section>
                ))}
                {left != null && (
                    <div className="flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-[12.5px] text-ink-2">
                        <span role="meter" aria-label="AI reads left today" aria-valuemin={0} aria-valuemax={READS} aria-valuenow={left}
                            className="block h-[5px] w-[60px] flex-none overflow-hidden rounded-[3px] bg-border">
                            <span style={{ width: Math.round((left / READS) * 100) + "%" }} className="block h-[5px] bg-primary" />
                        </span>
                        <span>{none ? "No AI reads left today. They come back within a day of the first one." : left + " of " + READS + " AI reads left today · pasting a calendar or CSV doesn’t count"}</span>
                    </div>
                )}
                {note && <p role={note.error ? "alert" : "status"} className={cn("m-0 text-[12.5px]", note.error ? "text-destructive" : "text-ink-2")}>{note.text}</p>}
                <details className="text-[12.5px] text-ink-2">
                    <summary className="min-h-7 cursor-pointer">Paste a calendar or CSV instead</summary>
                    <p className="mt-2 mb-1.5">Calendar text, or CSV with the columns <span className="font-mono">type,course,title,date,start,end,room,weight</span>.</p>
                    <TextArea rows={4} className="min-h-0 font-mono text-[12px]" value={text} aria-label="Calendar or CSV text" placeholder="Paste calendar or CSV text" onChange={(e) => setText(e.target.value)} />
                    <Button variant="ghost" className="mt-1.5" onClick={paste}>Preview</Button>
                </details>
            </SheetBody>
        </>
    )
}
```

In `src/components/sheet/sheet.tsx`, add `const AiSheet = lazyNamed(() => import("./ai-sheet"), "AiSheet")` and, in the `Suspense`, `{shown?.kind === "ai" && <AiSheet />}`.

- [ ] **Step 6: The button (`src/components/top-bar.tsx`)**

Import `openAiImport` from `@/data/actions`, and put this between `<Search />` and the New item button:

```tsx
            {/* Import with AI (spec §10): the spark and the words; the spark alone on a phone */}
            <TextureButton variant="minimal" size="sm" aria-label="Import with AI" onClick={openAiImport}>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-3.5 text-primary">
                    <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" />
                </svg>
                <span className="max-[700px]:hidden">Import with AI</span>
            </TextureButton>
```

In the file's opening comment, say "…‹ Today › in the week and month views, search, Import with AI and New item."

- [ ] **Step 7: Reads left in Settings too (`src/components/sheet/settings-sheet.tsx`)**

Import `refreshReads` from `@/data/ai-read`. In `Import()`, add `const left = useUi((u) => u.aiLeft)` and `useEffect(() => { void refreshReads() }, [])`, and change its hint to:

```tsx
            <Hint>You see everything before it is saved. Outlines, timetables and calendars are read by AI, up to 10 a day{left != null ? " (" + left + " left today)" : ""}.</Hint>
```

- [ ] **Step 8: The mocks of `@/data/ai-read`**

In `src/components/sheet/settings-sheet.test.tsx`, `src/components/sheet/sheet.test.tsx` and `src/components/sheet/study-sheets.test.tsx`, change the mock to `vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(), MAX_FILE: 5 * 1024 * 1024 }))`. Run `rg -n "Outlines are read by AI" src test` and update what it finds.

- [ ] **Step 9: Run the tests and typecheck**

Run: `npx vitest run src`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/sheet/ai-sheet.tsx src/components/sheet/sheet.tsx src/components/sheet/import-sheet.tsx src/components/sheet/settings-sheet.tsx src/data/import-edit.ts src/data/school-edit.ts src/data/overlay.ts src/data/actions.ts src/components/top-bar.tsx src/components/top-bar.test.tsx src/components/sheet/ai-import.test.tsx src/components/sheet/settings-sheet.test.tsx src/components/sheet/sheet.test.tsx src/components/sheet/study-sheets.test.tsx
git commit -m "Import with AI in the top bar: a card with the class schedule, the course outline and the school calendar, and the reads left" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

# Part B — Every AI read, made cheaper, sturdier and more accurate

The owner asked to "improve all AI features to fully optimize it". What the three reads (outline, school calendar, class schedule) have after Part A, and what Part B changes:

| | Before | Part B |
|---|---|---|
| **Cost** | gpt-oss-120b, about 300 neurons an outline; the whole extracted text sent, page markers, running headers and footers on every page included; an image sent to `/api/outline` goes to `toMarkdown`, which describes it with a model of its own | Tokens logged per call (Task 1); repeated headers/footers and page numbers dropped (Task 10); pictures refused before any model on the outline and calendar routes (Task 10); a timetable's text capped at 16,000 characters (Task 10); the same file read again on this device costs nothing (Task 12) |
| **Reliability** | An answer that is not JSON is a 502 and a spent read; a hung model call waits until the browser gives up at 120 s | One `askJson` for all three: one repair retry inside the same read; a 100 s timeout answered as `ai_timeout` (Task 9); Cancel aborts the request (Task 5) |
| **Accuracy** | The model guesses a semester's name and a course code's spelling; dates years away and classes at 1 am get through | The school's semester names and your course codes told to the model (Task 11); dates more than 18 months from today dropped to "no date" (they land in the preview's notes); "1:00" classes read as 13:00; the same class twice kept once (Task 11) |
| **UX** | A spinner and a stage line; no Cancel; no reads left | Done in Part A: three real steps, Cancel, the reads left in the card and Settings |

Not changed, on purpose: the outline's and calendar's model, prompt rules and reasoning effort (scored 20/21 on real outlines; re-scoring costs about 1,800 neurons), and JSON mode for gpt-oss (not tried in the scoring). Their costs are now logged, so this can be decided with numbers later.

### Task 9: One JSON ask for every read: a repair retry and a timeout

**Files:**
- Modify: `worker/ai.js`, `worker/outline.js`, `worker/school.js`, `worker/schedule.js`
- Modify: `test/ai.test.js`
- Modify: `src/data/ai-read.ts`, `src/components/overlays.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `test/ai.test.js`, change the imports to:

```js
import { describe, it, expect, vi } from 'vitest';
import { runModel, askJson, modelJson } from '../worker/ai.js';
import { HttpError } from '../worker/http.js';
```

and add:

```js
describe('askJson', () => {
  const clean = (raw) => { const o = modelJson(raw); if (!o || !('ok' in o)) throw new HttpError(502, { error: 'x_unreadable' }); return { ok: o.ok }; };

  it('cleans a JSON answer after one call', async () => {
    const ai = { run: vi.fn(async () => ({ response: 'Here: {"ok":1}' })) };
    expect(await askJson(ai, '@cf/m', { messages: [{ role: 'user', content: 'hi' }] }, clean)).toEqual({ ok: 1 });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it('asks once more when the answer is not JSON, with that answer and a reminder', async () => {
    const ai = { run: vi.fn().mockResolvedValueOnce({ response: 'Sure! The dates are below.' }).mockResolvedValueOnce({ response: { ok: 2 } }) };
    expect(await askJson(ai, '@cf/m', { messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }, clean)).toEqual({ ok: 2 });
    const second = ai.run.mock.calls[1][1];
    expect(second.max_tokens).toBe(10);
    expect(second.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Sure! The dates are below.' },
      { role: 'user', content: 'That was not one valid JSON object. Answer again with only the JSON object, nothing else.' },
    ]);
  });

  it("gives up after the second try with the reader's own error", async () => {
    const ai = { run: vi.fn(async () => ({ response: 'no' })) };
    await expect(askJson(ai, '@cf/m', { messages: [] }, clean)).rejects.toMatchObject({ status: 502, body: { error: 'x_unreadable' } });
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it('does not retry JSON that the reader finds empty: asking again would cost the same for the same answer', async () => {
    const ai = { run: vi.fn(async () => ({ response: '{}' })) };
    await expect(askJson(ai, '@cf/m', { messages: [] }, clean)).rejects.toMatchObject({ status: 502 });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });
});

describe('a model that does not answer', () => {
  it('is a 504 ai_timeout after the time given', async () => {
    await expect(runModel({ run: () => new Promise(() => {}) }, '@cf/x', {}, 'outline', 10))
      .rejects.toMatchObject({ status: 504, body: { error: 'ai_timeout' } });
  });
});
```

In `src/components/overlays.test.tsx`, add to "puts what went wrong in the note":

```tsx
        await act(() => read(async () => { throw new fake.ApiError(504, { error: "ai_timeout" }) }))
        expect(fake.ui.importNote).toEqual({ text: "The AI took too long to answer. Try again in a minute.", error: true })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/ai.test.js src/components/overlays.test.tsx`
Expected: FAIL: `askJson` and `modelJson` are not exported from `worker/ai.js`; there is no timeout; `ai_timeout` has no message.

- [ ] **Step 3: `worker/ai.js`**

Add the timeout to `runModel` and move `modelJson` here from `worker/outline.js`:

```js
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
```

- [ ] **Step 4: The three readers through it**

In `worker/outline.js`: delete `modelJson` and import it (`import { runModel, askJson, modelJson } from './ai.js';`, and `export { modelJson };` under the imports so nothing else breaks). Change `askModel` to clean the answer itself:

```js
/**
 * A document's text put to the model with `messages(text)` and its answer cleaned by `clean`:
 * {...clean(answer), truncated}. `claim` runs just before the model does: only a document
 * that reaches the model uses one of the day's reads, not a file that could not be converted
 * or has no text.
 */
export async function askModel(ai, { bytes, type, name, claim }, messages, clean, { effort, maxTokens = MAX_TOKENS, what = 'outline' } = {}) {
  let text = (await outlineText(ai, bytes, type, name)).trim();
  if (text.length < 40) throw new HttpError(422, { error: 'outline_empty' });
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);
  if (claim) await claim();
  const input = { messages: messages(text), max_tokens: maxTokens, temperature: 0, ...(effort ? { reasoning: { effort } } : {}) };
  return { ...await askJson(ai, MODEL, input, clean, what), truncated };
}

export async function readOutline(ai, { today, termStart, ...doc }) {
  return askModel(ai, doc, (text) => prompt(text, today, termStart), cleanOutline);
}
```

(`runModel` is no longer used in `outline.js`; drop it from the import if the linter or typecheck says so.)

In `worker/school.js`: import `modelJson` from `./ai.js` (keep `DAYS, dayIndex, askModel` from `./outline.js`), and:

```js
export async function readSchool(ai, { today, ...doc }) {
  return askModel(ai, doc, (text) => prompt(text, today), cleanSchool, { what: 'calendar' });
}
```

In `worker/schedule.js`: import `askJson, modelJson` from `./ai.js` (and no longer `modelJson` from `./outline.js`, nor `runModel`). `askImage` becomes:

```js
async function askImage(ai, { bytes, type, claim }, today) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, { error: 'too_large' });
  if (claim) await claim();
  return askJson(ai, VISION_MODEL, {
    messages: [
      { role: 'system', content: RULES.join(' ') },
      { role: 'user', content: [
        { type: 'text', text: 'Today is ' + today + '. Read this timetable.' },
        { type: 'image_url', image_url: { url: 'data:' + type.toLowerCase() + ';base64,' + toBase64(bytes) } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: VISION_TOKENS,
    temperature: 0,
  }, cleanSchedule, 'schedule');
}
```

and `readSchedule`:

```js
export async function readSchedule(ai, { today, ...doc }) {
  if (/^image\//i.test(doc.type || '')) {
    /* toMarkdown would describe other pictures with a model of its own: refuse them here */
    if (!IMAGE_TYPES.test(doc.type)) throw new HttpError(415, { error: 'image_unsupported' });
    return { ...await askImage(ai, doc, today), truncated: false };
  }
  return askModel(ai, doc, (text) => textPrompt(text, today), cleanSchedule, { effort: 'low', maxTokens: TEXT_TOKENS, what: 'schedule' });
}
```

- [ ] **Step 5: The message (`src/data/ai-read.ts`)**

Add to `AI_ERRORS`:

```ts
    ai_timeout: "The AI took too long to answer. Try again in a minute.",
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/ai.test.js test/outline.test.js test/school.test.js test/schedule.test.js src/components/overlays.test.tsx`
Expected: PASS. (In `test/outline.test.js` "reads JSON from text, fenced text and a chat-completions reply" still passes: `cleanOutline` uses `modelJson` as before.)

- [ ] **Step 7: Commit**

```bash
git add worker/ai.js worker/outline.js worker/school.js worker/schedule.js test/ai.test.js src/data/ai-read.ts src/components/overlays.test.tsx
git commit -m "Every AI read asks once more when the answer is not JSON, and gives up after 100 seconds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 10: Less to read: headers and page numbers dropped, pictures refused where they cost, a timetable capped

**Files:**
- Modify: `worker/ai.js`, `worker/outline.js`, `worker/schedule.js`
- Modify: `test/ai.test.js`, `test/outline.test.js`, `test/schedule.test.js`
- Modify: `src/data/ai-read.ts`

- [ ] **Step 1: Write the failing tests**

In `test/ai.test.js`, add `tidyText` to the import from `../worker/ai.js`, and:

```js
describe('tidyText', () => {
  const page = (n, body) => '### Page ' + n + '\nCHEM 271 · Fall 2026 · Concordia University\n' + body + '\nPage ' + n + ' of 4';
  const doc = [
    page(1, 'Schedule\nWeek 1 Intro\n7\nLEC\nReading: ch. 1'),
    page(2, 'Week 7\nTerm test 1\nLEC\nRoom H-110\nReading: ch. 7'),
    page(3, 'Week 9\nQuiz 2\nLEC\nRoom H-110\nReading: ch. 9'),
    page(4, 'Week 13\nFinal review\nFinal exam\nDecember\nGood luck'),
  ].join('\n\n');

  it('keeps a running header once, and drops page markers and page numbers', () => {
    const out = tidyText(doc);
    expect(out.match(/CHEM 271 · Fall 2026/g)).toHaveLength(1);
    expect(out).not.toMatch(/Page \d/);
    expect(out).toContain('Term test 1');
    expect(out.length).toBeLessThan(doc.length);
  });

  it('keeps what repeats inside the pages, and a lone number that is not at a page edge', () => {
    const out = tidyText(doc);
    expect(out.match(/^LEC$/gm)).toHaveLength(3);
    expect(out.match(/^Room H-110$/gm)).toHaveLength(2);
    expect(out).toMatch(/^7$/m);
  });

  it('squeezes spaces and blank lines in text without pages', () => {
    expect(tidyText('a   b\t c\n\n\n\nd')).toBe('a b c\nd');
  });
});
```

In `test/outline.test.js`, add to `describe('readOutline', …)`:

```js
  it('refuses a picture before any model or read: toMarkdown would describe it with a model', async () => {
    const ai = fakeAi(MODEL_REPLY);
    const claim = vi.fn();
    await expect(readOutline(ai, { bytes: new Uint8Array(400), type: 'image/png', name: 'x.png', today: '2026-09-23', claim }))
      .rejects.toMatchObject({ status: 415, body: { error: 'image_unsupported' } });
    expect(ai.calls).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
  });

  it('sends the text tidied', async () => {
    const ai = fakeAi(MODEL_REPLY);
    const text = ['### Page 1', 'PHARM 101 header', OUTLINE, 'Page 1 of 3', '### Page 2', 'PHARM 101 header', 'More', 'Page 2 of 3', '### Page 3', 'PHARM 101 header', 'End', 'Page 3 of 3'].join('\n');
    await readOutline(ai, { bytes: new TextEncoder().encode(text), type: 'text/plain', today: '2026-09-23' });
    const sent = ai.calls[0][2].messages[1].content;
    expect(sent.match(/PHARM 101 header/g)).toHaveLength(1);
    expect(sent).not.toContain('Page 2 of 3');
  });
```

(add `vi` to the `vitest` import at the top of `test/outline.test.js`).

In `test/schedule.test.js`, add to `describe('readSchedule, text', …)`:

```js
  it('reads at most 16,000 characters of a timetable', async () => {
    const ai = fakeAi(REPLY);
    const long = Array.from({ length: 1200 }, (_, i) => 'CHEM 271 LEC Mon 09:00 row ' + i).join('\n');
    const out = await readSchedule(ai, { bytes: new TextEncoder().encode(long), type: 'text/plain', today: '2026-09-01' });
    expect(out.truncated).toBe(true);
    expect(ai.calls[0][1].messages[1].content.length).toBeLessThan(16_200);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/ai.test.js test/outline.test.js test/schedule.test.js`
Expected: FAIL: `tidyText` is not exported; a PNG goes to `toMarkdown`; the timetable is not capped.

- [ ] **Step 3: `tidyText` (`worker/ai.js`)**

```js
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
```

(The squeeze test has one "page" of two lines: `'a b c\nd'`. A plain-text upload without markers is one page, so only its first and last two lines can be a page number, and nothing repeats on 3 pages.)

- [ ] **Step 4: Use it, refuse pictures, cap a timetable (`worker/outline.js`, `worker/schedule.js`)**

In `worker/outline.js`, import `tidyText` from `./ai.js`. At the top of `outlineText`:

```js
  /* toMarkdown describes a picture with an AI model of its own (and its neurons); timetable
     screenshots go to /api/ai/schedule instead */
  if (/^image\//i.test(type || '')) throw new HttpError(415, { error: 'image_unsupported' });
```

In `askModel`, add the option `maxChars = MAX_CHARS` and tidy first:

```js
export async function askModel(ai, { bytes, type, name, claim }, messages, clean, { effort, maxTokens = MAX_TOKENS, maxChars = MAX_CHARS, what = 'outline' } = {}) {
  let text = tidyText(await outlineText(ai, bytes, type, name));
  if (text.length < 40) throw new HttpError(422, { error: 'outline_empty' });
  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);
```

(the rest as in Task 9).

In `worker/schedule.js`, add `const TEXT_CHARS = 16_000;    /* a timetable is a page or two; a long PDF picked by mistake costs no more than this */` under `TEXT_TOKENS`, and pass `maxChars: TEXT_CHARS` in `readSchedule`'s `askModel` options.

- [ ] **Step 5: The message (`src/data/ai-read.ts`)**

Add to `AI_ERRORS`:

```ts
    image_unsupported: "That is a picture. Outlines and calendars need a PDF, Word or text file; a timetable screenshot goes under Class schedule.",
```

(`readScheduleFile`'s own `image_unsupported` message comes first for timetables.)

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/ai.test.js test/outline.test.js test/school.test.js test/schedule.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/ai.js worker/outline.js worker/schedule.js test/ai.test.js test/outline.test.js test/schedule.test.js src/data/ai-read.ts
git commit -m "AI reads send less: running headers and page numbers dropped, pictures refused before toMarkdown, a timetable capped at 16,000 characters" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 11: What the app knows, told to the model; the answers checked

**Files:**
- Modify: `worker/ai.js`, `worker/outline.js`, `worker/schedule.js`, `worker/api.js`
- Modify: `test/ai.test.js`, `test/outline.test.js`, `test/schedule.test.js`
- Create: `src/data/ai-context.ts`
- Modify: `src/core/api.ts`, `test/api-client.test.js`, `src/data/import-edit.ts`, `src/data/schedule-edit.ts`, `src/components/sheet/ai-import.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `test/ai.test.js`, add `knownContext, listParam` to the import from `../worker/ai.js`, and:

```js
describe('what the app knows', () => {
  it('reads the lists sent with a read, bounded', () => {
    expect(listParam('Fall 2026| Winter 2027 ||', '|', 6, 40)).toEqual(['Fall 2026', 'Winter 2027']);
    expect(listParam(null, ',', 30, 8)).toEqual([]);
    expect(listParam('A,B,C', ',', 2, 8)).toEqual(['A', 'B']);
    expect(listParam('CHEM271XYZ', ',', 30, 8)).toEqual(['CHEM271X']);
  });

  it('says the semesters and the course codes in a sentence each', () => {
    expect(knownContext({ terms: ['Fall 2026', 'Winter 2027'], codes: ['CHEM271'] }))
      .toBe('The school\'s semesters are named "Fall 2026", "Winter 2027"; when the document is for one of them, write term exactly as that name. The student\'s courses so far have the codes CHEM271; when a course is one of these, write its code exactly like that.');
    expect(knownContext({})).toBe('');
  });
});
```

In `test/outline.test.js`, add to `describe('readOutline', …)`:

```js
  it('tells the model the semesters and course codes, and drops dates far from today', async () => {
    const ai = fakeAi({ ...MODEL_REPLY, assessments: [{ title: 'Midterm exam', type: 'exam', date: '2016-10-20', weight: 30 }, { title: 'Final', type: 'exam', date: '2026-12-15', weight: 50 }] });
    const out = await readOutline(ai, { bytes: new TextEncoder().encode(OUTLINE), type: 'text/plain', today: '2026-09-23', terms: ['Fall 2026', 'Winter 2027'], codes: ['PHARM101'] });
    const user = ai.calls[0][2].messages[1].content;
    expect(user).toContain('"Fall 2026", "Winter 2027"');
    expect(user).toContain('the codes PHARM101');
    expect(out.assessments.map((a) => [a.title, a.date])).toEqual([['Midterm exam', ''], ['Final', '2026-12-15']]);
  });
```

In `test/schedule.test.js`, add:

```js
describe('the answers checked', () => {
  it('reads a "1:00" class as 13:00 and keeps the same class once', () => {
    expect(cleanClasses([
      { kind: 'Lecture', day: 'Mon', start: '1:00', end: '2:30' },
      { kind: 'Lecture', day: 'Mon', start: '13:00', end: '14:30' },
      { kind: 'Lab', day: 'Tue', start: '08:00', end: '11:00' },
    ])).toEqual([
      { kind: 'Lecture', weekday: 1, start: '13:00', end: '14:30', room: '' },
      { kind: 'Lab', weekday: 2, start: '08:00', end: '11:00', room: '' },
    ]);
  });

  it('tells both models the semesters and course codes', async () => {
    const known = { terms: ['Fall 2026'], codes: ['CHEM271'] };
    const text = fakeAi(REPLY);
    await readSchedule(text, { bytes: new TextEncoder().encode(TIMETABLE), type: 'text/plain', today: '2026-09-01', ...known });
    expect(text.calls[0][1].messages[1].content).toContain('"Fall 2026"');
    const image = fakeAi(REPLY);
    await readSchedule(image, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), type: 'image/jpeg', today: '2026-09-01', ...known });
    expect(image.calls[0][1].messages[1].content[0].text).toContain('the codes CHEM271');
  });
});
```

In `test/api-client.test.js`, add:

```js
  it('sends what the app knows with an AI read', async () => {
    respond({});
    await client.api.readOutline(new Blob(['x'], { type: 'text/plain' }), { name: 'o.pdf', today: '2026-10-01', termStart: '', terms: 'Fall 2026|Winter 2027', codes: 'CHEM271' });
    expect(fetch.mock.calls[0][0]).toBe('/api/outline?name=o.pdf&today=2026-10-01&terms=Fall+2026%7CWinter+2027&codes=CHEM271');
  });
```

In `src/components/sheet/ai-import.test.tsx`, add:

```tsx
describe("what a read is told", () => {
    it("is the school calendar's semesters and the codes of the courses kept", async () => {
        const { readContext } = await import("@/data/ai-context")
        expect(readContext()).toEqual({})
        fake.cal = CAL
        fake.data.courses = [CHEM, { ...CHEM, id: "c2", code: "OLD1", archived: true }]
        expect(readContext()).toEqual({ terms: "Fall 2026|Winter 2027", codes: "CHEM271" })
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/ai.test.js test/outline.test.js test/schedule.test.js test/api-client.test.js src/components/sheet/ai-import.test.tsx`
Expected: FAIL: `knownContext`, `listParam` and `@/data/ai-context` do not exist; the prompts say nothing of semesters; old dates and "1:00" pass through.

- [ ] **Step 3: `worker/ai.js`**

```js
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
```

- [ ] **Step 4: The route passes them (`worker/api.js`)**

Import `listParam` from `./ai.js`, and in `aiRead`'s call to `read`, add beside `termStart`:

```js
      terms: listParam(url.searchParams.get('terms'), '|', 6, 40), codes: listParam(url.searchParams.get('codes'), ',', 30, 8),
```

- [ ] **Step 5: The readers use them, and check the answers**

In `worker/outline.js`, import `knownContext` from `./ai.js`. `prompt` takes the context and adds it to the user's message:

```js
function prompt(text, today, termStart, known = '') {
```

```js
      content: 'Today is ' + today + '.' + (termStart ? ' The term started on ' + termStart + '.' : '') + (known ? ' ' + known : '') + '\n\nCourse outline:\n\n' + text,
```

`readOutline` passes it and `today` for the date check:

```js
export async function readOutline(ai, { today, termStart, terms, codes, ...doc }) {
  return askModel(ai, doc, (text) => prompt(text, today, termStart, knownContext({ terms, codes })), (raw) => cleanOutline(raw, { today }));
}
```

In `cleanOutline(raw, { today } = {})`, keep a date only within 18 months of today (a date years away is a misread year; it shows as "no date" in the preview's notes):

```js
  const near = (d) => !d || !today || Math.abs(Date.parse(d) - Date.parse(today)) <= 548 * 86_400_000;
```

and in the assessments' map: `date: near(cleanDate(a?.date)) ? cleanDate(a?.date) : '',`.

In `cleanClasses`, read a small-hours time as the afternoon and keep each weekday-and-start once:

```js
/* "1:00" in a timetable that leaves out am/pm is 13:00: no class starts between midnight and 6 */
const daytime = (t) => (t && t < '06:00' ? String(+t.slice(0, 2) + 12).padStart(2, '0') + t.slice(2) : t);

export function cleanClasses(list, max = 12) {
  return (Array.isArray(list) ? list : []).map((c) => {
    const start = daytime(cleanTime(c?.start)), end = daytime(cleanTime(c?.end));
    return { kind: cleanKind(c?.kind), weekday: dayIndex(c?.day), start, end: end > start ? end : '', room: clip(c?.room, 40) };
  }).filter((c, i, all) => c.weekday >= 0 && c.start && all.findIndex((x) => x.weekday === c.weekday && x.start === c.start) === i).slice(0, max);
}
```

In `worker/schedule.js`, import `knownContext` from `./ai.js`; `textPrompt(text, today, known = '')` puts `(known ? ' ' + known : '')` after `'Today is ' + today + '.'`; `askImage(ai, doc, today, known = '')` makes its text part `'Today is ' + today + '.' + (known ? ' ' + known : '') + ' Read this timetable.'`; and `readSchedule(ai, { today, terms, codes, ...doc })` computes `const known = knownContext({ terms, codes })` and passes it to both.

- [ ] **Step 6: The browser sends them**

Create `src/data/ai-context.ts`:

```ts
// What the app already knows that helps an AI read, sent with it: the school calendar's
// semester names (so a read's term matches one of them) and the codes of your courses (so a
// course found is written the way yours is). See worker/ai.js, knownContext.

import { data } from "@/core/store"
import { schoolCal } from "@/data/query"

export function readContext(): { terms?: string; codes?: string } {
    const cal = schoolCal()
    const terms = cal ? cal.terms.map((t) => t.name).join("|") : ""
    const codes = data.courses.filter((c) => !c.archived && c.code).map((c) => c.code).slice(0, 30).join(",")
    return { ...(terms ? { terms } : {}), ...(codes ? { codes } : {}) }
}
```

In `src/core/api.ts`, add above `export const api`:

```ts
/* A read's query: only the values given, in the order given. */
const query = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString()
type ReadQuery = { name: string; today: string; termStart?: string; terms?: string; codes?: string }
```

and make the three reads use it:

```ts
  readOutline: (file: Blob, q: ReadQuery, signal?: AbortSignal) => request('POST', '/api/outline?' + query(q), file, undefined, signal),
  readSchool: (file: Blob, q: ReadQuery, signal?: AbortSignal) => request('POST', '/api/school-calendar?' + query(q), file, undefined, signal),
  readSchedule: (file: Blob, q: ReadQuery, signal?: AbortSignal) => request('POST', '/api/ai/schedule?' + query(q), file, undefined, signal),
```

In `src/data/import-edit.ts`, `readOutlineFile`'s call becomes `api.readOutline(body, { name: file.name, today: today(), termStart: termStart() || "", ...readContext() }, signal)`; in `src/data/schedule-edit.ts`, `api.readSchedule(body, { name: file.name, today: today(), ...readContext() }, signal)` (import `readContext` from `./ai-context`). The calendar read sends nothing more: it is where the semesters come from.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run test/ai.test.js test/outline.test.js test/school.test.js test/schedule.test.js test/api-client.test.js src/components/sheet/ai-import.test.tsx`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add worker/ai.js worker/outline.js worker/schedule.js worker/api.js test/ai.test.js test/outline.test.js test/schedule.test.js test/api-client.test.js src/data/ai-context.ts src/core/api.ts src/data/import-edit.ts src/data/schedule-edit.ts src/components/sheet/ai-import.test.tsx
git commit -m "AI reads are told the school's semesters and your course codes; dates years away and 1 am classes are corrected or dropped" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 12: The same file twice costs nothing

**Files:**
- Create: `src/data/ai-cache.ts`, `src/data/ai-cache.test.ts`
- Modify: `src/data/ai-read.ts`, `src/data/import-edit.ts`, `src/data/school-edit.ts`, `src/data/schedule-edit.ts`, `src/data/session.ts`
- Modify: `src/components/overlays.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/data/ai-cache.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { webcrypto } from "node:crypto"
import { cacheKey, cached, forgetReads, remember } from "./ai-cache"

beforeAll(() => { if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto) })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

const DAY = 86_400_000

describe("answers remembered on this device", () => {
    it("are found by the file and the words of the read", async () => {
        const a = await cacheKey(["outline", "u1"], new Blob(["text"]))
        expect(a).toMatch(/^[0-9a-f]{64}$/)
        expect(await cacheKey(["outline", "u1"], new Blob(["text"]))).toBe(a)
        expect(await cacheKey(["outline", "u2"], new Blob(["text"]))).not.toBe(a)
        expect(await cacheKey(["timetable", "u1"], new Blob(["text"]))).not.toBe(a)
        expect(await cacheKey(["outline", "u1"], new Blob(["text!"]))).not.toBe(a)
    })

    it("are kept 30 days, the newest 12", () => {
        remember("k0", { a: 1 }, 1000)
        expect(cached("k0", 2000)).toEqual({ a: 1 })
        expect(cached("k0", 1000 + 31 * DAY)).toBeNull()
        for (let i = 1; i <= 12; i++) remember("k" + i, i, 2000 + i)
        expect(cached("k0", 3000)).toBeNull()
        expect(cached("k12", 3000)).toBe(12)
        expect(cached("k1", 3000)).toBe(1)
    })

    it("are forgotten on sign-out, and nothing breaks without storage", () => {
        remember("k", 1)
        forgetReads()
        expect(cached("k")).toBeNull()
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
        expect(() => remember("k", 1)).not.toThrow()
        expect(cached("k")).toBeNull()
    })
})
```

In `src/components/overlays.test.tsx`, add `import { webcrypto } from "node:crypto"` and `beforeAll(() => { if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto) })` (add `beforeAll` to the vitest import), `localStorage.clear()` to `afterEach`, and inside `describe("the reading card", …)`:

```tsx
    it("answers the same file again from this device, using no read", async () => {
        const call = vi.fn(async () => ({ ok: 1 }))
        const done = vi.fn()
        const opts = { what: "outline", title: "T", steps: STEPS, flag: "outlineBusy" as const, note: "importNote" as const, errors: {}, cache: ["outline", "u1"], call, done, refresh: vi.fn() }
        await act(() => readWithAi(file(), opts))
        await act(() => readWithAi(file(), opts))
        expect(call).toHaveBeenCalledTimes(1)
        expect(done).toHaveBeenNthCalledWith(2, { ok: 1 })
        await act(() => readWithAi(file(), { ...opts, cache: ["outline", "u2"] }))
        expect(call).toHaveBeenCalledTimes(2)
    })

    it("remembers no failed read", async () => {
        const call = vi.fn().mockRejectedValueOnce(new fake.ApiError(503, { error: "outline_unavailable" })).mockResolvedValueOnce({ ok: 2 })
        const opts = { what: "outline", title: "T", steps: STEPS, flag: "outlineBusy" as const, note: "importNote" as const, errors: {}, cache: ["outline", "u3"], call, done: vi.fn(), refresh: vi.fn() }
        await act(() => readWithAi(file(), opts))
        await act(() => readWithAi(file(), opts))
        expect(call).toHaveBeenCalledTimes(2)
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/ai-cache.test.ts src/components/overlays.test.tsx`
Expected: FAIL: `src/data/ai-cache.ts` does not exist; `readWithAi` has no `cache`.

- [ ] **Step 3: `src/data/ai-cache.ts`**

```ts
// AI reads remembered on this device: the same file read again (the same text or picture,
// for the same kind of read, account, month and semesters) answers from here at once, using
// no read and no neurons. Kept in localStorage for 30 days, the newest 12; never synced;
// forgotten on sign-out (data/session.ts). Without storage or WebCrypto, nothing is kept.

const KEY = "term.aiReads"
const DAYS_30 = 30 * 86_400_000
const KEEP = 12
interface Entry { k: string; at: number; answer: unknown }

/** The SHA-256 of the read's words and the file as sent, in hex; null where WebCrypto is missing. */
export async function cacheKey(parts: string[], body: Blob): Promise<string | null> {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const head = new TextEncoder().encode(parts.join("\n") + "\n\n")
    const file = new Uint8Array(await body.arrayBuffer())
    const all = new Uint8Array(head.length + file.length)
    all.set(head)
    all.set(file, head.length)
    return Array.from(new Uint8Array(await subtle.digest("SHA-256", all)), (b) => b.toString(16).padStart(2, "0")).join("")
}

function load(): Entry[] {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || "[]")
        return Array.isArray(v) ? v : []
    } catch { return [] }
}

/** The answer remembered for `k`, or null. */
export function cached(k: string, now = Date.now()): unknown {
    return load().find((e) => e.k === k && now - e.at < DAYS_30)?.answer ?? null
}

export function remember(k: string, answer: unknown, now = Date.now()) {
    const keep = [{ k, at: now, answer }, ...load().filter((e) => e.k !== k && now - e.at < DAYS_30)].slice(0, KEEP)
    try { localStorage.setItem(KEY, JSON.stringify(keep)) } catch { /* full or blocked: not kept */ }
}

export function forgetReads() {
    try { localStorage.removeItem(KEY) } catch { /* blocked */ }
}
```

- [ ] **Step 4: `readWithAi` asks it first (`src/data/ai-read.ts`)**

Import `{ cacheKey, cached, remember }` from `./ai-cache`. Add to `AiRead<T>`:

```ts
    /** the words that, with the file as sent, find a remembered answer: the kind, the account, … */
    cache?: string[]
```

take `cache` in the destructuring, and replace the lines from `show(1)` to `const answer = …`:

```ts
        const key = cache ? await cacheKey(cache, body).catch(() => null) : null
        const hit = key ? cached(key) : null
        show(1)
        const answer = hit != null ? hit as T : await call(body, stop.signal)
        stop.signal.throwIfAborted()
        if (key && hit == null) remember(key, answer)
```

(keep the `stop.signal.throwIfAborted()` that was after `call`; it is the one above.)

- [ ] **Step 5: The three reads say what finds them**

In `src/data/import-edit.ts`'s `readOutlineFile`, add:

```ts
        cache: ["outline", String(data.profile?.id ?? ""), today().slice(0, 7), termStart() || "", JSON.stringify(readContext())],
```

In `src/data/schedule-edit.ts`'s `readScheduleFile`:

```ts
        cache: ["timetable", String(data.profile?.id ?? ""), today().slice(0, 7), JSON.stringify(readContext())],
```

In `src/data/school-edit.ts`'s `readSchoolFile` (import `data` from `@/core/store` if it is not there):

```ts
        cache: ["calendar", String(store.data.profile?.id ?? ""), today().slice(0, 7)],
```

(the month is in the key because the model places dates by today's date; a read from another month asks again.)

In `src/data/session.ts`, import `forgetReads` from `./ai-cache`, and in `signOut` call `forgetReads()` on the line before `if (id) {`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/data src/components`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/ai-cache.ts src/data/ai-cache.test.ts src/data/ai-read.ts src/data/import-edit.ts src/data/school-edit.ts src/data/schedule-edit.ts src/data/session.ts src/components/overlays.test.tsx
git commit -m "A file read with AI again on the same device answers from there, using no read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 13: The real models, once (at most 4 calls)

The only task that spends the allowance. **Budget: at most 4 model calls, about 750 neurons**:

| # | File | Path | Estimate |
|---|---|---|---|
| 1 | `timetable.png` (1400×900 screenshot) | Llama 4 Scout | ~110 neurons |
| 2 | `timetable.pdf` | gpt-oss-120b, low effort | ~110 |
| 3 | `test/fixtures/outline.txt` | gpt-oss-120b, as outlines are read | ~250 |
| 4 | spare: one re-run after a prompt fix, or the licence call | — | ≤ 280 |

Stop at once on a 429 `outline_quota` (error 4006): the live site has no reads left either until 00:00 UTC; say so in the report. A repair retry (Task 9) is a call: count it.

**Files:**
- Create: `test/fixtures/timetable.html`, `test/fixtures/outline.txt`, `test/fixtures/schedule-vision-reply.json`, `test/fixtures/schedule-text-reply.json`
- Modify: `test/schedule.test.js`, and the cost comments in `worker/schedule.js` (and the prompt, only if a fact comes back wrong)

- [ ] **Step 1: The sample timetable and outline**

Create `test/fixtures/timetable.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fall 2026 class schedule</title>
<style>
body { font: 14px/1.4 Arial, sans-serif; margin: 32px; color: #222; width: 1100px }
h1 { font-size: 20px; margin: 0 0 4px }
p { margin: 0 0 16px; color: #555 }
table { border-collapse: collapse; width: 100% }
th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left }
th { background: #e8edf3 }
.foot { margin-top: 16px }
</style>
</head>
<body>
<h1>My Class Schedule — Fall 2026</h1>
<p>Student: Alex Rivera · Program: B.Sc. Biochemistry · Printed 2026-08-28</p>
<table>
<tr><th>Course</th><th>Title</th><th>Section</th><th>Component</th><th>Days</th><th>Time</th><th>Room</th><th>Instructor</th></tr>
<tr><td>CHEM 271</td><td>Organic Chemistry I</td><td>01</td><td>LEC</td><td>Tu Th</td><td>8:30 AM – 10:00 AM</td><td>H-110</td><td>Dr. A. Okafor</td></tr>
<tr><td>CHEM 271</td><td>Organic Chemistry I</td><td>01A</td><td>LAB</td><td>Fr</td><td>1:00 PM – 4:00 PM</td><td>SP-265</td><td>Staff</td></tr>
<tr><td>PHYS 205</td><td>Waves and Optics</td><td>02</td><td>LEC</td><td>Mo We</td><td>9:00 AM – 10:30 AM</td><td>Hall B</td><td>Dr. J. Chen</td></tr>
<tr><td>PHYS 205</td><td>Waves and Optics</td><td>02T</td><td>TUT</td><td>We</td><td>3:00 PM – 4:00 PM</td><td>Room 2.04</td><td>Staff</td></tr>
<tr><td>BIOL 266</td><td>Cell Biology</td><td>01</td><td>LEC</td><td>Mo</td><td>1:00 PM – 2:30 PM</td><td>CC-301</td><td>Dr. M. Roy</td></tr>
<tr><td>BIOL 266</td><td>Cell Biology</td><td>01L</td><td>LAB</td><td>Th</td><td>2:00 PM – 5:00 PM</td><td>SP-110</td><td>Staff</td></tr>
</table>
<p class="foot">Final exams are scheduled separately. Reading week: 12–16 October (no classes).</p>
</body>
</html>
```

The facts it holds (8 classes): CHEM 271 Lecture Tue and Thu 08:30–10:00 H-110, Lab Fri 13:00–16:00 SP-265; PHYS 205 Lecture Mon and Wed 09:00–10:30 Hall B, Tutorial Wed 15:00–16:00 Room 2.04; BIOL 266 Lecture Mon 13:00–14:30 CC-301, Lab Thu 14:00–17:00 SP-110.

Create `test/fixtures/outline.txt` (three pages as the browser's PDF reader writes them, with a running header and page numbers for `tidyText`):

```text
### Page 1
CHEM 271 · Organic Chemistry I · Fall 2026
Concordia University, Department of Chemistry and Biochemistry
Instructor: Dr. Ada Okafor (ada.okafor@example.edu)
Lectures: Tuesday and Thursday 8:30–10:00, H-110
Laboratory: Friday 13:00–16:00, SP-265
Office hours: Wednesday 14:00–15:30, SP-201, or by appointment
Classes begin Tuesday 8 September 2026.
Page 1 of 3

### Page 2
CHEM 271 · Organic Chemistry I · Fall 2026
Evaluation
Lab reports (6 × 3%) 18%
Term test 1 — 29 September 2026 — 15%
Term test 2 — 3 November 2026 — 20%
Problem sets, due in weeks 3, 6 and 9 (4% each) 12%
Final exam (December exam period) 35%
Page 2 of 3

### Page 3
CHEM 271 · Organic Chemistry I · Fall 2026
Weekly schedule
Week 1 (8 Sep) Structure and bonding
Week 3 Problem set 1 due
Week 6 Problem set 2 due
Week 9 Problem set 3 due
Week 13 Review
Page 3 of 3
```

Render the timetable with headless Chrome into the scratchpad (not the repo):

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
OUT="$TEMP/term-stage7"; mkdir -p "$OUT"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1400,900 --screenshot="$OUT/timetable.png" "file:///$(pwd -W)/test/fixtures/timetable.html"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT/timetable.pdf" "file:///$(pwd -W)/test/fixtures/timetable.html"
ls -l "$OUT"
```

Expected: `timetable.png` (about 60–150 KB) and `timetable.pdf`. Open the PNG with the Read tool to check it shows the table.

- [ ] **Step 2: Log the replies, for this task only**

In `worker/ai.js`'s `runModel`, under the `usage` log line, add **temporarily**:

```js
  console.log(`${what} reply: ` + JSON.stringify(out?.response ?? out));   // TASK 13 ONLY: remove before committing
```

- [ ] **Step 3: The three reads (calls 1–3)**

Start the dev server (How to work, 2), sign in as `termqa`, open Import with AI, and read, one at a time, watching the reading card and the dev server's terminal:
1. **Class schedule** ← `timetable.png`;
2. **Class schedule** ← `timetable.pdf`;
3. **Course outline** ← `test/fixtures/outline.txt`.

For each, copy from the terminal the `… in=N out=M` line and the `… reply: {…}` line. In each preview, check the facts above (for the outline: Tue/Thu 08:30 lectures, Fri lab, Wednesday office hours, Term test 1 on 29 Sep at 15%, Term test 2 on 3 Nov at 20%, the problem sets in weeks 3, 6 and 9, the final without a date in the notes, term start 8 Sep). Don't press Add or Import (the test user's data stays as it is); close each preview with ✕.

If Scout answers with an error that asks to agree to a licence, **stop and report it**: agreeing to Meta's licence is the owner's call (the spare call can then be the `agree`, on their word). If Scout refuses `response_format` (an input error naming it), change it to `{ type: 'json_object' }` in `askImage` (and the test), and use the spare call to read the PNG again. If gpt-oss refuses `reasoning`, remove the `effort: 'low'` option from `readSchedule` (and its test) and use the spare call for the PDF again.

- [ ] **Step 4: Save the replies and the cost**

Save the two schedule replies (the JSON after `reply: `) as `test/fixtures/schedule-vision-reply.json` and `test/fixtures/schedule-text-reply.json`, pretty-printed (`node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')),null,2)+'\n')"`). Work out each call's neurons: Scout `in × 24,545/1e6 + out × 77,273/1e6`; gpt-oss `in × 31,818/1e6 + out × 68,182/1e6`. Put the two measured schedule figures in the cost comments in `worker/schedule.js` (replace "About 110 neurons…" and "Measured in Task 13." with the numbers and the date), and the outline figure in the "Cost:" comment of `worker/outline.js` if it differs from "about 300 neurons" by more than a third.

If a fact came back wrong: decide whether the prompt (`RULES`) or the cleaning would fix it; change it; if a call is left in the budget, read that one file again. Never go over 4 calls.

- [ ] **Step 5: The replies as tests**

In `test/schedule.test.js`, add:

```js
import visionReply from './fixtures/schedule-vision-reply.json';
import textReply from './fixtures/schedule-text-reply.json';

describe('the real replies (Task 13)', () => {
  it.each([['screenshot', visionReply], ['PDF', textReply]])('read the sample timetable from a %s', (_, reply) => {
    const out = cleanSchedule(reply);
    expect(out.courses.map((c) => c.code).sort()).toEqual(['BIOL266', 'CHEM271', 'PHYS205']);
    const chem = out.courses.find((c) => c.code === 'CHEM271');
    expect(chem.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Lecture', weekday: 2, start: '08:30', end: '10:00' }),
      expect.objectContaining({ kind: 'Lecture', weekday: 4, start: '08:30', end: '10:00' }),
      expect.objectContaining({ kind: 'Lab', weekday: 5, start: '13:00', end: '16:00', room: 'SP-265' }),
    ]));
    expect(out.courses.find((c) => c.code === 'PHYS205').classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Tutorial', weekday: 3, start: '15:00', end: '16:00' }),
    ]));
    expect(out.courses.reduce((n, c) => n + c.classes.length, 0)).toBe(8);
  });
});
```

If a real reply got a fact wrong and there was no call left to fix it, write that expectation to what the reply really says, with a comment naming the miss, and put it in the report.

Run: `npx vitest run test/schedule.test.js` — expected: PASS.

- [ ] **Step 6: Take the reply log out**

Remove the `TASK 13 ONLY` line from `worker/ai.js`. Run: `git diff worker/ai.js` — expected: empty (or only intended changes from Step 3's fixes). Run: `npm run check` with the dev server stopped — expected: typecheck, all tests and the build pass.

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/timetable.html test/fixtures/outline.txt test/fixtures/schedule-vision-reply.json test/fixtures/schedule-text-reply.json test/schedule.test.js worker/schedule.js worker/outline.js
git commit -m "The class schedule read once with the real models: the replies saved as tests, the neurons measured" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

Report: the calls made (≤ 4), each call's tokens and neurons, the total, and any fact the models got wrong.

---

# Part C — Check and release

### Task 14: Look at it

**Files:**
- Modify: whatever the look needs among `src/components/sheet/ai-sheet.tsx`, `schedule-sheet.tsx`, `import-sheet.tsx`, `src/components/overlays.tsx`, `src/components/top-bar.tsx` (spacing and colours only; behaviour is covered by tests)

**No new model calls in this task.** Read only the files Task 13 read (`timetable.png`, `timetable.pdf`, `outline.txt`): the device cache answers them at once and the meter does not move. If the meter does go down, stop: the cache is not working; fix it before going on.

- [ ] **Step 1: Look**

Start the dev server (How to work, 2), sign in as `termqa`. Compare with the prototype's import boards in the canvas (https://claude.ai/artifact/9xFvWnbeuFGhLwmuKbNAwV). Check at 1440 px, 1024 px and 390 px wide, in light and dark, and in Medicine and one other theme (the accent changes the spark, the icons, the meter and the steps). The Chrome automation tab may report `visibilityState` "hidden"; nothing here polls, so it doesn't matter.
- the top bar: "Import with AI" with the accent spark between search and New item; at 390 px the spark alone, nothing overflowing, New item still floating;
- the card: the intro line, the three boxes with their icons in the soft accent, the dashed drop areas with "Choose a PDF or image" and "PDF, PNG or JPG · read by AI", the meter and its line, "Paste a calendar or CSV instead" opening; the file dialog filters to the types; keyboard: Tab reaches each drop area (focus ring) and Enter/Space opens the dialog;
- a timetable (`timetable.png` from Task 13): the reading card with the serif title, the mono file name, the three steps ticking (fast, from the cache), then "Read by AI · timetable.png", "Found 3 courses", the boxes with the colour square, the badges (create a course CHEM 271 beforehand in the course sheet to see "Matches your course", and delete it after), the semester picker (set a school calendar in Settings to see it, with its two semesters and "Both semesters"; remove it after if the test user had none), the rows lined up in columns with mono times, unticked rows faded, "Add N classes" counting; at 390 px the rows fit with the room truncated and the semester picker wrapping under the name;
- **Add N classes** once, with a new course: the toast "Added … classes to … courses", the course in the sidebar with its classes on the week; then delete what was added (the test user's data as before);
- an outline (`outline.txt`): today's import preview with the Semester picker under the course (with the school calendar), Cancel going back to the card;
- a school calendar from the card opens the school sheet; from Settings, Import and School calendar still work as before, and Import's hint shows "(N left today)";
- Cancel: pick a long PDF (50 pages or more, if one is on the machine) under Course outline and press Cancel (or Escape) while "Reading the document" is current: the card goes, "Stopped reading." shows in the card, and the meter is unchanged (nothing reached the Worker). Skip if there is no such PDF;
- an error: pick a `.gif` or a `.heic` under Class schedule: "That picture could not be opened…" or "That kind of picture cannot be read…" in the card, and no read used;
- reduced motion (DevTools → Rendering → prefers-reduced-motion): the spinner and the progress line stand still.

Fix what's off in the same files. Then stop the dev server and run `npm run check`; expected: typecheck, all tests and the build pass.

- [ ] **Step 2: Commit**

```bash
git add -A src/components
git commit -m "Import with AI checked in the browser at desktop, tablet and phone widths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

(If nothing needed fixing, skip the commit.)

---

### Task 15: Review and release

The owner has said to finish everything: after the review, merge and push without waiting.

- [ ] **Step 1: Final review**

Request a code review of `git diff term...term-7-import` (superpowers:requesting-code-review), pointing the reviewer at: the claim happening only after the file is ready and just before the model (no read spent on a refused or empty file, including the 415 and 413 paths); the repair retry never claiming twice; the timeout clearing its timer; `send`'s second abort listener removed in `finally`; the device cache keyed by account and forgotten on sign-out; `commitImport` writing a course that exists only when it gains classes or a semester; nothing loaded from another origin (`git diff term...term-7-import -- public/_headers` is empty). Fix what holds up, commit on the branch, and run `npm run check` again.

- [ ] **Step 2: Merge and release**

No migration in this stage (`git diff term...term-7-import -- migrations` is empty), so nothing to run on the remote database.

```bash
git switch term && git merge --no-ff term-7-import -m "Merge term-7-import: Stage 7, Import with AI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
git switch main && git merge --no-ff term -m "Merge term: Stage 7, Import with AI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
git push origin main term
```

The Cloudflare Git build deploys `main`. After it finishes, open the live site: Import with AI in the top bar, the card with the three kinds and the meter (opening it spends nothing). Don't read a file on the live site as a test; the owner's first real timetable is the check.

- [ ] **Step 3: Tell the owner**

What changed (the "What the owner sees" paragraph and Part B's table), the vision model and its measured cost per read, the live calls Task 13 made, and the choices to confirm:
- the routes are `/api/ai/schedule` and `/api/ai/reads` (the master plan's names); the outline and calendar keep theirs;
- school calendars still count as reads (the prototype said they don't);
- Cancel can't give a read back once the file reached the AI;
- the device cache keeps answers for 30 days on that device only;
- the outline preview keeps today's look, with the semester added (the prototype's restyle is not in).
