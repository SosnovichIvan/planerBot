import { afterEach, expect, it, vi } from 'vitest';
import { connectTelegram, initData } from './index';

afterEach(() => { delete window.Telegram; delete document.documentElement.dataset.theme; });

it('does not create identity outside Telegram', () => {
  expect(initData()).toBe('');
  connectTelegram()();
});

it('initializes Telegram and follows theme changes with cleanup', () => {
  const app = {
    initData: 'signed', colorScheme: 'light' as 'light' | 'dark', ready: vi.fn(), expand: vi.fn(),
    onEvent: vi.fn(), offEvent: vi.fn(),
  };
  window.Telegram = { WebApp: app };
  expect(initData()).toBe('signed');
  const cleanup = connectTelegram();
  expect(app.ready).toHaveBeenCalledOnce();
  expect(app.expand).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.theme).toBe('light');
  app.colorScheme = 'dark';
  app.onEvent.mock.calls[0][1]();
  expect(document.documentElement.dataset.theme).toBe('dark');
  cleanup();
  expect(app.offEvent).toHaveBeenCalledWith('themeChanged', app.onEvent.mock.calls[0][1]);
});
