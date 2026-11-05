import React, { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './Button';

/* ── Tabs ───────────────────────────────────────────────────────────────────────────────── */

export type TabItem<T extends string> = {
  id: T;
  label: string;
  /** The count the label is really about — "Requests (12)". Also what a screen reader hears last. */
  count?: number;
  content: React.ReactNode;
};

/**
 * Tabbed sections in this product were previously a row of buttons that changed some state, with the
 * content below them in an unrelated div. That reads as four identical buttons to a keyboard user
 * with no way to know which one is speaking. This is the real pattern: a tablist, roving tabindex so
 * Tab leaves the row in one stop, arrows to move inside it, and a panel wired to the tab that names
 * it.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  size = 'md',
}: {
  items: TabItem<T>[];
  value?: T;
  onChange?: (id: T) => void;
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const rootId = useId();
  const [internal, setInternal] = useState<T>(items[0]?.id);
  const active = value ?? internal;
  const select = onChange ?? setInternal;
  const tabRefs = React.useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const uid = (id: T, kind: 'tab' | 'panel') => `${rootId}-${kind}-${id}`;

  function onKeyDown(event: React.KeyboardEvent) {
    const index = items.findIndex((item) => item.id === active);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    select(item.id);
    // Focus follows selection, and it is moved by ref rather than by selector: an id from `useId`
    // contains colons, which a `querySelector` would need escaping to survive.
    tabRefs.current[item.id]?.focus();
  }

  const activeItem = items.find((item) => item.id === active) ?? items[0];

  return (
    <div className={cn('w-full', className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-border overflow-x-auto"
      >
        {items.map((item) => {
          const isActive = item.id === activeItem?.id;
          return (
            <button
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              key={item.id}
              type="button"
              role="tab"
              id={uid(item.id, 'tab')}
              aria-selected={isActive}
              aria-controls={uid(item.id, 'panel')}
              // Roving tabindex: exactly one tab is in the Tab order, so leaving the row is one press.
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(item.id)}
              className={cn(
                'relative shrink-0 px-3.5 font-bold whitespace-nowrap transition-colors duration-micro',
                size === 'sm' ? 'text-micro py-2' : 'text-caption py-2.5',
                isActive ? 'text-ink' : 'text-ink-muted hover:text-ink',
                'focus-visible:outline-none focus-visible:text-ink focus-visible:underline focus-visible:decoration-accent focus-visible:underline-offset-4'
              )}
            >
              {item.label}
              {typeof item.count === 'number' ? (
                <span className="ml-1.5 font-numbers text-micro opacity-80">({item.count})</span>
              ) : null}
              {isActive ? (
                // One shared layoutId across the row is what makes the underline travel instead of
                // teleporting; the tabs themselves never animate their own box.
                <motion.span
                  layoutId={`tab-underline-${rootId}`}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-pill bg-accent"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <div
          role="tabpanel"
          id={uid(activeItem.id, 'panel')}
          aria-labelledby={uid(activeItem.id, 'tab')}
          // Panels are scroll containers on phones; without a tabindex a keyboard user cannot get
          // into the region the tab just announced.
          tabIndex={0}
          className="pt-4 focus-visible:outline-none"
        >
          {/* Enter-only. An exit animation needs the old panel to stay mounted, which means the tab
              a screen reader just announced points at content that is on its way out. */}
          <motion.div
            key={activeItem.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {activeItem.content}
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Pagination ─────────────────────────────────────────────────────────────────────────── */

/** Window of page numbers: first, last, and the neighbourhood of the current page. */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | 'gap')[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('gap');
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < total - 1) out.push('gap');
  out.push(total);
  return out;
}

/**
 * Announced as navigation with the current page marked, so "you are on page 3 of 12" is a fact the
 * assistive tech already has rather than something the user infers from a filled square.
 */
export const Pagination: React.FC<{
  page: number;
  total: number;
  onChange: (page: number) => void;
  className?: string;
  ariaLabel?: string;
}> = ({ page, total, onChange, className, ariaLabel = 'Pagination' }) => {
  if (total <= 1) return null;
  const go = (next: number) => {
    if (next >= 1 && next <= total && next !== page) onChange(next);
  };
  return (
    <nav aria-label={ariaLabel} className={cn('flex items-center justify-center gap-1', className)}>
      <IconButton
        variant="outline"
        size="sm"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        <ChevronLeft className="w-4 h-4" aria-hidden />
      </IconButton>

      <ul className="flex items-center gap-1">
        {pageWindow(page, total).map((entry, i) =>
          entry === 'gap' ? (
            <li key={`gap-${i}`} aria-hidden className="px-1.5 text-micro text-ink-faint select-none">
              …
            </li>
          ) : (
            <li key={entry}>
              <button
                type="button"
                onClick={() => go(entry)}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                className={cn(
                  'min-w-9 h-9 px-2 rounded-control text-caption font-bold font-numbers transition-colors duration-micro',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  entry === page
                    ? 'bg-brand text-white'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink border border-border'
                )}
              >
                {entry}
              </button>
            </li>
          )
        )}
      </ul>

      <IconButton
        variant="outline"
        size="sm"
        aria-label="Next page"
        disabled={page >= total}
        onClick={() => go(page + 1)}
      >
        <ChevronRight className="w-4 h-4" aria-hidden />
      </IconButton>
    </nav>
  );
};

/* ── Tooltip ────────────────────────────────────────────────────────────────────────────── */

/**
 * Wraps a single trigger element and shows the hint on hover, focus and touch. The browser's `title`
 * attribute is not a substitute: it does not appear on keyboard focus, its delay is unconfigurable,
 * and it is invisible on a phone — which is most of the members using this app.
 *
 * The child is cloned rather than wrapped, because `aria-describedby` has to sit on the element the
 * user actually tabs into. The trigger's own handlers are still called.
 */
export const Tooltip: React.FC<{
  label: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom';
  className?: string;
}> = ({ label, children, side = 'top', className }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = children as React.ReactElement<Record<string, unknown> & { className?: string }>;
  const triggerProps = trigger.props;

  const chain = (name: string, next: (event: unknown) => void) => {
    const previous = triggerProps[name] as ((event: unknown) => void) | undefined;
    return (event: unknown) => {
      previous?.(event);
      next(event);
    };
  };

  return (
    <>
      {React.cloneElement(trigger, {
        'aria-describedby': open ? id : undefined,
        className: cn('relative', className, triggerProps.className),
        onMouseEnter: chain('onMouseEnter', () => setOpen(true)),
        onMouseLeave: chain('onMouseLeave', () => setOpen(false)),
        onFocus: chain('onFocus', () => setOpen(true)),
        onBlur: chain('onBlur', () => setOpen(false)),
        onKeyDown: chain('onKeyDown', (e?: unknown) => {
          if ((e as { key?: string })?.key === 'Escape') setOpen(false);
        }),
      })}
      <AnimatePresence>
        {open ? (
          <motion.span
            role="tooltip"
            id={id}
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === 'top' ? 4 : -4 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            // Inverted on purpose and invariant across the theme flip: a tooltip is a floating card,
            // so it keeps one ink surface rather than picking up the page it happens to hover over.
            className={cn(
              'pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 w-max max-w-[16rem]',
              'rounded-control bg-ink-900 text-esme-white px-2.5 py-1.5 text-micro font-semibold leading-snug',
              'shadow-overlay ring-1 ring-white/10',
              side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
            )}
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </>
  );
};
