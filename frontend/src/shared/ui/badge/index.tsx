import type { ComponentProps } from 'react';

export function Badge({ className = '', ...props }: ComponentProps<'span'>) {
  return <span className={`update-badge inline-flex rounded-full border border-accent bg-accent/15 px-2 py-0.5 text-xs font-semibold text-ink ${className}`} {...props} />;
}
