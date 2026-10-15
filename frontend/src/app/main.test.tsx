import { expect, it, vi } from 'vitest';

const render = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render })) }));
vi.mock('../shared/telegram', () => ({ connectTelegram: connect }));

it('mounts the application and connects the Telegram lifecycle', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  expect(connect).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledOnce();
});
