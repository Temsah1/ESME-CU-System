/**
 * Pure helpers for the Meta Graph sync. No Deno global is touched here, so Vitest can execute
 * every rule below without a runtime or a network: which configuration is complete, how a Graph
 * response becomes rows, and how a provider error is scrubbed before it is stored.
 *
 * The access token never appears in a returned row, a stored detail or an error message. The only
 * place it is carried is the `authorization` field of a request this module builds.
 */

export const META_REQUIRED_ENV = ['META_PAGE_ID', 'META_GRAPH_TOKEN'] as const;
export const META_DEFAULT_VERSION = 'v21.0';

export type MetaConfiguration =
  | { ok: true; pageId: string; token: string; version: string }
  | { ok: false; missing: string[]; invalid: string[] };

function text(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * A page id is numeric or a page username. Restricting the shape keeps a value from being used
 * as a path segment with a slash or query in it; the token is never validated by shape because a
 * wrong token must fail at Meta, not in a local guess that could echo it.
 */
function validPageId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(value);
}

function validVersion(value: string): boolean {
  return /^v\d{1,3}\.\d{1,3}$/.test(value);
}

export function metaConfiguration(env: Record<string, string | undefined>): MetaConfiguration {
  const pageId = text(env.META_PAGE_ID);
  const token = text(env.META_GRAPH_TOKEN);
  const version = text(env.META_GRAPH_VERSION) || META_DEFAULT_VERSION;

  const missing: string[] = [];
  if (!pageId) missing.push('META_PAGE_ID');
  if (!token) missing.push('META_GRAPH_TOKEN');

  const invalid: string[] = [];
  if (pageId && !validPageId(pageId)) invalid.push('META_PAGE_ID');
  if (!validVersion(version)) invalid.push('META_GRAPH_VERSION');

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return { ok: true, pageId, token, version };
}

/** The query string without the token, so a blocked run can record exactly what is needed. */
export function missingConfigurationDetail(configuration: MetaConfiguration): string {
  if (configuration.ok) return '';
  const parts: string[] = [];
  if (configuration.missing.length > 0) parts.push(`missing: ${configuration.missing.join(', ')}`);
  if (configuration.invalid.length > 0) parts.push(`malformed: ${configuration.invalid.join(', ')}`);
  return `Meta Graph is not configured (${parts.join('; ')}). No request was made.`;
}

export type SocialPostRow = {
  platform: 'facebook';
  externalId: string;
  title: string;
  permalink: string | null;
  publishedAt: string | null;
  impressions: number | null;
  interactions: number | null;
  shares: number | null;
  reach: number | null;
  audience: Record<string, number>;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RecordValue) : null;
}

function count(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function summaryTotal(value: unknown): number | null {
  const holder = record(value);
  if (!holder) return null;
  const summary = record(holder.summary);
  return summary ? count(summary.total) : null;
}

function sharesTotal(value: unknown): number | null {
  const holder = record(value);
  return holder ? count(holder.count) : null;
}

/**
 * `post_impressions_by_age_gender_unique` returns keys such as `F.18-24` and `M.25-34`. The table
 * stores one number per age bracket, aggregated across genders; an unreadable value produces an
 * empty map rather than invented shares.
 */
export function parseAgeBrackets(value: unknown): Record<string, number> {
  const holder = record(value);
  if (!holder) return {};
  const totals: Record<string, number> = {};
  for (const [key, raw] of Object.entries(holder)) {
    const match = /^[A-Za-z]\.(\d{1,2}-\d{1,2}|\d{1,2}\+|unknown)$/i.exec(key);
    if (!match) continue;
    const bracket = match[1];
    const amount = count(raw);
    if (amount === null) continue;
    totals[bracket] = (totals[bracket] ?? 0) + amount;
  }
  return totals;
}

export type ParsedInsights = { impressions: number | null; reach: number | null; audience: Record<string, number> };

/** Reads a `/insights` payload. A metric the response does not carry stays null. */
export function parseInsights(payload: unknown): ParsedInsights {
  const body = record(payload);
  const data = Array.isArray(body?.data) ? body.data : [];
  const out: ParsedInsights = { impressions: null, reach: null, audience: {} };
  for (const entry of data) {
    const metric = record(entry);
    if (!metric || typeof metric.name !== 'string') continue;
    const values = Array.isArray(metric.values) ? metric.values : [];
    const first = record(values[0]);
    const value = first?.value;
    if (metric.name === 'post_impressions') out.impressions = count(value);
    else if (metric.name === 'post_reached') out.reach = count(value);
    else if (metric.name === 'post_impressions_by_age_gender_unique') out.audience = parseAgeBrackets(value);
  }
  return out;
}

export type ParsedPosts = { posts: SocialPostRow[]; rejected: number };

/**
 * Turns a `/posts` payload into rows. A post with no external id cannot be keyed to a row and is
 * counted as rejected, never merged into another post. Metrics the response omits stay null.
 */
export function parsePostsResponse(payload: unknown): ParsedPosts {
  const body = record(payload);
  const data = Array.isArray(body?.data) ? body.data : [];
  const posts: SocialPostRow[] = [];
  let rejected = 0;

  for (const entry of data) {
    const post = record(entry);
    const externalId = typeof post?.id === 'string' ? post.id.trim() : '';
    if (!post || !externalId) {
      rejected++;
      continue;
    }

    const message = typeof post.message === 'string' ? post.message.trim() : '';
    const likes = summaryTotal(post.likes);
    const comments = summaryTotal(post.comments);
    const shares = sharesTotal(post.shares);
    const interactions =
      likes === null && comments === null && shares === null
        ? null
        : (likes ?? 0) + (comments ?? 0) + (shares ?? 0);

    posts.push({
      platform: 'facebook',
      externalId,
      title: message === '' ? 'Post without text' : message.slice(0, 200),
      permalink: typeof post.permalink_url === 'string' && post.permalink_url.startsWith('https://')
        ? post.permalink_url
        : null,
      publishedAt: isoDate(post.created_time),
      impressions: null,
      interactions,
      shares,
      reach: null,
      audience: {},
    });
  }

  return { posts, rejected };
}

/** Removes any configured secret from a provider message before it is stored or returned. */
export function scrubProviderError(message: string, secrets: string[] = []): string {
  let scrubbed = message;
  for (const secret of secrets) {
    if (secret.length >= 4) scrubbed = scrubbed.split(secret).join('***');
  }
  // Graph errors can name an access token in a URL as `access_token=…`; scrub the parameter
  // whether or not the exact secret was passed in.
  scrubbed = scrubbed.replace(/access_token=[^&\s]+/gi, 'access_token=***');
  return scrubbed.slice(0, 500);
}

/** The Graph paths, kept together so a malformed version or page id cannot change the host. */
export function postsEndpoint(configuration: Extract<MetaConfiguration, { ok: true }>): string {
  return `https://graph.facebook.com/${configuration.version}/${encodeURIComponent(configuration.pageId)}/posts`;
}

export function insightsEndpoint(
  configuration: Extract<MetaConfiguration, { ok: true }>,
  externalId: string
): string {
  return `https://graph.facebook.com/${configuration.version}/${encodeURIComponent(externalId)}/insights`;
}
