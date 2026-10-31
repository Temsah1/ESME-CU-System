import type Lenis from 'lenis';
import { canAnimate } from './env';
import { loadGsap } from './gsap';

/**
 * One smooth-scroll instance for the whole public page, driven by the GSAP ticker.
 *
 * Two Lenis instances on a page fight over the same scroll position and the fight is settled by
 * whichever raf runs last, which is why this module holds a single promise and hands everybody the
 * same object. The ticker wiring is the part that cannot be improvised: ScrollTrigger has to be
 * updated from Lenis' own scroll event and Lenis' raf has to run from GSAP's clock, or a scrubbed
 * animation lags one frame behind the wheel every time.
 *
 * Nothing here loads on the dashboard. Lenis, GSAP and ScrollTrigger are dynamic imports that only
 * the public landing and the application form ask for.
 */

export const LENIS_DURATION = 1.25;
export const LENIS_EASING = (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t));
/** Anchor targets land below the fixed header rather than underneath it. */
export const ANCHOR_OFFSET = -70;

export type ScrollRuntime = {
  lenis: Lenis;
  update: () => void;
  stop: () => void;
  start: () => void;
  /** Takes the ticker callback with it: a destroyed Lenis must not keep being raf'd. */
  dispose: () => void;
};

let runtime: ScrollRuntime | null = null;
let mounting: Promise<ScrollRuntime | null> | null = null;
/**
 * Bumped by every teardown, so a load that was still in flight when its page went away can recognise
 * that nobody is waiting for it any more — StrictMode mounts an effect twice, and the first answer
 * would otherwise install a second instance behind the new one.
 */
let generation = 0;
/**
 * Screens change with an exit animation still running, so the landing page tears its instance down
 * while the form is already asking for one. Counting consumers keeps the shared runtime alive across
 * the overlap and destroys it once the last page lets go.
 */
let consumers = 0;

async function create(): Promise<ScrollRuntime | null> {
  if (!canAnimate()) return null;
  const gsapRuntime = await loadGsap();
  if (!gsapRuntime) return null;
  const { gsap, ScrollTrigger } = gsapRuntime;
  const { default: LenisClass } = await import('lenis');

  const lenis = new LenisClass({
    duration: LENIS_DURATION,
    easing: LENIS_EASING,
    smoothWheel: true,
  });

  lenis.on('scroll', ScrollTrigger.update);
  const raf = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);

  return {
    lenis,
    update: () => ScrollTrigger.update(),
    stop: () => lenis.stop(),
    start: () => lenis.start(),
    dispose: () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    },
  };
}

/** Idempotent: every caller gets the same instance, and a reduced-motion visitor gets none. */
export function mountSmoothScroll(): Promise<ScrollRuntime | null> {
  if (runtime) return Promise.resolve(runtime);
  if (!mounting) {
    const wanted = generation + 1;
    generation = wanted;
    mounting = create().then((next) => {
      if (wanted !== generation) {
        next?.dispose();
        return null;
      }
      runtime = next;
      mounting = null;
      return next;
    });
  }
  return mounting;
}

export function getScrollRuntime(): ScrollRuntime | null {
  return runtime;
}

/**
 * Scrolls to an in-page target. Falls back to the browser's own jump when Lenis is not mounted —
 * reduced motion, or a page that never asked for smooth scroll.
 */
export function scrollToTarget(target: string | HTMLElement, offset = ANCHOR_OFFSET): void {
  if (runtime) {
    runtime.lenis.scrollTo(target, { offset });
    return;
  }
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo(0, Math.max(0, top));
}

/**
 * Holds the runtime for as long as one screen needs it, and hands back the release. A page calls this
 * in its mount effect and returns the release from the cleanup; the instance itself is shared, so a
 * second caller never starts a second smooth-scroll.
 */
export function retainSmoothScroll(): () => void {
  consumers += 1;
  void mountSmoothScroll();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers -= 1;
    if (consumers <= 0) destroySmoothScroll();
  };
}

export function destroySmoothScroll(): void {
  generation += 1;
  mounting = null;
  if (!runtime) return;
  runtime.dispose();
  runtime = null;
}
