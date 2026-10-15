import { afterEach, expect, it, vi } from 'vitest';
import { ApiFailure, loadChats, loadEvents, createEvent, editEvent, eventAction, configureChat, errorText } from './index';
import type { CalendarEvent, EventDraft } from './index';

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

const draft: EventDraft = { title: 'Встреча', topic_id: 10, start_date: '2026-10-20', place_pending: true, description: '', meeting_format: 'offline', place: '', address: '', map_url: '', online_url: '' };
const settings = { version: 1, timezone: 'UTC', event_tag: '#event', enabled_topic_ids: [], creation_policy: 'admins' as const, confirmation_required: false };
const event: CalendarEvent = { id: '00000000-0000-4000-8000-000000000001', chat_id: '-100100', chat_title: 'А', topic_title: 'Встречи', data: draft, timezone: 'UTC', starts_at: '2026-10-20T00:00:00Z', ends_at: null, version: 1, status: 'active', source: 'form', source_message_id: null, publication_status: 'pending', can_manage: true };

it('uses generated HTTP routes, typed bodies, versions and idempotency keys', async () => {
  const fetch = vi.fn().mockImplementation((request: Request) => {
    if (request.url.includes('/settings') || request.url.includes('/retry')) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json(event));
  });
  vi.stubGlobal('fetch', fetch);
  await createEvent('signed', '-100100', draft, event.id);
  const first = fetch.mock.calls[0][0] as Request;
  expect(first.method).toBe('POST');
  expect(first.headers.get('Idempotency-Key')).toBe(event.id);
  expect(await first.json()).toEqual(draft);
  await editEvent('signed', event, draft);
  const second = fetch.mock.calls[1][0] as Request;
  expect(second.method).toBe('PUT');
  expect(await second.json()).toMatchObject({ version: 1 });
  await eventAction('signed', event, 'approve');
  await eventAction('signed', event, 'cancel');
  await eventAction('signed', event, 'retry', true);
  await configureChat('signed', '-100100', settings);
  expect((fetch.mock.calls[2][0] as Request).url).toContain('/approve');
  expect((fetch.mock.calls[3][0] as Request).url).toContain('/cancel');
  expect(await (fetch.mock.calls[4][0] as Request).json()).toEqual({ ack_duplicate_risk: true });
});

it('loads events for an explicit date range', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ events: [event], has_more: false })));
  const result = await loadEvents('signed', new AbortController().signal, { start: '2026-10-01', end: '2026-11-01' });
  expect(result.events[0].id).toBe(event.id);
});

it('maps failed mutations and structured validation errors without trusting arbitrary fields', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ detail: 'Конфликт версии' }, { status: 409 })));
  vi.stubGlobal('fetch', fetch);
  await expect(createEvent('signed', '-100100', draft, event.id)).rejects.toThrow('Конфликт версии');
  await expect(eventAction('signed', event, 'retry')).rejects.toHaveProperty('status', 409);
  await expect(configureChat('signed', '-100100', settings)).rejects.toHaveProperty('status', 409);
  fetch.mockResolvedValue(Response.json({ detail: [{ msg: 'invalid' }] }, { status: 422 }));
  await expect(createEvent('signed', '-100100', draft, event.id)).rejects.toThrow('Проверьте данные');
  fetch.mockResolvedValue(Response.json({ detail: [{ msg: 'Value error, Укажите место встречи' }] }, { status: 422 }));
  await expect(createEvent('signed', '-100100', draft, event.id)).rejects.toThrow('Укажите место встречи');
  fetch.mockResolvedValue(new Response(null, { status: 204 }));
  await expect(createEvent('signed', '-100100', draft, event.id)).rejects.toHaveProperty('status', 204);
  expect(errorText(new ApiFailure(401))).toContain('Сессия истекла');
  expect(errorText(new ApiFailure(403))).toContain('Нет прав');
  expect(errorText(new ApiFailure(409, 'Конфликт'))).toBe('Конфликт');
  expect(errorText(new Error('network'))).toContain('Результат запроса неизвестен');
});
