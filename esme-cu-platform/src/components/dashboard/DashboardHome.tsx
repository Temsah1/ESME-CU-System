import React, { useMemo } from 'react';
import { motion } from 'motion/react';
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
import { AnimatedNumber, StaggerGroup, StaggerItem, groupItemScale, transitions } from '../../motion';
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
  tone: string;
};

const StatCard: React.FC<{ stat: Stat; onNavigate: (view: DashboardView) => void }> = ({ stat, onNavigate }) => {
  const Icon = stat.icon;
  return (
    <StaggerItem variants={groupItemScale} className="h-full">
      <motion.div
        role="button"
        tabIndex={0}
        onClick={() => onNavigate(stat.view)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onNavigate(stat.view);
          }
        }}
        whileHover={{ y: -4 }}
        whileTap={{ scale: 0.98 }}
        transition={transitions.standard}
        className="group/card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:shadow-md hover:border-[#123B60]/30 transition-[box-shadow,border-color] cursor-pointer flex flex-col justify-between h-full focus-visible:outline-2 focus-visible:outline-[#F59A16]"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{stat.label}</span>
          <div className={`w-8 h-8 shrink-0 rounded-xl ${stat.tone} flex items-center justify-center`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {stat.value === null ? '—' : <AnimatedNumber value={stat.value} format={stat.format} startOnView />}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-start justify-between gap-2">
            <span>{stat.hint}</span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-60 transition-transform duration-200 group-hover/card:translate-x-0.5" />
          </div>
        </div>
      </motion.div>
    </StaggerItem>
  );
};

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs text-slate-600 dark:text-slate-300">
    {children}
  </p>
);

const Panel: React.FC<{ title: string; caption?: string; children: React.ReactNode }> = ({
  title,
  caption,
  children,
}) => (
  <motion.section
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm"
  >
    <div className="mb-4">
      <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
      {caption && <p className="text-[11px] text-slate-400">{caption}</p>}
    </div>
    {children}
  </motion.section>
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
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20 font-bold">
        Account role: {ROLE_LABELS[actor.role]}
      </span>
      {posts.length === 0 ? (
        <span className="px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-slate-100">
          No committee seat assigned
        </span>
      ) : (
        posts.map(({ committee, position }) => (
          <span
            key={`${committee.id}-${position}`}
            className="px-2.5 py-1 rounded-full bg-[#F59A16] text-[#0A2239] font-bold"
          >
            {POSITION_LABELS[position]} — {committee.name}
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
      <StaggerGroup className="space-y-2" step={0.05} amount={0.1}>
        {items.map((item) => (
          <StaggerItem key={item.key}>
            <motion.button
              onClick={() => onNavigate(item.view)}
              whileHover={{ x: 3 }}
              transition={transitions.micro}
              className="w-full text-left p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{item.title}</span>
                <span className="block text-[11px] text-slate-400 mt-0.5 truncate">
                  {item.kind} · {item.detail}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-right text-slate-500 dark:text-slate-300">
                {item.dueInDays === null
                  ? 'no date'
                  : item.dueInDays < 0
                    ? `${Math.abs(item.dueInDays)}d late`
                    : `${item.dueInDays}d left`}
              </span>
            </motion.button>
          </StaggerItem>
        ))}
      </StaggerGroup>
    )}
    <div className="mt-3 flex justify-end">
      <button
        onClick={() => onNavigate('action_center')}
        className="text-xs text-[#F59A16] font-bold hover:underline flex items-center gap-1"
      >
        Open Action Center
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  </Panel>
);

const StatGrid: React.FC<{ stats: Stat[]; onNavigate: (view: DashboardView) => void }> = ({ stats, onNavigate }) => (
  <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" step={0.06} amount={0.1}>
    {stats.map((stat) => (
      <StatCard key={stat.label} stat={stat} onNavigate={onNavigate} />
    ))}
  </StaggerGroup>
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
      tone: 'bg-[#123B60]/10 text-[#123B60] dark:text-[#F59A16]',
    },
    {
      label: 'Open tasks',
      value: committee ? openTasks.length : null,
      hint: `${committeeTasks.length} task(s) written for this committee`,
      icon: CheckSquare,
      view: 'tasks',
      tone: 'bg-blue-500/10 text-blue-600',
    },
    {
      label: 'Awaiting your review',
      value: committee ? awaitingReview.length : null,
      hint: 'Submissions filed as submitted or under review',
      icon: FileCheck2,
      view: 'submissions',
      tone: 'bg-amber-500/10 text-amber-600',
    },
    {
      label: 'Past their deadline',
      value: committee ? lateTasks.length : null,
      hint: `${openTasks.length} still open while ${lateTasks.length} run past their date`,
      icon: AlertTriangle,
      view: 'tasks',
      tone: 'bg-rose-500/10 text-rose-600',
    },
  ];

  if (mayReadScores) {
    stats.push({
      label: 'Points recorded',
      value: committee ? pointsRecorded : null,
      hint: `${ledgerForRoster.length} ledger entry(ies) for this roster`,
      icon: Award,
      view: 'scoring',
      tone: 'bg-purple-500/10 text-purple-600',
    });
  }
  if (mayReadRewards) {
    stats.push({
      label: 'Active warnings',
      value: committee ? openWarnings.length : null,
      hint: 'Entries nobody has reversed; bonuses are counted in the ledger',
      icon: ShieldAlert,
      view: 'rewards',
      tone: 'bg-rose-500/10 text-rose-600',
    });
  }

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-r from-[#123B60] via-[#0E2F4D] to-[#0A2239] rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden border border-white/10"
      >
        <div className="absolute inset-0 bg-grid-pattern-dark opacity-10 pointer-events-none" />
        <div className="relative z-10 space-y-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[#F59A16] text-xs font-bold border border-white/15">
            Committee command
          </span>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            {greeting(clock.hour)}, {actor.name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-200 max-w-2xl leading-relaxed">
            {committee
              ? `${committee.name} (${committee.shortCode}) — every figure below counts records filed under this committee. Anything outside it is not shown here because your read scope stops at the committee line.`
              : 'Your account is not filed under a committee, so there is no committee scope to report. Ask an officer to place the account; until then only records that name you personally are reachable.'}
          </p>
          <RoleAndSeat actor={actor} />
        </div>
      </motion.header>

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
      tone: 'bg-purple-500/10 text-purple-600',
    },
    {
      label: 'Tasks assigned to you',
      value: openMyTasks.length,
      format: (n) => `${n}`,
      hint: `${myTasks.length} in total, ${lateMyTasks.length} past their deadline`,
      icon: CheckSquare,
      view: 'tasks',
      tone: 'bg-blue-500/10 text-blue-600',
    },
    {
      label: 'Work awaiting a decision',
      value: awaitingMine.length,
      hint: revisions.length === 0 ? `${mine.length} submission(s) filed by you` : `${revisions.length} sent back for revision`,
      icon: FileCheck2,
      view: 'submissions',
      tone: 'bg-amber-500/10 text-amber-600',
    },
    {
      label: 'Unread alerts',
      value: unread,
      hint: 'Raised in this browser by the notification sweep',
      icon: Inbox,
      view: 'notifications',
      tone: 'bg-[#123B60]/10 text-[#123B60] dark:text-[#F59A16]',
    },
  ];

  const nextUp = [...openMyTasks]
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-r from-[#123B60] via-[#0E2F4D] to-[#0A2239] rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden border border-white/10"
      >
        <div className="absolute inset-0 bg-grid-pattern-dark opacity-10 pointer-events-none" />
        <div className="relative z-10 space-y-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[#F59A16] text-xs font-bold border border-white/15">
            My standing
          </span>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            {greeting(clock.hour)}, {actor.name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-200 max-w-2xl leading-relaxed">
            {committee ? `${committee.name} — ${committee.description || 'no committee description recorded'}. ` : ''}
            This page lists only records that name you: your own scores, tasks and submissions. Chapter and committee
            totals are outside your read scope, so they are not hidden here — they are simply not returned to you.
          </p>
          <RoleAndSeat actor={actor} />
        </div>
      </motion.header>

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
            <StaggerGroup className="space-y-2" step={0.05} amount={0.1}>
              {nextUp.map((task) => {
                const days = Math.floor((Date.parse(task.deadline) - clock.ms) / 86400000);
                return (
                  <StaggerItem key={task.id}>
                    <div className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{task.title}</span>
                        <span className="block text-[11px] text-slate-400 mt-0.5">
                          {task.committeeName} · {task.points} pts · {task.status.replace('_', ' ')}
                        </span>
                      </span>
                      <CalendarClock
                        className={`w-4 h-4 shrink-0 ${days < 0 ? 'text-rose-500' : days <= 2 ? 'text-amber-500' : 'text-slate-400'}`}
                      />
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                        {days < 0 ? `${Math.abs(days)}d late` : `${days}d left`}
                      </span>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerGroup>
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
              <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                  {bonuses} bonus point(s) awarded
                </span>
                <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                  {warnings.length} active warning(s)
                </span>
              </div>
              <ul className="space-y-2 text-xs">
                {rewardEntries
                  .filter((e) => e.targetId === actor.id)
                  .slice(0, 4)
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-100">
                          {entry.kind === 'bonus' ? `+${entry.points} pts` : `${entry.severity ?? 'warning'} warning`}
                        </span>
                        <span className="text-[10px] text-slate-400">{entry.issuedAt.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">{entry.reason}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
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
