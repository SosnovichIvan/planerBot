import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { RemovalTasks } from './removal-tasks';
import { event } from './fixtures.test-data';
import * as telegram from '../../../shared/telegram';

it('has no empty queue panel and distinguishes pending, failure and unknown/manual cleanup', async () => {
  const retry = vi.fn();
  const view = render(<RemovalTasks events={[]} more={false} busy={false} onRetry={retry} />);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  const failed = { ...event, status: 'cancelled', publication_status: 'failed' };
  view.rerender(<RemovalTasks events={[failed]} more busy={false} onRetry={retry} />);
  expect(screen.getByText(/48 часов/)).toBeVisible();
  expect(screen.getByText(/первые 50 задач/)).toBeVisible();
  const open = vi.spyOn(telegram, 'openTelegramMessage').mockReturnValue(true);
  await userEvent.click(screen.getByRole('link', { name: 'Проверить сообщение в Telegram' }));
  expect(open).toHaveBeenCalledWith(event.message_url);
  await userEvent.click(screen.getByRole('button', { name: 'Повторить удаление сообщения' }));
  expect(retry).toHaveBeenCalledWith(failed);
  view.rerender(<RemovalTasks events={[{ ...failed, publication_status: 'unknown', message_url: null }]} more={false} busy={false} onRetry={retry} />);
  expect(screen.getByText(/ID сообщения неизвестен/)).toBeVisible(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  view.rerender(<RemovalTasks events={[{ ...failed, publication_status: 'unknown' }]} more={false} busy onRetry={retry} />);
  expect(screen.getByRole('button')).toBeDisabled();
  view.rerender(<RemovalTasks events={[{ ...failed, publication_status: null }]} more={false} busy={false} onRetry={retry} />);
  expect(screen.getByText('Удаление сообщения в очереди')).toBeVisible();
  view.rerender(<RemovalTasks events={[{ ...failed, publication_status: 'sending' }]} more={false} busy={false} onRetry={retry} />);
  expect(screen.getByText('Удаляем сообщение в Telegram')).toBeVisible();
});
