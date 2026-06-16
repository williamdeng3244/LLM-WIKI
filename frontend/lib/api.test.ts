import { describe, it, expect, vi, afterEach } from 'vitest';

import { api } from '@/lib/api';

// Every UI call goes through `call()` (fetch + Content-Type + auth headers +
// `!ok` -> throw + 204 -> undefined). We stub global fetch and assert the
// URL/method/body it builds and how it handles responses.
function stubFetch(resp: { ok: boolean; status: number; body?: unknown; text?: string }) {
  const spy = vi.fn(async () => ({
    ok: resp.ok,
    status: resp.status,
    json: async () => resp.body,
    text: async () => resp.text ?? '',
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('getPage hits /api/pages/<path> and returns parsed JSON', async () => {
    const spy = stubFetch({ ok: true, status: 200, body: { path: 'eng/x', title: 'X' } });
    const page = await api.getPage('eng/x');
    expect(spy.mock.calls[0][0]).toBe('/api/pages/eng/x');
    expect(page).toMatchObject({ path: 'eng/x' });
  });

  it('lockPage builds the query string and POSTs', async () => {
    const spy = stubFetch({ ok: true, status: 200, body: {} });
    await api.lockPage('eng/x', true);
    expect(spy.mock.calls[0][0]).toBe('/api/pages/eng/x/lock?locked=true');
    expect(spy.mock.calls[0][1].method).toBe('POST');
  });

  it('createDraft POSTs a JSON body', async () => {
    const spy = stubFetch({ ok: true, status: 200, body: { id: 1 } });
    await api.createDraft({ title: 'T', body: 'B', new_page: { path: 'a/b' } });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/pages/draft');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ title: 'T', new_page: { path: 'a/b' } });
  });

  it('throws "<status>: <text>" on a non-2xx response', async () => {
    stubFetch({ ok: false, status: 403, text: 'forbidden' });
    await expect(api.listPages()).rejects.toThrow(/403/);
  });

  it('returns undefined for 204 No Content', async () => {
    stubFetch({ ok: true, status: 204 });
    await expect(api.submitRevision(1)).resolves.toBeUndefined();
  });
});
