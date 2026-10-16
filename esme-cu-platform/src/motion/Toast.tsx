import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import { durations, easings } from './tokens';

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

const kindStyles: Record<ToastKind, { icon: React.ElementType; ring: string }> = {
  success: { icon: CheckCircle2, ring: 'border-l-emerald-500' },
  info: { icon: Info, ring: 'border-l-[#123B60]' },
  error: { icon: AlertTriangle, ring: 'border-l-rose-500' },
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
      window.setTimeout(() => dismiss(id), 3800);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const { icon: Icon, ring } = kindStyles[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: durations.micro } }}
                transition={{ duration: durations.standard, ease: easings.out }}
                className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border border-slate-200 border-l-4 ${ring} bg-white px-3.5 py-3 text-xs font-semibold text-slate-800 shadow-lg`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#F59A16]" />
                <span className="flex-1 leading-relaxed">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="text-slate-400 transition hover:text-slate-600"
                  aria-label="Dismiss notification"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
