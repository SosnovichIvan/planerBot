import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, loadChats, loadEvents, loadEventDetails, respondEvent } from '../../shared/api';
import * as telegram from '../../shared/telegram';
import { CalendarPage } from './index';
import { event as calendarEvent } from './ui/fixtures.test-data';

vi.mock('../../shared/api', async (original) => ({
  ...await original<typeof import('../../shared/api')>(), loadChats: vi.fn(), loadEvents: vi.fn().mockResolvedValue({ events: [], has_more: false }), loadEventDetails: vi.fn(), respondEvent: vi.fn(),
}));

const chats = [
  { id: '-1', title: 'Рабочая команда', can_manage: true, topics: [{ id: '10', title: 'Встречи', enabled: true }], timezone: 'UTC', event_tag: '#событие', creation_policy: 'admins', confirmation_required: false, settings_version: 1 },
  { id: '-2', title: 'Книжный клуб', can_manage: false, topics: [], timezone: 'UTC', event_tag: '#событие', creation_policy: 'admins', confirmation_required: false, settings_version: 1 },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadChats).mockReset();
  vi.mocked(loadEvents).mockReset().mockResolvedValue({ events: [], has_more: false });
  vi.mocked(loadEventDetails).mockReset().mockResolvedValue({ event: calendarEvent, counts: null, personal_messages_enabled: false });
  vi.mocked(respondEvent).mockReset().mockResolvedValue({ event: { ...calendarEvent, my_response: 'yes' }, counts: { yes: 1, no: 0, unanswered: 0 }, personal_messages_enabled: false });
  vi.spyOn(telegram, 'initData').mockReturnValue('signed');
});

it('opens a list for a multi-event day, then a card, and refreshes personal markers after voting', async () => {
  const month = new Date();
  const day = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-20`;
  const first = { ...calendarEvent, data: { ...calendarEvent.data, start_date: day, end_date: day } };
  vi.mocked(loadChats).mockResolvedValue(chats);
  vi.mocked(loadEvents).mockResolvedValue({ events: [first, { ...first, id: 'other', my_response: 'yes', data: { ...first.data, title: 'Другая встреча' } }], has_more: false });
  render(<CalendarPage />);
  const trigger = await screen.findByRole('button', { name: '20, событий: 2' });
  expect(trigger).toHaveAccessibleDescription('Нужен ваш ответ');
  await userEvent.click(trigger);
  const list = screen.getByRole('dialog');
  expect(within(list).getByText('Другая встреча')).toBeVisible();
  await userEvent.click(within(list).getByRole('button', { name: /Встреча команды/ }));
  expect(await screen.findByRole('dialog', { name: 'Встреча команды' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Приду' }));
  expect(await screen.findByText('Ваш ответ: Приду')).toBeVisible();
  expect(loadChats).toHaveBeenCalledTimes(2);
});

it('opens an event deep link after chat permissions are loaded', async () => {
  vi.mocked(telegram.initData).mockReturnValue('start_param=event_-100100_00000000000040008000000000000001');
  vi.mocked(loadChats).mockResolvedValue(chats);
  render(<CalendarPage />);
  expect(await screen.findByRole('dialog', { name: calendarEvent.data.title })).toBeVisible();
  expect(loadEventDetails).toHaveBeenCalledWith(expect.any(String), '-100100', calendarEvent.id, expect.any(AbortSignal));
});

it('opens only events of the clicked day and navigates to their Telegram message', async () => {
  const month = new Date();
  const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const event = { ...calendarEvent, data: { ...calendarEvent.data, start_date: `${prefix}-20`, end_date: `${prefix}-20` } };
  vi.mocked(loadChats).mockResolvedValue(chats);
  vi.mocked(loadEvents).mockResolvedValue({ events: [event, { ...event, id: 'another', data: { ...event.data, title: 'Другой день', start_date: `${prefix}-21`, end_date: `${prefix}-21` } }], has_more: false });
  const open = vi.spyOn(telegram, 'openTelegramMessage').mockReturnValue(true);
  render(<CalendarPage />);
  await userEvent.click(await screen.findByRole('button', { name: '20, событий: 1' }));
  const dialog = screen.getByRole('dialog');
  expect(await within(dialog).findByRole('heading', { name: event.data.title })).toBeVisible();
  expect(within(dialog).queryByText('Другой день')).not.toBeInTheDocument();
  const link = within(dialog).getByRole('link', { name: 'Сообщение в Telegram' });
  expect(link).toHaveAttribute('href', event.message_url);
  await userEvent.click(link);
  expect(open).toHaveBeenCalledWith(event.message_url);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Закрыть окно' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  let finish!: (data: { events: typeof event[]; has_more: boolean }) => void;
  vi.mocked(loadEvents).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Чат' }), '-2');
  expect(screen.queryByRole('button', { name: '20, событий: 1' })).not.toBeInTheDocument();
  await act(() => finish({ events: [], has_more: false }));
});

it('explains the Telegram entry point and does not request data outside Telegram', () => {
  vi.mocked(telegram.initData).mockReturnValue('');
  render(<CalendarPage />);
  expect(screen.getByRole('heading', { name: 'Откройте календарь через Telegram' })).toBeVisible();
  expect(loadChats).not.toHaveBeenCalled();
});

it('shows a compact toolbar, chat selector and month navigation', async () => {
  let resolve!: (value: typeof chats) => void;
  vi.mocked(loadChats).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<CalendarPage />);
  expect(screen.getByRole('status')).toHaveTextContent('Проверяем доступ');
  await act(() => { resolve(chats); });
  expect(screen.queryByText('Личный календарь')).not.toBeInTheDocument();
  expect(screen.queryByText('Ваше время, вместе')).not.toBeInTheDocument();
  const create = screen.getByRole('button', { name: 'Создать событие' });
  expect(create.closest('header')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Обновить события' }).parentElement).toBe(create.parentElement);
  expect(screen.queryByLabelText('Фильтр по тегу')).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Чат' }), '-2');
  await waitFor(() => expect(loadEvents).toHaveBeenLastCalledWith('signed', expect.any(AbortSignal), expect.objectContaining({ chat_id: -2 })));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Чат' }), 'all');
  await waitFor(() => expect(loadEvents).toHaveBeenLastCalledWith('signed', expect.any(AbortSignal), expect.objectContaining({ chat_id: undefined })));
  await user.click(screen.getByRole('button', { name: 'Создать событие' }));
  expect(screen.getByRole('button', { name: 'Создать и опубликовать' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Закрыть форму' }));
  const original = screen.getByRole('table').getAttribute('aria-label');
  await user.click(screen.getByRole('button', { name: 'Следующий месяц' }));
  expect(screen.getByRole('table').getAttribute('aria-label')).not.toBe(original);
  await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
  expect(screen.getByRole('table')).toHaveAttribute('aria-label', original);
  expect(screen.getByRole('heading', { name: 'События месяца' })).toBeVisible();
});

it('shows an empty state without inventing events', async () => {
  vi.mocked(loadChats).mockResolvedValue([]);
  render(<CalendarPage />);
  expect(await screen.findByText(/Доступных чатов пока нет/)).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Чат' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Создать событие' })).not.toBeInTheDocument();
});

it('handles an expired identity without a pointless retry', async () => {
  vi.mocked(loadChats).mockRejectedValue(new ApiFailure(401));
  render(<CalendarPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Сессия истекла');
  expect(screen.queryByRole('button', { name: 'Попробовать снова' })).not.toBeInTheDocument();
});

it('shows refresh but not creation or settings for a member', async () => {
  vi.mocked(loadChats).mockResolvedValue(chats.map((chat) => ({ ...chat, can_manage: false })));
  render(<CalendarPage />);
  expect(await screen.findByRole('combobox', { name: 'Чат' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Обновить события' }).closest('header')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Создать событие' })).not.toBeInTheDocument();
  expect(screen.queryByText('Настройки чата')).not.toBeInTheDocument();
});

it('opens creation from a Telegram link only after loading admin permissions, without reopening after closing', async () => {
  vi.mocked(telegram.initData).mockReturnValue('start_param=create_-1_10');
  vi.mocked(loadChats).mockResolvedValue(chats);
  render(<CalendarPage />);
  expect(await screen.findByRole('dialog', { name: 'Создать событие' })).toBeVisible();
  expect(screen.getByLabelText('Тема')).toHaveValue('10');
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть форму' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Чат' }), '-2');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('does not grant creation through a forged target pointing at a member chat', async () => {
  vi.mocked(telegram.initData).mockReturnValue('start_param=create_-2_1');
  vi.mocked(loadChats).mockResolvedValue(chats);
  render(<CalendarPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('нужны права администратора');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Создать событие' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Чат' })).toHaveValue('-1');
});

it('opens a generic creation link with the first administered chat', async () => {
  vi.mocked(telegram.initData).mockReturnValue('start_param=create');
  vi.mocked(loadChats).mockResolvedValue(chats);
  render(<CalendarPage />);
  const dialog = await screen.findByRole('dialog', { name: 'Создать событие' });
  expect(within(dialog).getByLabelText('Чат')).toHaveValue('-1');
});

it('hides data during failure and supports retry', async () => {
  vi.mocked(loadChats).mockRejectedValueOnce(new ApiFailure(503)).mockResolvedValueOnce(chats);
  render(<CalendarPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить доступ');
  await userEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));
  expect(await screen.findByRole('button', { name: 'Создать событие' })).toBeVisible();
});

it('handles a network error', async () => {
  vi.mocked(loadChats).mockRejectedValue(new Error('network'));
  render(<CalendarPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Данные чатов скрыты');
});

it('ignores stale successful results after unmount', async () => {
  let resolve!: (value: typeof chats) => void;
  vi.mocked(loadChats).mockReturnValue(new Promise((done) => { resolve = done; }));
  const { unmount } = render(<CalendarPage />);
  unmount();
  await act(() => { resolve(chats); });
  expect(screen.queryByText('Вы администратор')).not.toBeInTheDocument();
});

it('ignores stale failures after unmount', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadChats).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  const { unmount } = render(<CalendarPage />);
  unmount();
  await act(() => { reject(new Error('network')); });
  await waitFor(() => { expect(screen.queryByRole('alert')).not.toBeInTheDocument(); });
});
