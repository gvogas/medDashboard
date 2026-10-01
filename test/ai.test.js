import { describe, it, expect, vi } from 'vitest';
import { runModel, askJson, modelJson, tidyText, knownContext, listParam, cleanTerm, timeLeft, TIMEOUT_MS } from '../worker/ai.js';
import { knownParams } from '../worker/api.js';
import { HttpError } from '../worker/http.js';

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

  it('does not retry an answer cut off for length: the retry would be cut off too', async () => {
    const short = { response: '{"ok": 1, "items": [', usage: { prompt_tokens: 5, completion_tokens: 10 } };
    const a = { run: vi.fn(async () => short) };
    await expect(askJson(a, '@cf/m', { messages: [], max_tokens: 10 }, clean)).rejects.toMatchObject({ status: 502 });
    expect(a.run).toHaveBeenCalledTimes(1);
    const chat = { choices: [{ message: { content: '{"ok": 1, "items": [' }, finish_reason: 'length' }] };
    const b = { run: vi.fn(async () => chat) };
    await expect(askJson(b, '@cf/m', { messages: [] }, clean)).rejects.toMatchObject({ status: 502 });
    expect(b.run).toHaveBeenCalledTimes(1);
  });

  it("echoes a chat-completions answer's text, not the wrapper", async () => {
    const ai = { run: vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Sure thing' }, finish_reason: 'stop' }] })
      .mockResolvedValueOnce({ response: { ok: 3 } }) };
    expect(await askJson(ai, '@cf/m', { messages: [{ role: 'user', content: 'hi' }] }, clean)).toEqual({ ok: 3 });
    expect(ai.run.mock.calls[1][1].messages[1]).toEqual({ role: 'assistant', content: 'Sure thing' });
  });

  it('skips the retry when too little of the deadline is left', async () => {
    const ai = { run: vi.fn(() => new Promise((ok) => setTimeout(() => ok({ response: 'no' }), 50))) };
    await expect(askJson(ai, '@cf/m', { messages: [] }, clean, 'x', { timeoutMs: 100, minRetryMs: 60 }))
      .rejects.toMatchObject({ status: 502, body: { error: 'x_unreadable' } });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it('gives the retry only what is left of one deadline', async () => {
    const ai = { run: vi.fn()
      .mockImplementationOnce(() => new Promise((ok) => setTimeout(() => ok({ response: 'no' }), 120)))
      .mockImplementationOnce(() => new Promise(() => {})) };
    const t0 = Date.now();
    await expect(askJson(ai, '@cf/m', { messages: [] }, clean, 'x', { timeoutMs: 200, minRetryMs: 10 }))
      .rejects.toMatchObject({ status: 504, body: { error: 'ai_timeout' } });
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(Date.now() - t0).toBeLessThan(280);
  });
});

describe('a model that does not answer', () => {
  it('is a 504 ai_timeout after the time given', async () => {
    await expect(runModel({ run: () => new Promise(() => {}) }, '@cf/x', {}, 'outline', 10))
      .rejects.toMatchObject({ status: 504, body: { error: 'ai_timeout' } });
  });
});

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

  it('keeps a short line that ends most pages, and a long footer once', () => {
    const quiz = [1, 2, 3].map((n) => '### Page ' + n + '\nWeek ' + n + '\nReading ' + n + '\nQuiz').join('\n\n') + '\n\n### Page 4\nWeek 4\nReview\nFinal';
    expect(tidyText(quiz).match(/^Quiz$/gm)).toHaveLength(3);
    const foot = [1, 2, 3, 4].map((n) => '### Page ' + n + '\nWeek ' + n + '\nTopic ' + n + '\nCHEM 271 · Fall 2026 · Concordia University').join('\n\n');
    expect(tidyText(foot).match(/CHEM 271 · Fall 2026 · Concordia University/g)).toHaveLength(1);
  });

  it("drops only the page's own number, and keeps dates and numbers that are not it", () => {
    const pages = [
      '### Page 1\nIntro\nWeek 1 reading\n1',
      '### Page 2\nWeek 2\nTest on\n9/14\n2/4',
      '### Page 3\n- 3 -\nWeek 3\nRoom\n13',
      '### Page 4\nPage 4 of 4\nWeek 4\nFinal\n3/4',
    ].join('\n\n');
    const out = tidyText(pages);
    expect(out).toMatch(/^9\/14$/m);
    expect(out).toMatch(/^13$/m);
    expect(out).toMatch(/^3\/4$/m);
    expect(out).not.toMatch(/^1$/m);
    expect(out).not.toMatch(/^2\/4$/m);
    expect(out).not.toMatch(/- 3 -|Page 4/);
  });

  it('drops page numbers one off from the markers when the whole document is one off', () => {
    const pages = [1, 2, 3, 4].map((n) => '### Page ' + n + '\nWeek ' + n + '\nTopic ' + n + '\n' + (n + 1)).join('\n\n');
    expect(tidyText(pages)).toBe([1, 2, 3, 4].map((n) => 'Week ' + n + '\nTopic ' + n).join('\n\n'));
  });

  it('counts blank pages in "N/M" footers, and the text before the first marker as no page', () => {
    const blank = ['### Page 1\nWeek 1\nIntro\n1/4', '### Page 2\nWeek 2\nLab\n2/4', '### Page 3\n', '### Page 4\nWeek 4\nFinal\n4/4'].join('\n\n');
    expect(tidyText(blank)).toBe('Week 1\nIntro\n\nWeek 2\nLab\n\nWeek 4\nFinal');
    const lead = 'CHEM 271 outline\n1/2\n\n' + ['### Page 1\nWeek 1\nIntro\n1/2', '### Page 2\nWeek 2\nLab\n2/2'].join('\n\n');
    expect(tidyText(lead)).toBe('CHEM 271 outline\n1/2\n\nWeek 1\nIntro\n\nWeek 2\nLab');
  });

  it('squeezes spaces and blank lines in text without pages', () => {
    expect(tidyText('a   b\t c\n\n\n\nd')).toBe('a b c\nd');
  });
});

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
    /* a name is quoted as JSON, so a stray quote or backslash cannot end it early */
    expect(knownContext({ terms: ['Fall \\ 2026'] })).toContain('named "Fall \\\\ 2026";');
  });

  it('cleans the semesters and codes a read is sent', () => {
    expect(cleanTerm('  "Fall\u0007 2026"\n ')).toBe('Fall 2026');
    expect(cleanTerm('Winter \u201c27\u201d')).toBe('Winter 27');
    const params = new URLSearchParams({ terms: 'Fall "2026"|\u0000|Winter 2027', codes: 'chem 271,  ,phys-205,!!,ABCD-EFGH-1' });
    expect(knownParams(params)).toEqual({ terms: ['Fall 2026', 'Winter 2027'], codes: ['CHEM271', 'PHYS-205', 'ABCDEFGH'] });
  });
});

describe('timeLeft', () => {
  it('is what is left of a deadline, all of TIMEOUT_MS without one, and a 504 once it has passed', () => {
    expect(timeLeft(undefined)).toBe(TIMEOUT_MS);
    const left = timeLeft(Date.now() + 5_000);
    expect(left).toBeGreaterThan(4_900);
    expect(left).toBeLessThanOrEqual(5_000);
    expect(timeLeft(Date.now() + 10 * TIMEOUT_MS)).toBe(TIMEOUT_MS);
    expect(() => timeLeft(Date.now() - 1)).toThrow(expect.objectContaining({ status: 504, body: { error: 'ai_timeout' } }));
  });
});
