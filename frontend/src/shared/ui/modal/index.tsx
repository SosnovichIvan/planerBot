import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export function Modal({ title, onClose, busy = false, children, closeLabel = 'Закрыть окно' }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode; closeLabel?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    headingRef.current?.focus();
    return () => {
      dialog.close(); document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="modal" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-start justify-between gap-3">
      <h2 ref={headingRef} tabIndex={-1} id={titleId} className="min-w-0 break-words text-xl font-semibold">{title}</h2>
      <button className="secondary-button shrink-0" type="button" disabled={busy} onClick={onClose} aria-label={closeLabel}>Закрыть</button>
    </div>
    {children}
  </dialog>;
}
