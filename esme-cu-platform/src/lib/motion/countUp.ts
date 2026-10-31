import { prefersReduced } from './env';

/**
 * Count-up for statistics and cycle counters.
 *
 * The curve is the one the brief names — easeOutQuart, `1 - (1 - p)^4` — over two seconds, and a
 * reduced-motion visitor gets the final number on the first frame rather than a fast version of the
 * same animation.
 */

export const easeOutQuart = (p: number): number => 1 - Math.pow(1 - p, 4);

export const COUNT_DURATION = 2000;
/** Reduced motion still gets a duration, it simply is not perceptible: the spec's 1ms. */
export const COUNT_DURATION_REDUCED = 1;

export type CountOptions = {
  to: number;
  from?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  locale?: string;
};

export function formatCount(value: number, decimals: number, locale = 'en-US'): string {
  return value.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Writes the count into `el` and returns the cancel function.
 *
 * The element is the only thing touched: no state, no re-render, so a counter on a page full of
 * reveals costs one rAF per running counter and nothing per frame otherwise.
 */
export function countUp(el: HTMLElement, options: CountOptions): () => void {
  const { to, from = 0, decimals = 0, prefix = '', suffix = '', duration = COUNT_DURATION, locale = 'en-US' } = options;
  const reduced = prefersReduced();
  const total = reduced ? COUNT_DURATION_REDUCED : duration;

  const write = (value: number) => {
    el.textContent = `${prefix}${formatCount(value, decimals, locale)}${suffix}`;
  };

  if (reduced) {
    write(to);
    return () => {};
  }

  let raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / total);
    write(from + (to - from) * easeOutQuart(p));
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  write(from);
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
