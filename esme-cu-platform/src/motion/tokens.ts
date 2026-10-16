import type { Transition } from 'motion/react';

export const durations = {
  micro: 0.15,
  standard: 0.28,
  section: 0.6,
  hero: 0.9,
} as const;

export const easings = {
  out: [0.22, 1, 0.36, 1] as const,
  smooth: [0.4, 0, 0.2, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
  spring: { type: 'spring', stiffness: 260, damping: 24 } satisfies Transition,
} as const;

export const transitions = {
  micro: { duration: durations.micro, ease: easings.out } satisfies Transition,
  standard: { duration: durations.standard, ease: easings.out } satisfies Transition,
  smooth: { duration: durations.standard, ease: easings.smooth } satisfies Transition,
  section: { duration: durations.section, ease: easings.out } satisfies Transition,
  hero: { duration: durations.hero, ease: easings.out } satisfies Transition,
  spring: easings.spring,
} as const;

export const viewport = {
  reveal: { once: true, amount: 0.2 } as const,
  hero: { once: true, amount: 0.4 } as const,
};

export const stagger = {
  tight: 0.045,
  default: 0.08,
  relaxed: 0.12,
  hero: 0.09,
};

export const interaction = {
  hover: { scale: 1.015, y: -2, transition: transitions.micro } as const,
  cardHover: { y: -4, scale: 1.01, transition: transitions.standard } as const,
  press: { scale: 0.98, transition: transitions.micro } as const,
};
