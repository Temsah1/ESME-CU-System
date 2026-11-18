import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/cn';
import { statusTone } from '../../lib/statusTone';
import { transitions } from '../../motion/tokens';

const PILL =
  'inline-flex items-center gap-2 rounded-pill border px-2 py-1 ' +
  'text-micro font-bold uppercase tracking-wider whitespace-nowrap ' +
  // §2.10: when the status changes under a mounted badge, the wash, the edge and the ink travel to
  // the new role together instead of snapping. The word itself crossfades on the keyed span below.
  'transition-[background-color,border-color,color] duration-badge-crossfade ease-out motion-reduce:transition-none';

/**
 * The status word and its wash, together. The word is always printed: colour alone is not a signal
 * a reader who cannot tell the two greens apart can use.
 */
export const StatusBadge: React.FC<{
  status: string;
  /** Overrides the printed word; the colour still comes from `status`. */
  children?: React.ReactNode;
  className?: string;
}> = ({ status, children, className }) => {
  const label = children ?? status.replace(/_/g, ' ');
  const wordKey = typeof label === 'string' ? `${status}:${label}` : status;
  return (
    <span className={cn(PILL, statusTone(status), className)}>
      <motion.span
        key={wordKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitions.badgeCrossfade}
        className="inline-flex items-center gap-2"
      >
        {label}
      </motion.span>
    </span>
  );
};
