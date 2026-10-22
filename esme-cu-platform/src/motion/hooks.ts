import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

const TOUCH_QUERY = '(hover: none), (pointer: coarse)';
const DESKTOP_QUERY = '(min-width: 768px)';

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
