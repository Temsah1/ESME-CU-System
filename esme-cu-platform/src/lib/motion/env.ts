/**
 * The two questions every animation asks before it starts: did this visitor ask for calm, and can
 * this device afford the work.
 *
 * Reduced motion is read from the media query the operating system sets, never from a cookie or a
 * user-profile field — a page that offers its own "motion" toggle still has to obey the platform
 * request. Low power is a device-capability read (save-data, small cores, old Android) used to keep
 * a canvas from being the reason a phone runs hot; it never hides content.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/** True when the platform asks for reduced motion. Safe to call during render. */
export function prefersReduced(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/** Tracks the preference so a change mid-visit is felt without a reload. */
export function onReducedChange(listener: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/** A visitor who asked their network to save data, or a device with too few cores to spin a WebGL loop. */
export function isLowPower(): boolean {
  if (typeof window === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData === true) return true;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse && cores <= 4;
}

/** Heavy canvases stop the moment the tab is in the background; nothing renders to a hidden frame. */
export function onPageVisibleChange(listener: (visible: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = () => listener(!document.hidden);
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

/** Caps the backing store: 1.5 for WebGL, 2 for 2D. A 3× retina canvas is pixels nobody sees. */
export function cappedDpr(kind: 'webgl' | '2d'): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(dpr, kind === 'webgl' ? 1.5 : 2);
}

/**
 * A DOM emulator has no layout, no GPU and no real scroll position, so an engine that pins elements
 * or draws a frame cannot be verified inside it and is left off there. This is environment detection,
 * not a preference: a browser — including the automated Playwright one — is unaffected.
 */
export function isHeadlessDom(): boolean {
  if (typeof window === 'undefined') return true;
  if (import.meta.env.MODE === 'test') return true;
  return /jsdom/i.test(navigator.userAgent);
}

/** Whether a heavy engine may run at all: a real browser that did not ask for calm. */
export function canAnimate(): boolean {
  return !prefersReduced() && !isHeadlessDom();
}
