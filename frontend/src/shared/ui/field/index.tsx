import type { ComponentProps } from 'react';
import { Icon } from '../icon';

export const fieldClassName = 'field mt-2 block min-h-11 w-full min-w-0 appearance-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink shadow-sm transition-colors placeholder:text-muted hover:border-muted disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${fieldClassName} ${className}`} {...props} />;
}

export function TextArea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`${fieldClassName} min-h-28 resize-y ${className}`} {...props} />;
}

export function Field({ className = '', ...props }: ComponentProps<'label'>) {
  return <label className={`form-label block min-w-0 text-sm font-medium ${className}`} {...props} />;
}

export function Checkbox({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <span className={`relative inline-flex size-5 flex-none align-middle ${className}`}>
    <input type="checkbox" className="peer absolute inset-0 size-5 appearance-none cursor-pointer rounded-md border border-line bg-surface checked:border-accent checked:bg-accent disabled:cursor-not-allowed disabled:opacity-50" {...props} />
    <span className="pointer-events-none absolute inset-0 grid place-items-center text-white opacity-0 peer-checked:opacity-100"><Icon name="check" /></span>
  </span>;
}
