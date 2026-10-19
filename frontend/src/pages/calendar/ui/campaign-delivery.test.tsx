import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, campaignStatus } from '../../../shared/api';
import type { Campaign } from '../../../shared/api';
import { event } from './fixtures.test-data';
import { CampaignDelivery } from './campaign-delivery';

vi.mock('../../../shared/api', async original => ({ ...await original<typeof import('../../../shared/api')>(), campaignStatus: vi.fn() }));
beforeEach(() => { vi.mocked(campaignStatus).mockReset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
const flush = async () => { await act(async () => {}); };
function show(id = 'campaign') { return render(<CampaignDelivery raw="signed" event={event} id={id} />); }

it('automatically checks pending/sending until terminal without resending a campaign', async () => {
  vi.mocked(campaignStatus)
    .mockResolvedValueOnce({ id: 'campaign', statuses: { pending: 2 } })
    .mockResolvedValueOnce({ id: 'campaign', statuses: { sending: 1, sent: 1 } })
    .mockResolvedValue({ id: 'campaign', statuses: { sent: 1, skipped: 1, unknown: 1, failed: 1 } });
  const view = show(); expect(screen.getByRole('status')).toHaveTextContent('Проверяем');
  await flush(); expect(screen.getByText('В очереди: 2')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(3000)); expect(screen.getByText('Отправляется: 1')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(3000)); expect(screen.getByText('Доставка неизвестна: 1')).toBeVisible();
  expect(screen.getByText('Ошибка: 1')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(9000)); expect(campaignStatus).toHaveBeenCalledTimes(3);
  expect(vi.mocked(campaignStatus).mock.calls[0][3]).toBeInstanceOf(AbortSignal);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('explicitly reports an empty audience, including an omitted status field', async () => {
  vi.mocked(campaignStatus).mockResolvedValue({ id: 'campaign', statuses: {} });
  const view = show(); await flush();
  expect(screen.getByText(/В выбранной группе нет получателей/)).toBeVisible();
  vi.mocked(campaignStatus).mockResolvedValue({ id: 'campaign' });
  fireEvent.click(screen.getByRole('button', { name: 'Проверить доставку' })); await flush();
  expect(screen.getByText(/Сообщения не отправлялись/)).toBeVisible();
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('stops automatic checks on errors, hides stale counts and retries only status manually', async () => {
  vi.mocked(campaignStatus).mockResolvedValueOnce({ id: 'campaign', statuses: { pending: 1 } }).mockRejectedValueOnce(new ApiFailure(403));
  const view = show(); await flush();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByRole('status')).toHaveTextContent('Нет прав');
  expect(screen.queryByText('В очереди: 1')).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(9000)); expect(campaignStatus).toHaveBeenCalledTimes(2);
  vi.mocked(campaignStatus).mockResolvedValue({ id: 'campaign', statuses: { sent: 1, future: 1 } });
  fireEvent.click(screen.getByRole('button', { name: 'Проверить доставку' })); await flush();
  expect(screen.getByText('Отправлено: 1')).toBeVisible(); expect(screen.getByText('future: 1')).toBeVisible();
  view.unmount();
});

it('cancels requests/timers and ignores late successes and failures after unmount', async () => {
  for (const failed of [false, true]) {
    let resolve!: (value: Campaign) => void; let reject!: (error: Error) => void;
    vi.mocked(campaignStatus).mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const view = show(); const signal = vi.mocked(campaignStatus).mock.lastCall![3]!;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { if (failed) reject(new Error('offline')); else resolve({ id: 'campaign', statuses: { pending: 1 } }); });
    expect(vi.getTimerCount()).toBe(0);
  }
});
