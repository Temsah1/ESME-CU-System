/**
 * The two integrators the heavy scenes share.
 *
 * Both cap the frame at 50ms: a tab that was in the background comes back with one enormous delta,
 * and an uncapped spring either throws the object across the screen or, with the sub-stepping below,
 * spends a thousand iterations catching up. Capping costs one frame of lag; not capping costs a
 * visual bug every time somebody alt-tabs.
 */

/** Longest step a frame may integrate, in seconds. */
export const MAX_FRAME_DT = 0.05;

/** Frames per second the loop assumes when it cannot measure. */
export function clampDt(dt: number): number {
  return Math.min(Math.max(dt, 0), MAX_FRAME_DT);
}

export type Spring = { value: number; velocity: number };

export type SpringConfig = { k?: number; c?: number; subSteps?: number };

/**
 * Semi-implicit Euler with sub-stepping, the form the brief specifies:
 * `v += ((target - y) * K - v * C) * h; y += v * h`.
 *
 * K=70, C=12.5 is a stiff, barely-overshooting spring — the right shape for a row of books that has
 * to feel heavy rather than bouncy.
 */
export function stepSpring(state: Spring, target: number, config: SpringConfig = {}, dt = 1 / 60): Spring {
  const { k = 70, c = 12.5, subSteps = 4 } = config;
  const h = clampDt(dt) / subSteps;
  for (let i = 0; i < subSteps; i += 1) {
    state.velocity += ((target - state.value) * k - state.velocity * c) * h;
    state.value += state.velocity * h;
  }
  return state;
}

/**
 * Frame-rate independent easing toward a rate: `f(r) = 1 - exp(-dt * r)`.
 *
 * Used wherever something chases a target every frame (a shader's look table, a belt's velocity).
 * A fixed `x += (t - x) * 0.1` would run 40% faster on a 120Hz screen; this does not.
 */
export function approach(dt: number, rate: number): number {
  return 1 - Math.exp(-clampDt(dt) * rate);
}

/** Moves `value` toward `target` by the frame's share of `rate`. */
export function easeToward(value: number, target: number, dt: number, rate: number): number {
  return value + (target - value) * approach(dt, rate);
}
