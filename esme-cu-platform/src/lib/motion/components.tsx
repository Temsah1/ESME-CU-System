import React, { useEffect, useRef } from 'react';
import { onRevealed, registerReveal } from './reveal';
import { splitWords } from './split';
import { countUp } from './countUp';

/**
 * The React surface of the motion engine.
 *
 * These components exist so a page never has to know the engine's DOM contract: `Reveal` marks the
 * element the observer looks for, `Split` renders a sentence the way the author wrote it and lets the
 * splitter wrap the words after paint, and `Counter` keeps its finished value in the markup so the
 * number is readable with JavaScript switched off and only becomes a count-up once it is on screen.
 */

type Tag = 'div' | 'section' | 'article' | 'header' | 'footer' | 'li' | 'p' | 'span' | 'h1' | 'h2' | 'h3';

type RevealProps = {
  as?: Tag;
  className?: string;
  /** The larger step for pictures and panels: `.rv-scale` trades the rise for a settle. */
  scale?: boolean;
  /** Overrides the sibling stagger when the visual order and the DOM order disagree. */
  order?: number;
  id?: string;
  children?: React.ReactNode;
};

export const Reveal: React.FC<RevealProps> = ({ as = 'div', className = '', scale = false, order, id, children }) => {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (ref.current) registerReveal(ref.current);
  }, [children, scale]);
  return React.createElement(
    as,
    {
      ref,
      id,
      'data-rv': '',
      className: `rv ${scale ? 'rv-scale ' : ''}${className}`.trim(),
      style: order === undefined ? undefined : ({ '--d': String(order) } as React.CSSProperties),
    },
    children
  );
};

type SplitProps = {
  as?: Tag;
  className?: string;
  /** Per-word gradient: the brief puts the run on each word span, never on a wrapper. */
  gradient?: boolean;
  /**
   * The sentence as one string, for assistive tech.
   *
   * Once the splitter has run, the words are separate elements and a screen reader reads them with
   * the pauses of a list rather than a sentence; the label gives back the line the author wrote.
   */
  label?: string;
  children: React.ReactNode;
};

export const Split: React.FC<SplitProps> = ({ as = 'h2', className = '', gradient = false, label, children }) => {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    splitWords(el);
    registerReveal(el);
  }, [children, gradient]);
  return React.createElement(
    as,
    {
      ref,
      'data-rv': '',
      'aria-label': label,
      'data-split-grad': gradient ? '' : undefined,
      className: `split ${className}`.trim(),
    },
    children
  );
};

type CounterProps = {
  to: number;
  from?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
};

/**
 * A statistic that reads as its final value in the HTML and counts up when it enters the viewport.
 *
 * The element is deliberately not emptied first: a counter that starts blank costs the reader a
 * number they never get if the reveal never fires.
 */
export const Counter: React.FC<CounterProps> = ({ to, from = 0, decimals = 0, prefix = '', suffix = '', duration, className = '' }) => {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancel = () => {};
    const stopWatching = onRevealed(el, () => {
      cancel = countUp(el, { to, from, decimals, prefix, suffix, duration });
    });
    return () => {
      stopWatching();
      cancel();
    };
  }, [to, from, decimals, prefix, suffix, duration]);
  return (
    <span ref={ref} className={className}>
      {`${prefix}${to.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`}
    </span>
  );
};
