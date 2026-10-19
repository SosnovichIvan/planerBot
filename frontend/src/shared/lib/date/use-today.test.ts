import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { localDate, useToday } from './index';

afterEach(() => vi.useRealTimers());

it('uses device-local date and rolls over at midnight, including year boundary', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
  const view = renderHook(useToday);
  expect(view.result.current).toBe('2026-12-31');
  act(() => vi.advanceTimersByTime(1000));
  expect(view.result.current).toBe('2027-01-01');
  expect(localDate(new Date(2026, 0, 2))).toBe('2026-01-02');
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('refreshes after backgrounding and removes all listeners/timers on unmount', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 19));
  const view = renderHook(useToday);
  vi.setSystemTime(new Date(2026, 9, 20));
  act(() => window.dispatchEvent(new Event('focus')));
  expect(view.result.current).toBe('2026-10-20');
  vi.setSystemTime(new Date(2026, 9, 21));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(view.result.current).toBe('2026-10-21');
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
