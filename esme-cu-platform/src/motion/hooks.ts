import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

const TOUCH_QUERY = '(hover: none), (pointer: coarse)';

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
