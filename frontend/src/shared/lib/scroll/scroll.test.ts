import { expect, it, vi } from 'vitest';
import { revealControl } from './index';

it('reveals only the owning scroll region, with padding above/below and no-op when visible', () => {
  const control = document.createElement('button'); const container = document.createElement('div');
  const rect = (top: number, bottom: number) => ({ top, bottom } as DOMRect);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(100, 300));
  const item = vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(rect(90, 134));
  container.scrollTop = 50; revealControl(control, container); expect(container.scrollTop).toBe(32);
  item.mockReturnValue(rect(280, 324)); revealControl(control, container); expect(container.scrollTop).toBe(64);
  item.mockReturnValue(rect(150, 194)); revealControl(control, container, 4); expect(container.scrollTop).toBe(64);
});
