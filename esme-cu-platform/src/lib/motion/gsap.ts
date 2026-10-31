import { canAnimate } from './env';

/**
 * GSAP and ScrollTrigger arrive on demand, from one place.
 *
 * The brief pins gsap 3.12.5 and asks for a lazy load: the landing page must not ship a scroll
 * engine to a visitor who never scrolls past the first screen, and the dashboard must not pay for
 * one at all. `canAnimate()` is the second half of that decision — a reduced-motion visitor gets
 * neither Lenis nor GSAP, so the chunk is never even fetched.
 */

export type GsapRuntime = {
  gsap: typeof import('gsap').gsap;
  ScrollTrigger: typeof import('gsap/ScrollTrigger').ScrollTrigger;
};

let runtime: GsapRuntime | null = null;
let loading: Promise<GsapRuntime | null> | null = null;

export function loadGsap(): Promise<GsapRuntime | null> {
  if (runtime) return Promise.resolve(runtime);
  if (!canAnimate()) return Promise.resolve(null);
  loading ??= (async () => {
    const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
    gsap.registerPlugin(ScrollTrigger);
    runtime = { gsap, ScrollTrigger };
    return runtime;
  })();
  return loading;
}

/** Kills every trigger created for one element tree — used when a section unmounts. */
export async function killTriggersFor(targets: unknown[]): Promise<void> {
  const current = runtime;
  if (!current) return;
  current.ScrollTrigger.getAll()
    .filter((trigger) => targets.includes(trigger.trigger))
    .forEach((trigger) => trigger.kill(true));
  current.gsap.killTweensOf(targets);
}
