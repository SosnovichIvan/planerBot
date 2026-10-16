import { useId, useRef, useState } from 'react';
import { Modal } from '../modal';

export function Select({ label, options, value, defaultValue = '', onChange, name, disabled = false }: {
  label: string; options: { value: string; label: string; disabled?: boolean }[];
  value?: string; defaultValue?: string; onChange?: (value: string) => void; name?: string; disabled?: boolean;
}) {
  const [local, setLocal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const selected = value ?? local;
  const id = useId();
  const focusRef = useRef<HTMLButtonElement>(null);
  return <>
    {name && <input type="hidden" name={name} value={selected} />}
    <button className="field select-trigger" type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox" disabled={disabled}
      onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
      <span className="min-w-0 truncate">{options.find((option) => option.value === selected)?.label ?? 'Выберите'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <Modal title={label} initialFocus={focusRef} onClose={() => setOpen(false)}>
      <div id={id} role="listbox" aria-label={label} className="space-y-1" onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }}>{options.map((option) => <button type="button" key={option.value} ref={selected === option.value ? focusRef : undefined} className="select-option" role="option" aria-selected={selected === option.value} disabled={option.disabled} onClick={() => {
        setLocal(option.value); onChange?.(option.value); setOpen(false);
      }}><span>{option.label}</span>{selected === option.value && <span aria-hidden="true">✓</span>}</button>)}</div>
    </Modal>}
  </>;
}
