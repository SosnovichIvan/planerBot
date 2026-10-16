import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, campaignStatus, disablePersonalMessages, loadEventDetails, respondEvent, sendCampaign } from '../../../shared/api';
import * as telegram from '../../../shared/telegram';
import type { EventDetails as Details } from '../../../shared/api';
import { EventDetails } from './event-details';
import { event } from './fixtures.test-data';

vi.mock('../../../shared/api', async (original) => ({ ...await original<typeof import('../../../shared/api')>(), loadEventDetails: vi.fn(), respondEvent: vi.fn(), sendCampaign: vi.fn(), campaignStatus: vi.fn(), disablePersonalMessages: vi.fn() }));
const details = (admin = true, answered = false): Details => ({ event: { ...event, can_manage: admin, my_response: answered ? 'yes' : 'unanswered' }, counts: answered ? { yes: 1, no: 1, unanswered: 2 } : null, personal_messages_enabled: false });
function show(onClose = vi.fn(), onChanged = vi.fn()) { return render(<EventDetails raw="signed" chatId={event.chat_id} eventId={event.id} onClose={onClose} onChanged={onChanged} />); }

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadEventDetails).mockReset().mockResolvedValue(details());
  vi.mocked(respondEvent).mockReset().mockImplementation(async (_raw, _event, answer) => ({ ...details(false, answer !== 'unanswered'), event: { ...event, can_manage: false, my_response: answer } }));
  vi.mocked(sendCampaign).mockReset().mockResolvedValue({ id: 'campaign', statuses: {} });
  vi.mocked(campaignStatus).mockReset().mockResolvedValue({ id: 'campaign', statuses: { sent: 1, pending: 2, unknown: 1 } });
  vi.mocked(disablePersonalMessages).mockReset().mockResolvedValue();
});

it('hides all statistics until the viewer votes, including an administrator, and hides them again on reset', async () => {
  const changed = vi.fn(); show(vi.fn(), changed);
  expect(await screen.findByText('Нужен ваш ответ')).toBeVisible();
  expect(screen.queryByLabelText('Ответы участников календаря')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Не проголосовали:/ })).not.toBeInTheDocument();
  const open = vi.spyOn(telegram, 'openTelegramMessage').mockReturnValue(true);
  await userEvent.click(screen.getByRole('link', { name: 'Сообщение в Telegram' }));
  expect(open).toHaveBeenCalledWith(event.message_url);
  await userEvent.click(screen.getByRole('button', { name: 'Приду' }));
  expect(await screen.findByText('Ваш ответ: Приду')).toBeVisible();
  expect(screen.getByText('Приду: 1')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Приду: 1' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Не приду' }));
  expect(await screen.findByText('Ваш ответ: Не приду')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить ответ' }));
  expect(await screen.findByText('Нужен ваш ответ')).toBeVisible();
  expect(screen.queryByLabelText('Ответы участников календаря')).not.toBeInTheDocument();
  expect(changed).toHaveBeenCalledTimes(3);
});

it('confirms a group broadcast, reports delivery separately and prevents double submits', async () => {
  vi.mocked(loadEventDetails).mockResolvedValue(details(true, true));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  show();
  await userEvent.click(await screen.findByRole('button', { name: 'Не проголосовали: 2' }));
  await userEvent.type(screen.getByLabelText('Текст сообщения'), 'Пожалуйста, ответьте');
  await userEvent.click(screen.getByRole('button', { name: 'Отправить группе' }));
  expect(sendCampaign).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  let finish!: (value: { id: string; statuses: Record<string, number> }) => void;
  vi.mocked(sendCampaign).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const form = screen.getByLabelText('Текст сообщения').closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(sendCampaign).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Повторить тот же запрос' })).toBeDisabled();
  await act(() => finish({ id: 'campaign', statuses: {} }));
  expect(await screen.findByText(/поставлена в очередь/)).toBeVisible();
  expect(sendCampaign).toHaveBeenCalledWith('signed', expect.objectContaining({ id: event.id }), 'unanswered', 'Пожалуйста, ответьте', expect.any(String));
  await userEvent.click(screen.getByRole('button', { name: 'Проверить доставку' }));
  expect(await screen.findByText('Отправлено: 1')).toBeVisible();
  expect(screen.getByText('Доставка неизвестна: 1')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Не приду: 1' }));
  expect(screen.getByRole('heading', { name: 'Сообщение: Не приду' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть форму отправки' }));
  await userEvent.click(screen.getByRole('button', { name: 'Приду: 1' }));
  expect(screen.getByRole('heading', { name: 'Сообщение: Приду' })).toBeVisible();
});

it('retains a frozen request after an uncertain outcome and retries with the same idempotency key', async () => {
  vi.mocked(loadEventDetails).mockResolvedValue(details(true, true));
  vi.mocked(sendCampaign).mockRejectedValueOnce(new Error('network'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const close = vi.fn(); show(close);
  await userEvent.click(await screen.findByRole('button', { name: 'Приду: 1' }));
  await userEvent.type(screen.getByLabelText('Текст сообщения'), 'Текст');
  await userEvent.click(screen.getByRole('button', { name: 'Отправить группе' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Результат запроса неизвестен');
  expect(screen.getByLabelText('Текст сообщения')).toBeDisabled();
  confirm.mockReturnValue(false);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть форму отправки' }));
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Повторить тот же запрос' }));
  await screen.findByText(/поставлена в очередь/);
  expect(vi.mocked(sendCampaign).mock.calls[0]).toEqual(vi.mocked(sendCampaign).mock.calls[1]);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }));
  expect(close).toHaveBeenCalledOnce();
});

it('opens a separate top-level form for each group and Escape closes only the form', async () => {
  vi.mocked(loadEventDetails).mockResolvedValue(details(true, true));
  const close = vi.fn();
  document.body.style.overflow = 'auto';
  const view = show(close);
  await screen.findByText('Ваш ответ: Приду');
  for (const label of ['Приду: 1', 'Не приду: 1', 'Не проголосовали: 2']) {
    const trigger = screen.getByRole('button', { name: label });
    await userEvent.click(trigger);
    const form = screen.getByRole('dialog', { name: `Сообщение: ${label.replace(/: \d+$/, '')}` });
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(form).toContainElement(screen.getByLabelText('Текст сообщения'));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent(form, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  }
  view.unmount();
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});

it('confirms discarding a draft and restores scroll even when both dialogs unmount together', async () => {
  vi.mocked(loadEventDetails).mockResolvedValue(details(true, true));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const view = show();
  await userEvent.click(await screen.findByRole('button', { name: 'Приду: 1' }));
  await userEvent.type(screen.getByLabelText('Текст сообщения'), 'Черновик');
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.getByLabelText('Текст сообщения')).toHaveValue('Черновик');
  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(screen.queryByLabelText('Текст сообщения')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Не приду: 1' }));
  expect(screen.getByLabelText('Текст сообщения')).toHaveValue('');
  view.unmount();
  expect(document.body.style.overflow).toBe('');
});

it('keeps editable message text after a definitive rejection', async () => {
  vi.mocked(loadEventDetails).mockResolvedValue(details(true, true));
  vi.mocked(sendCampaign).mockRejectedValueOnce(new ApiFailure(403));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  show();
  await userEvent.click(await screen.findByRole('button', { name: 'Приду: 1' }));
  await userEvent.type(screen.getByLabelText('Текст сообщения'), 'Текст');
  await userEvent.click(screen.getByRole('button', { name: 'Отправить группе' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет прав');
  expect(screen.getByLabelText('Текст сообщения')).toBeEnabled();
});

it('handles permission requests, refresh and opt-out without trusting the SDK callback as persistence', async () => {
  const request = vi.spyOn(telegram, 'requestPersonalMessages').mockResolvedValue(false);
  show();
  await userEvent.click(await screen.findByRole('button', { name: 'Разрешить сообщения' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Разрешение не получено');
  request.mockResolvedValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Разрешить сообщения' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Разрешение принято Telegram');
  expect(screen.queryByText('Личные уведомления включены')).not.toBeInTheDocument();
  vi.mocked(loadEventDetails).mockResolvedValue({ ...details(), personal_messages_enabled: true });
  await userEvent.click(screen.getByRole('button', { name: 'Обновить разрешение' }));
  expect(await screen.findByText('Личные уведомления включены')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Отключить уведомления' }));
  expect(disablePersonalMessages).toHaveBeenCalledWith('signed');
  expect(await screen.findByRole('button', { name: 'Разрешить сообщения' })).toBeVisible();
});

it('handles loading errors, retry, absent optional event fields and cancelled events', async () => {
  vi.mocked(loadEventDetails).mockRejectedValueOnce(new ApiFailure(403));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет прав');
  vi.mocked(loadEventDetails).mockResolvedValue({ ...details(false), event: { ...event, status: 'cancelled', message_url: null, data: { ...event.data, description: '', map_url: '', online_url: '', start_time: null } } });
  await userEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByText('Событие отменено')).toBeVisible();
  expect(screen.getByText(/Весь день/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Приду' })).not.toBeInTheDocument();
});

it('ignores a late response after unmount and presents pending events without voting', async () => {
  let resolve!: (value: Details) => void;
  vi.mocked(loadEventDetails).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const view = show(); view.unmount();
  await act(() => resolve(details()));
  vi.mocked(loadEventDetails).mockResolvedValue({ ...details(), event: { ...event, status: 'pending' } });
  show();
  expect(await screen.findByText('Событие ожидает подтверждения')).toBeVisible();
});

it('does not close the dialog while a vote is being saved and surfaces vote errors', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(respondEvent).mockReturnValueOnce(new Promise((_done, fail) => { reject = fail; }));
  const close = vi.fn(); show(close);
  await userEvent.click(await screen.findByRole('button', { name: 'Приду' }));
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }));
  expect(close).not.toHaveBeenCalled();
  await act(() => reject(new ApiFailure(409, 'Событие отменено')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Событие отменено');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Приду' })).toBeEnabled());
});
