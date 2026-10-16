import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DateTimeField } from './index';

it('uses fixed month navigation at month end and commits a localized date', async () => {
  const changed = vi.fn();
  render(<form><DateTimeField label="Дата" name="date" type="date" defaultValue="2026-01-31" required onChange={changed} /></form>);
  const trigger = screen.getByRole('button', { name: 'Дата' });
  await userEvent.click(trigger);
  expect(screen.queryByRole('button', { name: 'Очистить' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
  expect(screen.getByText('февраль 2026 г.')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
  const first = screen.getByRole('button', { name: '1 января 2026 г.' });
  first.focus();
  await userEvent.keyboard('{ArrowRight}{ArrowDown}{ArrowLeft}{ArrowUp}');
  expect(first).toHaveFocus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(first).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: '15 января 2026 г.' }));
  expect(trigger).toHaveTextContent('15 января 2026 г.');
  expect(new FormData(trigger.closest('form')!).get('date')).toBe('2026-01-15');
  expect(changed).toHaveBeenCalledOnce();
  await userEvent.click(trigger);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(trigger).toHaveFocus();
});

it('can clear an optional date, cancel without changing it and open an empty date', async () => {
  render(<DateTimeField label="Окончание" name="end" type="date" defaultValue="2026-10-20" />);
  const trigger = screen.getByRole('button', { name: 'Окончание' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(trigger).toHaveTextContent('20 октября 2026 г.');
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Очистить' }));
  expect(trigger).toHaveTextContent('Выберите дату');
  await userEvent.click(trigger);
  expect(screen.getByText('Пн')).toBeVisible();
});

it('selects hours and minutes, confirms in 24h format, and supports clear/disabled', async () => {
  const view = render(<form><DateTimeField label="Время" name="time" type="time" defaultValue="09:15" /></form>);
  const trigger = screen.getByRole('button', { name: 'Время' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Часы: 22' }));
  await userEvent.click(screen.getByRole('button', { name: 'Минуты: 30' }));
  expect(screen.getByRole('button', { name: 'Минуты: 30' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
  expect(trigger).toHaveTextContent('22:30');
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Очистить' }));
  expect(trigger).toHaveTextContent('Выберите время');
  await userEvent.click(trigger);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть окно' }));
  view.rerender(<DateTimeField label="Время" name="time" type="time" disabled />);
  expect(screen.getByRole('button', { name: 'Время' })).toBeDisabled();
});
