import type { HTMLAttributes } from 'react';

export function Panel({ as: Element = 'section', className = '', ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'p' }) {
  return <Element className={`panel min-w-0 rounded-2xl border border-line bg-surface p-4 sm:p-6 ${className}`} {...props} />;
}
