import React, { useMemo, useState } from 'react';
import { History, Search, Filter, TriangleAlert, Clock } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { AUDIT_RETENTION } from '../../domain/audit';
import { EmptyState } from '../EmptyState';

export const AuditTrailView: React.FC = () => {
  const { auditLogs } = useApp();
  const actor = useActor();
  const [searchTerm, setSearchTerm] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('all');

  const filteredLogs = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return auditLogs.filter((log) => {
      const matchesSearch =
        log.actorName.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term) ||
        log.details.toLowerCase().includes(term);
      const matchesTarget = targetTypeFilter === 'all' || log.targetType === targetTypeFilter;
      return matchesSearch && matchesTarget;
    });
  }, [auditLogs, searchTerm, targetTypeFilter]);

  const getTargetBadgeColor = (type: string) => {
    switch (type) {
      case 'user': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
      case 'committee': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
      case 'task': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
      case 'submission': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
      case 'score': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
      case 'cms': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5 text-[#F59A16]" />
            Chapter Governance & Audit Trail
          </h1>
          <p className="text-xs text-slate-500">
            Actions this application has taken with your account, newest first — {auditLogs.length}{' '}
            {auditLogs.length === 1 ? 'entry' : 'entries'} cached in this browser.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
            <TriangleAlert className="w-4 h-4" />
            Browser-cached copy, not a tamper-evident log
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
        <p className="font-bold text-slate-800 dark:text-slate-100">What this list is</p>
        <p>
          It is written by the application as operations run and cached in this browser, so it can
          under-report: an action taken in another browser, another device, or directly against the database will not
          appear here, and only the most recent {AUDIT_RETENTION} entries are kept locally. {actor ? `You are seeing it as ${actor.name} (${actor.role.replace('_', ' ')}).` : ''} The
          durable trail lives in the provider's <span className="font-mono text-[10px]">esme_audit_log</span> table; the{' '}
          <span className="font-mono text-[10px]">supabase/migrations</span> directory defines it as append-only, and until that
          provider is configured nothing can be read back from it.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search audit trail by actor, action, or details..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:ring-2 focus:ring-[#123B60] outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold outline-none text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Entity Domains</option>
            <option value="user">Users & Membership</option>
            <option value="committee">Committees</option>
            <option value="task">Tasks</option>
            <option value="submission">Submissions</option>
            <option value="score">Points & Score Ledger</option>
            <option value="cms">Website CMS</option>
            <option value="system">System & Diagnostics</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table / Feed */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <div 
                key={log.id} 
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 shadow-sm">
                    {log.actorName ? log.actorName[0] : 'S'}
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                        {log.actorName}
                      </span>
                      <span className="text-[10px] text-slate-400">({log.actorRole.replace('_', ' ')})</span>
                      <span className="text-xs text-slate-400 font-semibold">•</span>
                      <span className="text-xs font-semibold text-[#123B60] dark:text-[#F59A16]">
                        {log.action}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${getTargetBadgeColor(log.targetType)}`}>
                        {log.targetType}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">
                      {log.details}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center text-[11px] text-slate-400 font-mono shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{log.timestamp}</span>
                </div>
              </div>
            ))
          ) : auditLogs.length === 0 ? (
            <EmptyState
              title="Nothing recorded in this session yet"
              description="No operation has run with your account since this workspace opened. Entries appear as tasks, decisions and profile changes are made here."
              icon={History}
            />
          ) : (
            <div className="p-12 text-center text-slate-400 text-xs">
              {auditLogs.length} {auditLogs.length === 1 ? 'entry' : 'entries'} exist, but none match this search or
              filter.
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
