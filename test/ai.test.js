import { describe, it, expect, vi } from 'vitest';
import { runModel, askJson, modelJson, tidyText, knownContext, listParam } from '../worker/ai.js';
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
  });
});
