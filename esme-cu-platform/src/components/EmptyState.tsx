import React from 'react';
import { Inbox } from 'lucide-react';

type Props = {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
};

/**
 * Shown where a collection legitimately has no rows yet — a fresh install, or a
 * workspace whose records live on a provider that is not configured. It states the
 * reason instead of filling the space with sample data.
 */
export const EmptyState: React.FC<Props> = ({ title, description, icon: Icon = Inbox, action }) => (
  <div className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 px-6 py-12 text-center">
    <span className="inline-flex p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400">
      <Icon className="w-6 h-6" aria-hidden />
    </span>
    <h3 className="mt-4 text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">{description}</p>
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;
