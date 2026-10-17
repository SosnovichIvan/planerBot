import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, createEvent, eventAction, loadEvents } from '../../../shared/api';
import { EventsPanel } from './events-panel';
import { chats, event } from './fixtures.test-data';
import { selectDate } from '../../../shared/ui/controls.test-support';

vi.mock('../../../shared/api', async (original) => ({
  ...await original<typeof import('../../../shared/api')>(), loadEvents: vi.fn(), eventAction: vi.fn(), createEvent: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(loadEvents).mockReset().mockResolvedValue({ events: [event], has_more: false, has_more_removals: false });
  vi.mocked(eventAction).mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

function panel(selectedChat = 'all', items = chats) {
  return <EventsPanel chats={items} raw="signed" month={new Date(2026, 9, 1)} selectedChat={selectedChat} />;
}

it('renders event details without topic/tag filters', async () => {
  render(panel(chats[0].id));
  expect(await screen.findByRole('heading', { name: event.data.title })).toBeVisible();
  expect(screen.getByText('Кафе, Москва')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Открыть карту' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Подключиться онлайн' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Тема событий')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Фильтр по тегу')).not.toBeInTheDocument();
  expect(loadEvents).toHaveBeenLastCalledWith('signed', expect.any(AbortSignal), expect.objectContaining({ chat_id: -100100 }));
  await userEvent.click(screen.getByRole('button', { name: 'Изменить' }));
  expect(screen.getByRole('heading', { name: 'Редактировать событие' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть форму' }));
  expect(screen.queryByRole('heading', { name: 'Редактировать событие' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Создать событие' }));
  expect(screen.getByRole('button', { name: 'Создать и опубликовать' })).toBeVisible();
});

it('hides admin actions for members and handles cancelled/all-day/pending events', async () => {
  vi.mocked(loadEvents).mockResolvedValue({ events: [
    { ...event, can_manage: false, status: 'cancelled', publication_status: null, data: { ...event.data, start_time: null, end_time: null, description: '', place_pending: true, tags: [], map_url: '', online_url: '' } },
  ], has_more: true, has_more_removals: false });
  render(panel('all', chats.map((chat) => ({ ...chat, can_manage: false }))));
  expect(await screen.findByText(/В выбранном периоде событий нет/)).toBeVisible();
  expect(screen.queryByRole('heading', { name: event.data.title })).not.toBeInTheDocument();
  expect(screen.getByText(/Показаны первые 200/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Создать событие' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
});

it('handles empty, failure, retry and cancellation of stale results', async () => {
  vi.mocked(loadEvents).mockRejectedValueOnce(new ApiFailure(401)).mockResolvedValueOnce({ events: [], has_more: false, has_more_removals: false });
  render(panel());
  expect(await screen.findByRole('alert')).toHaveTextContent('Сессия истекла');
  await userEvent.click(screen.getByRole('button', { name: 'Обновить события' }));
  expect(await screen.findByText(/В выбранном периоде/)).toBeVisible();
});

it('confirms cancel, approval and uncertain delivery retries', async () => {
  vi.mocked(loadEvents).mockResolvedValue({ events: [{ ...event, status: 'pending', publication_status: 'unknown' }], has_more: false, has_more_removals: false });
  render(panel());
  await screen.findByText('Ожидает подтверждения · Результат отправки неизвестен');
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  await userEvent.click(screen.getByRole('button', { name: 'Удалить событие' }));
  expect(eventAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Удалить событие' }));
  await waitFor(() => expect(eventAction).toHaveBeenCalledWith('signed', expect.objectContaining({ id: event.id }), 'cancel', false));
  await userEvent.click(await screen.findByRole('button', { name: 'Подтвердить событие' }));
  await waitFor(() => expect(eventAction).toHaveBeenCalledWith('signed', expect.any(Object), 'approve', false));
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  await userEvent.click(await screen.findByRole('button', { name: 'Повторить с риском дубликата' }));
  expect(eventAction).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: 'Повторить с риском дубликата' }));
  await waitFor(() => expect(eventAction).toHaveBeenCalledWith('signed', expect.any(Object), 'retry', true));
});

it('reports failed action and permits retry of a known failed publication', async () => {
  vi.mocked(loadEvents).mockResolvedValue({ events: [{ ...event, publication_status: 'failed' }], has_more: false, has_more_removals: false });
  vi.mocked(eventAction).mockRejectedValue(new ApiFailure(403));
  render(panel());
  await userEvent.click(await screen.findByRole('button', { name: 'Повторить публикацию' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет прав');
});

it('does not apply a stale response after unmount', async () => {
  let resolve!: (data: Awaited<ReturnType<typeof loadEvents>>) => void;
  vi.mocked(loadEvents).mockReturnValue(new Promise((done) => { resolve = done; }));
  const view = render(panel()); view.unmount();
  await act(() => { resolve({ events: [event], has_more: false, has_more_removals: false }); });
  expect(screen.queryByText(event.data.title)).not.toBeInTheDocument();
});

it('creates an event and refreshes its list with a navigation callback', async () => {
  vi.mocked(createEvent).mockResolvedValue(event);
  const created = vi.fn();
  render(<EventsPanel chats={chats} raw="signed" month={new Date(2026, 9, 1)} selectedChat="all" onCreated={created} />);
  await userEvent.click(screen.getByRole('button', { name: 'Создать событие' }));
  await userEvent.type(screen.getByLabelText('Название'), 'Новая встреча');
  await selectDate('Дата начала', '2026-10-20');
  await userEvent.type(screen.getByLabelText('Место встречи'), 'Кафе');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(event));
  expect(await screen.findByText(/Событие сохранено на/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Создать и опубликовать' })).not.toBeInTheDocument();
});

it('polls a pending publication and stops after delivery', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(loadEvents).mockResolvedValueOnce({ events: [{ ...event, publication_status: 'pending' }], has_more: false, has_more_removals: false }).mockResolvedValue({ events: [event], has_more: false, has_more_removals: false });
    const view = render(panel());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(loadEvents).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(loadEvents).toHaveBeenCalledTimes(2);
    view.unmount();
  } finally { vi.useRealTimers(); }
});

it('keeps cleanup outside the agenda, retries deletion, and polls its queue separately', async () => {
  vi.mocked(loadEvents).mockResolvedValue({ events: [], has_more: false, has_more_removals: false, removals: [{ ...event, status: 'cancelled', publication_status: 'unknown' }] });
  render(panel());
  const cleanup = await screen.findByRole('region', { name: 'Удаление сообщений в Telegram' });
  expect(cleanup).toHaveTextContent(event.data.title);
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  await userEvent.click(screen.getByRole('button', { name: 'Повторить удаление сообщения' }));
  expect(eventAction).not.toHaveBeenCalled();
  vi.mocked(loadEvents).mockResolvedValue({ events: [], has_more: false, has_more_removals: false, removals: [] });
  await userEvent.click(screen.getByRole('button', { name: 'Повторить удаление сообщения' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Удаление сообщений в Telegram' })).not.toBeInTheDocument());
  expect(eventAction).toHaveBeenCalledWith('signed', expect.objectContaining({ id: event.id }), 'retry', true);
});
