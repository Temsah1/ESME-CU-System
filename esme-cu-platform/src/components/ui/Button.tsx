import React from 'react';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'accent' | 'brand' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'group relative inline-flex items-center justify-center gap-2 rounded-control font-bold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,filter,transform] duration-micro ease-smooth active:duration-[80ms] ' +
  'motion-safe:active:scale-[0.98] motion-safe:active:translate-y-0 motion-reduce:active:scale-100 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// A primary action lifts 1px and deepens its shadow on hover (§2.4); secondary variants stay put.
const lift = 'motion-safe:hover:-translate-y-px hover:shadow-raised';

const variants: Record<ButtonVariant, string> = {
  // Orange is the chapter's action colour: it is what a screen points at when it wants a decision.
  // The label on it is near-black, not white — brand orange against white lands around 2:1, which
  // fails AA even for the bold 12px these buttons ship, while against slate-950 it reaches 7:1.
  // Same palette, one step darker for the ink, and the button stays unmistakably ESME.
  accent: `bg-accent text-slate-950 hover:bg-accent-hover shadow-sm ${lift}`,
  brand: `bg-brand text-white hover:bg-brand-hover shadow-sm ${lift}`,
  outline: 'bg-surface text-ink border border-border-strong hover:border-accent',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  // `danger` is an ink token that pales on slate, so a destructive *fill* uses the solid role:
  // white on `--esme-red` clears 8:1 in light and dark alike, and the hover lightens rather than
  // reaching for a red the palette does not have.
  danger: `bg-danger-solid text-white hover:bg-danger-solid-hover shadow-sm ${lift}`,
};

const sizes: Record<ButtonSize, string> = {
  // `md` is 44px so the default control clears the touch target a phone demands; `sm` is for the
  // dense rows of a table, where a bigger button would push the row itself past what fits.
  sm: 'h-9 px-3 text-caption',
  md: 'h-11 px-4 text-caption',
  lg: 'h-12 px-5 text-label rounded-card',
};

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Renders an `<a>` instead — for anything that navigates rather than mutates. */
  href?: string;
  target?: string;
  rel?: string;
};

/**
 * One button, so a primary action looks the same in the planner as it does in the ledger.
 *
 * `loading` keeps the button's own width while it spins and announces itself, rather than swapping
 * in a second element a screen reader reads as a new control.
 */
export const Button: React.FC<Props> = ({
  variant = 'accent',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  href,
  target,
  rel,
  ...rest
}) => {
  const classes = cn(base, variants[variant], sizes[size], className);
  const isDisabled = disabled || loading;

  if (href && !isDisabled) {
    return (
      <a
        href={href}
        target={target}
        rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
        className={classes}
        {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" disabled={isDisabled} aria-busy={loading || undefined} className={classes} {...rest}>
      {loading ? <Spinner size="sm" label="" className="absolute" /> : null}
      <span className={cn('inline-flex items-center gap-2', loading && 'opacity-0')}>{children}</span>
    </button>
  );
};

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * Icon-only control. The label is required by the type, because a pencil with no name tells a
 * screen reader nothing and this is where unlabelled buttons historically appear.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'ghost',
  size = 'md',
  className,
  ...rest
}) => (
  <button
    type="button"
    className={cn(
      base,
      variants[variant],
      sizes[size],
      size === 'sm' ? 'w-9' : size === 'lg' ? 'w-12' : 'w-11',
      'px-0',
      className
    )}
    {...rest}
  />
);

export default Button;
