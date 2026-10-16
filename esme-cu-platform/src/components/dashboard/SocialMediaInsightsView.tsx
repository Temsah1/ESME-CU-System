import React from 'react';
import { PlugZap, TriangleAlert, BarChart3 } from 'lucide-react';
import { HISTORICAL_SOCIAL_INSIGHTS } from '../../data/historyData';
import { useApp } from '../../context/AppContext';
import { EmptyState } from '../EmptyState';

/**
 * No analytics provider is connected to this application, so this page cannot report a
 * live measurement. What it can show honestly is the chapter's own transcribed record —
 * labelled as a record, with the numbers it actually contains and no claim of
 * verification, refresh or automation.
 */
export const SocialMediaInsightsView: React.FC = () => {
  const { can } = useApp();
  const report = HISTORICAL_SOCIAL_INSIGHTS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Social Media Analysis</h1>
        <p className="text-xs text-slate-500">
          The chapter's recorded outreach report, kept separate from the operational database.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 flex items-start gap-3">
        <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
        <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <p className="font-bold">No analytics integration is connected</p>
          <p>
            Nothing in this application calls the Meta Graph API or any other platform endpoint. Every figure below was
            transcribed by hand from screenshots taken in {report.reportDate} and stored as static content in
            <span className="font-mono text-[10px]"> src/data/historyData.ts</span>. It is not refreshed, not
            independently confirmed, and not derived from data this system collected.
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="inline-flex p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500">
            <PlugZap className="w-4 h-4" aria-hidden />
          </span>
          <div className="text-xs space-y-1.5">
            <p className="font-bold text-slate-900 dark:text-white">What a connected integration would replace</p>
            <p className="text-slate-600 dark:text-slate-300">
              A live connection needs a platform app, a page token held by the provider, and a server-side job that
              writes rows the workspace can read. Until that exists, this page will keep showing one frozen record
              rather than numbers that look current.
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              {can('integrations.manage')
                ? 'Your role holds the integrations capability: connecting a provider happens outside this interface, in the deployment configuration.'
                : 'Connecting a provider is an integration capability held by a Super Administrator; this page is read-only for your role.'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
            Recorded posts ({report.posts.length})
          </span>
          <span className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" aria-hidden />
            Transcribed {report.reportDate}
          </span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
            <tr>
              <th className="py-3 px-4">Post title</th>
              <th className="py-3 px-4">Views</th>
              <th className="py-3 px-4">Interactions</th>
              <th className="py-3 px-4">Shares</th>
              <th className="py-3 px-4">Rate</th>
              <th className="py-3 px-4">Stated role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {report.posts.map((p) => (
              <tr key={p.title} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">{p.title}</td>
                <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{p.views.toLocaleString()}</td>
                <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{p.interactions.toLocaleString()}</td>
                <td className="py-3 px-4 text-slate-500">{p.shares}</td>
                <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{p.rate}</td>
                <td className="py-3 px-4 text-slate-500 italic">{p.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800">
          Totals: {report.totalViews.toLocaleString()} views and {report.totalInteractions.toLocaleString()} interactions
          across the {report.posts.length} posts listed. Averages such as {report.avgViewsPerPost.toLocaleString()} views
          per post come from these same four rows — a sample too small to describe the chapter's reach.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Audience age brackets</h2>
          <p className="text-[11px] text-slate-400 mb-4">Share of the audience recorded for the same four posts.</p>
          <div className="space-y-3">
            {report.audienceDemographics.map((demo) => (
              <div key={demo.ageRange} className="space-y-1">
                <div className="flex justify-between text-xs">
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

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            Editorial direction written for the M&amp;C committee
          </h2>
          <p className="text-[11px] text-slate-400 -mt-2">
            Written by the chapter as guidance. It is opinion, not a system-generated recommendation.
          </p>
          <div className="space-y-3">
            {report.strategicRecommendations.map((rec) => (
              <div key={rec.rule} className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs">
                <div className="font-bold text-[#123B60] dark:text-[#F59A16] mb-1">{rec.rule}</div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Records owned by this workspace</h2>
        <EmptyState
          title="No social posts stored by the application"
          description="The database has no posts, campaigns or insight rows. Content published through the website CMS is saved as site copy; it is never counted, ranked or reported as performance."
        />
      </div>
    </div>
  );
};

export default SocialMediaInsightsView;
