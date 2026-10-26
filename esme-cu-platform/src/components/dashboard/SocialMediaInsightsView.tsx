import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Clock3,
  ExternalLink,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { HISTORICAL_SOCIAL_INSIGHTS } from '../../data/historyData';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import {
  SOCIAL_SETUP_VARIABLES,
  STALE_AFTER_HOURS,
  freshnessOf,
  summarizePosts,
  type SocialLoad,
  type SyncAttempt,
} from '../../domain/socialInsights';
import {
  loadSocialInsights,
  requestSocialSync,
  socialSourceFromEnv,
  type SocialSource,
} from '../../social/metaSync';

/**
 * Social analytics read from the rows a server-side Meta Graph sync wrote.
 *
 * The page cannot obtain a live figure by itself: the token is an Edge Function secret, and the
 * browser only holds the project's publishable key. When the sync is not configured, the page says
 * BLOCKED with the missing server-side variable names. The transcribed screenshots below are shown
 * as a historical record and never mixed into the live totals.
 */

const number = (value: number | null): string => (value === null ? '—' : value.toLocaleString());

const ageLabel = (hours: number | null): string => {
  if (hours === null) return 'at an unknown time';
  if (hours < 1) return 'less than an hour ago';
  const rounded = Math.round(hours);
  return `${rounded} hour${rounded === 1 ? '' : 's'} ago`;
};

const Stat: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</div>
    <div className="text-xl font-black text-slate-900 dark:text-white mt-1">{value}</div>
    <div className="text-[10px] text-slate-400 mt-1">{hint}</div>
  </div>
);

const Tone: React.FC<{ tone: 'amber' | 'rose' | 'emerald' | 'blue'; title: string; children: React.ReactNode }> = ({
  tone,
  title,
  children,
}) => {
  const styles = {
    amber: {
      box: 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10',
      title: 'text-amber-900 dark:text-amber-200',
      body: 'text-amber-800 dark:text-amber-300',
      icon: 'text-amber-600',
    },
    rose: {
      box: 'border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10',
      title: 'text-rose-900 dark:text-rose-200',
      body: 'text-rose-800 dark:text-rose-300',
      icon: 'text-rose-600',
    },
    emerald: {
      box: 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10',
      title: 'text-emerald-900 dark:text-emerald-200',
      body: 'text-emerald-800 dark:text-emerald-300',
      icon: 'text-emerald-600',
    },
    blue: {
      box: 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10',
      title: 'text-blue-900 dark:text-blue-200',
      body: 'text-blue-800 dark:text-blue-300',
      icon: 'text-blue-600',
    },
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 flex items-start gap-3 ${styles.box}`}>
      <TriangleAlert className={`w-4 h-4 shrink-0 mt-0.5 ${styles.icon}`} aria-hidden />
      <div className="text-xs space-y-1">
        <p className={`font-bold ${styles.title}`}>{title}</p>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
};

function syncedLabel(load: SocialLoad, nowMs: number): { tone: 'amber' | 'rose' | 'emerald' | 'blue'; title: string; body: string } {
  if (load.state !== 'ready') {
    return load.state === 'blocked'
      ? {
          tone: 'amber',
          title: 'Live sync is blocked',
          body: `This build does not know the project URL or publishable key (${load.missing.join(', ')}). No request was made to Meta.`,
        }
      : { tone: 'rose', title: 'The stored measurements could not be read', body: load.message };
  }

  const freshness = freshnessOf(load.runs, nowMs);
  switch (freshness.state) {
    case 'never':
      return {
        tone: 'amber',
        title: 'No sync has run yet',
        body: 'No measurement has been stored. The figures below stay empty until a sync writes a row; this page never estimates them.',
      };
    case 'blocked':
      return {
        tone: 'amber',
        title: 'The last sync was blocked',
        body: freshness.latest?.detail || 'A configuration variable was missing, so no request was made to Meta.',
      };
    case 'error':
      return {
        tone: 'rose',
        title: 'The last sync failed',
        body: freshness.latest?.detail || 'The provider did not complete the run. No figure was invented to fill the gap.',
      };
    case 'running':
      return { tone: 'blue', title: 'A sync is running', body: 'The rows below are the last completed measurement.' };
    case 'stale':
      return {
        tone: 'amber',
        title: 'The measurements are stale',
        body: `The last successful sync started ${ageLabel(freshness.ageHours)}; this page treats anything older than ${STALE_AFTER_HOURS} hours as stale.`,
      };
    default:
      return {
        tone: 'emerald',
        title: 'Measurements are current',
        body: `The last successful sync started ${ageLabel(freshness.ageHours)} and stored ${freshness.latest?.rowsWritten ?? 0} row(s).`,
      };
  }
}

export const SocialMediaInsightsView: React.FC = () => {
  const { can } = useApp();
  const { toast } = useToast();
  const [source, setSource] = useState<SocialSource | null>(null);
  const [load, setLoad] = useState<SocialLoad | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<SyncAttempt | null>(null);

  const refresh = useCallback(async (nextSource: SocialSource) => {
    const next = await loadSocialInsights(nextSource);
    setLoad(next);
    setLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const nextSource = await socialSourceFromEnv();
      if (!alive) return;
      setSource(nextSource);
      const next = await loadSocialInsights(nextSource);
      if (!alive) return;
      setLoad(next);
      setLoadedAt(Date.now());
    })();
    return () => {
      alive = false;
    };
  }, []);

  const runSync = async () => {
    if (!source) return;
    setBusy(true);
    setAttempt(null);
    try {
      const result = await requestSocialSync(source);
      setAttempt(result);
      if (result.status === 'ok') {
        toast(
          result.rowsWritten > 0
            ? `Sync complete: ${result.rowsWritten} post(s) stored.`
            : 'Sync complete: the page returned no posts to store.',
          'success'
        );
        await refresh(source);
      } else {
        toast(result.status === 'blocked' ? `Sync blocked: ${result.message}` : result.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const posts = load?.state === 'ready' ? load.posts : [];
  const runs = load?.state === 'ready' ? load.runs : [];
  const totals = summarizePosts(posts);
  const status = load ? syncedLabel(load, loadedAt) : null;
  const freshness = freshnessOf(runs, loadedAt);
  const canSync = can('integrations.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Social Media Analysis</h1>
        <p className="text-xs text-slate-500">
          Post-level measurements written by the server-side Meta Graph sync. A missing figure is shown as “—” and is
          never replaced with an estimate.
        </p>
      </div>

      {status && (
        <Tone tone={status.tone} title={status.title}>
          <p>{status.body}</p>
        </Tone>
      )}

      {attempt && attempt.status !== 'ok' && (
        <Tone tone={attempt.status === 'blocked' ? 'amber' : 'rose'} title={`Sync ${attempt.status}`}>
          <p>{attempt.message}</p>
          {attempt.status === 'blocked' && attempt.missing.length > 0 && (
            <p className="font-mono text-[11px]">Missing: {attempt.missing.join(', ')}</p>
          )}
        </Tone>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
              <PlugZap className="w-4 h-4" aria-hidden />
            </span>
            <div className="text-xs space-y-1.5">
              <p className="font-bold text-slate-900 dark:text-white">Sync from the Meta Graph API</p>
              <p className="text-slate-600 dark:text-slate-300">
                The token is read by the Edge Function from its own environment. The browser only holds the project URL
                and the publishable key, so no page access token is bundled or sent here.
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                {canSync
                  ? 'Your role holds integrations.manage, so you may start a run by hand. The daily schedule invokes the same function.'
                  : 'Starting a run needs integrations.manage. The rows below are readable through the content capability.'}
              </p>
            </div>
          </div>
          <div className="shrink-0 self-start">
            {canSync && (
              <button
                type="button"
                onClick={runSync}
                disabled={busy || source?.status !== 'ready'}
                className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition inline-flex items-center gap-2"
                title={source?.status === 'ready' ? 'Invoke the sync now' : 'Configure the server-side variables first'}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
        </div>

        {source?.status === 'blocked' && (
          <p className="mt-4 text-[11px] text-amber-700 dark:text-amber-300">
            The browser provider is not configured in this build: {source.missing.join(', ')}. The sync button stays
            disabled because there is no project to invoke.
          </p>
        )}
      </div>

      {load?.state === 'ready' && posts.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Posts stored" value={number(totals.posts)} hint="Rows written by a completed sync" />
            <Stat
              label="Impressions"
              value={number(totals.impressions)}
              hint={totals.impressions === null ? 'The provider did not return this metric' : 'Sum over the stored posts'}
            />
            <Stat
              label="Interactions"
              value={number(totals.interactions)}
              hint="Likes, comments and shares the provider returned"
            />
            <Stat
              label="Engagement rate"
              value={totals.engagementRate === null ? '—' : `${totals.engagementRate}%`}
              hint={totals.engagementRate === null ? 'Needs both interactions and impressions' : 'Interactions per 100 impressions'}
            />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Measured posts ({posts.length})</span>
              <span className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
                <Clock3 className="w-3.5 h-3.5" aria-hidden />
                {freshness.latest?.startedAt
                  ? `Last run ${ageLabel(freshness.ageHours)}`
                  : 'No completed run recorded'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[720px]">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Post</th>
                    <th className="py-3 px-4">Published</th>
                    <th className="py-3 px-4 text-right">Impressions</th>
                    <th className="py-3 px-4 text-right">Interactions</th>
                    <th className="py-3 px-4 text-right">Shares</th>
                    <th className="py-3 px-4 text-right">Reach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {posts.map((post) => (
                    <tr key={post.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100 max-w-[22rem]">
                        <span className="line-clamp-2">{post.title}</span>
                        {post.permalink && (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[#123B60] dark:text-[#F59A16] hover:underline"
                          >
                            Open post <ExternalLink className="w-3 h-3" aria-hidden />
                          </a>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                        {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">{number(post.impressions)}</td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">{number(post.interactions)}</td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">{number(post.shares)}</td>
                      <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">{number(post.reach)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {load.rejectedRows > 0 && (
              <p className="px-4 py-3 text-[11px] text-amber-700 dark:text-amber-300 border-t border-slate-100 dark:border-slate-800">
                {load.rejectedRows} stored row(s) could not be described by this page and are not counted above. They
                remain in the database for inspection.
              </p>
            )}
          </div>
        </>
      )}

      {load?.state === 'ready' && posts.length === 0 && (
        <EmptyState
          title="No social measurement is stored"
          description="The database holds no post-level row yet. A completed sync writes them; until then there is no figure to show, and this page does not fill the gap with a screenshot or an average."
        />
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
            <Server className="w-4 h-4" aria-hidden />
          </span>
          <div className="text-xs space-y-1">
            <p className="font-bold text-slate-900 dark:text-white">Server-side configuration</p>
            <p className="text-slate-500 dark:text-slate-400">
              These are Edge Function secrets, set with <span className="font-mono text-[10px]">supabase secrets set</span>.
              A <span className="font-mono text-[10px]">VITE_</span> prefix would compile the value into the public bundle,
              so none is used.
            </p>
          </div>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          {SOCIAL_SETUP_VARIABLES.map((variable) => (
            <li
              key={variable.name}
              className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3 py-2"
            >
              <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{variable.name}</span>
              <span className="block text-slate-500 dark:text-slate-400 mt-0.5">{variable.purpose}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-400 inline-flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          A missing variable produces a blocked run row and no call to graph.facebook.com. The deployment steps are in
          <span className="font-mono text-[10px]"> supabase/README.md</span>.
        </p>
      </div>

      <details className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <summary className="px-5 py-4 cursor-pointer text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#F59A16]" aria-hidden />
          Historical record transcribed from screenshots ({HISTORICAL_SOCIAL_INSIGHTS.reportDate}) — not live
        </summary>
        <div className="px-5 pb-5 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">
          <Tone tone="amber" title="This is a historical record, not a measurement from this system">
            <p>
              The {HISTORICAL_SOCIAL_INSIGHTS.posts.length} posts and the audience brackets below were transcribed by
              hand from screenshots taken in {HISTORICAL_SOCIAL_INSIGHTS.reportDate}. They were not collected here, are
              not refreshed, and are kept apart from every live total above.
            </p>
          </Tone>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[560px]">
              <thead className="text-slate-500 font-semibold uppercase text-[10px]">
                <tr>
                  <th className="py-2 pr-4">Post title</th>
                  <th className="py-2 pr-4">Views</th>
                  <th className="py-2 pr-4">Interactions</th>
                  <th className="py-2 pr-4">Shares</th>
                  <th className="py-2 pr-4">Rate</th>
                  <th className="py-2">Stated role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {HISTORICAL_SOCIAL_INSIGHTS.posts.map((post) => (
                  <tr key={post.title}>
                    <td className="py-2 pr-4 font-bold text-slate-800 dark:text-slate-100">{post.title}</td>
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{post.views.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{post.interactions.toLocaleString()}</td>
                    <td className="py-2 pr-4 text-slate-500">{post.shares}</td>
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{post.rate}</td>
                    <td className="py-2 text-slate-500 italic">{post.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-slate-400">
            Totals as transcribed: {HISTORICAL_SOCIAL_INSIGHTS.totalViews.toLocaleString()} views and{' '}
            {HISTORICAL_SOCIAL_INSIGHTS.totalInteractions.toLocaleString()} interactions across the{' '}
            {HISTORICAL_SOCIAL_INSIGHTS.posts.length} posts. Averages such as{' '}
            {HISTORICAL_SOCIAL_INSIGHTS.avgViewsPerPost.toLocaleString()} views per post come from those same rows.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-2">Audience age brackets</h3>
              <div className="space-y-2">
                {HISTORICAL_SOCIAL_INSIGHTS.audienceDemographics.map((demo) => (
                  <div key={demo.ageRange} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {demo.ageRange} years
                        {demo.primary && <strong className="text-[#F59A16]"> (student target)</strong>}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white">{demo.percentage}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${demo.primary ? 'bg-[#F59A16]' : 'bg-[#123B60]'}`}
                        style={{ width: `${demo.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-2">
                Editorial guidance written for M&amp;C
              </h3>
              <p className="text-[10px] text-slate-400 mb-2">Opinion recorded by the chapter, not a system recommendation.</p>
              <div className="space-y-2">
                {HISTORICAL_SOCIAL_INSIGHTS.strategicRecommendations.map((rec) => (
                  <div
                    key={rec.rule}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-[11px]"
                  >
                    <div className="font-bold text-[#123B60] dark:text-[#F59A16] mb-1">{rec.rule}</div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
};

export default SocialMediaInsightsView;
