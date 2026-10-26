/**
 * The browser side of the Meta insight sync.
 *
 * The browser holds the project URL and the publishable key, exactly as it does for sign-in. It
 * never holds META_GRAPH_TOKEN: the token is read by the Edge Function from its own environment,
 * and this module only invokes that function. When the project is not configured, nothing is
 * called and the caller is told which client variables are missing.
 */
import { configurationProblems } from '../auth/supabaseAdapter';
import {
  interpretFailure,
  normalizePost,
  normalizeRun,
  type SocialLoad,
  type SyncAttempt,
} from '../domain/socialInsights';

type QueryResult = { data: unknown; error: unknown };

/** The small surface this module needs, so a test can answer without a network. */
export interface SocialClient {
  select(table: string, options: { order: string; ascending: boolean; limit: number }): Promise<QueryResult>;
  invokeSync(): Promise<{ data: unknown; error: unknown }>;
}

export type SocialSource =
  | { status: 'ready'; client: SocialClient }
  | { status: 'blocked'; missing: string[] }
  | { status: 'error'; message: string };

type ClientEnv = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : 'The provider did not answer.';
}

function rowsOf(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

/** Builds the real client only when both public variables are present and well formed. */
export async function socialSourceFromEnv(env: ClientEnv = import.meta.env as ClientEnv): Promise<SocialSource> {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  const missing = [!url ? 'VITE_SUPABASE_URL' : null, !key ? 'VITE_SUPABASE_ANON_KEY' : null].filter(
    (entry): entry is string => entry !== null
  );
  if (missing.length > 0 || !url || !key) return { status: 'blocked', missing };

  const problems = configurationProblems(url, key);
  if (problems.length > 0) return { status: 'error', message: problems.join(' ') };

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const client: SocialClient = {
      async select(table, { order, ascending, limit }) {
        const { data, error } = await supabase.from(table).select('*').order(order, { ascending }).limit(limit);
        return { data, error };
      },
      async invokeSync() {
        const { data, error } = await supabase.functions.invoke('sync-meta-insights', { body: {} });
        return { data, error };
      },
    };
    return { status: 'ready', client };
  } catch (error) {
    return { status: 'error', message: messageOf(error) };
  }
}

/** Rows the screen may render. Malformed rows are dropped and counted, never repaired by guess. */
export async function loadSocialInsights(source: SocialSource): Promise<SocialLoad> {
  if (source.status === 'blocked') return { state: 'blocked', missing: source.missing };
  if (source.status === 'error') return { state: 'error', message: source.message };

  const runs = await source.client.select('esme_social_sync_runs', {
    order: 'started_at',
    ascending: false,
    limit: 10,
  });
  if (runs.error) return { state: 'error', message: messageOf(runs.error) };

  const posts = await source.client.select('esme_social_posts', {
    order: 'published_at',
    ascending: false,
    limit: 100,
  });
  if (posts.error) return { state: 'error', message: messageOf(posts.error) };

  let rejectedRows = 0;
  const normalizedRuns = rowsOf(runs.data).flatMap((row) => {
    const run = normalizeRun(row);
    if (run) return [run];
    rejectedRows++;
    return [];
  });
  const normalizedPosts = rowsOf(posts.data).flatMap((row) => {
    const post = normalizePost(row);
    if (post) return [post];
    rejectedRows++;
    return [];
  });

  return { state: 'ready', runs: normalizedRuns, posts: normalizedPosts, rejectedRows };
}

/** Invokes the sync and maps every answer — including a refused or blocked one — to a sentence. */
export async function requestSocialSync(
  source: SocialSource,
  fallbackMessage = 'The sync did not run.'
): Promise<SyncAttempt> {
  if (source.status === 'blocked') {
    return {
      status: 'blocked',
      missing: source.missing,
      message: `The provider is not configured in this build (${source.missing.join(', ')}). No request was made.`,
    };
  }
  if (source.status === 'error') return { status: 'error', message: source.message };

  const { data, error } = await source.client.invokeSync();
  if (error) return interpretFailure(error, fallbackMessage);
  // A 2xx body is read by the same interpreter, so `status: 'ok'` is required before the screen
  // can call the run a success.
  return interpretFailure({ context: { status: 200, json: async () => data } }, fallbackMessage);
}
