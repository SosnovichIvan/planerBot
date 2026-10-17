import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Modal } from './index';

function Layers({ busy = false, close = () => {} }: { busy?: boolean; close?: () => void }) {
  const [outer, setOuter] = useState(true); const [inner, setInner] = useState(false);
  return outer && <Modal title="Первое" onClose={() => { setOuter(false); close(); }}>
    <button onClick={() => setInner(true)}>Открыть второе</button>
    {inner && <Modal title="Второе" busy={busy} onClose={() => setInner(false)}>Внутри</Modal>}
  </Modal>;
}

it('coordinates native Escape for exactly the top layer, respects busy and restores the page', async () => {
  const close = vi.fn(); const originalOverflow = document.body.style.overflow;
  const view = render(<Layers close={close} />);
  const trigger = screen.getByRole('button', { name: 'Открыть второе' });
  await userEvent.click(trigger); expect(screen.getAllByRole('dialog')).toHaveLength(2);
  fireEvent.keyDown(document, { key: 'Enter' });
  fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  view.rerender(<Layers busy close={close} />);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getAllByRole('dialog')).toHaveLength(2);
  view.rerender(<Layers close={close} />);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(trigger).toHaveFocus(); expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(close).toHaveBeenCalledOnce(); expect(document.body.style.overflow).toBe(originalOverflow);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
});
