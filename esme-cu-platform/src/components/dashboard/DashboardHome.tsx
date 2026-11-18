import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Award,
  CalendarClock,
  CheckSquare,
  ChevronRight,
  FileCheck2,
  Inbox,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useActor, useApp } from '../../context/AppContext';
import type { ActionItem } from '../../domain/actions';
import { leadershipPostsOf, POSITION_LABELS, rosterOf } from '../../domain/committees';
import { activeWarningsOf, bonusPointsOf } from '../../domain/rewards';
import { ROLE_LABELS, scopeFor } from '../../domain/roles';
import { Card, CommandBanner, StatTile, StatusBadge, type StatTone } from '../ui';
import { SuperAdminOverview } from './SuperAdminOverview';
import type { DashboardView } from './DashboardShell';
import type { User } from '../../types';

interface DashboardHomeProps {
  onNavigate: (view: DashboardView) => void;
}

type Stat = {
  label: string;
  /** null is not zero: it means the records needed for the figure do not exist for this account. */
  value: number | null;
  format?: (n: number) => string;
  hint: string;
  icon: LucideIcon;
  view: DashboardView;
  tone: StatTone;
};

const count = (n: number) => Math.round(n).toLocaleString();

const StatCard: React.FC<{ stat: Stat; onNavigate: (view: DashboardView) => void }> = ({ stat, onNavigate }) => (
  <StatTile
    label={stat.label}
    value={stat.value === null ? '—' : (stat.format ?? count)(stat.value)}
    hint={stat.hint}
    icon={stat.icon}
    tone={stat.tone}
    onClick={() => onNavigate(stat.view)}
  />
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-card border border-border bg-surface-muted p-4 text-caption text-ink-muted leading-relaxed">
    {children}
  </p>
);

const Panel: React.FC<{ title: string; caption?: string; children: React.ReactNode }> = ({
  title,
  caption,
  children,
}) => (
  <Card as="section" ariaLabel={title} className="p-4 sm:p-6">
    <div className="mb-4">
      <h2 className="text-label font-bold text-ink-strong">{title}</h2>
      {caption && <p className="text-micro text-ink-subtle mt-1">{caption}</p>}
    </div>
    {children}
  </Card>
);

const greeting = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

/**
 * The clock is read once when the home screen opens. A deadline that shifts while somebody is
 * looking at it is not a measurement, and reading it during render would make every figure on
 * the page move on unrelated re-renders.
 */
const useOpenClock = () => {
  const [clock] = React.useState(() => ({ ms: Date.now(), hour: new Date().getHours() }));
  return clock;
};

/** The two facts people confuse: what rank the account holds, and which seat it was assigned. */
const RoleAndSeat: React.FC<{ actor: User }> = ({ actor }) => {
  const { committees } = useApp();
  const posts = leadershipPostsOf(actor.id, committees);
  return (
    <div className="flex flex-wrap items-center gap-2 text-micro">
      <span className="px-3 py-1 rounded-pill bg-white/15 border border-white/25 font-bold">
        Account role: {ROLE_LABELS[actor.role]}
      </span>
      {posts.length === 0 ? (
        <span className="px-3 py-1 rounded-pill bg-white/10 border border-white/20 text-slate-100">
          No committee seat assigned
        </span>
      ) : (
        posts.map(({ committee, position }) => (
          <span
            key={`${committee.id}-${position}`}
            className="px-3 py-1 rounded-pill bg-accent text-brand-ink font-bold"
          >
            {POSITION_LABELS[position]} · {committee.name}
          </span>
        ))
      )}
    </div>
  );
};

const QueuePanel: React.FC<{ items: ActionItem[]; caption: string; onNavigate: (view: DashboardView) => void }> = ({
  items,
  caption,
  onNavigate,
}) => (
  <Panel title="Waiting on you" caption={caption}>
    {items.length === 0 ? (
      <Note>
        Nothing is outstanding for this account right now. The queue is rebuilt from task, submission, application and
        milestone records every time it is read, so an empty list means no record names you — not that the workspace
        has no work in it.
      </Note>
    ) : (
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onNavigate(item.view)}
              className="w-full text-left p-3 rounded-card border border-border-subtle bg-surface-muted hover:bg-tint-hover hover:border-border-strong transition-colors duration-micro ease-smooth motion-reduce:transition-none flex items-center justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block font-bold text-caption text-ink truncate">{item.title}</span>
                <span className="block text-micro text-ink-subtle mt-1 truncate">
                  {item.kind} · {item.detail}
                </span>
              </span>
              <span className="shrink-0 text-micro font-bold uppercase tracking-wider text-right text-ink-muted font-numbers">
                {item.dueInDays === null
                  ? 'no date'
                  : item.dueInDays < 0
                    ? `${Math.abs(item.dueInDays)}d late`
                    : `${item.dueInDays}d left`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
    <div className="mt-4 flex justify-end">
      <button
        type="button"
        onClick={() => onNavigate('action_center')}
        className="text-caption text-ink-accent font-bold hover:underline underline-offset-4 flex items-center gap-1 rounded-control"
      >
        Open Action Center
        <ChevronRight className="w-4 h-4" aria-hidden />
      </button>
    </div>
  </Panel>
);

const StatGrid: React.FC<{ stats: Stat[]; onNavigate: (view: DashboardView) => void }> = ({ stats, onNavigate }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
    {stats.map((stat) => (
      <StatCard key={stat.label} stat={stat} onNavigate={onNavigate} />
    ))}
  </div>
);

/** The banner both scoped homes open on: one greeting, one statement of what the figures count. */
const HomeBanner: React.FC<{
  eyebrow: string;
  name: string;
  hour: number;
  children: React.ReactNode;
  actor: User;
}> = ({ eyebrow, name, hour, children, actor }) => (
  <CommandBanner>
    <div className="space-y-3">
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-white/10 text-accent text-micro font-bold uppercase tracking-wider border border-white/20">
        {eyebrow}
      </span>
      <h1 className="text-title sm:text-headline font-extrabold tracking-tight">
        {greeting(hour)}, {name}
      </h1>
      <p className="text-caption sm:text-label text-slate-200 max-w-2xl leading-relaxed">{children}</p>
      <RoleAndSeat actor={actor} />
    </div>
  </CommandBanner>
);

/** Leadership whose read scope reaches a whole committee — Directors and Team Heads. */
const CommitteeHome: React.FC<{ actor: User; onNavigate: (view: DashboardView) => void }> = ({ actor, onNavigate }) => {
  const { committees, users, tasks, submissions, scoreLedger, rewardEntries, actionQueue, can } = useApp();
  const clock = useOpenClock();
  const queue = useMemo(() => actionQueue().slice(0, 6), [actionQueue]);
  const committee = committees.find((c) => c.id === actor.committeeId);
  const roster = useMemo(() => (committee ? rosterOf(committee.id, users) : []), [committee, users]);
  const rosterIds = useMemo(() => new Set(roster.map((m) => m.id)), [roster]);

  const committeeTasks = tasks.filter((t) => t.committeeId === committee?.id && !t.archivedAt);
  const openTasks = committeeTasks.filter((t) => t.status === 'assigned' || t.status === 'in_progress');
  const lateTasks = committeeTasks.filter(
    (t) => t.status === 'overdue' || (t.status !== 'approved' && Date.parse(t.deadline) < clock.ms)
  );
  const awaitingReview = submissions.filter(
    (s) => s.committeeId === committee?.id && (s.status === 'submitted' || s.status === 'under_review')
  );
  const ledgerForRoster = scoreLedger.filter((l) => rosterIds.has(l.memberId));
  const pointsRecorded = ledgerForRoster.reduce((sum, l) => sum + l.points, 0);
  const openWarnings = rewardEntries.filter(
    (e) => e.committeeId === committee?.id && e.kind === 'warning' && e.status === 'active'
  );

  const mayReadRewards = can('rewards.read', { committeeId: actor.committeeId });
  const mayReadScores = can('scores.read', { committeeId: actor.committeeId });

  const stats: Stat[] = [
    {
      label: 'Committee roster',
      value: committee ? roster.length : null,
      hint: committee ? `${roster.filter((m) => m.status === 'active').length} active account(s) filed under ${committee.shortCode}` : 'This account holds no committee',
      icon: Users,
      view: 'members',
      tone: 'brand',
    },
    {
      label: 'Open tasks',
      value: committee ? openTasks.length : null,
      hint: `${committeeTasks.length} task(s) written for this committee`,
      icon: CheckSquare,
      view: 'tasks',
      tone: 'info',
    },
    {
      label: 'Awaiting your review',
      value: committee ? awaitingReview.length : null,
      hint: 'Submissions filed as submitted or under review',
      icon: FileCheck2,
      view: 'submissions',
      tone: 'warning',
    },
    {
      label: 'Past their deadline',
      value: committee ? lateTasks.length : null,
      hint: `${openTasks.length} still open while ${lateTasks.length} run past their date`,
      icon: AlertTriangle,
      view: 'tasks',
      tone: 'danger',
    },
  ];

  if (mayReadScores) {
    stats.push({
      label: 'Points recorded',
      value: committee ? pointsRecorded : null,
      hint: `${ledgerForRoster.length} ledger entry(ies) for this roster`,
      icon: Award,
      view: 'scoring',
      tone: 'violet',
    });
  }
  if (mayReadRewards) {
    stats.push({
      label: 'Active warnings',
      value: committee ? openWarnings.length : null,
      hint: 'Entries nobody has reversed; bonuses are counted in the ledger',
      icon: ShieldAlert,
      view: 'rewards',
      tone: 'danger',
    });
  }

  return (
    <div className="space-y-6">
      <HomeBanner eyebrow="Committee command" name={actor.name} hour={clock.hour} actor={actor}>
        {committee
          ? `${committee.name} (${committee.shortCode}): every figure below counts records filed under this committee. Anything outside it is not shown here because your read scope stops at the committee line.`
          : 'Your account is not filed under a committee, so there is no committee scope to report. Ask an officer to place the account; until then only records that name you personally are reachable.'}
      </HomeBanner>

      <StatGrid stats={stats} onNavigate={onNavigate} />
      <QueuePanel
        items={queue}
        onNavigate={onNavigate}
        caption="Committee work that names you, rebuilt from the records each time this page opens."
      />
    </div>
  );
};

/** A member's own standing: their work, their scores, their bonus and warning history. */
const MemberHome: React.FC<{ actor: User; onNavigate: (view: DashboardView) => void }> = ({ actor, onNavigate }) => {
  const {
    committees,
    tasks,
    submissions,
    scoreLedger,
    rewardEntries,
    notifications,
    actionQueue,
    can,
  } = useApp();
  const queue = useMemo(() => actionQueue().slice(0, 6), [actionQueue]);
  const clock = useOpenClock();
  const committee = committees.find((c) => c.id === actor.committeeId);

  const myTasks = tasks.filter((t) => t.assigneeIds.includes(actor.id) && !t.archivedAt);
  const openMyTasks = myTasks.filter((t) => t.status === 'assigned' || t.status === 'in_progress');
  const lateMyTasks = openMyTasks.filter((t) => Date.parse(t.deadline) < clock.ms);
  const mine = submissions.filter((s) => s.memberId === actor.id);
  const awaitingMine = mine.filter((s) => s.status === 'submitted' || s.status === 'under_review');
  const revisions = mine.filter((s) => s.status === 'revision_requested');
  const myLedger = scoreLedger.filter((l) => l.memberId === actor.id);
  const pointsMine = myLedger.reduce((sum, l) => sum + l.points, 0);
  const bonuses = bonusPointsOf(rewardEntries, actor.id);
  const warnings = activeWarningsOf(rewardEntries, actor.id);
  const unread = notifications.filter((n) => !n.read).length;

  const stats: Stat[] = [
    {
      label: 'Points in the ledger',
      value: myLedger.length === 0 ? null : pointsMine,
      hint:
        myLedger.length === 0
          ? 'No score entry names you yet'
          : `${myLedger.length} entry(ies) recorded against your account`,
      icon: Award,
      view: 'scoring',
      tone: 'violet',
    },
    {
      label: 'Tasks assigned to you',
      value: openMyTasks.length,
      format: (n) => `${n}`,
      hint: `${myTasks.length} in total, ${lateMyTasks.length} past their deadline`,
      icon: CheckSquare,
      view: 'tasks',
      tone: 'info',
    },
    {
      label: 'Work awaiting a decision',
      value: awaitingMine.length,
      hint: revisions.length === 0 ? `${mine.length} submission(s) filed by you` : `${revisions.length} sent back for revision`,
      icon: FileCheck2,
      view: 'submissions',
      tone: 'warning',
    },
    {
      label: 'Unread alerts',
      value: unread,
      hint: 'Raised in this browser by the notification sweep',
      icon: Inbox,
      view: 'notifications',
      tone: 'brand',
    },
  ];

  const nextUp = [...openMyTasks]
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <HomeBanner eyebrow="My standing" name={actor.name} hour={clock.hour} actor={actor}>
        {committee ? `${committee.name}: ${committee.description || 'no committee description recorded'}. ` : ''}
        This page lists only records that name you: your own scores, tasks and submissions. Chapter and committee
        totals are outside your read scope, so they are not hidden here — they are simply not returned to you.
      </HomeBanner>

      <StatGrid stats={stats} onNavigate={onNavigate} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <Panel title="Your next deadlines" caption="Open tasks assigned to you, soonest first.">
          {nextUp.length === 0 ? (
            <Note>
              No task is currently assigned to you. A Head or Director assigns work from the Tasks screen, and it
              appears here as soon as one names your account.
            </Note>
          ) : (
            <ul className="space-y-2">
              {nextUp.map((task) => {
                const days = Math.floor((Date.parse(task.deadline) - clock.ms) / 86400000);
                return (
                  <li
                    key={task.id}
                    className="p-3 rounded-card border border-border-subtle bg-surface-muted flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold text-caption text-ink truncate">{task.title}</span>
                      <span className="block text-micro text-ink-subtle mt-1 truncate">
                        {task.committeeName} · {task.points} pts
                      </span>
                    </span>
                    <span className="shrink-0 flex flex-col items-end gap-1">
                      <StatusBadge status={task.status} />
                      <span className="flex items-center gap-1 text-micro font-bold uppercase tracking-wider text-ink-muted font-numbers">
                        <CalendarClock
                          aria-hidden
                          className={`w-4 h-4 shrink-0 ${days < 0 ? 'text-danger' : days <= 2 ? 'text-ink-accent' : 'text-ink-faint'}`}
                        />
                        {days < 0 ? `${Math.abs(days)}d late` : `${days}d left`}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          </Panel>
        </div>

        <div className="lg:col-span-5">
        <Panel
          title="Bonuses and warnings on your record"
          caption={
            can('rewards.read', { id: actor.id })
              ? 'Read from the ledger through your self scope.'
              : 'rewards.read is not granted to this account.'
          }
        >
          {rewardEntries.filter((e) => e.targetId === actor.id).length === 0 ? (
            <Note>
              Nothing has been recorded for you in the bonus and warning ledger. An empty record is not a clean
              record — it means no officer has written an entry naming your account in this workspace.
            </Note>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-micro font-bold">
                <span className="px-2 py-1 rounded-pill border border-success/30 bg-success/15 text-success-ink">
                  {bonuses} bonus point(s) awarded
                </span>
                <span className="px-2 py-1 rounded-pill border border-warning/30 bg-warning/15 text-ink">
                  {warnings.length} active warning(s)
                </span>
              </div>
              <ul className="space-y-2 text-caption">
                {rewardEntries
                  .filter((e) => e.targetId === actor.id)
                  .slice(0, 4)
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="p-3 rounded-card border border-border-subtle bg-surface-muted"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-ink font-numbers">
                          {entry.kind === 'bonus' ? `+${entry.points} pts` : `${entry.severity ?? 'warning'} warning`}
                        </span>
                        <span className="text-micro text-ink-subtle font-numbers">{entry.issuedAt.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <p className="text-micro text-ink-muted mt-1 leading-relaxed">{entry.reason}</p>
                      <p className="text-micro text-ink-subtle mt-1">
                        Recorded by {entry.actorName} ({ROLE_LABELS[entry.actorRole]})
                        {entry.status === 'reversed' ? ' · reversed by a later entry' : ''}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          </Panel>
        </div>
      </div>

      <QueuePanel
        items={queue}
        onNavigate={onNavigate}
        caption="Reminders that name this account — tasks, reviews and filings."
      />
    </div>
  );
};

/**
 * Spec G part 1: the home screen is decided by the signed-in account, not by a single page that
 * shows chapter totals to everybody. The switch reads `users.read` out of the role matrix, so the
 * shape of the home follows the scope the provider already enforces: a member's home cannot grow
 * a committee figure and a Head's cannot grow a chapter one.
 */
export const DashboardHome: React.FC<DashboardHomeProps> = ({ onNavigate }) => {
  const actor = useActor();
  const peopleScope = scopeFor(actor.role, 'users.read');

  if (peopleScope === 'all') return <SuperAdminOverview onNavigate={onNavigate} />;
  if (peopleScope === 'committee') return <CommitteeHome actor={actor} onNavigate={onNavigate} />;
  return <MemberHome actor={actor} onNavigate={onNavigate} />;
};

export default DashboardHome;
