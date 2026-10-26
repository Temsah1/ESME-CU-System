import { describe, expect, it } from 'vitest';
import {
  insightsEndpoint,
  metaConfiguration,
  missingConfigurationDetail,
  parseAgeBrackets,
  parseInsights,
  parsePostsResponse,
  postsEndpoint,
  scrubProviderError,
} from './metaGraph';

const configured = { META_PAGE_ID: '1122334455', META_GRAPH_TOKEN: 'EAAB-secret-token' } as const;

describe('the server-side configuration', () => {
  it('refuses a half-set environment and names only the missing variables', () => {
    const configuration = metaConfiguration({ META_PAGE_ID: '1122334455' });
    expect(configuration.ok).toBe(false);
    if (!configuration.ok) {
      expect(configuration.missing).toEqual(['META_GRAPH_TOKEN']);
      expect(configuration.invalid).toEqual([]);
    }
    const detail = missingConfigurationDetail(configuration);
    expect(detail).toContain('META_GRAPH_TOKEN');
    expect(detail).not.toContain('1122334455');
  });

  it('rejects a page id or version that could alter the request path', () => {
    const configuration = metaConfiguration({
      META_PAGE_ID: '../me?fields=token',
      META_GRAPH_TOKEN: 'token',
      META_GRAPH_VERSION: 'v21/../../me',
    });
    expect(configuration.ok).toBe(false);
    if (!configuration.ok) expect(configuration.invalid).toEqual(['META_PAGE_ID', 'META_GRAPH_VERSION']);
  });

  it('defaults the version and never echoes the token in its detail', () => {
    const configuration = metaConfiguration(configured);
    expect(configuration.ok).toBe(true);
    if (configuration.ok) {
      expect(configuration.version).toBe('v21.0');
      expect(missingConfigurationDetail(configuration)).toBe('');
    }
  });
});

describe('reading a Graph response', () => {
  it('keeps a missing metric null and sums the figures it was given', () => {
    const parsed = parsePostsResponse({
      data: [
        {
          id: 'page_1',
          message: '  NDT workshop  ',
          created_time: '2026-10-01T10:00:00+0000',
          permalink_url: 'https://www.facebook.com/esme/posts/1',
          shares: { count: 4 },
          likes: { summary: { total: 30 } },
          comments: { summary: { total: 6 } },
        },
        { message: 'no id' },
      ],
    });
    expect(parsed.rejected).toBe(1);
    expect(parsed.posts).toHaveLength(1);
    expect(parsed.posts[0]).toMatchObject({
      externalId: 'page_1',
      title: 'NDT workshop',
      interactions: 40,
      shares: 4,
      impressions: null,
      reach: null,
      publishedAt: '2026-10-01T10:00:00.000Z',
    });
  });

  it('labels a post with no text without inventing a headline', () => {
    const parsed = parsePostsResponse({ data: [{ id: 'page_2' }] });
    expect(parsed.posts[0].title).toBe('Post without text');
    expect(parsed.posts[0].interactions).toBeNull();
  });

  it('takes the insight metrics by name and aggregates age brackets across genders', () => {
    const insights = parseInsights({
      data: [
        { name: 'post_impressions', values: [{ value: 1200 }] },
        { name: 'post_reached', values: [{ value: 900 }] },
        {
          name: 'post_impressions_by_age_gender_unique',
          values: [{ value: { 'F.18-24': 100, 'M.18-24': 50, 'F.25-34': 10, 'U.unknown': 5, bad: 3 } }],
        },
      ],
    });
    expect(insights).toMatchObject({ impressions: 1200, reach: 900 });
    expect(insights.audience).toEqual({ '18-24': 150, '25-34': 10, unknown: 5 });
  });

  it('ignores an unreadable bracket map rather than guessing shares', () => {
    expect(parseAgeBrackets({ 'F.18-24': 'many' })).toEqual({});
    expect(parseAgeBrackets(null)).toEqual({});
  });
});

describe('errors and endpoints', () => {
  it('removes the token and any access_token parameter before a detail is stored', () => {
    const scrubbed = scrubProviderError(
      'GET https://graph.facebook.com/v21.0/me?access_token=EAAB-secret-token failed; token EAAB-secret-token expired',
      ['EAAB-secret-token']
    );
    expect(scrubbed).not.toContain('EAAB-secret-token');
    expect(scrubbed).toContain('access_token=***');
    expect(scrubbed).toContain('***');
  });

  it('keeps the request on graph.facebook.com and encodes the identifiers', () => {
    const configuration = metaConfiguration(configured);
    if (!configuration.ok) throw new Error('expected a configured environment');
    const posts = new URL(postsEndpoint(configuration));
    expect(posts.host).toBe('graph.facebook.com');
    expect(posts.pathname).toBe('/v21.0/1122334455/posts');
    expect(posts.toString()).not.toContain(configuration.token);

    const insights = new URL(insightsEndpoint(configuration, '112_abc/def'));
    expect(insights.pathname).toBe('/v21.0/112_abc%2Fdef/insights');
  });
});
