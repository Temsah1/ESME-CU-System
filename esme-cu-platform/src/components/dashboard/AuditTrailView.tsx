import React, { useMemo, useState } from 'react';
import { History, Search, Filter, TriangleAlert, Clock, Ban } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { AUDIT_RETENTION } from '../../domain/audit';
import { EmptyState } from '../EmptyState';
import { Card, StatusBadge } from '../ui';

/* Entity type is a category, not a status, so every domain shares one quiet chip and the colour
 * budget stays on the thing an officer actually scans for: whether the action ran or was refused. */
const entityChip =
  'px-2 py-1 rounded-pill text-micro font-bold uppercase tracking-wider bg-surface-muted text-ink-muted border border-border-strong';
const fieldClass =
  'px-3 py-2 bg-surface border border-border rounded-control text-caption font-semibold outline-none text-ink focus-visible:ring-2 focus-visible:ring-focus';

export const AuditTrailView: React.FC = () => {
  const { auditLogs } = useApp();
  const actor = useActor();
  const [searchTerm, setSearchTerm] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const filteredLogs = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return auditLogs.filter((log) => {
      const matchesSearch =
        log.actorName.toLowerCase().includes(term) ||
        log.actorId.toLowerCase().includes(term) ||
        log.targetId.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term) ||
        log.details.toLowerCase().includes(term);
      const matchesTarget = targetTypeFilter === 'all' || log.targetType === targetTypeFilter;
      // Older rows carry no outcome, so "executed" means "not explicitly refused".
      const matchesOutcome =
        outcomeFilter === 'all' || (outcomeFilter === 'denied' ? log.outcome === 'denied' : log.outcome !== 'denied');
      return matchesSearch && matchesTarget && matchesOutcome;
    });
  }, [auditLogs, searchTerm, targetTypeFilter, outcomeFilter]);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-title font-black text-ink-strong flex items-center gap-2">
            <History className="w-5 h-5 text-ink-accent" aria-hidden />
            Chapter Governance & Audit Trail
          </h1>
          <p className="mt-1 text-caption text-ink-muted">
            Actions this application has taken with your account, newest first — {auditLogs.length}{' '}
            {auditLogs.length === 1 ? 'entry' : 'entries'} cached in this browser, of which{' '}
            {auditLogs.filter((log) => log.outcome === 'denied').length} refused attempts are kept alongside the
            changes that ran.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="px-3 py-2 bg-surface-muted text-ink-muted text-caption font-bold rounded-control border border-border flex items-center gap-2">
            <TriangleAlert className="w-4 h-4" aria-hidden />
            Browser-cached copy, not a tamper-evident log
          </span>
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface-muted p-4 text-caption text-ink-muted space-y-2">
        <p className="font-bold text-ink-strong">What this list is</p>
        <p>
          It is written by the application as operations run and cached in this browser, so it can
          under-report: an action taken in another browser, another device, or directly against the database will not
          appear here, and only the most recent {AUDIT_RETENTION} entries are kept locally. {actor ? `You are seeing it as ${actor.name} (${actor.role.replace('_', ' ')}).` : ''} The
          durable trail lives in the provider's <span className="font-mono text-micro">esme_audit_log</span> table; the{' '}
          <span className="font-mono text-micro">supabase/migrations</span> directory defines it as append-only, and until that
          provider is configured nothing can be read back from it.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-ink-subtle absolute left-3 top-2.5" aria-hidden />
          <input
            type="text"
            placeholder="Search audit trail by actor, action, or details..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pl-9 ${fieldClass}`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-ink-subtle" aria-hidden />
          <select
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            className={fieldClass}
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
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            aria-label="Filter by outcome"
            className={fieldClass}
          >
            <option value="all">Executed and refused</option>
            <option value="denied">Refused attempts only</option>
            <option value="allowed">Executed only</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table / Feed */}
      <Card className="overflow-hidden">
        <div className="divide-y divide-border-subtle">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors duration-micro ${
                  log.outcome === 'denied'
                    ? 'bg-danger/10 border-l-2 border-l-danger'
                    : 'hover:bg-tint-hover'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-bold text-caption shrink-0 mt-0.5">
                    {log.actorName ? log.actorName[0] : 'S'}
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-label text-ink-strong">
                        {log.actorName}
                      </span>
                      <span className="text-micro text-ink-subtle">({log.actorRole.replace('_', ' ')})</span>
                      <span className="text-caption text-ink-faint font-semibold" aria-hidden>•</span>
                      <span className="text-caption font-semibold text-ink-brand">
                        {log.action}
                      </span>
                      <span className={entityChip}>
                        {log.targetType}
                      </span>
                      {log.outcome === 'denied' && (
                        <StatusBadge status="refused">
                          <Ban className="w-3 h-3" aria-hidden />
                          Refused
                        </StatusBadge>
                      )}
                      {log.previousRole && log.newRole && (
                        <span className="text-micro px-2 py-1 rounded-pill font-mono font-semibold bg-surface-muted text-ink-muted">
                          {log.previousRole.replace('_', ' ')} → {log.newRole.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-caption text-ink-muted">
                      {log.details}
                    </div>
                    <div className="text-micro text-ink-subtle font-mono">
                      actor {log.actorId} · target {log.targetId}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center text-micro text-ink-subtle font-mono shrink-0">
                  <Clock className="w-3.5 h-3.5" aria-hidden />
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
            <div className="p-12 text-center text-ink-subtle text-caption">
              {auditLogs.length} {auditLogs.length === 1 ? 'entry' : 'entries'} exist, but none match this search or
              filter.
            </div>
          )}
        </div>
      </Card>

    </div>
  );
};
