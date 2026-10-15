import { afterEach, expect, it, vi } from 'vitest';
import { ApiFailure, loadChats } from './index';

afterEach(() => { vi.unstubAllGlobals(); });

it('loads paginated authorized chats with identity only in the header', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ chats: [{ id: '-2', title: 'А', can_manage: false, topics: [] }], next_cursor: '-2' }))
    .mockResolvedValueOnce(Response.json({ chats: [], next_cursor: null }));
  vi.stubGlobal('fetch', fetch);
  const result = await loadChats('signed-user-data', new AbortController().signal);
  expect(result).toHaveLength(1);
  const first = fetch.mock.calls[0][0] as Request;
  expect(first.headers.get('Authorization')).toBe('tma signed-user-data');
  expect(first.url).not.toContain('signed-user-data');
  expect((fetch.mock.calls[1][0] as Request).url).toContain('after=-2');
});

it('retains an HTTP status without trusting server error details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'no access' }, { status: 401 })));
  await expect(loadChats('expired', new AbortController().signal)).rejects.toEqual(new ApiFailure(401));
});

it('propagates cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
  await expect(loadChats('signed', new AbortController().signal)).rejects.toHaveProperty('name', 'AbortError');
});
