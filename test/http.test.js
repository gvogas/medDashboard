import { describe, expect, it, vi } from 'vitest';
import { readJson } from '../worker/http.js';

describe('bounded JSON bodies', () => {
  it('counts UTF-8 bytes, not JavaScript characters', async () => {
    const request = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ text: '€'.repeat(400000) }) });
    await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
  });

  it('stops a chunked stream as soon as it exceeds the limit', async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const body = new ReadableStream({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(512 * 1024)); },
      cancel,
    }, { highWaterMark: 0 });
    await expect(readJson(new Request('http://localhost', { method: 'POST', body }))).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(chunks).toBe(3);
  });

  it('decodes a Unicode character split across network chunks', async () => {
    const bytes = new TextEncoder().encode('{"text":"€"}');
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 10)); c.enqueue(bytes.slice(10)); c.close(); } });
    expect(await readJson(new Request('http://localhost', { method: 'POST', body }))).toEqual({ text: '€' });
  });
});
