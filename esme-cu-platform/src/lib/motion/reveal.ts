import { prefersReduced } from './env';

/**
 * One IntersectionObserver for the whole public page.
 *
 * Everything that reveals on scroll asks this module, so the threshold, the root margin, the
 * sibling stagger and the two safety sweeps are written once. The sweep matters more than the
 * observer: a section already on screen when the page paints may never intersect while React is
 * still mounting, and content that waits for an event that already happened stays invisible.
 */

export const REVEAL_THRESHOLD = 0.08;
export const REVEAL_ROOT_MARGIN = '0px 0px -6%';
const REVEAL_SELECTOR = '.rv, .split';
/**
 * Siblings, in the strict sense.
 *
 * `parentElement.querySelectorAll('.rv')` would answer for every descendant, so a section block on a
 * long form inherits the count of all the fields nested inside its neighbours and reveals a second
 * after the page it belongs to. Each group staggers against its own row.
 */
const REVEAL_SIBLING_SELECTOR = ':scope > .rv, :scope > .split';
/** How far above the fold an element has to sit to be counted as "already in view" for the sweep. */
const SWEEP_LINE = 0.94;
/** Stagger step, and the head start for the block the visitor lands on. */
const ABOVE_FOLD_BASE = 700;

let observer: IntersectionObserver | null = null;
let sweepsBound = 0;
const pending = new Set<Element>();

function reveal(el: Element) {
  el.classList.add('in');
  if (observer) observer.unobserve(el);
  pending.delete(el);
}

/** Reveals anything already inside the viewport, whether or not it has been observed yet. */
function sweep() {
  if (typeof window === 'undefined') return;
  const line = window.innerHeight * SWEEP_LINE;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`${REVEAL_SELECTOR}:not(.in)`))) {
    const rect = el.getBoundingClientRect();
    if (rect.top < line && rect.bottom > 0) reveal(el);
  }
}

function ensureObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting || entry.intersectionRatio >= REVEAL_THRESHOLD) reveal(entry.target);
      }
    },
    { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN }
  );
  return observer;
}

/**
 * With no IntersectionObserver — a headless render, a jsdom test that never stubbed one — nothing
 * waits. A reveal is decoration; a blank page is a bug.
 */
function revealEverything() {
  for (const el of document.querySelectorAll<HTMLElement>(`${REVEAL_SELECTOR}:not(.in)`)) el.classList.add('in');
}

/**
 * Gives a revealing element its place in the stagger, then observes it.
 *
 * Only siblings that also reveal are counted, and a block with no reveal siblings keeps a zero step
 * so the first paragraph of a section is not late for no reason.
 */
export function registerReveal(el: HTMLElement): void {
  if (typeof document === 'undefined') return;
  if (el.dataset.rvBound === '1') return;
  el.dataset.rvBound = '1';
  el.dataset.rv = '';

  const siblings = Array.from(el.parentElement?.querySelectorAll<HTMLElement>(REVEAL_SIBLING_SELECTOR) ?? []);
  const index = siblings.indexOf(el);
  el.style.setProperty('--d', String(siblings.length > 1 ? Math.max(0, index) : 0));

  if (typeof window !== 'undefined' && el.getBoundingClientRect().top < window.innerHeight) {
    el.style.setProperty('--base', `${ABOVE_FOLD_BASE}ms`);
  }

  const io = ensureObserver();
  if (!io || prefersReduced()) {
    reveal(el);
    return;
  }
  io.observe(el);
  pending.add(el);
}

/** Tells an element to reveal without an observer — used by counters and one-shot canvases. */
export function revealNow(el: Element): void {
  reveal(el);
}

/**
 * Binds the sweeps. Called once by the public page: two animation frames after mount (React has
 * laid out, images have not necessarily arrived) and again on window load (fonts and pictures
 * moved everything).
 */
export function initRevealSystem(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (typeof IntersectionObserver === 'undefined') {
    revealEverything();
    return () => {};
  }
  ensureObserver();

  // Counted, not boolean: the next screen is mounted before the one leaving has finished exiting,
  // and a teardown in that overlap would strand the new page's content hidden.
  sweepsBound += 1;
  if (sweepsBound > 1) return releaseRevealSystem;

  const rafSweep = () => {
    requestAnimationFrame(() => requestAnimationFrame(sweep));
  };
  rafSweep();
  window.addEventListener('load', sweep);
  return releaseRevealSystem;
}

function releaseRevealSystem(): void {
  sweepsBound -= 1;
  if (sweepsBound > 0) return;
  sweepsBound = 0;
  window.removeEventListener('load', sweep);
  // Everything still waiting on the observer about to be disconnected carries `data-rv-bound`, and a
  // later `registerReveal` would answer to that mark and hand it to nobody. A screen that mounts
  // twice — StrictMode in development, an exit that overlaps the next entry — would leave those
  // elements sitting at opacity 0. Their bound mark goes with the observer.
  for (const el of pending) delete (el as HTMLElement).dataset.rvBound;
  observer?.disconnect();
  observer = null;
  pending.clear();
}

/**
 * Registers a subtree after React has drawn it. Content the operator switches on mid-visit, or a
 * section that mounts after a tab change, is otherwise never observed.
 */
export function refreshReveals(root: ParentNode = document): void {
  if (typeof IntersectionObserver === 'undefined') {
    revealEverything();
    return;
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`${REVEAL_SELECTOR}[data-rv]`))) {
    if (!el.classList.contains('in')) registerReveal(el);
  }
}

/** Runs `onEnter` the first time the element is revealed. Counters and canvas loops use this. */
export function onRevealed(el: HTMLElement, onEnter: () => void): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    onEnter();
  };
  const io = typeof IntersectionObserver === 'undefined' ? null : ensureObserver();
  if (!io) {
    fire();
    return () => {};
  }
  const check = (entries: IntersectionObserverEntry[]) => {
    if (entries.some((entry) => entry.isIntersecting)) fire();
  };
  // A second observer so the reveal class and the callback can be unbound independently.
  const enterObserver = new IntersectionObserver(check, { threshold: REVEAL_THRESHOLD, rootMargin: REVEAL_ROOT_MARGIN });
  enterObserver.observe(el);
  return () => enterObserver.disconnect();
}
