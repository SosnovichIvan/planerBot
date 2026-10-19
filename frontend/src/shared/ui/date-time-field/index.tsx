import { Button, IconButton } from '../button';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../modal';
import { Icon } from '../icon';
import { fieldClassName } from '../field';
import { OptionButton } from '../option-button';
import { revealControl } from '../../lib/scroll';
import { localDate, useToday } from '../../lib/date';

const dateText = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export function DateTimeField({ label, name, type, defaultValue = '', required = false, disabled = false, onChange }: {
  label: string; name: string; type: 'date' | 'time'; defaultValue?: string; required?: boolean; disabled?: boolean; onChange?: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(`${type === 'date' && value ? value : localDate(new Date())}T12:00:00`));
  const [clock, setClock] = useState(value || '19:00');
  const timeRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && type === 'date') {
      const target = dateRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? dateRef.current?.querySelector<HTMLElement>('[aria-current="date"]') ?? dateRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      const container = dateRef.current?.closest<HTMLElement>('.modal-body');
      if (target && container) revealControl(target, container);
    }
  }, [open, type, month, value]);
  useEffect(() => {
    if (open && type === 'time') timeRef.current?.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]').forEach(button => {
      if (button.parentElement) button.parentElement.scrollTop = button.offsetTop - button.parentElement.offsetTop - 8;
    });
  }, [open, type]);
  function choose(next: string) { setValue(next); onChange?.(); setOpen(false); }
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = useToday();
  const [hours, minutes] = clock.split(':');
  return <>
    <input type="hidden" name={name} value={disabled ? '' : value} />
    <Button variant="unstyled" className={`${fieldClassName} flex items-center justify-between gap-3 text-left`} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-required={required} disabled={disabled} onClick={() => {
      setClock(value || '19:00'); if (type === 'date' && value) setMonth(new Date(`${value}T12:00:00`)); setOpen(true);
    }}><span className="min-w-0 [overflow-wrap:anywhere]">{value ? type === 'date' ? dateText(value) : value : type === 'date' ? 'Выберите дату' : 'Выберите время'}</span><Icon name={type === 'date' ? 'calendar' : 'clock'} /></Button>
    {open && <Modal title={label} onClose={() => setOpen(false)} footer={<>
      {!required && <Button variant="secondary" type="button" onClick={() => choose('')}>Очистить</Button>}
      <Button variant="secondary" type="button" onClick={() => setOpen(false)}>Отмена</Button>
      {type === 'time' && <Button variant="primary" type="button" onClick={() => choose(clock)}>Подтвердить</Button>}
    </>}>
      {type === 'date' ? <>
        <div className="mb-4 flex items-center justify-between gap-2"><IconButton type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="previous" /></IconButton><strong className="capitalize" aria-live="polite">{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</strong><IconButton type="button" aria-label="Следующий месяц" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="next" /></IconButton></div>
        <div ref={dateRef} className="grid grid-cols-7 gap-1 text-center" onKeyDown={(e) => {
          const directions: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (!(e.key in directions)) return;
          e.preventDefault();
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = items[Math.max(0, Math.min(items.length - 1, index + directions[e.key]))];
          next?.focus({ preventScroll: true });
          const container = e.currentTarget.closest<HTMLElement>('.modal-body');
          if (next && container) revealControl(next, container);
        }}>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span className="pb-2 text-xs text-muted" key={day}>{day}</span>)}{Array.from({ length: 42 }, (_, index) => {
          const day = index - offset + 1;
          const valid = day > 0 && day <= days;
          const date = localDate(new Date(month.getFullYear(), month.getMonth(), day));
          return <Button variant="unstyled" className={`picker-day ${date === today && valid ? `font-bold ring-2 ring-inset ${date === value ? 'ring-white' : 'ring-focus'}` : ''}`} type="button" key={index} disabled={!valid} aria-label={valid ? dateText(date) : undefined} aria-pressed={valid && date === value} aria-current={valid && date === today ? 'date' : undefined} onClick={() => choose(date)}>{valid ? day : ''}</Button>;
        })}</div>
        {today.startsWith(localDate(first).slice(0, 8)) && <p className="mt-3 text-xs text-muted">Сегодня: {dateText(today)}</p>}
      </> : <div ref={timeRef} className="grid grid-cols-2 gap-4">{(['Часы', 'Минуты'] as const).map((title, column) => <div key={title}><p className="mb-2 text-sm text-muted">{title}</p><div className="time-column" role="group" aria-label={title}>{Array.from({ length: column ? 60 : 24 }, (_, index) => {
        const part = String(index).padStart(2, '0');
        return <OptionButton className="justify-center" type="button" key={part} aria-label={`${title}: ${part}`} aria-pressed={part === (column ? minutes : hours)} onClick={() => setClock(column ? `${hours}:${part}` : `${part}:${minutes}`)}>{part}</OptionButton>;
      })}</div></div>)}</div>}
    </Modal>}
  </>;
}
