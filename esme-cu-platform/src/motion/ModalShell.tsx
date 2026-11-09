import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDialogA11y } from '../lib/useDialogA11y';
import { durations, easings } from './tokens';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  /**
   * What the dialog is called. A `role="dialog"` with no name is what axe reports as an unnamed
   * modal, and every screen that opens one has a phrase for it — "Add a committee", "Review this
   * submission". The fallback is generic on purpose: a generic name still beats none.
   */
  ariaLabel?: string;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({ open, onClose, className, ariaLabel = 'Dialog', children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: durations.standard, ease: easings.smooth }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            // Focusable so the trap has somewhere to put focus on open; the outline is suppressed
            // because the ring would be drawn around the whole dialog and point at nothing.
            tabIndex={-1}
            className={`relative outline-none shadow-2xl ${className ?? ''}`}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: durations.standard + 0.08, ease: easings.out }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

interface DrawerShellProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  /** Which edge the panel hangs from. A navigation drawer comes from the left. */
  side?: 'left' | 'right';
  ariaLabel?: string;
  children: React.ReactNode;
}

export const DrawerShell: React.FC<DrawerShellProps> = ({
  open,
  onClose,
  className,
  side = 'right',
  ariaLabel = 'Panel',
  children,
}) => {
  const panelRef = useRef<HTMLElement>(null);
  useDialogA11y(panelRef, open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 z-50 flex ${side === 'left' ? 'justify-start' : 'justify-end'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: durations.standard, ease: easings.smooth }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" />
          <motion.aside
            ref={panelRef as React.RefObject<HTMLDivElement>}
            // A drawer used to be an `<aside>` with nothing to say about itself: no role, no name, no
            // Escape, and a tab order that walked straight off its edge into the page behind.
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            initial={{ x: side === 'left' ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'left' ? '-100%' : '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className={`relative outline-none h-full overflow-y-auto pt-safe pb-safe ${className ?? ''}`}
          >
            {children}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
