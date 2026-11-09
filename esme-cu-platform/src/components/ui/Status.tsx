import React from 'react';
import { cn } from '../../lib/cn';
import { statusTone } from '../../lib/statusTone';

const PILL =
  'inline-flex items-center gap-2 rounded-pill border px-2 py-1 ' +
  'text-micro font-bold uppercase tracking-wider whitespace-nowrap';

/**
 * The status word and its wash, together. The word is always printed: colour alone is not a signal
 * a reader who cannot tell the two greens apart can use.
 */
export const StatusBadge: React.FC<{
  status: string;
  /** Overrides the printed word; the colour still comes from `status`. */
  children?: React.ReactNode;
  className?: string;
}> = ({ status, children, className }) => (
  <span className={cn(PILL, statusTone(status), className)}>
    {children ?? status.replace(/_/g, ' ')}
  </span>
);