import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import { toastPose, transitions } from './tokens';

type ToastKind = 'success' | 'info' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

/** The bar and the timer read the same number so the bar never lies about the dismissal. */
const TOAST_MS = 3800;

const kindStyles: Record<ToastKind, { icon: React.ElementType; edge: string; ink: string; bar: string }> = {
  success: { icon: CheckCircle2, edge: 'border-l-success', ink: 'text-success-ink', bar: 'bg-success' },
  info: { icon: Info, edge: 'border-l-brand', ink: 'text-ink-accent', bar: 'bg-accent' },
  error: { icon: AlertTriangle, edge: 'border-l-danger', ink: 'text-danger', bar: 'bg-danger' },
};

const ToastCard: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  const reduced = useReducedMotion();
  const { icon: Icon, edge, ink, bar } = kindStyles[toast.kind];
  return (
    <motion.li
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, margin: 0, transition: transitions.toastExit }}
      transition={transitions.toastEnter}
      className={`pointer-events-auto relative mb-2 flex list-none items-start gap-2.5 overflow-hidden rounded-card border border-border border-l-4 ${edge} bg-surface px-3.5 py-3 pr-2.5 text-caption font-semibold text-ink shadow-overlay`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ink}`} aria-hidden />
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="rounded-control p-1 text-ink-subtle transition-colors duration-micro hover:bg-tint-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      <motion.span
        aria-hidden
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: TOAST_MS / 1000, ease: 'linear' }}
        className={`absolute bottom-0 left-0 ${bar}`}
        style={{ height: toastPose.barHeight }}
      />
    </motion.li>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col"
        aria-live="polite"
      >
        <ul className="flex flex-col">
          <AnimatePresence>
            {toasts.map((t) => (
              <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </ToastContext.Provider>
  );
};
