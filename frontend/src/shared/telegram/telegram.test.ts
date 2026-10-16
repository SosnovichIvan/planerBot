import { afterEach, expect, it, vi } from 'vitest';
import { connectTelegram, creationTarget, eventTarget, initData, openTelegramMessage, requestPersonalMessages } from './index';

afterEach(() => { delete window.Telegram; delete document.documentElement.dataset.theme; localStorage.clear(); });

it('uses Telegram navigation only for supported message links and falls back without SDK', () => {
  const url = 'https://t.me/c/100/10/5';
  expect(openTelegramMessage(url)).toBe(false);
  window.Telegram = { WebApp: { initData: '', colorScheme: 'light', ready() {}, expand() {}, onEvent() {}, offEvent() {}, openTelegramLink: vi.fn() } };
  expect(openTelegramMessage('https://evil.test/')).toBe(false);
  expect(openTelegramMessage(url)).toBe(true);
  expect(window.Telegram.WebApp.openTelegramLink).toHaveBeenCalledWith(url);
  vi.mocked(window.Telegram.WebApp.openTelegramLink!).mockImplementation(() => { throw new Error('unsupported'); });
  expect(openTelegramMessage(url)).toBe(false);
});

it('parses creation hints without treating arbitrary start params as creation', () => {
  expect(creationTarget('start_param=create')).toEqual({});
  expect(creationTarget('start_param=create_-100100_10')).toEqual({ chatId: '-100100', topicId: '10' });
  for (const raw of ['', 'start_param=chat_-100100', 'start_param=create_42_10', 'start_param=create_-1_0', 'start_param=create_-1_10_extra']) expect(creationTarget(raw)).toBeNull();
});

it('parses an event deep link only as a navigation hint', () => {
  expect(eventTarget('start_param=event_-100100_00000000000040008000000000000001')).toEqual({ chatId: '-100100', eventId: '00000000-0000-4000-8000-000000000001' });
  for (const raw of ['', 'start_param=create', 'start_param=event_42_bad']) expect(eventTarget(raw)).toBeNull();
});

it('requests personal-message permission only through the supported SDK', async () => {
  expect(await requestPersonalMessages()).toBe(false);
  const app = { initData: '', colorScheme: 'light' as const, ready() {}, expand() {}, onEvent() {}, offEvent() {} };
  window.Telegram = { WebApp: app };
  expect(await requestPersonalMessages()).toBe(false);
  window.Telegram.WebApp.requestWriteAccess = (callback) => callback(true);
  expect(await requestPersonalMessages()).toBe(true);
  window.Telegram.WebApp.requestWriteAccess = () => { throw new Error('unsupported'); };
  expect(await requestPersonalMessages()).toBe(false);
});

it('does not create identity outside Telegram', () => {
  expect(initData()).toBe('');
  connectTelegram()();
});

it('initializes Telegram but keeps the product dark by default with cleanup', () => {
  const app = {
    initData: 'signed', colorScheme: 'light' as 'light' | 'dark', ready: vi.fn(), expand: vi.fn(),
    onEvent: vi.fn(), offEvent: vi.fn(),
  };
  window.Telegram = { WebApp: app };
  expect(initData()).toBe('signed');
  const cleanup = connectTelegram();
  expect(app.ready).toHaveBeenCalledOnce();
  expect(app.expand).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.theme).toBe('dark');
  app.colorScheme = 'dark';
  app.onEvent.mock.calls[0][1]();
  expect(document.documentElement.dataset.theme).toBe('dark');
  localStorage.setItem('planerbot-theme', 'light');
  app.onEvent.mock.calls[0][1]();
  expect(document.documentElement.dataset.theme).toBe('light');
  cleanup();
  expect(app.offEvent).toHaveBeenCalledWith('themeChanged', app.onEvent.mock.calls[0][1]);
});
