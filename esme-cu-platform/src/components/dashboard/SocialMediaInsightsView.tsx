import React from 'react';
import { 
  Share2, 
  Eye, 
  TrendingUp, 
  Users, 
  MessageSquare, 
  Sparkles, 
  CheckCircle2, 
  Lightbulb, 
  Image as ImageIcon 
} from 'lucide-react';
import { HISTORICAL_SOCIAL_INSIGHTS } from '../../data/historyData';

export const SocialMediaInsightsView: React.FC = () => {
  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Meta Insights & Social Media Analysis</h1>
          <p className="text-xs text-slate-500">
            Authoritative performance report snapshot dated <strong>October 2026</strong> from the official ESME Cairo University report.
          </p>
        </div>
        <span className="px-3 py-1 bg-[#123B60] text-white text-xs font-bold rounded-xl self-start sm:self-auto">
          Archived Evidence
        </span>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm text-center">
          <div className="text-3xl font-extrabold text-[#F59A16]">{HISTORICAL_SOCIAL_INSIGHTS.totalViews.toLocaleString()}</div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">Total Analyzed Views</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Across 4 verified posts</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm text-center">
          <div className="text-3xl font-extrabold text-[#123B60] dark:text-white">{HISTORICAL_SOCIAL_INSIGHTS.avgViewsPerPost.toLocaleString()}</div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">Average Views / Post</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Strong organic baseline</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm text-center">
          <div className="text-3xl font-extrabold text-emerald-600">{HISTORICAL_SOCIAL_INSIGHTS.totalInteractions.toLocaleString()}</div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">Total Interactions</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Clicks, shares & reactions</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm text-center">
          <div className="text-3xl font-extrabold text-purple-600">{HISTORICAL_SOCIAL_INSIGHTS.highestEngagementPost.engagementRate}</div>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-1">Peak Engagement Rate</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Recruitment Open post</div>
        </div>
      </div>

      {/* Post Snapshot Comparison Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Post-by-Post Verified Ranking</span>
          <span className="text-[11px] text-slate-400">Meta Insights screenshot audit</span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
            <tr>
              <th className="py-3 px-4">Post Title</th>
              <th className="py-3 px-4">Views</th>
              <th className="py-3 px-4">Interactions</th>
              <th className="py-3 px-4">Shares</th>
              <th className="py-3 px-4">Engagement Rate</th>
              <th className="py-3 px-4">Strategic Role in Mix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {HISTORICAL_SOCIAL_INSIGHTS.posts.map((p, idx) => (
              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">{p.title}</td>
                <td className="py-3 px-4 font-bold text-[#F59A16]">{p.views.toLocaleString()}</td>
                <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{p.interactions.toLocaleString()}</td>
                <td className="py-3 px-4 text-slate-500">{p.shares}</td>
                <td className="py-3 px-4 font-semibold text-emerald-600">{p.rate}</td>
                <td className="py-3 px-4 text-slate-500 italic">{p.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Demographics & Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Audience Age Bracket */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Audience Age Demographics</h2>
          <p className="text-[11px] text-slate-400 mb-4">Confirmed audience distribution from Meta Insights</p>
          <div className="space-y-3">
            {HISTORICAL_SOCIAL_INSIGHTS.audienceDemographics.map((demo) => (
              <div key={demo.ageRange} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {demo.ageRange} Years {demo.primary && <strong className="text-[#F59A16]">(Core Student Target)</strong>}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">{demo.percentage}%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${demo.primary ? 'bg-[#F59A16]' : 'bg-[#123B60]'}`}
                    style={{ width: `${demo.percentage}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content Strategy Rules */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Recommended Content Direction for M&C Committee</h2>
          <div className="space-y-3">
            {HISTORICAL_SOCIAL_INSIGHTS.strategicRecommendations.map((rec, idx) => (
              <div key={idx} className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs">
                <div className="font-bold text-[#123B60] dark:text-[#F59A16] mb-1">{rec.rule}</div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{rec.detail}</p>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};
