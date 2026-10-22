import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { durations, easings } from './tokens';

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({ open, onClose, className, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
            role="dialog"
            aria-modal="true"
            className={`relative shadow-2xl ${className ?? ''}`}
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
  children: React.ReactNode;
}

export const DrawerShell: React.FC<DrawerShellProps> = ({ open, onClose, className, side = 'right', children }) => (
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
          initial={{ x: side === 'left' ? '-100%' : '100%' }}
          animate={{ x: 0 }}
          exit={{ x: side === 'left' ? '-100%' : '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          className={`relative h-full overflow-y-auto ${className ?? ''}`}
        >
          {children}
        </motion.aside>
      </motion.div>
    )}
  </AnimatePresence>
);
