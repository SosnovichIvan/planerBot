import type { ComponentProps } from 'react';

const variants = {
  primary: 'button min-h-11 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90',
  secondary: 'secondary-button min-h-11 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-canvas',
  danger: 'min-h-11 rounded-xl border border-attention/60 bg-attention/10 px-4 py-2 text-sm font-semibold text-attention hover:bg-attention/20',
  unstyled: '',
};

export function Button({ variant = 'secondary', type = 'button', className = '', ...props }: ComponentProps<'button'> & { variant?: keyof typeof variants }) {
  return <button type={type} className={`ui-button touch-manipulation cursor-pointer select-none transition-colors active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`} {...props} />;
}

export function IconButton({ type = 'button', className = '', ...props }: ComponentProps<'button'> & { 'aria-label': string }) {
  return <button type={type} className={`icon-button inline-flex size-[44px] min-h-[44px] min-w-[44px] max-h-[44px] max-w-[44px] flex-none touch-manipulation cursor-pointer select-none items-center justify-center self-start rounded-xl border border-line bg-surface p-0 text-ink transition-colors hover:bg-canvas active:opacity-70 disabled:cursor-not-allowed disabled:opacity-50 ${className}`} {...props} />;
}
