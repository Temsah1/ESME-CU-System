import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

/*
 * The surfaces every view is built out of. These classes used to be retyped per screen, which is how
 * one panel ended up `shadow-sm` and its neighbour `shadow-md` for no reason a reader could see. The
 * names here are the ones the token file already publishes, so a card in the planner and a card in
 * the ledger are the same pixels by construction.
 */

type CardProps = {
  children: React.ReactNode;
  className?: string;
  /** `section` is a heading on the page: the landmark lets a screen-reader user jump between panels. */
  as?: 'div' | 'section' | 'article' | 'li';
  /** Name the landmark when `as` is section or article. */
  ariaLabel?: string;
  /** `flat` drops the shadow for cards that sit inside another card. */
  tone?: 'card' | 'raised' | 'sunken';
  padded?: boolean;
};

const cardTones = {
  card: 'bg-surface border-border shadow-card',
  raised: 'bg-surface-raised border-border-strong shadow-raised',
  sunken: 'bg-surface-sunken border-border-subtle',
};

export const Card: React.FC<CardProps> = ({
  children,
  className,
  as = 'div',
  ariaLabel,
  tone = 'card',
  padded = true,
}) => {
  const Tag = as;
  const labelled = ariaLabel ? { 'aria-label': ariaLabel } : {};
  return (
    <Tag
      {...labelled}
      className={cn(
        'rounded-sheet border',
        cardTones[tone],
        padded && 'p-5 sm:p-6',
        // A card that is also a control (CommitteeManagement's profile tiles) needs the hover lift
        // without each screen re-deriving which class produces it.
        'transition-[border-color,box-shadow] duration-standard ease-smooth',
        className
      )}
    >
      {children}
    </Tag>
  );
};

type BadgeTone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const badgeTones: Record<BadgeTone, string> = {
  // Tinted badges are typed with `text-ink`, not with the status colour. The reason is contrast, not
  // taste: a 15% wash of a hue plus text of that same hue lands around 2:1, which fails AA at badge
  // size in both themes. The wash carries the status at a glance and the word carries it aloud.
  neutral: 'bg-surface-muted text-ink-muted border-border',
  brand: 'bg-brand text-white border-transparent',
  accent: 'bg-accent text-slate-950 border-transparent',
  success: 'bg-success/15 text-ink border-transparent',
  warning: 'bg-warning/15 text-ink border-transparent',
  danger: 'bg-danger/15 text-ink border-transparent',
  info: 'bg-info/15 text-ink border-transparent',
};

/**
 * A status word, never a colour alone: the text is the signal and the tint is the shortcut, so the
 * badge still reads for a user who cannot tell the two greens apart.
 */
export const Badge: React.FC<{
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
  /** Renders inside a table cell where the surrounding row already carries the status. */
  dot?: boolean;
}> = ({ children, tone = 'neutral', dot, className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-2 rounded-pill border px-2 py-1',
      'text-micro font-bold whitespace-nowrap',
      badgeTones[tone],
      className
    )}
  >
    {dot ? <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current" /> : null}
    {children}
  </span>
);

/**
 * The page's own title block. Views used to write their own `<h1>` with their own margins, which is
 * why three pages that do the same job started at three different heights.
 */
export const PageHeader: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  /** A live figure (member count, unread requests) that belongs beside the title, not in a card. */
  meta?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon: Icon, actions, meta, className }) => (
  <header
    className={cn(
      'flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4',
      // Sticky on purpose is avoided: a 4-row header eating 120px of a 640px phone screen is the
      // classic way a dashboard becomes unusable on the device most members actually use.
      className
    )}
  >
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        {Icon ? (
          <span className="inline-flex p-2 rounded-control bg-tint-accent text-ink shrink-0">
            <Icon className="w-5 h-5" aria-hidden />
          </span>
        ) : null}
        <h1 className="text-headline font-extrabold text-ink-strong tracking-tight truncate">{title}</h1>
      </div>
      {subtitle ? <p className="mt-2 text-label text-ink-muted leading-relaxed max-w-prose">{subtitle}</p> : null}
      {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
  </header>
);

/** The hues a metric is allowed to wear. Each one is a wash plus an ink that clears AA on it. */
export type StatTone = 'brand' | 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'violet';

const statTones: Record<StatTone, string> = {
  brand: 'bg-tint-brand text-ink-brand',
  accent: 'bg-tint-accent text-ink',
  info: 'bg-info/15 text-info',
  success: 'bg-success/15 text-success-ink',
  warning: 'bg-warning/15 text-ink',
  danger: 'bg-danger/15 text-danger',
  violet: 'bg-violet/15 text-violet',
};

/**
 * One number that matters. `label` is read before the value by design — a bare figure with no name
 * ("47") is the thing a dashboard does wrong most often.
 *
 * With `onClick` the tile is a real button: the home screens use it to jump to the register the
 * figure counts, and a native button carries Enter/Space and the focus ring without each screen
 * re-deriving them. The figure itself is printed, never counted up — a number that animates from
 * zero is read as zero by anyone who glances away, and by every screen reader.
 */
export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  trend?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
  onClick?: () => void;
  className?: string;
}> = ({ label, value, trend, hint, icon: Icon, tone, onClick, className }) => {
  const base = cn(
    'rounded-card border border-border bg-surface shadow-card p-4 flex flex-col justify-between h-full',
    'transition-[border-color,box-shadow] duration-standard ease-smooth motion-reduce:transition-none',
    onClick && 'w-full text-left cursor-pointer hover:border-brand/40 hover:shadow-raised',
    className
  );
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="text-micro font-bold uppercase tracking-wider text-ink-muted">{label}</span>
        {Icon ? (
          tone ? (
            <span className={cn('w-8 h-8 shrink-0 rounded-control flex items-center justify-center', statTones[tone])}>
              <Icon className="w-4 h-4" aria-hidden />
            </span>
          ) : (
            <Icon className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" aria-hidden />
          )
        ) : null}
      </span>
      <span className="mt-3 block text-headline font-extrabold text-ink-strong leading-none font-numbers tracking-tight">
        {value}
      </span>
      <span className="mt-2 flex items-start justify-between gap-2 min-h-4">
        <span className="min-w-0 flex items-start gap-2">
          {trend ? (
            <span
              className={cn(
                'text-micro font-bold font-numbers shrink-0',
                // Direction alone is not a verdict: a rising churn count is bad news. `good` decides
                // the colour and the arrow says which way the number moved, so the two never conflict.
                trend.good === false ? 'text-danger' : trend.good === true ? 'text-success-ink' : 'text-ink-subtle'
              )}
            >
              {/* The triangle is decoration — some screen readers announce it as "up-pointing
                  triangle", which is the same sentence the sr-only text already says, worse. */}
              <span aria-hidden>{trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '●'} </span>
              {trend.value}
              <span className="sr-only">
                {trend.direction === 'up' ? ' higher' : trend.direction === 'down' ? ' lower' : ' unchanged'} than last period
              </span>
            </span>
          ) : null}
          {hint ? <span className="text-micro text-ink-subtle leading-snug">{hint}</span> : null}
        </span>
        {onClick ? <ChevronRight className="w-4 h-4 shrink-0 text-ink-faint" aria-hidden /> : null}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={base}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
};

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const alertTones: Record<AlertTone, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: { cls: 'bg-info/10 border-info/35 text-ink', Icon: Info },
  success: { cls: 'bg-success/10 border-success/35 text-ink', Icon: CheckCircle2 },
  warning: { cls: 'bg-warning/15 border-warning/40 text-ink', Icon: AlertTriangle },
  danger: { cls: 'bg-danger/12 border-danger/35 text-ink', Icon: XCircle },
};

/**
 * A message with a reason. `role` is `status` for the quiet kind (saved, sent) and `alert` for the
 * one that must interrupt — the difference is what a screen reader does with it while you are typing.
 */
export const Alert: React.FC<{
  tone?: AlertTone;
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  role?: 'status' | 'alert';
}> = ({ tone = 'info', title, children, action, onDismiss, className, role }) => {
  const { cls, Icon } = alertTones[tone];
  return (
    <div
      role={role ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status')}
      aria-live={role === 'alert' || tone === 'danger' || tone === 'warning' ? 'assertive' : 'polite'}
      className={cn('flex items-start gap-3 rounded-card border px-4 py-3.5', cls, className)}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-label font-bold text-ink-strong">{title}</p> : null}
        <div className={cn('text-caption text-ink-muted leading-relaxed', title && 'mt-1')}>{children}</div>
        {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-control text-ink-faint hover:text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <XCircle className="w-4 h-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
};

/**
 * A block shaped like what it will become. `aria-hidden` because the skeleton is decoration; the
 * loading announcement belongs to whatever asked for the data (Spinner, or a status region), not to
 * every grey rectangle on screen.
 */
export const Skeleton: React.FC<{
  className?: string;
  /** Stack a whole block with one label instead of repeating a live region per bar. */
  count?: number;
  variant?: 'text' | 'circle' | 'rect';
}> = ({ className, count = 1, variant = 'text' }) => (
  <div aria-hidden className={cn('space-y-2', className)}>
    {Array.from({ length: count }, (_, i) => (
      <div
        key={i}
        className={cn(
          'bg-surface-muted rounded-control motion-safe:animate-pulse',
          variant === 'circle' ? 'h-10 w-10 rounded-full' : variant === 'rect' ? 'h-24' : 'h-3'
        )}
      />
    ))}
  </div>
);

/**
 * Progress that a screen reader can also read: the bar is a `role=progressbar` with the values set,
 * so the animation is not the only place the number exists.
 */
export const ProgressBar: React.FC<{
  value: number;
  max?: number;
  label: string;
  /** Announce a fraction instead of a bare 0–100 — "3 of 9 committees" reads better than "33%". */
  valueText?: string;
  tone?: 'accent' | 'brand' | 'success';
  className?: string;
  size?: 'sm' | 'md';
}> = ({ value, max = 100, label, valueText, tone = 'accent', className, size = 'md' }) => {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const fill = tone === 'success' ? 'bg-success' : tone === 'brand' ? 'bg-brand' : 'bg-accent';
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-micro font-bold uppercase tracking-wider text-ink-muted">{label}</span>
        <span className="text-micro font-bold text-ink-muted font-numbers">{valueText ?? `${Math.round(pct)}%`}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={valueText}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn('w-full overflow-hidden rounded-pill bg-surface-muted', size === 'sm' ? 'h-1.5' : 'h-2.5')}
      >
        <div
          className={cn('h-full rounded-pill transition-[width] duration-standard ease-smooth motion-reduce:transition-none', fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
