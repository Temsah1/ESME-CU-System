import { prefersReduced } from './env';

/**
 * The hero's "chat studio": an applicant asks, the chapter replies.
 *
 * The panel is laid out for its finished text and then typed into, which is the only way the height
 * stays put — the component renders a ghost copy of every line (`.ai-t` puts the ghost and the live
 * text in the same grid cell), so a line arriving changes what is painted, never where the other
 * lines sit.
 *
 * One rAF loop drives every column from a pre-computed schedule, so the two columns are genuinely
 * simultaneous, a backgrounded tab does not queue up a backlog of typing, and unmounting cancels
 * cleanly.
 */

export type StudioLine = {
  /** The message element, revealed with the `.chat-line` enter transition. */
  el: HTMLElement;
  /** The typing indicator, shown for the dot phase and hidden when characters start. */
  dots?: HTMLElement | null;
  /** The live text node, emptied and filled by the engine. */
  target: HTMLElement;
  text: string;
};

export type StudioOptions = {
  /** When the first line of every column starts, from the page painting. */
  start: number;
  /** How long the dots run before characters appear. */
  dotPhase: number;
  /** Characters written per tick. */
  charsPerTick: number;
  /** Milliseconds per tick. */
  tickMs: number;
  /** Pause between one line finishing and the next starting. */
  gap: number;
};

export const STUDIO_DEFAULTS: StudioOptions = {
  start: 1500,
  dotPhase: 650,
  charsPerTick: 2,
  tickMs: 14,
  gap: 420,
};

type Scheduled = { line: StudioLine; from: number; dotsUntil: number; typeUntil: number };

function schedule(lines: StudioLine[], options: StudioOptions): Scheduled[] {
  let cursor = options.start;
  return lines.map((line) => {
    const ticks = Math.ceil(line.text.length / options.charsPerTick);
    const entry: Scheduled = { line, from: cursor, dotsUntil: cursor + options.dotPhase, typeUntil: cursor + options.dotPhase + ticks * options.tickMs };
    cursor = entry.typeUntil + options.gap;
    return entry;
  });
}

function settle(entry: Scheduled, now: number) {
  const { line } = entry;
  if (now < entry.from) return;
  line.el.classList.add('in');

  if (now >= entry.typeUntil) {
    if (line.dots) line.dots.hidden = true;
    line.target.textContent = line.text;
    return;
  }
  if (now < entry.dotsUntil) {
    if (line.dots) line.dots.hidden = false;
    line.target.textContent = '';
    return;
  }
  if (line.dots) line.dots.hidden = true;
  const p = (now - entry.dotsUntil) / (entry.typeUntil - entry.dotsUntil);
  const chars = Math.floor(p * line.text.length);
  line.target.textContent = line.text.slice(0, Math.max(0, chars));
}

/**
 * Types each column, independently and at the same time. Returns the cancel function.
 *
 * Reduced motion is not a fast version of the same script: the finished conversation is written on
 * the first frame and no loop runs at all.
 */
export function runStudio(columns: StudioLine[][], options: Partial<StudioOptions> = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  const opts: StudioOptions = { ...STUDIO_DEFAULTS, ...options };
  const plans = columns.map((lines) => schedule(lines, opts));

  if (prefersReduced()) {
    for (const plan of plans) {
      for (const entry of plan) {
        entry.line.el.classList.add('in');
        if (entry.line.dots) entry.line.dots.hidden = true;
        entry.line.target.textContent = entry.line.text;
      }
    }
    return () => {};
  }

  let raf = 0;
  const start = performance.now();
  const end = Math.max(0, ...plans.flatMap((plan) => plan.map((entry) => entry.typeUntil)));
  const tick = (now: number) => {
    const elapsed = now - start;
    for (const plan of plans) for (const entry of plan) settle(entry, elapsed);
    if (elapsed < end) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(raf);
}
