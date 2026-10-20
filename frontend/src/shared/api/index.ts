import createClient from 'openapi-fetch';
import type { paths } from './schema';
import type { components } from './schema';

export type Chat = components['schemas']['ChatResponse'];
export type CalendarEvent = components['schemas']['EventView'];
export type EventDraft = components['schemas']['EventInput'];
export type ChatSettings = components['schemas']['ChatSettingsInput'];
export type EventDetails = components['schemas']['EventDetails'];
export type Answer = components['schemas']['ResponseInput']['answer'];
export type Campaign = components['schemas']['CampaignView'];
export type UnansweredPage = components['schemas']['UnansweredView'];

export async function loadUnanswered(raw: string, chatId: string, eventId: string, after?: string, signal?: AbortSignal) {
  return checked(await client(raw).GET('/api/chats/{chat_id}/events/{event_id}/unanswered', {
    params: { path: { chat_id: Number(chatId), event_id: eventId }, query: { after: after ? Number(after) : 0 } }, signal,
  }));
}

export class ApiFailure extends Error {
  constructor(public readonly status: number, message = 'Calendar request failed') { super(message); }
}

function client(raw: string) {
  return createClient<paths>({ baseUrl: window.location.origin, headers: { Authorization: `tma ${raw}` } });
}

function checked<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (!result.response.ok || result.data === undefined) throw failure(result.response.status, result.error);
  return result.data;
}

function failure(status: number, error?: unknown): ApiFailure {
  const detail = typeof error === 'object' && error !== null && 'detail' in error && typeof error.detail === 'string' ? error.detail : undefined;
  const issues = typeof error === 'object' && error !== null && 'detail' in error && Array.isArray(error.detail) ? error.detail : [];
  const validation = issues.filter((issue): issue is { msg: string } => typeof issue === 'object' && issue !== null && 'msg' in issue && typeof issue.msg === 'string' && /[А-Яа-яЁё]/.test(issue.msg)).map((issue) => issue.msg.replace(/^Value error, /, '')).slice(0, 3).join('. ');
  return new ApiFailure(status, detail ?? (validation || 'Не удалось сохранить изменения. Проверьте данные и повторите запрос.'));
}

export function errorText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 401) return 'Сессия истекла. Откройте календарь через Telegram заново.';
    if (error.status === 403) return 'Нет прав на это действие. Обновите календарь.';
    return error.message;
  }
  return 'Нет ответа сервера. Результат запроса неизвестен. Повторите с теми же данными.';
}

export async function loadEvents(raw: string, signal: AbortSignal, query: { start: string; end: string; chat_id?: number; topic_id?: number; tag?: string }) {
  return checked(await client(raw).GET('/api/events', { params: { query }, signal }));
}

export async function createEvent(raw: string, chatId: string, body: EventDraft, key: string) {
  return checked(await client(raw).POST('/api/chats/{chat_id}/events', {
    params: { path: { chat_id: Number(chatId) }, header: { 'Idempotency-Key': key } }, body,
  }));
}

export async function editEvent(raw: string, event: CalendarEvent, body: EventDraft) {
  return checked(await client(raw).PUT('/api/chats/{chat_id}/events/{event_id}', {
    params: { path: { chat_id: Number(event.chat_id), event_id: event.id } }, body: { ...body, version: event.version },
  }));
}

export async function eventAction(raw: string, event: CalendarEvent, action: 'approve' | 'cancel' | 'retry', acknowledge = false) {
  const path = { chat_id: Number(event.chat_id), event_id: event.id };
  if (action === 'retry') {
    const result = await client(raw).POST('/api/chats/{chat_id}/events/{event_id}/retry', {
      params: { path }, body: { ack_duplicate_risk: acknowledge },
    });
    if (!result.response.ok) throw failure(result.response.status, result.error);
  } else {
    const url = action === 'approve' ? '/api/chats/{chat_id}/events/{event_id}/approve' : '/api/chats/{chat_id}/events/{event_id}/cancel';
    checked(await client(raw).POST(url, { params: { path }, body: { version: event.version } }));
  }
}

export async function configureChat(raw: string, chatId: string, body: ChatSettings) {
  const result = await client(raw).PUT('/api/chats/{chat_id}/settings', {
    params: { path: { chat_id: Number(chatId) } }, body,
  });
  if (!result.response.ok) throw failure(result.response.status, result.error);
}

export async function loadChats(raw: string, signal: AbortSignal) {
  const client = createClient<paths>({ baseUrl: window.location.origin, headers: { Authorization: `tma ${raw}` } });
  const chats = [];
  let cursor: string | undefined;
  do {
    const { data, response } = await client.GET('/api/chats', {
      params: { query: { after: cursor === undefined ? undefined : Number(cursor) } }, signal,
    });
    if (!data) throw new ApiFailure(response.status);
    chats.push(...data.chats);
    cursor = data.next_cursor ?? undefined;
  } while (cursor !== undefined);
  const visit = await client.POST('/api/calendar/visit', { signal });
  if (!visit.response.ok) throw failure(visit.response.status, visit.error);
  return chats;
}

export async function loadEventDetails(raw: string, chatId: string, eventId: string, signal?: AbortSignal) {
  return checked(await client(raw).GET('/api/chats/{chat_id}/events/{event_id}', { params: { path: { chat_id: Number(chatId), event_id: eventId } }, signal }));
}

export async function respondEvent(raw: string, event: CalendarEvent, answer: Answer) {
  return checked(await client(raw).PUT('/api/chats/{chat_id}/events/{event_id}/response', { params: { path: { chat_id: Number(event.chat_id), event_id: event.id } }, body: { answer } }));
}

export async function sendCampaign(raw: string, event: CalendarEvent, audience: Answer, text: string, key: string) {
  return checked(await client(raw).POST('/api/chats/{chat_id}/events/{event_id}/campaigns', { params: { path: { chat_id: Number(event.chat_id), event_id: event.id }, header: { 'Idempotency-Key': key } }, body: { audience, text } }));
}

export async function campaignStatus(raw: string, event: CalendarEvent, campaignId: string, signal?: AbortSignal) {
  return checked(await client(raw).GET('/api/chats/{chat_id}/events/{event_id}/campaigns/{campaign_id}', { params: { path: { chat_id: Number(event.chat_id), event_id: event.id, campaign_id: campaignId } }, signal }));
}

export async function disablePersonalMessages(raw: string) {
  const result = await client(raw).DELETE('/api/calendar/notifications');
  if (!result.response.ok) throw failure(result.response.status, result.error);
}
