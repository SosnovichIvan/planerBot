import type { CalendarEvent, Chat } from '../../../shared/api';

export const chats: Chat[] = [
  { id: '-100100', title: 'Команда', can_manage: true, topics: [{ id: '10', title: 'Встречи', enabled: true }, { id: '11', title: 'Архив', enabled: false }], timezone: 'Europe/Moscow', event_tag: '#событие', creation_policy: 'admins', confirmation_required: false, settings_version: 1 },
  { id: '-100200', title: 'Клуб', can_manage: true, topics: [{ id: '20', title: 'Обсуждения', enabled: true }], timezone: 'UTC', event_tag: '#event', creation_policy: 'members', confirmation_required: true, settings_version: 2 },
];

export const event: CalendarEvent = {
  id: '00000000-0000-4000-8000-000000000001', chat_id: chats[0].id, chat_title: 'Команда', topic_title: 'Встречи',
  data: { topic_id: 10, title: 'Встреча команды', start_date: '2026-10-20', start_time: '19:00', end_date: '2026-10-20', end_time: '20:00',
    description: 'Планы на месяц', meeting_format: 'hybrid', place: 'Кафе', address: 'Москва', map_url: 'https://example.test/map', online_url: 'https://example.test/meet', place_pending: false, tags: ['#команда'], notify_members: false },
  timezone: 'Europe/Moscow', starts_at: '2026-10-20T16:00:00Z', ends_at: '2026-10-20T17:00:00Z',
  status: 'active', source: 'form', source_message_id: null, publication_status: 'published', version: 1, can_manage: true, message_url: 'https://t.me/c/100/5', my_response: 'unanswered', has_updates: false,
};
