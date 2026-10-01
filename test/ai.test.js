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
