import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiFailure, configureChat } from '../../../shared/api';
import { SettingsForm } from './settings-form';
import { chats } from './fixtures.test-data';

vi.mock('../../../shared/api', async (original) => ({
  ...await original<typeof import('../../../shared/api')>(), configureChat: vi.fn(),
}));
beforeEach(() => { vi.mocked(configureChat).mockReset(); });

it('saves timezone, tag, author policy and topic toggles with optimistic version', async () => {
  const saved = vi.fn();
  vi.mocked(configureChat).mockResolvedValue(undefined);
  render(<SettingsForm chat={chats[0]} raw="signed" onSaved={saved} />);
  await userEvent.click(screen.getByText('Настройки чата'));
  await userEvent.selectOptions(screen.getByLabelText('Кто создаёт из сообщений'), 'members');
  await userEvent.click(screen.getByLabelText('Подтверждать импорт администраторов'));
  await userEvent.click(screen.getByLabelText('Архив'));
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(configureChat).toHaveBeenCalledWith('signed', chats[0].id, expect.objectContaining({ version: 1, enabled_topic_ids: [10, 11], creation_policy: 'members', confirmation_required: true }));
});

it('preserves values after conflict and prevents parallel submit', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(configureChat).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<SettingsForm chat={chats[0]} raw="signed" onSaved={vi.fn()} />);
  await userEvent.click(screen.getByText('Настройки чата'));
  const button = screen.getByRole('button', { name: 'Сохранить настройки' });
  fireEvent.submit(button.closest('form')!); fireEvent.submit(button.closest('form')!);
  expect(configureChat).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
  reject(new ApiFailure(409, 'Настройки изменились'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Настройки изменились');
  expect(screen.getByLabelText('Часовой пояс IANA')).toHaveValue('Europe/Moscow');
});
