import { Button } from '../button';
import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../modal';
import { fieldClassName } from '../field';
import { Icon } from '../icon';
import { OptionButton } from '../option-button';
import { revealControl } from '../../lib/scroll';

export function Select({ label, options, value, defaultValue = '', onChange, name, disabled = false }: {
  label: string; options: { value: string; label: string; disabled?: boolean }[];
  value?: string; defaultValue?: string; onChange?: (value: string) => void; name?: string; disabled?: boolean;
}) {
  const [local, setLocal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const selected = value ?? local;
  const id = useId();
  const focusRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusValue = options.find(option => !option.disabled && option.value === selected)?.value ?? options.find(option => !option.disabled)?.value;
  useEffect(() => {
    if (open && focusRef.current && listRef.current?.parentElement) revealControl(focusRef.current, listRef.current.parentElement);
  }, [open]);
  return <>
    {name && <input type="hidden" name={name} value={selected} />}
    <Button variant="unstyled" className={`${fieldClassName} flex items-center justify-between gap-3 text-left`} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" disabled={disabled}
      onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
      <span className="min-w-0 truncate">{options.find((option) => option.value === selected)?.label ?? 'Выберите'}</span><Icon name="down" />
    </Button>
    {open && <Modal title={label} initialFocus={focusRef} dismissOnBackdrop onClose={() => setOpen(false)}>
      <div ref={listRef} id={id} role="listbox" aria-label={label} className="space-y-1" onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        const next = items[index];
        next?.focus({ preventScroll: true });
        if (next && listRef.current?.parentElement) revealControl(next, listRef.current.parentElement);
      }}>{options.map((option) => <OptionButton type="button" key={option.value} ref={focusValue === option.value ? focusRef : undefined} role="option" aria-selected={selected === option.value} disabled={option.disabled} onClick={() => {
        setLocal(option.value); onChange?.(option.value); setOpen(false);
      }}><span className="min-w-0">{option.label}</span>{selected === option.value && <Icon name="check" />}</OptionButton>)}</div>
    </Modal>}
  </>;
}
