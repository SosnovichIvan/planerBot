import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { DayEvents } from './day-events';
import { event } from './fixtures.test-data';

it('shows pending, unavailable, all-day, online and legacy place states without fake links', () => {
  render(<DayEvents date="2026-10-20" onClose={() => {}} events={[
    { ...event, id: 'pending', message_url: null, publication_status: 'pending', data: { ...event.data, place: '', address: '', online_url: 'https://example.test/meet', start_time: null } },
    { ...event, id: 'unknown', message_url: null, publication_status: 'published', data: { ...event.data, place: '', address: '', online_url: '', map_url: '' } },
  ]} />);
  expect(screen.getByRole('dialog')).toHaveAccessibleName(/20 октября 2026/);
  expect(screen.getByText(/Карточка ещё публикуется/)).toBeVisible();
  expect(screen.getByText(/Ссылка на сообщение пока недоступна/)).toBeVisible();
  expect(screen.getByText('https://example.test/meet')).toBeVisible();
  expect(screen.getByText('Место уточняется')).toBeVisible();
  expect(screen.getByText(/Весь день/)).toBeVisible();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('shows an empty day and supports Escape', () => {
  let closed = false;
  render(<DayEvents date="2026-10-20" events={[]} incomplete onClose={() => { closed = true; }} />);
  expect(screen.getByText(/больше нет/)).toBeVisible();
  expect(screen.getByText(/Загружены не все/)).toBeVisible();
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(closed).toBe(true);
});

it('returns focus to the day trigger after the window is removed', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const view = render(<DayEvents date="2026-10-20" events={[]} onClose={() => {}} />);
  expect(screen.getByRole('heading')).toHaveFocus();
  view.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it('keeps an ordinary message link as fallback without Telegram SDK', async () => {
  render(<DayEvents date="2026-10-20" events={[event]} onClose={() => {}} />);
  const link = screen.getByRole('link');
  expect(link).toHaveAttribute('href', event.message_url);
  // Prevent JSDOM navigation while retaining the component default decision.
  let preventedByComponent = false;
  document.addEventListener('click', (e) => { preventedByComponent = e.defaultPrevented; e.preventDefault(); }, { once: true });
  await userEvent.click(link);
  expect(preventedByComponent).toBe(false);
});
