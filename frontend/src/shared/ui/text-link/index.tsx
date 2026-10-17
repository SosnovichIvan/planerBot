import type { ComponentProps } from 'react';

export function TextLink({ className = '', ...props }: ComponentProps<'a'>) {
  return <a className={`flex min-h-11 min-w-0 touch-manipulation items-center rounded-lg px-2 py-2 text-sm font-medium text-ink underline underline-offset-4 [overflow-wrap:anywhere] transition-colors hover:bg-canvas hover:text-focus ${className}`} {...props} />;
}
