import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

const TOUCH_QUERY = '(hover: none), (pointer: coarse)';
const DESKTOP_QUERY = '(min-width: 768px)';
const NAV_RAIL_QUERY = '(min-width: 1024px)';
const NAV_LABELS_QUERY = '(min-width: 1280px)';

/**
 * A media query that keeps tracking. Reads the initial value while rendering — the same shape
 * `useIsTouch` uses — and then subscribes, so a rotation or a resize to a narrow window is felt
 * without a re-render loop.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false)
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Below this the sidebar is a drawer and tables are cards. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/**
 * Whether the navigation gets a permanent rail. This is wider than `useIsDesktop` on purpose: a
 * 768px screen can still lay out a table, but a 264px rail there leaves a content column too narrow
 * for the same table, so the nav goes off-canvas a whole breakpoint earlier than the chrome did.
 */
export function useHasNavRail(): boolean {
  return useMediaQuery(NAV_RAIL_QUERY);
}

/** Room enough for the rail to carry its labels. Below it the rail starts collapsed. */
export function useHasRoomForNavLabels(): boolean {
  return useMediaQuery(NAV_LABELS_QUERY);
}

export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(() => window.matchMedia(TOUCH_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(TOUCH_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isTouch;
}

export function usePremiumMotion(): boolean {
  const reduced = useReducedMotion();
  const isTouch = useIsTouch();
  return !reduced && !isTouch;
}

/** Keeps the last non-null value so modal bodies can animate out after their entity is cleared. */
export function useStickyNonNull<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== undefined && value !== last) setLast(value);
  return value ?? last;
}
