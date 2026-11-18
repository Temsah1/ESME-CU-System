import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

type Props = {
  className?: string;
  label?: string;
  size?: 'sm' | 'md';
};

/**
 * The only spinner in the product. `label` is what a screen reader hears while it turns; leave it
 * out only when the surrounding control already announces the wait, in which case it is hidden.
 */
export const Spinner: React.FC<Props> = ({ className, label = 'Loading', size = 'md' }) => (
  <span
    role={label ? 'status' : undefined}
    aria-live={label ? 'polite' : undefined}
    aria-label={label || undefined}
    className={cn('inline-flex items-center justify-center', label && 'gap-2', className)}
  >
    <Loader2
      className={cn('animate-spin motion-reduce:animate-none', size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4')}
      aria-hidden={label ? undefined : true}
    />
    {label ? <span className="text-caption font-semibold">{label}</span> : null}
  </span>
);

export default Spinner;
