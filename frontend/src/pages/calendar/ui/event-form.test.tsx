import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, createEvent, editEvent } from '../../../shared/api';
import { EventForm } from './event-form';
import { chats, event } from './fixtures.test-data';
import { selectDate, selectOption } from '../../../shared/ui/controls.test-support';

vi.mock('../../../shared/api', async (original) => ({
  ...await original<typeof import('../../../shared/api')>(), createEvent: vi.fn(), editEvent: vi.fn(),
}));
beforeEach(() => { vi.mocked(createEvent).mockReset(); vi.mocked(editEvent).mockReset(); vi.spyOn(window, 'confirm').mockReturnValue(true); });

async function fill() {
  await userEvent.type(screen.getByLabelText('Название'), 'Встреча');
  await selectDate('Дата начала', '2026-10-20');
  await userEvent.type(screen.getByLabelText('Место встречи'), 'Кафе');
}

it('uses the bounded full-height layout for create and edit without applying it to nested pickers', async () => {
  const view = render(<EventForm chats={chats} raw="signed" onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: 'Создать событие' })).toHaveClass('modal-full-height');
  expect(screen.getByRole('button', { name: 'Создать и опубликовать' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Дата начала' }));
  expect(screen.getByRole('dialog', { name: 'Дата начала' })).not.toHaveClass('modal-full-height');
  view.unmount();
  render(<EventForm chats={chats} raw="signed" event={event} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: 'Редактировать событие' })).toHaveClass('modal-full-height');
  expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeVisible();
});

it('creates in the selected chat and enabled topic, passes place and preserves a stable request key', async () => {
  const saved = vi.fn();
  vi.mocked(createEvent).mockRejectedValueOnce(new ApiFailure(422, 'Проверьте время')).mockResolvedValueOnce(event);
  render(<EventForm chats={chats} raw="signed" onSaved={saved} onClose={vi.fn()} />);
  expect(screen.queryByRole('option', { name: 'Архив' })).not.toBeInTheDocument();
  await fill();
  expect(screen.getByText(/Уведомление о новом событии отправится автоматически/)).toBeInTheDocument();
  await selectOption('Чат', 'Клуб');
  await selectOption('Тема', 'Обсуждения');
  await userEvent.type(screen.getByLabelText('Теги через пробел'), '#встреча #клуб');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте время');
  expect(screen.getByLabelText('Название')).toHaveValue('Встреча');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(event));
  expect(vi.mocked(createEvent).mock.calls[0][3]).toBe(vi.mocked(createEvent).mock.calls[1][3]);
  expect(createEvent).toHaveBeenCalledWith('signed', chats[1].id, expect.objectContaining({ topic_id: 20, place: 'Кафе', place_pending: false, tags: ['#встреча', '#клуб'], notify_members: false }), expect.any(String));
});

it('freezes an uncertain draft and retries exactly the same payload after a lost response', async () => {
  vi.mocked(createEvent).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(event);
  render(<EventForm chats={chats} raw="signed" onSaved={vi.fn()} onClose={vi.fn()} />);
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Результат запроса неизвестен');
  expect(screen.getByLabelText('Название')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(2));
  expect(vi.mocked(createEvent).mock.calls[0]).toEqual(vi.mocked(createEvent).mock.calls[1]);
});

it('edits with the existing topic and version, disables double submit and allows closing', async () => {
  let resolve!: (value: typeof event) => void;
  vi.mocked(editEvent).mockReturnValue(new Promise((done) => { resolve = done; }));
  const close = vi.fn();
  render(<EventForm chats={chats} raw="signed" event={event} onSaved={vi.fn()} onClose={close} />);
  expect(screen.getByLabelText('Тема')).toBeDisabled();
  await userEvent.clear(screen.getByLabelText('Место встречи'));
  await userEvent.type(screen.getByLabelText('Место встречи'), 'Парк');
  const submit = screen.getByRole('button', { name: 'Сохранить изменения' });
  const form = submit.closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(editEvent).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
  resolve(event);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть форму' }));
  expect(close).toHaveBeenCalledOnce();
});

it('does not submit when no topic is enabled', () => {
  render(<EventForm chats={[{ ...chats[0], topics: [] }]} raw="signed" onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Создать и опубликовать' })).toBeDisabled();
});

it('requires a location or connection link without an unspecified-place bypass', async () => {
  vi.mocked(createEvent).mockResolvedValue(event);
  render(<EventForm chats={chats} raw="signed" onSaved={vi.fn()} onClose={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Название'), 'Онлайн встреча');
  await selectDate('Дата начала', '2026-10-20');
  expect(screen.queryByLabelText('Место уточняется')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('место встречи или ссылку');
  expect(createEvent).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Ссылка подключения'), 'https://example.test/meet');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await waitFor(() => expect(createEvent).toHaveBeenCalledWith('signed', chats[0].id, expect.objectContaining({ place: '', online_url: 'https://example.test/meet', place_pending: false }), expect.any(String)));
});

it('opens a labelled dialog and blocks background scrolling until unmounted', () => {
  document.body.style.overflow = 'auto';
  const view = render(<EventForm chats={chats} raw="signed" initialChatId={chats[1].id} initialTopicId="20" onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: 'Создать событие' })).toHaveAttribute('open');
  expect(screen.getByRole('heading', { name: 'Создать событие' })).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Чат' })).toHaveTextContent('Клуб');
  expect(screen.getByRole('combobox', { name: 'Тема' })).toHaveTextContent('Обсуждения');
  expect(document.body.style.overflow).toBe('hidden');
  view.unmount();
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});

it('requires an explicit replacement for an unavailable launch topic', () => {
  render(<EventForm chats={chats} raw="signed" initialChatId={chats[0].id} initialTopicId="11" onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Исходная тема недоступна');
  expect(screen.getByRole('combobox', { name: 'Тема' })).toHaveTextContent('Выберите тему');
  expect(screen.getByRole('button', { name: 'Создать и опубликовать' })).toBeDisabled();
});

it('handles Escape and cancel, but does not close during a save', async () => {
  const close = vi.fn();
  let finish!: (event: typeof import('./fixtures.test-data').event) => void;
  vi.mocked(createEvent).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<EventForm chats={chats} raw="signed" onSaved={vi.fn()} onClose={close} />);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  close.mockClear();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Закрыть форму' })).toBeDisabled();
  finish(event);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отмена' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(close).toHaveBeenCalledOnce();
});

it('keeps a dirty draft when discarding is declined, including an uncertain save', async () => {
  const close = vi.fn();
  vi.mocked(createEvent).mockRejectedValue(new Error('network'));
  render(<EventForm chats={chats} raw="signed" onSaved={vi.fn()} onClose={close} />);
  await fill();
  vi.mocked(window.confirm).mockReturnValue(false);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть форму' }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Название')).toHaveValue('Встреча');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('Сохранение могло состояться'));
  expect(close).not.toHaveBeenCalled();
});

it('never inherits invitation intent on edit and avoids sending an unchanged draft', async () => {
  render(<EventForm chats={chats} raw="signed" event={{ ...event, data: { ...event.data, notify_members: true } }} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Уведомить участников об изменениях' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  expect(screen.getByRole('status')).toHaveTextContent('Нет изменений');
  expect(editEvent).not.toHaveBeenCalled();
});

it('confirms optional edit notifications separately and sends only after explicit consent', async () => {
  vi.mocked(editEvent).mockResolvedValue({ ...event, version: 2 });
  render(<EventForm chats={chats} raw="signed" event={event} onSaved={vi.fn()} onClose={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Место встречи'), ' новый адрес');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Уведомить участников об изменениях' }));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  expect(screen.getByRole('dialog', { name: 'Уведомить об изменениях?' })).toBeVisible();
  expect(editEvent).not.toHaveBeenCalled();
  fireEvent(screen.getByRole('dialog', { name: 'Уведомить об изменениях?' }), new Event('cancel', { cancelable: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Отмена' }).at(-1)!);
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить и уведомить' }));
  await waitFor(() => expect(editEvent).toHaveBeenCalledWith('signed', event, expect.objectContaining({ notify_members: true })));
});

it('validates the date and supports custom format, dates, time and all-day controls', async () => {
  vi.mocked(createEvent).mockResolvedValue(event);
  render(<EventForm chats={chats} raw="signed" onSaved={vi.fn()} onClose={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Название'), 'Встреча');
  await userEvent.type(screen.getByLabelText('Место встречи'), 'Кафе');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  expect(screen.getByRole('alert')).toHaveTextContent('дату начала');
  await selectDate('Дата начала', '2026-10-20');
  await selectDate('Дата окончания', '2026-10-20');
  await selectOption('Формат встречи', 'Гибридная');
  for (const name of ['Время начала', 'Время окончания']) {
    await userEvent.click(screen.getByRole('button', { name }));
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
  }
  await userEvent.click(screen.getByRole('checkbox', { name: 'Весь день' }));
  expect(screen.getByRole('button', { name: 'Время начала' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await waitFor(() => expect(createEvent).toHaveBeenCalledWith('signed', chats[0].id, expect.objectContaining({ start_time: null, end_time: null, meeting_format: 'hybrid' }), expect.any(String)));
});
