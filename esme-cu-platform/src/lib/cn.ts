import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Conditional classes, then de-duplicated so a caller's override actually wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
