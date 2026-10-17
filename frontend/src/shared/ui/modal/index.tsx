import { IconButton } from '../button';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icon';

let openDialogs = 0;
let originalOverflow = '';
const dialogStack: { dialog: HTMLDialogElement; close: () => void }[] = [];
function closeTopOnEscape(event: KeyboardEvent) {
  const top = dialogStack.at(-1);
  if (event.key !== 'Escape' || event.isComposing || !top) return;
  // Prevent Chromium CloseWatcher from cancelling several grouped dialogs.
  event.preventDefault(); event.stopPropagation();
  top.close();
}

export function Modal({ title, onClose, busy = false, children, closeLabel = 'Закрыть окно', footer, drawer = false, initialFocus, fullHeight = false, dismissOnBackdrop = false }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode; closeLabel?: string; footer?: ReactNode; drawer?: boolean; initialFocus?: RefObject<HTMLElement | null>; fullHeight?: boolean; dismissOnBackdrop?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const latest = useRef({ busy, onClose });
  useEffect(() => { latest.current = { busy, onClose }; }, [busy, onClose]);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    if (openDialogs === 0) {
      originalOverflow = document.body.style.overflow;
      document.addEventListener('keydown', closeTopOnEscape, true);
    }
    dialog.showModal();
    const entry = { dialog, close: () => { if (!latest.current.busy) latest.current.onClose(); } };
    dialogStack.push(entry);
    openDialogs += 1;
    document.body.style.overflow = 'hidden';
    (initialFocus?.current ?? headingRef.current)?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      dialogStack.splice(dialogStack.indexOf(entry), 1);
      openDialogs -= 1;
      if (openDialogs === 0) {
        document.body.style.overflow = originalOverflow;
        document.removeEventListener('keydown', closeTopOnEscape, true);
      }
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return createPortal(<dialog ref={dialogRef} className={`modal ${drawer ? 'modal-drawer' : ''} ${fullHeight ? 'modal-full-height' : ''}`} aria-labelledby={titleId} onClick={(event) => {
    if (!dismissOnBackdrop || busy || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }} onCancel={(event) => { event.stopPropagation(); event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header">
      <h2 ref={headingRef} tabIndex={-1} id={titleId} className="min-w-0 [overflow-wrap:anywhere] text-xl font-semibold outline-none">{title}</h2>
      <IconButton type="button" disabled={busy} onClick={onClose} aria-label={closeLabel}><Icon name="close" /></IconButton>
    </div>
    <div className="modal-body">{children}</div>
    {footer && <div className="modal-footer">{footer}</div>}
  </dialog>, document.body);
}
