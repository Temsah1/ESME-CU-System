import React from 'react';
import {
  Users,
  Layers,
  CheckSquare,
  FileCheck2,
  AlertTriangle,
  Award,
  Target,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  Plus,
  PencilLine,
  type LucideIcon,
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { leaderAccounts } from '../../domain/committees';
import { seasonCovering, seasonsInOrder } from '../../domain/seasons';
import type { DashboardView } from './DashboardShell';
import { Button, Card, StatTile, StatusBadge, type StatTone } from '../ui';

interface SuperAdminOverviewProps {
  onNavigate: (view: DashboardView) => void;
}

const count = (n: number) => Math.round(n).toLocaleString();

/** The panel heading every block on this page opens with: a name, what it counts, and one way out. */
const PanelHead: React.FC<{
  title: string;
  caption: string;
  action?: { label: string; onClick: () => void };
}> = ({ title, caption, action }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
    <div className="min-w-0">
      <h2 className="text-label font-bold text-ink-strong">{title}</h2>
      <p className="text-micro text-ink-subtle mt-1">{caption}</p>
    </div>
    {action ? (
      <button
        type="button"
        onClick={action.onClick}
        className="shrink-0 inline-flex items-center gap-1 rounded-control text-caption font-bold text-ink-accent hover:underline underline-offset-4"
      >
        {action.label}
        <ChevronRight className="w-4 h-4" aria-hidden />
      </button>
    ) : null}
  </div>
);

const EmptyBlock: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-micro text-ink-subtle rounded-card border border-dashed border-border-strong px-4 py-6 text-center leading-relaxed">
    {children}
  </p>
);

export const SuperAdminOverview: React.FC<SuperAdminOverviewProps> = ({ onNavigate }) => {
  const {
    users,
    committees,
    tasks,
    submissions,
    seasonEvents,
    scoreLedger,
    auditLogs,
    seasons,
    can
  } = useApp();
  const currentUser = useActor();

  // The clock is read once when the page opens: a figure that moves while somebody watches it
  // is not a measurement, and reading it during render would shift every count below.
  const [clock] = React.useState(() => {
    const at = new Date();
    return { ms: at.getTime(), iso: at.toISOString().slice(0, 10), hour: at.getHours() };
  });

  // Dynamic calculations from initialized state
  const totalMembers = users.length;
  const activeCommittees = committees.filter(c => c.status === 'active').length;
  const activeTasks = tasks.filter(t => !t.archivedAt && (t.status === 'assigned' || t.status === 'in_progress')).length;
  const pendingSubmissions = submissions.filter(s => s.status === 'submitted' || s.status === 'under_review').length;
  const overdueTasks = tasks.filter(t => !t.archivedAt && (t.status === 'overdue' || (Date.parse(t.deadline) < clock.ms && t.status !== 'approved'))).length;
  const totalPointsDistributed = scoreLedger.reduce((acc, curr) => acc + curr.points, 0);

  // Season KPI completion calculation. The planner starts with nothing written in it, so an
  // empty plan reports "—" rather than a 0% that looks like a season that went nowhere.
  const totalSeasonDeliverables = seasonEvents.length;
  const completedDeliverables = seasonEvents.filter(e => e.status === 'Completed').length;
  const seasonProgressPct = totalSeasonDeliverables === 0
    ? null
    : Math.round((completedDeliverables / totalSeasonDeliverables) * 100);

  const orderedSeasons = seasonsInOrder(seasons);
  const activeSeason = seasonCovering(orderedSeasons, clock.iso)
    ?? orderedSeasons.find(s => s.status === 'active');

  const greeting = clock.hour < 12 ? 'Good morning' : clock.hour < 18 ? 'Good afternoon' : 'Good evening';

  const rosterSizeFor = (committeeId: string) => users.filter(u => u.committeeId === committeeId).length;

  const kpiCards: {
    label: string;
    /** null draws an em dash: the records the figure needs do not exist yet. */
    value: number | null;
    format?: (n: number) => string;
    subtitle: React.ReactNode;
    icon: LucideIcon;
    tone: StatTone;
    actionView: DashboardView;
    capability?: Parameters<typeof can>[0];
  }[] = [
    {
      label: 'Total Chapter Members',
      capability: 'users.read',
      value: totalMembers,
      subtitle: `${users.filter(u => u.status === 'active').length} active in rosters`,
      icon: Users,
      tone: 'brand',
      actionView: 'members'
    },
    {
      label: 'Active Committees',
      value: activeCommittees,
      subtitle: committees.filter(c => c.status === 'active').map(c => c.shortCode).join(', ') || 'No active committees',
      icon: Layers,
      tone: 'accent',
      actionView: 'committees'
    },
    {
      label: 'Active Tasks',
      capability: 'tasks.read',
      value: activeTasks,
      subtitle: `${tasks.length} total season tasks`,
      icon: CheckSquare,
      tone: 'info',
      actionView: 'tasks'
    },
    {
      label: 'Pending Submissions',
      capability: 'submissions.read',
      value: pendingSubmissions,
      subtitle: 'Filed as submitted or under review',
      icon: FileCheck2,
      tone: 'warning',
      actionView: 'submissions'
    },
    {
      label: 'Overdue / Flagged',
      capability: 'tasks.read',
      value: overdueTasks,
      subtitle: 'Past their deadline and not yet approved',
      icon: AlertTriangle,
      tone: 'danger',
      actionView: 'tasks'
    },
    {
      label: 'Points Recorded',
      value: totalPointsDistributed,
      capability: 'scores.read',
      subtitle: `${scoreLedger.length} ledger entries`,
      icon: Award,
      tone: 'violet',
      actionView: 'scoring'
    },
    {
      label: activeSeason ? `Season ${activeSeason.label} progress` : 'Season progress',
      value: seasonProgressPct,
      format: (n) => `${Math.round(n)}%`,
      subtitle: totalSeasonDeliverables === 0
        ? 'No milestone is written in the season planner yet'
        : `${completedDeliverables} of ${totalSeasonDeliverables} milestones completed`,
      icon: Target,
      tone: 'success',
      actionView: 'season_planner'
    }
  ];

  const visibleKpiCards = kpiCards.filter((card) => card.capability === undefined || can(card.capability));

  return (
    <div className="space-y-6">

      <header className="bg-gradient-to-r from-brand via-navy-mid to-brand-ink rounded-sheet p-6 text-white shadow-raised border border-white/10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-white/10 text-accent text-micro font-bold uppercase tracking-wider border border-white/20">
              <Sparkles className="w-4 h-4" aria-hidden />
              <span>
                {activeSeason ? `Season ${activeSeason.label} command center` : 'Chapter command center'}
              </span>
            </div>
            <h1 className="text-title sm:text-headline font-extrabold tracking-tight">
              {greeting}, {currentUser.name}
            </h1>
            <p className="text-caption sm:text-label text-slate-200 max-w-2xl leading-relaxed">
              Chapter-wide totals for the accounts, committees, tasks and ledger rows this session can read. Every
              figure is counted from the records in this workspace; none is projected or fetched from elsewhere.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {can('tasks.write') && (
              <Button
                size="sm"
                onClick={() => onNavigate('tasks')}
                className="focus-visible:ring-offset-brand"
              >
                <Plus className="w-4 h-4" aria-hidden />
                Create Task
              </Button>
            )}
            {can('submissions.review') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate('submissions')}
                className="bg-white/10 text-white border-white/25 hover:bg-white/20 hover:border-white/40 focus-visible:ring-offset-brand"
              >
                <FileCheck2 className="w-4 h-4" aria-hidden />
                Review Submissions
              </Button>
            )}
            {can('cms.content.write') && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate('website_cms')}
                className="bg-white/10 text-white border-white/25 hover:bg-white/20 hover:border-white/40 focus-visible:ring-offset-brand"
              >
                <PencilLine className="w-4 h-4" aria-hidden />
                Edit Website
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {visibleKpiCards.map((card) => (
          <StatTile
            key={card.label}
            label={card.label}
            value={card.value === null ? '—' : (card.format ?? count)(card.value)}
            hint={card.subtitle}
            icon={card.icon}
            tone={card.tone}
            onClick={() => onNavigate(card.actionView)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        <Card as="section" ariaLabel="Active submission queue" className="lg:col-span-7 p-4 sm:p-6">
          <PanelHead
            title="Active Submission Queue"
            caption="Filed work waiting on a review decision and the score that follows it"
            action={{ label: `View all (${submissions.length})`, onClick: () => onNavigate('submissions') }}
          />

          {submissions.length === 0 && (
            <EmptyBlock>
              Nothing is waiting for review. Submissions appear here as soon as members file work against a task.
            </EmptyBlock>
          )}
          <ul className="space-y-2">
            {submissions.slice(0, 4).map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  onClick={() => onNavigate('submissions')}
                  className="w-full text-left p-3 rounded-card border border-border-subtle bg-surface-muted hover:bg-tint-hover hover:border-border-strong transition-colors duration-micro ease-smooth motion-reduce:transition-none flex items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block font-bold text-caption text-ink truncate">{sub.taskTitle}</span>
                    <span className="block text-micro text-ink-subtle mt-1 truncate">
                      {sub.memberName} · {sub.committeeName} ·{' '}
                      <span className="text-ink-accent font-bold font-numbers">{sub.proposedPoints} pts</span>
                    </span>
                  </span>
                  <span className="shrink-0 flex items-center gap-2">
                    <StatusBadge status={sub.status} />
                    <ArrowUpRight className="w-4 h-4 text-ink-faint" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card as="section" ariaLabel="Committee rosters" className="lg:col-span-5 p-4 sm:p-6">
          <PanelHead
            title="Committee Rosters"
            caption={`${committees.length} committee${committees.length === 1 ? '' : 's'} in the organizational structure`}
            action={{ label: 'Manage', onClick: () => onNavigate('committees') }}
          />

          {committees.length === 0 && <EmptyBlock>No committees are defined yet.</EmptyBlock>}
          <ul className="space-y-2">
            {committees.map((comm) => (
              <li key={comm.id}>
                <button
                  type="button"
                  onClick={() => onNavigate('committees')}
                  className="w-full text-left p-3 rounded-card border border-border-subtle hover:bg-tint-hover hover:border-border-strong transition-colors duration-micro ease-smooth motion-reduce:transition-none flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-8 h-8 shrink-0 rounded-control bg-brand text-white flex items-center justify-center font-bold text-micro">
                      {comm.shortCode}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-caption text-ink truncate">{comm.name}</span>
                      <span className="block text-micro text-ink-subtle mt-1 truncate">
                        {(() => {
                          const holders = leaderAccounts(comm, 'director', users);
                          if (holders.length === 0) return 'No Director assigned';
                          const names = holders.map(({ account }) => account?.name ?? 'unresolved account').slice(0, 2).join(', ');
                          return `${holders.length} Director${holders.length === 1 ? '' : 's'}: ${names}${holders.length > 2 ? ` +${holders.length - 2}` : ''}`;
                        })()}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 flex flex-col items-end gap-1">
                    <span className="font-bold text-caption text-ink font-numbers">
                      {rosterSizeFor(comm.id)} member{rosterSizeFor(comm.id) === 1 ? '' : 's'}
                    </span>
                    <StatusBadge status={comm.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

      </div>

      <Card as="section" ariaLabel="Recent organization activity" className="p-4 sm:p-6">
        <PanelHead
          title="Recent Organization Activity"
          caption="Append-only record of the privileged changes made in this workspace"
          action={can('audit.read') ? { label: 'Full Audit Log', onClick: () => onNavigate('audit_log') } : undefined}
        />

        {auditLogs.length === 0 && (
          <EmptyBlock>
            No administrative actions recorded in this workspace yet. Every privileged change made here will appear as
            an append-only entry.
          </EmptyBlock>
        )}
        <ul className="divide-y divide-border-subtle">
          {auditLogs.slice(0, 5).map((log) => (
            <li key={log.id} className="py-3 flex items-start justify-between gap-4">
              <span className="flex items-start gap-3 min-w-0">
                <span
                  aria-hidden
                  className="w-8 h-8 shrink-0 rounded-full bg-tint-brand flex items-center justify-center text-ink-brand font-bold text-caption"
                >
                  {log.actorName[0]}
                </span>
                <span className="min-w-0">
                  <span className="block text-caption text-ink">
                    <strong className="font-bold">{log.actorName}</strong> {log.action}
                  </span>
                  <span className="block text-micro text-ink-muted mt-1">{log.details}</span>
                </span>
              </span>
              <span className="text-micro text-ink-subtle shrink-0 font-numbers">{log.timestamp}</span>
            </li>
          ))}
        </ul>
      </Card>

    </div>
  );
};