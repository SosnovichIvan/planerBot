import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button, IconButton } from './button';
import { Input, Field, Checkbox, TextArea } from './field';
import { Panel } from './panel';
import { Badge } from './badge';
import { Icon } from './icon';
import { OptionButton } from './option-button';
import { Disclosure } from './disclosure';
import { TextLink } from './text-link';

it('shares button states, forwards native attributes/ref and never submits by default', async () => {
  const click = vi.fn(); const ref = createRef<HTMLButtonElement>();
  render(<Panel><Button onClick={click} ref={ref}>Действие</Button><Button variant="primary" type="submit">Сохранить</Button><Button variant="danger" disabled>Удалить</Button><Button variant="unstyled" className="custom">Дата</Button><IconButton aria-label="Закрыть"><Icon name="close" /></IconButton></Panel>);
  await userEvent.click(screen.getByRole('button', { name: 'Действие' }));
  expect(click).toHaveBeenCalledOnce(); expect(ref.current).toHaveAttribute('type', 'button');
  expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute('type', 'submit');
  expect(screen.getByRole('button', { name: 'Удалить' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Дата' })).toHaveClass('custom');
  expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveClass('size-[44px]', 'flex-none');
});

it('preserves labels, editable values, disabled and checkbox semantics through primitives', async () => {
  render(<><Panel as="div" className="custom"><Field>Название<Input name="title" required /></Field><Field className="my-2">Описание<TextArea /></Field><Field>Согласие<Checkbox defaultChecked /></Field></Panel><Panel as="p">Подсказка</Panel><Badge>Обновлено</Badge><OptionButton role="option" aria-selected>Чат</OptionButton><OptionButton className="justify-center" disabled>Нет доступа</OptionButton></>);
  await userEvent.type(screen.getByLabelText('Название'), 'Встреча');
  expect(screen.getByLabelText('Название')).toHaveValue('Встреча');
  await userEvent.type(screen.getByLabelText('Описание'), 'План');
  expect(screen.getByLabelText('Описание')).toHaveValue('План');
  expect(screen.getByLabelText('Согласие')).toBeChecked();
  expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Подсказка').tagName).toBe('P');
  expect(screen.getByText('Обновлено')).toHaveClass('update-badge');
});

it('renders structural icons as hidden vector assets', () => {
  const names = ['check', 'close', 'refresh', 'previous', 'next', 'down', 'calendar', 'clock', 'moon', 'sun'] as const;
  const view = render(<>{names.map(name => <Icon key={name} name={name} />)}</>);
  expect(view.container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(names.length);
});

it('keeps native disclosure semantics behind the themed component', async () => {
  render(<Disclosure title="Настройки">Содержимое</Disclosure>);
  await userEvent.click(screen.getByText('Настройки'));
  expect(screen.getByText('Настройки').closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Содержимое')).toBeVisible();
});

it('shares touch-sized links without changing href or external navigation attributes', () => {
  render(<><TextLink href="https://example.test" target="_blank" rel="noreferrer">Карта</TextLink><TextLink className="mt-3" href="#event">Событие</TextLink></>);
  expect(screen.getByRole('link', { name: 'Карта' })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: 'Карта' })).toHaveClass('min-h-11');
  expect(screen.getByRole('link', { name: 'Событие' })).toHaveAttribute('href', '#event');
});
