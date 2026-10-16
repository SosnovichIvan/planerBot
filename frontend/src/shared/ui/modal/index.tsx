import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

let openDialogs = 0;
let originalOverflow = '';

export function Modal({ title, onClose, busy = false, children, closeLabel = 'Закрыть окно', footer, drawer = false, initialFocus }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode; closeLabel?: string; footer?: ReactNode; drawer?: boolean; initialFocus?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    if (openDialogs === 0) originalOverflow = document.body.style.overflow;
    dialog.showModal();
    openDialogs += 1;
    document.body.style.overflow = 'hidden';
    (initialFocus?.current ?? headingRef.current)?.focus();
    return () => {
      dialog.close();
      openDialogs -= 1;
      if (openDialogs === 0) document.body.style.overflow = originalOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return <dialog ref={dialogRef} className={`modal ${drawer ? 'modal-drawer' : ''}`} aria-labelledby={titleId} onCancel={(event) => { event.stopPropagation(); event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-header">
      <h2 ref={headingRef} tabIndex={-1} id={titleId} className="min-w-0 break-words text-xl font-semibold">{title}</h2>
      <button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label={closeLabel}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </div>
    <div className="modal-body">{children}</div>
    {footer && <div className="modal-footer">{footer}</div>}
  </dialog>;
}
