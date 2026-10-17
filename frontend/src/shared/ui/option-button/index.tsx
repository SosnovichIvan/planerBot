import type { ComponentProps } from 'react';
import { Button } from '../button';

export function OptionButton({ className = '', ...props }: ComponentProps<'button'>) {
  return <Button variant="unstyled" className={`select-option flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-base [overflow-wrap:anywhere] hover:bg-canvas focus-visible:-outline-offset-2 aria-selected:bg-accent aria-selected:text-white aria-pressed:bg-accent aria-pressed:text-white ${className}`} {...props} />;
}
