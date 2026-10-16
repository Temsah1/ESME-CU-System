import React, { useEffect, useRef } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { durations, easings } from './tokens';

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  from?: number;
  duration?: number;
  startOnView?: boolean;
  as?: 'span' | 'div';
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString();

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  format = defaultFormat,
  className,
  from = 0,
  duration = durations.section,
  startOnView = false,
  as = 'span',
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const mv = useMotionValue(from);
  const text = useTransform(mv, (latest) => format(latest));
  const started = useRef(false);

  useEffect(() => {
    if (startOnView && !inView) return;
    if (reduced) {
      mv.set(value);
      return;
    }
    if (startOnView && started.current && mv.get() === value) return;
    started.current = true;
    const controls = animate(mv, value, { duration, ease: easings.out });
    return () => controls.stop();
  }, [value, inView, reduced, startOnView, duration, mv]);

  const Tag = as === 'div' ? motion.div : motion.span;
  return (
    <Tag ref={ref as never} className={className}>
      {text}
    </Tag>
  );
};
