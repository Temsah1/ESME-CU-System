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
  <div className="rounded-sheet border border-dashed border-border-strong bg-surface/60 px-6 py-12 text-center">
    <span className="inline-flex p-3 rounded-card bg-surface-muted text-ink-subtle">
      <Icon className="w-6 h-6" aria-hidden />
    </span>
    <h3 className="mt-4 text-label font-bold text-ink-strong">{title}</h3>
    <p className="mt-1.5 text-caption text-ink-muted max-w-md mx-auto leading-relaxed">{description}</p>
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;
