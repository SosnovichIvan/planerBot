import { afterEach, expect, it, vi } from 'vitest';
import { connectTelegram, creationTarget, initData } from './index';

afterEach(() => { delete window.Telegram; delete document.documentElement.dataset.theme; });

it('parses creation hints without treating arbitrary start params as creation', () => {
  expect(creationTarget('start_param=create')).toEqual({});
  expect(creationTarget('start_param=create_-100100_10')).toEqual({ chatId: '-100100', topicId: '10' });
  for (const raw of ['', 'start_param=chat_-100100', 'start_param=create_42_10', 'start_param=create_-1_0', 'start_param=create_-1_10_extra']) expect(creationTarget(raw)).toBeNull();
});

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
