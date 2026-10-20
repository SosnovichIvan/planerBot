import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadUnanswered } from '../../../shared/api';
import type { UnansweredPage } from '../../../shared/api';
import { UnansweredParticipants } from './unanswered-participants';

vi.mock('../../../shared/api', async original => ({ ...await original<typeof import('../../../shared/api')>(), loadUnanswered: vi.fn() }));
const page: UnansweredPage = { participants: [{ user_id: '43', name: 'Мария' }], next_cursor: '43' };
const show = (onClose = vi.fn()) => render(<UnansweredParticipants raw="signed" chatId="-1" eventId="event" onClose={onClose} />);

beforeEach(() => { vi.mocked(loadUnanswered).mockReset().mockResolvedValue(page); });

it('shows named participants in a separate dialog, paginates empty pages and returns to start', async () => {
  const close = vi.fn(); show(close);
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем');
  expect(await screen.findByText('Мария')).toBeVisible();
  expect(screen.getByText('Telegram ID: 43')).toBeVisible();
  expect(screen.getByText(/не полный состав Telegram-чата/)).toBeVisible();
  vi.mocked(loadUnanswered).mockResolvedValueOnce({ participants: [], next_cursor: null });
  await userEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
  expect(await screen.findByText(/На этой странице нет/)).toBeVisible();
  expect(loadUnanswered).toHaveBeenLastCalledWith('signed', '-1', 'event', '43', expect.any(AbortSignal));
  expect(screen.queryByRole('button', { name: 'Следующая страница' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'В начало списка' }));
  expect(await screen.findByText('Мария')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть список участников' }));
  expect(close).toHaveBeenCalledOnce();
});

it('reports errors and retries the same page', async () => {
  vi.mocked(loadUnanswered).mockRejectedValueOnce(new Error('offline')); show();
  expect(await screen.findByRole('alert')).toHaveTextContent(/сеть|соедин|загруз|ошиб/i);
  await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку списка' }));
  expect(await screen.findByText('Мария')).toBeVisible();
  expect(loadUnanswered).toHaveBeenCalledTimes(2);
});

it('aborts pending work when the drawer closes and ignores late success and failure', async () => {
  let resolve!: (value: UnansweredPage) => void;
  vi.mocked(loadUnanswered).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const first = show();
  const signal = vi.mocked(loadUnanswered).mock.calls[0][4]!;
  first.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => resolve(page));
  let reject!: (error: Error) => void;
  vi.mocked(loadUnanswered).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const second = show(); second.unmount();
  await act(async () => reject(new Error('late')));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('does not expose the old list while the event or identity is changing', async () => {
  const view = show();
  expect(await screen.findByText('Мария')).toBeVisible();
  let resolve!: (value: UnansweredPage) => void;
  vi.mocked(loadUnanswered).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  view.rerender(<UnansweredParticipants raw="other-identity" chatId="-2" eventId="other-event" onClose={vi.fn()} />);
  expect(screen.queryByText('Мария')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем');
  await act(async () => resolve({ participants: [{ user_id: '44', name: 'Ирина' }], next_cursor: null }));
  expect(await screen.findByText('Ирина')).toBeVisible();
});
