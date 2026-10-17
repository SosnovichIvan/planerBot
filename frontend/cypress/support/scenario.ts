import type { components } from '../../src/shared/api/schema';
import 'cypress-real-events';

type Chat = components['schemas']['ChatResponse'];
type Event = components['schemas']['EventView'];
type Draft = components['schemas']['EventInput'];
type Answer = components['schemas']['ResponseInput']['answer'];

export const chatA: Chat = { id: '-100100', title: 'Команда', can_manage: true, topics: [{ id: '10', title: 'Встречи', enabled: true }, { id: '11', title: 'Архив', enabled: false }], timezone: 'Europe/Moscow', event_tag: '#событие', creation_policy: 'admins', confirmation_required: false, settings_version: 1 };
export const chatB: Chat = { ...chatA, id: '-100200', title: 'Клуб', can_manage: false, topics: [{ id: '1', title: 'Чат', enabled: true }] };
export const meeting: Event = {
  id: '00000000-0000-4000-8000-000000000001', chat_id: chatA.id, chat_title: chatA.title, topic_title: 'Встречи',
  data: { topic_id: 10, title: 'Встреча команды', start_date: '2026-10-20', start_time: '19:00', end_date: '2026-10-20', end_time: '20:00', description: 'Планы на месяц', meeting_format: 'offline', place: 'Кафе', address: 'Москва', online_url: '', map_url: '', place_pending: false, tags: ['#команда'], notify_members: false },
  timezone: 'Europe/Moscow', starts_at: '2026-10-20T16:00:00Z', ends_at: '2026-10-20T17:00:00Z', version: 1,
  status: 'active', source: 'form', source_message_id: null, publication_status: 'published', message_url: 'https://t.me/c/100/5', can_manage: true, my_response: 'unanswered', has_updates: false, changes: [],
};
export const second: Event = { ...meeting, id: '00000000-0000-4000-8000-000000000002', chat_id: chatB.id, chat_title: chatB.title, topic_title: 'Чат', can_manage: false, data: { ...meeting.data, topic_id: 1, title: 'Встреча клуба' } };

type Call = { method: string; path: string; body: unknown; key: string | undefined };
export type Scenario = {
  chats: Chat[]; events: Event[]; pages?: Chat[][]; more: boolean; contact: boolean;
  calls: Call[]; links: string[]; writeRequests: number; allowWrite: boolean;
  ready: number; expanded: number; campaignStatuses: Record<string, number>;
};

export function scenario(values: Partial<Scenario> = {}): Scenario {
  const state: Scenario = structuredClone({ chats: [chatA, chatB], events: [meeting, second], more: false, contact: false, calls: [], links: [], writeRequests: 0, allowWrite: true, ready: 0, expanded: 0, campaignStatuses: { sent: 1, skipped: 1, unknown: 1 }, ...values });
  // Every API request is intercepted. An unknown route fails rather than reaching a real server.
  cy.intercept('https://telegram.org/js/telegram-web-app.js', { body: '', headers: { 'content-type': 'application/javascript' } });
  cy.intercept({ hostname: '127.0.0.1', pathname: '/api/**' }, (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    state.calls.push({ method: req.method, path, body: structuredClone(req.body), key: req.headers['idempotency-key'] as string | undefined });
    expect(req.headers.authorization, 'test-only session header').to.match(/^tma /);
    const send = (body: unknown, statusCode = 200) => req.reply({ statusCode, body });
    if (req.method === 'GET' && path === '/api/chats') {
      const page = state.pages ? state.pages[url.searchParams.has('after') ? 1 : 0] : state.chats;
      send({ chats: page, next_cursor: state.pages && !url.searchParams.has('after') ? page.at(-1)!.id : null }); return;
    }
    if (req.method === 'POST' && path === '/api/calendar/visit') { send('', 204); return; }
    if (req.method === 'DELETE' && path === '/api/calendar/notifications') { state.contact = false; send('', 204); return; }
    if (req.method === 'GET' && path === '/api/events') {
      const start = url.searchParams.get('start')!; const end = url.searchParams.get('end')!;
      const inChat = (event: Event) => !url.searchParams.has('chat_id') || event.chat_id === url.searchParams.get('chat_id');
      send({ events: state.events.filter((event) => event.status !== 'cancelled' && inChat(event) && event.data.start_date >= start && event.data.start_date < end), has_more: state.more,
        removals: state.events.filter(event => event.status === 'cancelled' && event.can_manage && inChat(event) && event.publication_status !== 'published'), has_more_removals: false }); return;
    }
    const route = /^\/api\/chats\/(-\d+)\/(.+)$/.exec(path);
    if (!route) throw new Error(`Unexpected API route: ${req.method} ${path}`);
    const [, chatId, action] = route;
    if (action === 'settings' && req.method === 'PUT') {
      const chat = state.chats.find((item) => item.id === chatId)!;
      Object.assign(chat, req.body, { settings_version: chat.settings_version! + 1, topics: chat.topics.map((topic) => ({ ...topic, enabled: req.body.enabled_topic_ids.includes(Number(topic.id)) })) });
      send('', 204); return;
    }
    if (action === 'events' && req.method === 'POST') {
      const created: Event = { ...structuredClone(meeting), id: '00000000-0000-4000-8000-000000000003', data: req.body as Draft, chat_id: chatId, chat_title: state.chats.find((chat) => chat.id === chatId)!.title };
      state.events.push(created); send(created); return;
    }
    const [, id, command] = /^events\/([^/]+)(?:\/(.*))?$/.exec(action) ?? [];
    const event = state.events.find((item) => item.id === id && item.chat_id === chatId);
    if (!event) { send({ detail: 'Событие не найдено.' }, 404); return; }
    const details = () => ({ event, counts: event.my_response === 'unanswered' ? null : { yes: 3, no: 1, unanswered: 2 }, personal_messages_enabled: state.contact });
    if (!command && req.method === 'GET') { event.has_updates = false; send(details()); return; }
    if (!command && req.method === 'PUT') {
      const { version, ...data } = req.body as Draft & { version: number };
      event.data = { ...data, notify_members: false }; event.version = version + 1; send(event); return;
    }
    if (command === 'response' && req.method === 'PUT') { event.my_response = req.body.answer as Answer; send(details()); return; }
    if (command === 'campaigns' && req.method === 'POST') { send({ id: '00000000-0000-4000-8000-000000000009', statuses: {} }); return; }
    if (command?.startsWith('campaigns/') && req.method === 'GET') { send({ id: '00000000-0000-4000-8000-000000000009', statuses: state.campaignStatuses }); return; }
    if (command === 'cancel' || command === 'approve') { event.status = command === 'cancel' ? 'cancelled' : 'active'; if (command === 'cancel') event.publication_status = 'pending'; event.version++; send(event); return; }
    if (command === 'retry') { event.publication_status = 'published'; send('', 204); return; }
    throw new Error(`Unexpected API route: ${req.method} ${path}`);
  }).as('api');
  return state;
}

export function visit(state: Scenario, options: { raw?: string; noTelegram?: boolean; noWriteMethod?: boolean; telegramHeight?: number } = {}) {
  cy.clock(Date.UTC(2026, 9, 17, 12), ['Date']);
  cy.on('window:before:load', (win) => {
    if (options.telegramHeight) win.document.documentElement.style.setProperty('--tg-viewport-height', `${options.telegramHeight}px`);
    if (!options.noTelegram) Object.defineProperty(win, 'Telegram', { value: { WebApp: {
      initData: options.raw ?? 'query_id=cypress-local-fixture', colorScheme: 'light',
      ready: () => { state.ready++; }, expand: () => { state.expanded++; }, onEvent() {}, offEvent() {},
      openTelegramLink: (url: string) => state.links.push(url),
      ...(!options.noWriteMethod ? { requestWriteAccess: (callback: (granted: boolean) => void) => { state.writeRequests++; callback(state.allowWrite); } } : {}),
    } }, configurable: true });
  });
  cy.visit('/');
}

export const activeDialog = () => cy.get('dialog[open]').last();
export const button = (name: string) => cy.get('body').then(($body) => {
  const dialogs = $body.find('dialog[open]');
  return (dialogs.length ? cy.wrap(dialogs.last()) : cy.get('body')).contains('button', new RegExp(`^${name}$`));
});
export function escape() {
  activeDialog().find('.modal-header button').focus().should('have.focus');
  cy.realPress(Cypress.Keyboard.Keys.ESC);
}
export function choose(label: string, option: string) {
  cy.get(`[role="combobox"][aria-label="${label}"]`).last().focus().should('have.focus');
  cy.realPress(Cypress.Keyboard.Keys.SPACE);
  cy.get('[role="listbox"]').should('be.visible');
  activeDialog().find('[role="option"]').contains(new RegExp(`^${option}(?:✓)?$`)).click();
  cy.get('[role="listbox"]').should('not.exist');
}
export function date(label = 'Дата начала', day = '20 октября 2026 г.') {
  cy.get(`button[aria-label="${label}"]`).click();
  activeDialog().find(`button[aria-label="${day}"]`).click();
}
export function fill(title = 'Новая встреча') {
  cy.get('input[name="title"]').type(title);
  date();
  cy.get('input[name="place"]').type('Парк');
}
export const mutations = (state: Scenario, suffix: string) => state.calls.filter((call) => call.method !== 'GET' && call.path.endsWith(suffix));
export function bounds(selector: string, limit?: number) {
  cy.get(selector).should(($element) => {
    const rect = $element[0].getBoundingClientRect();
    const win = $element[0].ownerDocument.defaultView!;
    expect(rect.height, `${selector} nonzero height`).to.be.greaterThan(20);
    expect(rect.top, `${selector} top`).to.be.at.least(-1);
    expect(rect.bottom, `${selector} bottom`).to.be.at.most((limit ?? win.innerHeight) + 1);
    expect(rect.left).to.be.at.least(-1);
    expect(rect.right).to.be.at.most(win.innerWidth + 1);
  });
}
