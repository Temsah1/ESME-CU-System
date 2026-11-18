import type { Transition } from 'motion/react';

export const durations = {
  micro: 0.15,
  standard: 0.28,
  section: 0.6,
  hero: 0.9,
  routeIn: 0.22,
  routeOut: 0.15,
  toastEnter: 0.22,
  toastExit: 0.18,
  modalBackdrop: 0.2,
  modalPanel: 0.24,
  modalClose: 0.15,
  badgeCrossfade: 0.25,
  paletteFilter: 0.1,
  errorSlide: 0.2,
  rowFlash: 0.6,
  shake: 0.3,
} as const;

export const easings = {
  out: [0.16, 1, 0.3, 1] as const,
  smooth: [0.4, 0, 0.2, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
  spring: { type: 'spring', stiffness: 380, damping: 30 } satisfies Transition,
} as const;

export const transitions = {
  micro: { duration: durations.micro, ease: easings.out } satisfies Transition,
  standard: { duration: durations.standard, ease: easings.out } satisfies Transition,
  smooth: { duration: durations.standard, ease: easings.smooth } satisfies Transition,
  section: { duration: durations.section, ease: easings.out } satisfies Transition,
  hero: { duration: durations.hero, ease: easings.out } satisfies Transition,
  spring: easings.spring,
  /** §2.1 route transition — the outgoing view sinks 8px, the incoming rises 8px after a 40ms beat. */
  routeIn: { duration: durations.routeIn, delay: 0.04, ease: easings.out } satisfies Transition,
  routeOut: { duration: durations.routeOut, ease: easings.inOut } satisfies Transition,
  /** §2.7 toast — slides in, leaves by fading while its row collapses. */
  toastEnter: { duration: durations.toastEnter, ease: easings.out } satisfies Transition,
  toastExit: { duration: durations.toastExit, ease: easings.inOut } satisfies Transition,
  /** §2.6 modal — backdrop 200ms, panel .96→1 and y 12→0 in 240ms, close in 150ms. */
  modalBackdrop: { duration: durations.modalBackdrop, ease: easings.out } satisfies Transition,
  modalPanel: { duration: durations.modalPanel, ease: easings.out } satisfies Transition,
  modalClose: { duration: durations.modalClose, ease: easings.inOut } satisfies Transition,
  /** §2.10 the status badge crossfades wash, ink and word together. */
  badgeCrossfade: { duration: durations.badgeCrossfade, ease: easings.out } satisfies Transition,
  /** §2.11 palette filtering is an opacity crossfade only — rows never move. */
  paletteFilter: { duration: durations.paletteFilter, ease: easings.out } satisfies Transition,
  /** §2.8 an error message unrolls rather than shoving the fields below it. */
  errorSlide: { duration: durations.errorSlide, ease: easings.out } satisfies Transition,
  /** §2.3 a 600ms flash that marks the one row the operator just changed. */
  rowFlash: { duration: durations.rowFlash, ease: easings.out } satisfies Transition,
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

/** §2.1 the travel of a route swap: out sinks 8px, in rises from 8px. */
export const routeShift = { out: 8, in: 8 } as const;

/** §2.6 the panel's opening pose, and §2.7 the toast's entering pose. */
export const modalPanelPose = { scaleFrom: 0.96, yFrom: 12 } as const;
export const toastPose = { xFrom: 24, barHeight: 3 } as const;
