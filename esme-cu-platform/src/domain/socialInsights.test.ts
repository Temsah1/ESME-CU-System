import { describe, expect, it } from 'vitest';
import {
  SOCIAL_SETUP_VARIABLES,
  STALE_AFTER_HOURS,
  freshnessOf,
  interpretSyncResponse,
  normalizePost,
  normalizeRun,
  summarizePosts,
  type SocialPost,
  type SocialSyncRun,
} from './socialInsights';

const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: 'row_1',
  platform: 'facebook',
  externalId: '123_456',
  title: 'Hands-on NDT workshop',
  permalink: 'https://www.facebook.com/esme/posts/123',
  publishedAt: '2026-10-01T10:00:00.000Z',
  impressions: 1000,
  interactions: 50,
  shares: 5,
  reach: 800,
  audience: { '18-24': 60 },
  fetchedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

const run = (over: Partial<SocialSyncRun> = {}): SocialSyncRun => ({
  id: 'run_1',
  provider: 'meta_graph',
  startedAt: '2026-10-02T00:00:00.000Z',
  finishedAt: '2026-10-02T00:01:00.000Z',
  status: 'ok',
  rowsWritten: 4,
  detail: '4 post(s) stored',
  ...over,
});

describe('normalising a stored row', () => {
  it('keeps a null metric null and refuses a negative or non-numeric one', () => {
    const normalized = normalizePost({
      id: 'row_1',
      platform: 'facebook',
      external_id: '123_456',
      title: 'Workshop',
      impressions: null,
      interactions: -4,
      shares: 'seven',
      reach: '900',
      audience: { '18-24': 12, junk: 'x' },
      fetched_at: 'yesterday-ish',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.impressions).toBeNull();
    expect(normalized?.interactions).toBeNull();
    expect(normalized?.shares).toBeNull();
    expect(normalized?.reach).toBe(900);
    expect(normalized?.audience).toEqual({ '18-24': 12 });
    expect(normalized?.fetchedAt).toBeNull();
  });

  it('drops a post that cannot be keyed or titled', () => {
    expect(normalizePost({ platform: 'facebook', title: 'No id' })).toBeNull();
    expect(normalizePost({ id: 'row_1', platform: 'facebook', external_id: '1' })).toBeNull();
    expect(normalizePost({ id: 'row_1', platform: 'tiktok', external_id: '1', title: 'x' })).toBeNull();
  });

  it('drops a run with an unknown status rather than presenting it as a success', () => {
    expect(normalizeRun({ id: 'run_1', status: 'maybe' })).toBeNull();
    expect(normalizeRun({ id: 'run_1', status: 'blocked', detail: 'missing: META_PAGE_ID' })).toMatchObject({
      status: 'blocked',
      detail: 'missing: META_PAGE_ID',
    });
  });
});

describe('what the numbers mean', () => {
  it('reports null for a metric no row carries, and zero when a row carries zero', () => {
    const empty = summarizePosts([]);
    expect(empty).toMatchObject({ posts: 0, impressions: null, interactions: null, engagementRate: null });

    const measuredZero = summarizePosts([post({ impressions: 0, interactions: 0, shares: 0 })]);
    expect(measuredZero).toMatchObject({ impressions: 0, interactions: 0, engagementRate: null });

    const partial = summarizePosts([
      post({ impressions: null, interactions: 10, shares: null }),
      post({ id: 'row_2', impressions: 500, interactions: null, shares: 2 }),
    ]);
    expect(partial).toMatchObject({ impressions: 500, interactions: 10, shares: 2, engagementRate: 2 });
  });

  it('computes the engagement rate from the totals it actually has', () => {
    const totals = summarizePosts([post({ impressions: 2000, interactions: 100 })]);
    expect(totals.engagementRate).toBe(5);
    expect(totals.firstPublishedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(totals.lastPublishedAt).toBe('2026-10-01T10:00:00.000Z');
  });
});

describe('how old the measurement is', () => {
  const now = Date.parse('2026-10-03T12:00:00.000Z');

  it('says never when no run was recorded', () => {
    expect(freshnessOf([], now)).toEqual({ state: 'never', ageHours: null, latest: null });
  });

  it('calls a successful run fresh until the stated limit, then stale', () => {
    const fresh = freshnessOf([run({ startedAt: '2026-10-03T00:00:00.000Z' })], now);
    expect(fresh.state).toBe('fresh');
    expect(fresh.ageHours).toBe(12);

    const stale = freshnessOf(
      [run({ startedAt: new Date(now - (STALE_AFTER_HOURS + 1) * 3_600_000).toISOString() })],
      now
    );
    expect(stale.state).toBe('stale');
  });

  it('surfaces a blocked or failed attempt instead of falling back to an older success', () => {
    const runs = [
      run({ id: 'old', startedAt: '2026-10-01T00:00:00.000Z' }),
      run({ id: 'new', startedAt: '2026-10-03T11:00:00.000Z', status: 'blocked', detail: 'missing: META_GRAPH_TOKEN' }),
    ];
    expect(freshnessOf(runs, now)).toMatchObject({ state: 'blocked', latest: { id: 'new' } });
  });
});

describe('the answer the sync endpoint gives', () => {
  it('treats a 2xx without an ok status as an error, not a success', () => {
    expect(interpretSyncResponse({ rowsWritten: 3 }, 200)).toMatchObject({ status: 'error' });
  });

  it('reads the blocked answer and keeps only known variable names', () => {
    const attempt = interpretSyncResponse(
      {
        code: 'META_NOT_CONFIGURED',
        error: 'Meta Graph is not configured (missing: META_PAGE_ID). No request was made.',
        missing: ['META_PAGE_ID', 'SOMETHING_ELSE', 7],
        live: false,
      },
      503
    );
    expect(attempt).toMatchObject({ status: 'blocked', missing: ['META_PAGE_ID'] });
  });

  it('separates authorisation refusals from provider failures', () => {
    expect(interpretSyncResponse({ code: 'NOT_AUTHORIZED', error: 'no' }, 403)).toMatchObject({ status: 'refused' });
    expect(interpretSyncResponse({ error: 'Meta Graph answered 500.' }, 502)).toMatchObject({ status: 'error' });
  });

  it('reads a successful answer with its row count', () => {
    expect(interpretSyncResponse({ status: 'ok', rowsWritten: 4, detail: '4 post(s) stored' }, 200)).toEqual({
      status: 'ok',
      rowsWritten: 4,
      detail: '4 post(s) stored',
    });
  });
});

describe('the setup list', () => {
  it('names only server-side variables, none with a VITE_ prefix', () => {
    expect(SOCIAL_SETUP_VARIABLES.length).toBeGreaterThan(0);
    for (const variable of SOCIAL_SETUP_VARIABLES) {
      expect(variable.name.startsWith('VITE_')).toBe(false);
    }
    expect(SOCIAL_SETUP_VARIABLES.map((v) => v.name)).toContain('META_GRAPH_TOKEN');
  });
});
