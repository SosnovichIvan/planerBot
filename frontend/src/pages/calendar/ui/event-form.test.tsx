import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, createEvent, editEvent } from '../../../shared/api';
import { EventForm } from './event-form';
import { chats, event } from './fixtures.test-data';

vi.mock('../../../shared/api', async (original) => ({
  ...await original<typeof import('../../../shared/api')>(), createEvent: vi.fn(), editEvent: vi.fn(),
}));
beforeEach(() => { vi.mocked(createEvent).mockReset(); vi.mocked(editEvent).mockReset(); });

async function fill() {
  await userEvent.type(screen.getByLabelText('Название'), 'Встреча');
  fireEvent.change(screen.getByLabelText('Дата начала'), { target: { value: '2026-10-20' } });
  await userEvent.type(screen.getByLabelText('Место встречи'), 'Кафе');
}

it('creates in the selected chat and enabled topic, passes place and preserves a stable request key', async () => {
  const saved = vi.fn();
  vi.mocked(createEvent).mockRejectedValueOnce(new ApiFailure(422, 'Проверьте время')).mockResolvedValueOnce(event);
  render(<EventForm chats={chats} raw="signed" onSaved={saved} onClose={vi.fn()} />);
  expect(screen.queryByRole('option', { name: 'Архив' })).not.toBeInTheDocument();
  await fill();
  await userEvent.selectOptions(screen.getByLabelText('Чат'), chats[1].id);
  await userEvent.selectOptions(screen.getByLabelText('Тема'), '20');
  await userEvent.type(screen.getByLabelText('Теги через пробел'), '#встреча #клуб');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте время');
  expect(screen.getByLabelText('Название')).toHaveValue('Встреча');
  await userEvent.click(screen.getByRole('button', { name: 'Создать и опубликовать' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(event));
  expect(vi.mocked(createEvent).mock.calls[0][3]).toBe(vi.mocked(createEvent).mock.calls[1][3]);
  expect(createEvent).toHaveBeenCalledWith('signed', chats[1].id, expect.objectContaining({ topic_id: 20, place: 'Кафе', place_pending: false, tags: ['#встреча', '#клуб'] }), expect.any(String));
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
