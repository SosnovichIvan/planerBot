import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, loadChats } from '../../shared/api';
import * as telegram from '../../shared/telegram';
import { CalendarPage } from './index';

vi.mock('../../shared/api', async (original) => ({
  ...await original<typeof import('../../shared/api')>(), loadChats: vi.fn(), loadEvents: vi.fn().mockResolvedValue({ events: [], has_more: false }),
}));

const chats = [
  { id: '-1', title: 'Рабочая команда', can_manage: true, topics: [{ id: '10', title: 'Встречи', enabled: true }], timezone: 'UTC', event_tag: '#событие', creation_policy: 'admins', confirmation_required: false, settings_version: 1 },
  { id: '-2', title: 'Книжный клуб', can_manage: false, topics: [], timezone: 'UTC', event_tag: '#событие', creation_policy: 'admins', confirmation_required: false, settings_version: 1 },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadChats).mockReset();
  vi.spyOn(telegram, 'initData').mockReturnValue('signed');
});

it('explains the Telegram entry point and does not request data outside Telegram', () => {
  vi.mocked(telegram.initData).mockReturnValue('');
  render(<CalendarPage />);
  expect(screen.getByRole('heading', { name: 'Откройте календарь через Telegram' })).toBeVisible();
  expect(loadChats).not.toHaveBeenCalled();
});

it('shows loading, real chats, topics, filters and month navigation', async () => {
  let resolve!: (value: typeof chats) => void;
  vi.mocked(loadChats).mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<CalendarPage />);
  expect(screen.getByRole('status')).toHaveTextContent('Проверяем доступ');
  await act(() => { resolve(chats); });
  expect(screen.getByText('# Встречи')).toBeVisible();
  expect(screen.getByText('Вы администратор')).toBeVisible();
  expect(screen.getByText('Вы участник')).toBeVisible();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Показать чат' }), '-2');
  expect(screen.queryByText('# Встречи')).not.toBeInTheDocument();
  expect(screen.queryByText('Вы администратор')).not.toBeInTheDocument();
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
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('handles an expired identity without a pointless retry', async () => {
  vi.mocked(loadChats).mockRejectedValue(new ApiFailure(401));
  render(<CalendarPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Сессия истекла');
  expect(screen.queryByRole('button', { name: 'Попробовать снова' })).not.toBeInTheDocument();
});

it('hides data during failure and supports retry', async () => {
  vi.mocked(loadChats).mockRejectedValueOnce(new ApiFailure(503)).mockResolvedValueOnce(chats);
  render(<CalendarPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить доступ');
  await userEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));
  expect(await screen.findByText('Вы администратор')).toBeVisible();
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
