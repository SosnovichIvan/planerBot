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
