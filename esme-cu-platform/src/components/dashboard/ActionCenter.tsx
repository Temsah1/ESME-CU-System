import React, { useState } from 'react';
import { ArrowUpRight, BellRing, Filter, Inbox, Send } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import {
  ACTION_KINDS,
  dueForReminder,
  escalationFor,
  type ActionItem,
  type ActionKind,
} from '../../domain/actions';
import type { DashboardView } from './DashboardShell';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../motion';

/**
 * Spec D: one queue for the pending work this account can actually see, built from records.
 * Reminders are raised from it, one per record stage, and delivery stops at this workspace —
 * no message leaves the application, because no messaging provider is configured.
 */

const cardClass = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm';
const headClass =
  'bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]';

const priorityStyle: Record<ActionItem['priority'], string> = {
  urgent: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  medium: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const dueLabel = (item: ActionItem) => {
  if (item.dueInDays === null) return { text: item.kind === 'recruitment' ? 'no deadline; age-driven' : 'no date on record', over: false };
  if (item.dueInDays < 0) return { text: `${Math.abs(item.dueInDays)} day(s) past ${item.deadline}`, over: true };
  if (item.dueInDays === 0) return { text: `due today (${item.deadline})`, over: true };
  return { text: `${item.dueInDays} day(s) to ${item.deadline}`, over: false };
};

const ActionRow: React.FC<{ item: ActionItem; onNavigate: (view: DashboardView) => void; escalate: string | null }> = ({
  item,
  onNavigate,
  escalate,
}) => {
  const due = dueLabel(item);
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="py-2.5 px-4">
        <div className="font-bold text-slate-800 dark:text-slate-100">{item.title}</div>
        <div className="text-[10px] text-slate-400">{item.detail}</div>
        {escalate && <div className="text-[10px] text-rose-600 dark:text-rose-400 mt-0.5">{escalate}</div>}
      </td>
      <td className="py-2.5 px-4">
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          {item.kind}
        </span>
      </td>
      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{item.owner?.name ?? 'unassigned'}</td>
      <td className={`py-2.5 px-4 text-[11px] ${due.over ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-500'}`}>
        {due.text}
      </td>
      <td className="py-2.5 px-4">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${priorityStyle[item.priority]}`}>{item.priority}</span>
      </td>
      <td className="py-2.5 px-4 text-right">
        <button
          onClick={() => onNavigate(item.view as DashboardView)}
          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] inline-flex items-center gap-1"
        >
          Open
          <ArrowUpRight className="w-3 h-3" aria-hidden />
        </button>
      </td>
    </tr>
  );
};

export const ActionCenter: React.FC<{ onNavigate: (view: DashboardView) => void }> = ({ onNavigate }) => {
  const { notifications, actionPrefs, setActionPrefs, actionQueue, runActionSweep, users, markNotificationRead, can } =
    useApp();
  const actor = useActor();
  const { toast } = useToast();
  const [kindFilter, setKindFilter] = useState<ActionKind | 'all'>('all');
  const [onlyDue, setOnlyDue] = useState(false);

  const queue = actionQueue();
  const rows = queue
    .filter((item) => kindFilter === 'all' || item.kind === kindFilter)
    .filter((item) => (onlyDue ? dueForReminder([item], actionPrefs.leadDays).length > 0 : true));
  const fromQueue = notifications.filter((n) => n.sourceKey).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Action Center</h1>
          <p className="text-xs text-slate-500">
            {queue.length} open item(s) drawn from tasks, submissions, applications and season rows this account can
            read. The queue is rebuilt on every view, so a closed record disappears instead of ageing here.
          </p>
        </div>
        <button
          onClick={() => {
            try {
              const sweep = runActionSweep();
              toast(
                `${sweep.emitted} new reminder(s); ${sweep.suppressed.length} already raised for these records.`,
                'success'
              );
            } catch (error) {
              toast(error instanceof Error ? error.message : 'The sweep did not run.', 'error');
            }
          }}
          className="px-4 py-2 rounded-xl bg-[#123B60] hover:bg-[#0A2239] text-white text-xs font-bold flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" aria-hidden />
          Raise reminders from live records
        </button>
      </div>

      <div className={`${cardClass} p-4 flex items-start gap-2.5`}>
        <BellRing className="w-4 h-4 text-[#F59A16] mt-0.5 shrink-0" aria-hidden />
        <p className="text-[11px] text-slate-600 dark:text-slate-300">
          Reminders are generated from system records only — a queue item never raised before. Nothing here is a
          scheduled campaign, and nothing leaves the application: delivery is in-app, because this build is configured
          with no messaging provider. Support tickets are not in the queue because this chapter keeps no ticket records
          yet; the moment they exist they become another kind.
        </p>
      </div>

      {/* Filters */}
      <div className={`${cardClass} p-4 flex flex-wrap items-center gap-2`}>
        <span className="text-[11px] font-bold text-slate-500 inline-flex items-center gap-1 mr-1">
          <Filter className="w-3.5 h-3.5" aria-hidden />
          Filter
        </span>
        {(['all', ...ACTION_KINDS] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => setKindFilter(kind)}
            aria-pressed={kindFilter === kind}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
              kindFilter === kind
                ? 'bg-[#123B60] text-white border-[#123B60]'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            {kind === 'all' ? 'All kinds' : kind}
          </button>
        ))}
        <button
          onClick={() => setOnlyDue((prev) => !prev)}
          aria-pressed={onlyDue}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
            onlyDue
              ? 'bg-[#F59A16] text-white border-[#F59A16]'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
          }`}
        >
          Due within {actionPrefs.leadDays} day(s) or past
        </button>
      </div>

      {/* Queue */}
      <div className={cardClass}>
        {rows.length === 0 ? (
          <EmptyState
            title={queue.length === 0 ? 'Nothing outstanding' : 'Nothing matches this filter'}
            description={
              queue.length === 0
                ? 'No task is open with a deadline, no deliverable awaits a decision, no application is unanswered and no season row is unfinished. An empty queue is a real state, not a loading one.'
                : `${queue.length} item(s) are open; none is of this kind or due inside the reminder window.`
            }
            icon={Inbox}
          />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className={headClass}>
              <tr>
                <th className="py-2.5 px-4">Item</th>
                <th className="py-2.5 px-4">Kind</th>
                <th className="py-2.5 px-4">Owner</th>
                <th className="py-2.5 px-4">Deadline</th>
                <th className="py-2.5 px-4">Priority</th>
                <th className="py-2.5 px-4 text-right">Go</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((item) => (
                <ActionRow
                  key={item.key}
                  item={item}
                  onNavigate={onNavigate}
                  escalate={escalationFor(item, { role: actor.role, id: actor.id, committeeId: actor.committeeId }, users)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Preferences */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Reminder settings for this account</h2>
          <p className="text-[11px] text-slate-400">
            Turning a kind off removes its items from the queue before it is built, not after — you will not be told
            about work you opted out of, and nobody else sees your settings.
          </p>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {ACTION_KINDS.map((kind) => (
            <label
              key={kind}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
            >
              <input
                type="checkbox"
                checked={actionPrefs.enabled[kind]}
                onChange={(e) =>
                  setActionPrefs({
                    ...actionPrefs,
                    enabled: { ...actionPrefs.enabled, [kind]: e.target.checked },
                  })
                }
              />
              {kind}
            </label>
          ))}
        </div>
        <div className="px-4 pb-4 flex flex-wrap gap-4">
          <label className="text-[11px] font-bold text-slate-500 flex items-center gap-2">
            Remind me
            <input
              type="number"
              min={0}
              max={14}
              value={actionPrefs.leadDays}
              onChange={(e) => setActionPrefs({ ...actionPrefs, leadDays: Number(e.target.value) })}
              className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            />
            day(s) before a deadline
          </label>
          <label className="text-[11px] font-bold text-slate-500 flex items-center gap-2">
            Escalate a task
            <input
              type="number"
              min={1}
              max={30}
              value={actionPrefs.escalateAfterDays}
              onChange={(e) => setActionPrefs({ ...actionPrefs, escalateAfterDays: Number(e.target.value) })}
              className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
            />
            day(s) past due, to the level above the owner
          </label>
        </div>
      </div>

      {/* History */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Notification history ({notifications.length})</h2>
          <p className="text-[11px] text-slate-400">
            {fromQueue} of these came from a queue key; the rest were written by hand. Delivery status is in-app for
            every row: this workspace has no provider that could send one onward
            {can('notifications.manage') ? '' : ', and your account cannot manage delivery anyway'}.
          </p>
        </div>
        {notifications.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-400">
            No reminder has been raised yet. Use the sweep above; it writes only for records that exist right now.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {notifications.map((n) => (
              <li key={n.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{n.title}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">{n.message}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {n.timestamp} · delivered: {n.delivery ?? 'in_app'} · {n.sourceKey ? `key ${n.sourceKey}` : 'written by hand'}
                    </p>
                  </div>
                  {!n.read && (
                    <button
                      onClick={() => markNotificationRead(n.id)}
                      className="shrink-0 text-[10px] font-bold text-[#123B60] dark:text-[#F59A16]"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ActionCenter;
