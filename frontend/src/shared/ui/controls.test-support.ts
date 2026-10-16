import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export async function selectOption(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(screen.getByRole('option', { name: option }));
}

export async function selectDate(label: string, value: string) {
  await userEvent.click(screen.getByRole('button', { name: label }));
  const target = new Date(`${value}T12:00:00`);
  const now = new Date();
  const distance = (target.getFullYear() - now.getFullYear()) * 12 + target.getMonth() - now.getMonth();
  const dialog = screen.getByRole('dialog', { name: label });
  for (let i = 0; i < Math.abs(distance); i++) await userEvent.click(within(dialog).getByRole('button', { name: distance > 0 ? 'Следующий месяц' : 'Предыдущий месяц' }));
  await userEvent.click(within(dialog).getByRole('button', { name: target.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) }));
}
