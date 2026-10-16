import { createSupabaseAdapter, isSupabaseConfigured } from './supabaseAdapter';
import { createLocalDevAdapter } from './localDevAdapter';
import type { AuthAdapter } from './types';

export type AdapterResolution =
  | { adapter: AuthAdapter }
  | { adapter: null; reason: string };

/**
 * Production only ever uses the configured provider. The local fallback is compiled
 * out of production bundles, so a deployed build cannot quietly authenticate against
 * browser storage.
 */
export function resolveAdapter(): AdapterResolution {
  if (isSupabaseConfigured()) return { adapter: createSupabaseAdapter() };
  if (import.meta.env.DEV) return { adapter: createLocalDevAdapter() };
  return {
    adapter: null,
    reason:
      'Authentication is not configured for this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, apply the migrations in supabase/migrations, then restart the server.',
  };
}

export * from './types';
export { AuthNotConfiguredError, AuthFailedError, AccessRevokedError, RateLimitedError } from './errors';
