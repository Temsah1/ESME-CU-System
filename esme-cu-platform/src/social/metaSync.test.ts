import { describe, expect, it } from 'vitest';
import type { SocialClient } from './metaSync';
import { loadSocialInsights, requestSocialSync, socialSourceFromEnv } from './metaSync';

const row = (id: string) => ({
  id,
  platform: 'facebook',
  external_id: `ext_${id}`,
  title: `Post ${id}`,
  impressions: 100,
  interactions: 10,
  shares: 1,
  reach: 90,
  audience: { '18-24': 40 },
  published_at: '2026-10-01T10:00:00.000Z',
  fetched_at: '2026-10-02T00:00:00.000Z',
});

function fakeClient(over: Partial<SocialClient> = {}): SocialClient {
  return {
    async select(table) {
      if (table === 'esme_social_sync_runs') {
        return {
          data: [
            {
              id: 'run_1',
              provider: 'meta_graph',
              started_at: '2026-10-02T00:00:00.000Z',
              finished_at: '2026-10-02T00:01:00.000Z',
              status: 'ok',
              rows_written: 1,
              detail: '1 post(s) stored',
            },
          ],
          error: null,
        };
      }
      return { data: [row('1'), { id: 'broken' }], error: null };
    },
    async invokeSync() {
      return { data: { status: 'ok', rowsWritten: 1, detail: '1 post(s) stored' }, error: null };
    },
    ...over,
  };
}

describe('building a source from the public environment', () => {
  it('blocks without calling anything when either client variable is absent', async () => {
    expect(await socialSourceFromEnv({})).toEqual({
      status: 'blocked',
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });
    expect(await socialSourceFromEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual({
      status: 'blocked',
      missing: ['VITE_SUPABASE_ANON_KEY'],
    });
  });

  it('describes a malformed configuration instead of falling back silently', async () => {
    const source = await socialSourceFromEnv({
      VITE_SUPABASE_URL: 'https://x.supabase.co/rest/v1',
      VITE_SUPABASE_ANON_KEY: 'sb_secret_do-not-ship',
    });
    expect(source.status).toBe('error');
    if (source.status === 'error') {
      expect(source.message).toContain('project root');
      expect(source.message).toContain('secret API key');
    }
  });
});

describe('loading stored insight rows', () => {
  it('renders the rows the database returned and counts the ones it could not describe', async () => {
    const load = await loadSocialInsights({ status: 'ready', client: fakeClient() });
    expect(load.state).toBe('ready');
    if (load.state === 'ready') {
      expect(load.runs).toHaveLength(1);
      expect(load.posts).toHaveLength(1);
      expect(load.rejectedRows).toBe(1);
      expect(load.posts[0].impressions).toBe(100);
    }
  });

  it('reports a query failure rather than showing an empty chart as a measurement', async () => {
    const load = await loadSocialInsights({
      status: 'ready',
      client: fakeClient({
        async select() {
          return { data: null, error: { message: 'permission denied for table esme_social_posts' } };
        },
      }),
    });
    expect(load).toEqual({ state: 'error', message: 'permission denied for table esme_social_posts' });
  });

  it('passes a blocked source through without a query', async () => {
    let queried = false;
    const load = await loadSocialInsights({
      status: 'ready',
      client: fakeClient({
        async select() {
          queried = true;
          return { data: [], error: null };
        },
      }),
    });
    expect(load.state).toBe('ready');
    expect(queried).toBe(true);

    const blocked = await loadSocialInsights({ status: 'blocked', missing: ['VITE_SUPABASE_URL'] });
    expect(blocked).toEqual({ state: 'blocked', missing: ['VITE_SUPABASE_URL'] });
  });
});

describe('asking for a sync', () => {
  it('names the missing client variables and makes no call when the project is not configured', async () => {
    let called = false;
    const attempt = await requestSocialSync({ status: 'blocked', missing: ['VITE_SUPABASE_URL'] });
    expect(attempt).toMatchObject({ status: 'blocked', missing: ['VITE_SUPABASE_URL'] });
    expect(called).toBe(false);
  });

  it('reports a successful run with the count the function returned', async () => {
    const attempt = await requestSocialSync({ status: 'ready', client: fakeClient() });
    expect(attempt).toEqual({ status: 'ok', rowsWritten: 1, detail: '1 post(s) stored' });
  });

  it('reads a non-2xx body so a refusal is not reduced to a generic network error', async () => {
    const attempt = await requestSocialSync({
      status: 'ready',
      client: fakeClient({
        async invokeSync() {
          return {
            data: null,
            error: {
              name: 'FunctionsHttpError',
              message: 'Edge Function returned a non-2xx status code',
              context: {
                status: 503,
                json: async () => ({
                  code: 'META_NOT_CONFIGURED',
                  error: 'Meta Graph is not configured (missing: META_GRAPH_TOKEN). No request was made.',
                  missing: ['META_GRAPH_TOKEN'],
                }),
              },
            },
          };
        },
      }),
    });
    expect(attempt).toMatchObject({ status: 'blocked', missing: ['META_GRAPH_TOKEN'] });
  });

  it('keeps an authorisation refusal distinct from a provider failure', async () => {
    const refused = await requestSocialSync({
      status: 'ready',
      client: fakeClient({
        async invokeSync() {
          return {
            data: null,
            error: { context: { status: 403, json: async () => ({ code: 'NOT_AUTHORIZED', error: 'no' }) } },
          };
        },
      }),
    });
    expect(refused.status).toBe('refused');
  });
});
