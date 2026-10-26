/**
 * What the analytics screen may say about the chapter's social channels.
 *
 * Every figure here is derived from a row the server-side sync wrote. A missing row is `null`, not
 * zero: "nobody has measured this" and "the measurement was zero" are different facts, and only the
 * second one is a result. The transcribed screenshots in `src/data/historyData.ts` are kept apart
 * from these functions on purpose — they are a historical record, not a live measurement.
 */

export type SocialRunStatus = 'running' | 'ok' | 'blocked' | 'error';

export type SocialSyncRun = {
  id: string;
  provider: 'meta_graph';
  startedAt: string | null;
  finishedAt: string | null;
  status: SocialRunStatus;
  rowsWritten: number;
  detail: string;
};

export type SocialPost = {
  id: string;
  platform: 'facebook' | 'instagram';
  externalId: string;
  title: string;
  permalink: string | null;
  publishedAt: string | null;
  impressions: number | null;
  interactions: number | null;
  shares: number | null;
  reach: number | null;
  audience: Record<string, number>;
  fetchedAt: string | null;
};

export type SocialLoad =
  | { state: 'blocked'; missing: string[] }
  | { state: 'error'; message: string }
  | { state: 'ready'; runs: SocialSyncRun[]; posts: SocialPost[]; rejectedRows: number };

/** Server-side variables the sync needs. None may carry a VITE_ prefix: that would ship it. */
export const SOCIAL_SETUP_VARIABLES: { name: string; purpose: string }[] = [
  { name: 'META_PAGE_ID', purpose: 'The Facebook Page whose posts are read.' },
  { name: 'META_GRAPH_TOKEN', purpose: 'A Page access token. Server-only; never set as VITE_META_*. ' },
  { name: 'META_SYNC_CRON_SECRET', purpose: 'The header the daily schedule presents.' },
  { name: 'META_GRAPH_VERSION', purpose: 'Optional Graph version; defaults to v21.0.' },
];

export const STALE_AFTER_HOURS = 36;

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function runStatus(value: unknown): SocialRunStatus | null {
  return value === 'running' || value === 'ok' || value === 'blocked' || value === 'error' ? value : null;
}

/** A row the database cannot describe is dropped and counted, never shown with guessed fields. */
export function normalizeRun(value: unknown): SocialSyncRun | null {
  const raw = record(value);
  if (!raw) return null;
  const status = runStatus(raw.status);
  const id = text(raw.id);
  if (!status || !id) return null;
  return {
    id,
    provider: 'meta_graph',
    startedAt: iso(raw.started_at),
    finishedAt: iso(raw.finished_at),
    status,
    rowsWritten: integer(raw.rows_written) ?? 0,
    detail: text(raw.detail) ?? '',
  };
}

export function normalizePost(value: unknown): SocialPost | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  const externalId = text(raw.external_id);
  const title = text(raw.title);
  const platform = raw.platform === 'instagram' ? 'instagram' : raw.platform === 'facebook' ? 'facebook' : null;
  if (!id || !externalId || !title || !platform) return null;

  const audienceRaw = record(raw.audience) ?? {};
  const audience: Record<string, number> = {};
  for (const [bracket, amount] of Object.entries(audienceRaw)) {
    const parsed = integer(amount);
    if (parsed !== null) audience[bracket] = parsed;
  }

  return {
    id,
    platform,
    externalId,
    title,
    permalink: typeof raw.permalink === 'string' && raw.permalink.startsWith('https://') ? raw.permalink : null,
    publishedAt: iso(raw.published_at),
    impressions: integer(raw.impressions),
    interactions: integer(raw.interactions),
    shares: integer(raw.shares),
    reach: integer(raw.reach),
    audience,
    fetchedAt: iso(raw.fetched_at),
  };
}

export type SocialTotals = {
  posts: number;
  impressions: number | null;
  interactions: number | null;
  shares: number | null;
  /** Interactions per 100 impressions; null when no row carries an impression figure. */
  engagementRate: number | null;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
};

/** Totals over the rows that exist. A metric no row carries stays null rather than becoming 0. */
export function summarizePosts(posts: SocialPost[]): SocialTotals {
  let impressions = 0;
  let interactions = 0;
  let shares = 0;
  let hasImpressions = false;
  let hasInteractions = false;
  let hasShares = false;
  const dates: number[] = [];

  for (const post of posts) {
    if (post.impressions !== null) {
      impressions += post.impressions;
      hasImpressions = true;
    }
    if (post.interactions !== null) {
      interactions += post.interactions;
      hasInteractions = true;
    }
    if (post.shares !== null) {
      shares += post.shares;
      hasShares = true;
    }
    if (post.publishedAt) {
      const parsed = Date.parse(post.publishedAt);
      if (Number.isFinite(parsed)) dates.push(parsed);
    }
  }

  return {
    posts: posts.length,
    impressions: hasImpressions ? impressions : null,
    interactions: hasInteractions ? interactions : null,
    shares: hasShares ? shares : null,
    engagementRate: hasImpressions && impressions > 0 && hasInteractions
      ? Math.round((interactions / impressions) * 1000) / 10
      : null,
    firstPublishedAt: dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null,
    lastPublishedAt: dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null,
  };
}

export type SyncFreshness = {
  state: 'never' | 'fresh' | 'stale' | 'blocked' | 'error' | 'running';
  /** Hours since the latest attempt started; null when no run exists. */
  ageHours: number | null;
  latest: SocialSyncRun | null;
};

/** Reads the newest run first; a blocked or failed attempt is a state, not an absence of one. */
export function freshnessOf(runs: SocialSyncRun[], nowMs: number): SyncFreshness {
  if (runs.length === 0) return { state: 'never', ageHours: null, latest: null };
  const latest = [...runs].sort((a, b) => {
    const at = a.startedAt ? Date.parse(a.startedAt) : 0;
    const bt = b.startedAt ? Date.parse(b.startedAt) : 0;
    return bt - at;
  })[0];
  const started = latest.startedAt ? Date.parse(latest.startedAt) : Number.NaN;
  const ageHours = Number.isFinite(started) ? Math.max(0, (nowMs - started) / 3_600_000) : null;

  if (latest.status !== 'ok') return { state: latest.status, ageHours, latest };
  if (ageHours === null) return { state: 'stale', ageHours, latest };
  return { state: ageHours > STALE_AFTER_HOURS ? 'stale' : 'fresh', ageHours, latest };
}

export type SyncAttempt =
  | { status: 'ok'; rowsWritten: number; detail: string }
  | { status: 'blocked'; missing: string[]; message: string }
  | { status: 'refused'; message: string }
  | { status: 'error'; message: string };

const KNOWN_VARIABLES = new Set(SOCIAL_SETUP_VARIABLES.map((entry) => entry.name));

/**
 * Maps an Edge Function answer to the sentence the screen prints. The function answers 503
 * META_NOT_CONFIGURED with the variable names and makes no request to Meta; 403 means the session
 * does not hold `integrations.manage`; anything else is an error and is never called a success.
 */
export function interpretSyncResponse(
  data: unknown,
  status: number | null,
  fallbackMessage = 'The sync did not run.'
): SyncAttempt {
  const body = record(data) ?? {};
  if (status !== null && status >= 200 && status < 300 && body.status === 'ok') {
    return {
      status: 'ok',
      rowsWritten: integer(body.rowsWritten) ?? 0,
      detail: text(body.detail) ?? '',
    };
  }

  const code = text(body.code);
  if (code === 'META_NOT_CONFIGURED') {
    const missing = Array.isArray(body.missing)
      ? body.missing.filter((entry): entry is string => typeof entry === 'string' && KNOWN_VARIABLES.has(entry))
      : [];
    return {
      status: 'blocked',
      missing,
      message: text(body.error) ?? 'Meta Graph is not configured; no request was made.',
    };
  }
  if (code === 'NOT_AUTHORIZED' || code === 'NOT_SIGNED_IN') {
    return { status: 'refused', message: text(body.error) ?? 'This account may not run the sync.' };
  }
  return { status: 'error', message: text(body.error) ?? fallbackMessage };
}

/** Turns a `functions.invoke` result into the same attempt shape, including a non-2xx body. */
export async function interpretFailure(error: unknown, fallbackMessage: string): Promise<SyncAttempt> {
  const context = record(error)?.context;
  const response = record(context);
  const status = typeof response?.status === 'number' ? response.status : null;
  const json = response?.json;
  if (typeof json === 'function') {
    try {
      return interpretSyncResponse(await (json as () => Promise<unknown>)(), status, fallbackMessage);
    } catch {
      return { status: 'error', message: fallbackMessage };
    }
  }
  const message = error instanceof Error ? error.message : fallbackMessage;
  return { status: 'error', message };
}
