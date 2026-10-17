import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Select } from './index';

const options = [{ value: 'a', label: 'Чат А' }, { value: 'b', label: 'Чат Б' }, { value: 'c', label: 'Недоступно', disabled: true }];

it('closes after selection and close-button clicks when rendered inside a form label', async () => {
  render(<form><label>Выбор чата<Select label="Чат" name="chat" defaultValue="a" options={options} /></label></form>);
  const trigger = screen.getByRole('combobox');
  await userEvent.click(trigger);
  expect(screen.getByRole('dialog').closest('label')).toBeNull();
  expect(screen.getByRole('dialog').parentElement).toBe(document.body);
  await userEvent.click(screen.getByText('Чат Б'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveTextContent('Чат Б');
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть окно' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  fireEvent.click(screen.getByRole('dialog'), { clientX: 100, clientY: 100 });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveTextContent('Чат Б');
});

it('selects through a themed listbox, submits a hidden value and restores focus', async () => {
  const changed = vi.fn();
  render(<form><Select label="Чат" name="chat" defaultValue="a" options={options} onChange={changed} /></form>);
  const trigger = screen.getByRole('combobox');
  await userEvent.click(trigger);
  expect(screen.getByRole('option', { name: 'Недоступно' })).toBeDisabled();
  expect(screen.getByRole('option', { name: 'Чат А' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getByRole('option', { name: 'Чат Б' }));
  expect(trigger).toHaveTextContent('Чат Б');
  expect(trigger).toHaveFocus();
  expect(changed).toHaveBeenCalledWith('b');
  expect(new FormData(trigger.closest('form')!).get('chat')).toBe('b');
});

it('supports keyboard navigation and does not change a controlled value on cancel', async () => {
  render(<Select label="Чат" value="a" options={options} />);
  const trigger = screen.getByRole('combobox');
  fireEvent.keyDown(trigger, { key: 'x' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const first = screen.getByRole('option', { name: 'Чат А' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: 'Чат Б' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'End' });
  expect(screen.getByRole('option', { name: 'Чат Б' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Home' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Tab' });
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(trigger).toHaveTextContent('Чат А');
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  await userEvent.click(screen.getByRole('option', { name: 'Чат Б' }));
  expect(trigger).toHaveTextContent('Чат А');
});

it('handles an empty list and a disabled trigger without a native popup', async () => {
  const view = render(<Select label="Пусто" options={[]} />);
  await userEvent.click(screen.getByRole('combobox'));
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Home' });
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Закрыть окно' }));
  view.rerender(<Select label="Пусто" disabled options={[]} />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('combobox')).toHaveTextContent('Выберите');
});
