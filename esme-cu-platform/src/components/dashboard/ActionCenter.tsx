import React, { useState } from 'react';
import { ArrowUpRight, Filter, Inbox, Send } from 'lucide-react';
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
import { Alert, Button, Card, StatusBadge } from '../ui';

/**
 * Spec D: one queue for the pending work this account can actually see, built from records.
 * Reminders are raised from it, one per record stage, and delivery stops at this workspace —
 * no message leaves the application, because no messaging provider is configured.
 */

const headClass =
  'bg-surface-muted border-b border-border text-ink-muted font-semibold uppercase text-micro tracking-wider';
const chipClass = (selected: boolean) =>
  `px-2.5 py-1 rounded-control text-caption font-bold border transition-colors duration-micro ${
    selected
      ? 'bg-tint-accent border-accent text-ink-accent'
      : 'bg-surface border-border text-ink-muted hover:bg-tint-hover hover:text-ink'
  }`;
const numberField =
  'w-16 px-2 py-1 rounded-control border border-border bg-surface text-caption text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus';

const dueLabel = (item: ActionItem) => {
  if (item.dueInDays === null) return { text: 'no date on record', over: false };
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
    <tr className="hover:bg-tint-hover transition-colors duration-micro">
      <td className="py-2.5 px-4">
        <div className="font-bold text-ink-strong">{item.title}</div>
        <div className="text-micro text-ink-subtle">{item.detail}</div>
        {escalate && <div className="text-micro text-danger mt-1">{escalate}</div>}
      </td>
      <td className="py-2.5 px-4">
        <span className="px-2 py-1 rounded-control text-micro font-bold uppercase bg-surface-muted text-ink-muted">
          {item.kind}
        </span>
      </td>
      <td className="py-2.5 px-4 text-ink-muted">{item.owner?.name ?? 'unassigned'}</td>
      <td className={`py-2.5 px-4 text-caption ${due.over ? 'text-danger font-bold' : 'text-ink-muted'}`}>
        {due.text}
      </td>
      <td className="py-2.5 px-4">
        <StatusBadge status={item.priority}>{item.priority}</StatusBadge>
      </td>
      <td className="py-2.5 px-4 text-right">
        <Button variant="outline" size="sm" onClick={() => onNavigate(item.view as DashboardView)}>
          Open
          <ArrowUpRight className="w-3 h-3" aria-hidden />
        </Button>
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
          <h1 className="text-title font-black text-ink-strong">Action Center</h1>
          <p className="mt-1 text-caption text-ink-muted">
            {queue.length} open item(s) drawn from tasks, submissions and season rows this account can
            read. The queue is rebuilt on every view, so a closed record disappears instead of ageing here.
          </p>
        </div>
        <Button
          variant="brand"
          size="sm"
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
        >
          <Send className="w-3.5 h-3.5" aria-hidden />
          Raise reminders from live records
        </Button>
      </div>

      <Alert tone="info">
        Reminders are generated from system records only — a queue item never raised before. Nothing here is a
        scheduled campaign, and nothing leaves the application: delivery is in-app, because this build is configured
        with no messaging provider. Support tickets are not in the queue because this chapter keeps no ticket records
        yet; the moment they exist they become another kind.
      </Alert>

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-center gap-2">
        <span className="text-caption font-bold text-ink-muted inline-flex items-center gap-1 mr-1">
          <Filter className="w-3.5 h-3.5" aria-hidden />
          Filter
        </span>
        {(['all', ...ACTION_KINDS] as const).map((kind) => (
          <button
            key={kind}
            onClick={() => setKindFilter(kind)}
            aria-pressed={kindFilter === kind}
            className={chipClass(kindFilter === kind)}
          >
            {kind === 'all' ? 'All kinds' : kind}
          </button>
        ))}
        <button
          onClick={() => setOnlyDue((prev) => !prev)}
          aria-pressed={onlyDue}
          className={chipClass(onlyDue)}
        >
          Due within {actionPrefs.leadDays} day(s) or past
        </button>
      </Card>

      {/* Queue */}
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={queue.length === 0 ? 'Nothing outstanding' : 'Nothing matches this filter'}
            description={
              queue.length === 0
                ? 'No task is open with a deadline, no deliverable awaits a decision and no season row is unfinished. An empty queue is a real state, not a loading one.'
                : `${queue.length} item(s) are open; none is of this kind or due inside the reminder window.`
            }
            icon={Inbox}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-caption">
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
              <tbody className="divide-y divide-border-subtle">
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
          </div>
        )}
      </Card>

      {/* Preferences */}
      <Card>
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-label font-bold text-ink-strong">Reminder settings for this account</h2>
          <p className="mt-1 text-caption text-ink-subtle">
            Turning a kind off removes its items from the queue before it is built, not after — you will not be told
            about work you opted out of, and nobody else sees your settings.
          </p>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {ACTION_KINDS.map((kind) => (
            <label
              key={kind}
              className="px-3 py-2 rounded-control border border-border text-caption font-bold text-ink-muted flex items-center gap-2"
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
          <label className="text-caption font-bold text-ink-muted flex items-center gap-2">
            Remind me
            <input
              type="number"
              min={0}
              max={14}
              value={actionPrefs.leadDays}
              onChange={(e) => setActionPrefs({ ...actionPrefs, leadDays: Number(e.target.value) })}
              className={numberField}
            />
            day(s) before a deadline
          </label>
          <label className="text-caption font-bold text-ink-muted flex items-center gap-2">
            Escalate a task
            <input
              type="number"
              min={1}
              max={30}
              value={actionPrefs.escalateAfterDays}
              onChange={(e) => setActionPrefs({ ...actionPrefs, escalateAfterDays: Number(e.target.value) })}
              className={numberField}
            />
            day(s) past due, to the level above the owner
          </label>
        </div>
      </Card>

      {/* History */}
      <Card>
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-label font-bold text-ink-strong">Notification history ({notifications.length})</h2>
          <p className="mt-1 text-caption text-ink-subtle">
            {fromQueue} of these came from a queue key; the rest were written by hand. Delivery status is in-app for
            every row: this workspace has no provider that could send one onward
            {can('notifications.manage') ? '' : ', and your account cannot manage delivery anyway'}.
          </p>
        </div>
        {notifications.length === 0 ? (
          <p className="p-8 text-center text-caption text-ink-subtle">
            No reminder has been raised yet. Use the sweep above; it writes only for records that exist right now.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {notifications.map((n) => (
              <li key={n.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-label font-bold text-ink-strong">{n.title}</p>
                    <p className="mt-1 text-caption text-ink-muted">{n.message}</p>
                    <p className="text-micro text-ink-subtle mt-1">
                      {n.timestamp} · delivered: {n.delivery ?? 'in_app'} · {n.sourceKey ? `key ${n.sourceKey}` : 'written by hand'}
                    </p>
                  </div>
                  {!n.read && (
                    <button
                      onClick={() => markNotificationRead(n.id)}
                      className="shrink-0 text-caption font-bold text-ink-brand hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default ActionCenter;
