interface TelegramApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  onEvent(event: 'themeChanged', callback: () => void): void;
  offEvent(event: 'themeChanged', callback: () => void): void;
}

declare global {
  interface Window { Telegram?: { WebApp: TelegramApp } }
}

export function initData(): string {
  return window.Telegram?.WebApp.initData ?? '';
}

// Navigation hint only. API authorization still uses the complete signed initData.
export function creationTarget(raw: string): { chatId?: string; topicId?: string } | null {
  const value = new URLSearchParams(raw).get('start_param');
  if (value === 'create') return {};
  const match = /^create_(-[1-9]\d{0,15})_([1-9]\d{0,15})$/.exec(value ?? '');
  return match ? { chatId: match[1], topicId: match[2] } : null;
}

export function connectTelegram(): () => void {
  const app = window.Telegram?.WebApp;
  if (!app) return () => {};
  const theme = () => { document.documentElement.dataset.theme = app.colorScheme; };
  theme();
  app.ready();
  app.expand();
  app.onEvent('themeChanged', theme);
  return () => { app.offEvent('themeChanged', theme); };
}
