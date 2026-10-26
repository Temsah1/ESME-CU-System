/**
 * ESME CU — Meta Graph insight sync.
 *
 * Deployed as a Supabase Edge Function and invoked either by the daily schedule (with
 * META_SYNC_CRON_SECRET) or by a Super Admin from the analytics screen with their own session.
 *
 * What it deliberately cannot do:
 *   * run without a complete server-side configuration — no page id or token means a `blocked`
 *     run row and no request to graph.facebook.com, never a zero dressed up as a measurement;
 *   * accept a token, a page id or a URL from the caller — every value is read from the function's
 *     own environment;
 *   * store a credential. The token exists only in this process's memory while the request is in
 *     flight; a provider error is scrubbed before it is written to the run row;
 *   * write a figure the provider did not return. Missing metrics are stored as NULL.
 *
 * Requests to Postgres use PostgREST with the service-role key. Reads and writes from a browser
 * are governed by 0017's read-only policies; this function is the only writer.
 */

import {
  insightsEndpoint,
  metaConfiguration,
  missingConfigurationDetail,
  parseInsights,
  parsePostsResponse,
  postsEndpoint,
  scrubProviderError,
  type MetaConfiguration,
  type SocialPostRow,
} from '../_shared/metaGraph.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const CRON_SECRET = Deno.env.get('META_SYNC_CRON_SECRET') ?? '';
const POST_LIMIT = Math.min(Math.max(Number(Deno.env.get('META_POST_LIMIT') ?? 25) || 25, 1), 50);

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-esme-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Equal-length, non-short-circuiting compare: a wrong secret must not leak its own prefix. */
function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function postgrest(
  path: string,
  init: { method: string; body?: unknown; prefer?: string }
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (init.prefer) headers.Prefer = init.prefer;
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/**
 * A user token is accepted only when the capability RPC returns true for that token's role.
 * The function never trusts a role or a committee sent in the request body.
 */
async function callerMaySync(authorization: string): Promise<boolean> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/esme_has_capability`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY || SERVICE_KEY,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_capability: 'integrations.manage' }),
  });
  if (!response.ok) return false;
  return (await response.json()) === true;
}

async function recordBlockedRun(configuration: MetaConfiguration): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const detail = missingConfigurationDetail(configuration);
  try {
    await postgrest('esme_social_sync_runs', {
      method: 'POST',
      body: { provider: 'meta_graph', status: 'blocked', rows_written: 0, detail, finished_at: new Date().toISOString() },
    });
  } catch {
    // The caller still receives the blocked verdict; an unreachable database must not turn a
    // configuration problem into an apparent success.
  }
}

async function startRun(): Promise<string | null> {
  const response = await postgrest('esme_social_sync_runs', {
    method: 'POST',
    body: { provider: 'meta_graph', status: 'running' },
    prefer: 'return=representation',
  });
  if (!response.ok) throw new Error(`could not open a sync run: ${response.status}`);
  const rows = (await response.json()) as { id?: string }[];
  return rows[0]?.id ?? null;
}

async function finishRun(
  id: string | null,
  status: 'ok' | 'error',
  rowsWritten: number,
  detail: string
): Promise<void> {
  if (!id) return;
  try {
    await postgrest(`esme_social_sync_runs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status, rows_written: rowsWritten, detail: detail.slice(0, 500), finished_at: new Date().toISOString() },
    });
  } catch {
    // A failure to close the run is reported by the missing `ok` row, not by a false success.
  }
}

type GraphInsights = { impressions: number | null; reach: number | null; audience: Record<string, number> };

async function insightsFor(configuration: Extract<MetaConfiguration, { ok: true }>, externalId: string): Promise<GraphInsights> {
  const url = new URL(insightsEndpoint(configuration, externalId));
  url.searchParams.set('metric', 'post_impressions,post_reached,post_impressions_by_age_gender_unique');
  url.searchParams.set('period', 'lifetime');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${configuration.token}` },
  });
  if (!response.ok) return { impressions: null, reach: null, audience: {} };
  return parseInsights(await response.json());
}

async function writePosts(rows: SocialPostRow[], runId: string | null): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((row) => ({
    platform: row.platform,
    external_id: row.externalId,
    title: row.title,
    permalink: row.permalink,
    published_at: row.publishedAt,
    impressions: row.impressions,
    interactions: row.interactions,
    shares: row.shares,
    reach: row.reach,
    audience: row.audience,
    sync_run_id: runId,
    fetched_at: new Date().toISOString(),
  }));
  const response = await postgrest('esme_social_posts?on_conflict=platform,external_id', {
    method: 'POST',
    body: payload,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  if (!response.ok) throw new Error(`could not store posts: ${response.status}`);
  return rows.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'post-only: the schedule and the analytics screen invoke this' });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(503, { code: 'SUPABASE_NOT_CONFIGURED', error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' });
  }

  const cronProvided = req.headers.get('x-esme-cron-secret') ?? '';
  const scheduled = cronProvided !== '';
  if (scheduled) {
    if (!CRON_SECRET) return json(503, { code: 'CRON_SECRET_MISSING', error: 'META_SYNC_CRON_SECRET is not set' });
    if (!secretsMatch(cronProvided, CRON_SECRET)) return json(401, { code: 'CRON_SECRET_MISMATCH', error: 'the scheduler secret did not match' });
  } else {
    const authorization = req.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return json(401, { code: 'NOT_SIGNED_IN', error: 'a session or the scheduler secret is required' });
    if (!(await callerMaySync(authorization))) {
      return json(403, { code: 'NOT_AUTHORIZED', error: 'this account does not hold integrations.manage' });
    }
  }

  const configuration = metaConfiguration({
    META_PAGE_ID: Deno.env.get('META_PAGE_ID'),
    META_GRAPH_TOKEN: Deno.env.get('META_GRAPH_TOKEN'),
    META_GRAPH_VERSION: Deno.env.get('META_GRAPH_VERSION'),
  });

  if (!configuration.ok) {
    await recordBlockedRun(configuration);
    return json(503, {
      code: 'META_NOT_CONFIGURED',
      error: missingConfigurationDetail(configuration),
      missing: configuration.missing,
      invalid: configuration.invalid,
      live: false,
    });
  }

  let runId: string | null = null;
  try {
    runId = await startRun();

    const url = new URL(postsEndpoint(configuration));
    url.searchParams.set('fields', 'id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)');
    url.searchParams.set('limit', String(POST_LIMIT));
    const response = await fetch(url, {
      // The token travels in a header, never in a URL that a proxy or an error line could copy.
      headers: { Authorization: `Bearer ${configuration.token}` },
    });
    if (!response.ok) {
      const body = scrubProviderError(await response.text(), [configuration.token]);
      await finishRun(runId, 'error', 0, `provider ${response.status}: ${body}`);
      return json(502, { code: 'META_PROVIDER_ERROR', error: `Meta Graph answered ${response.status}.`, detail: body, live: true });
    }

    const parsed = parsePostsResponse(await response.json());
    if (parsed.posts.length === 0) {
      const detail = parsed.rejected > 0 ? `${parsed.rejected} row(s) had no post id` : 'the page returned no posts';
      await finishRun(runId, 'ok', 0, detail);
      return json(200, { status: 'ok', rowsWritten: 0, detail, live: true });
    }

    // Insights are requested per post. A failed call leaves that post's figures null instead of
    // borrowing another post's numbers or writing zero.
    let unmeasured = 0;
    for (const post of parsed.posts) {
      try {
        const insights = await insightsFor(configuration, post.externalId);
        post.impressions = insights.impressions;
        post.reach = insights.reach;
        post.audience = insights.audience;
      } catch {
        unmeasured++;
      }
    }

    const written = await writePosts(parsed.posts, runId);
    const detail = [
      `${written} post(s) stored`,
      unmeasured > 0 ? `${unmeasured} lacked an insights response (stored as null)` : '',
      parsed.rejected > 0 ? `${parsed.rejected} row(s) rejected without an id` : '',
    ]
      .filter(Boolean)
      .join('; ');
    await finishRun(runId, 'ok', written, detail);

    return json(200, { status: 'ok', rowsWritten: written, detail, unmeasured, rejected: parsed.rejected, live: true });
  } catch (error) {
    const message = scrubProviderError(error instanceof Error ? error.message : 'sync error', [configuration.token]);
    await finishRun(runId, 'error', 0, message);
    return json(502, { code: 'META_SYNC_FAILED', error: message, live: true });
  }
});
