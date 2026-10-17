import type { ComponentProps, ReactNode } from 'react';
import { Icon } from '../icon';

export function Disclosure({ title, children, className = '', ...props }: Omit<ComponentProps<'details'>, 'title'> & { title: ReactNode }) {
  return <details className={`group min-w-0 ${className}`} {...props}>
    <summary className="flex min-h-11 touch-manipulation cursor-pointer select-none list-none items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-canvas [&::-webkit-details-marker]:hidden">
      <span>{title}</span><span className="transition-transform group-open:rotate-180"><Icon name="down" /></span>
    </summary>
    <div className="pt-4">{children}</div>
  </details>;
}
