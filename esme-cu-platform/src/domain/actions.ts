import type { SeasonEvent, Task, TaskSubmission, User } from '../types';

/**
 * Spec D: one queue for the pending work that actually exists, built from records on every
 * read. Nothing here stores a task, approves an applicant or sends anything — it decides what
 * is outstanding, who owns it, and whether a notification about it has already been raised.
 *
 * Notification identity is a key over (kind, record, stage). Re-running the sweep cannot
 * produce a second reminder for the same stage of the same record, which is what duplicate
 * prevention means here.
 */

export type ActionKind = 'approval' | 'review' | 'overdue' | 'event' | 'milestone';

export const ACTION_KINDS: ActionKind[] = ['approval', 'review', 'overdue', 'event', 'milestone'];

export type ActionTarget = 'tasks' | 'submissions' | 'season_planner' | 'scoring';

export type ActionItem = {
  key: string;
  kind: ActionKind;
  title: string;
  detail: string;
  owner: { id: string; name: string } | null;
  /** null when the record has no resolvable committee — season rows name one in free text. */
  committeeId: string | null;
  deadline: string | null;
  priority: Task['priority'];
  view: ActionTarget;
  recordId: string;
  /** Negative when the date has already passed. null when the record carries no date. */
  dueInDays: number | null;
  /** Past this many days overdue the item is escalated, by rule. */
  escalateAfterDays: number;
};

export type ActionPrefs = {
  enabled: Record<ActionKind, boolean>;
  leadDays: number;
  escalateAfterDays: number;
};

export const DEFAULT_ACTION_PREFS: ActionPrefs = {
  enabled: { approval: true, review: true, overdue: true, event: true, milestone: true },
  leadDays: 2,
  escalateAfterDays: 3,
};

export type ActionScope = { role: User['role']; id: string; committeeId?: string };

/**
 * Who may see an item. A member only ever sees work that names them; committee leadership
 * sees its own committee; the chapter-wide roles — Super Admin, High Board and the IT
 * Moderator — see everything, because their read scope in the role matrix is `all`.
 * Derived from those scopes, never from which screen is open.
 */
export function visibleTo(actor: ActionScope, item: { ownerId: string | null; committeeId: string | null }): boolean {
  if (actor.role === 'super_admin' || actor.role === 'moderator' || actor.role === 'high_board') return true;
  if (actor.role === 'director' || actor.role === 'head') return item.committeeId === null || item.committeeId === actor.committeeId;
  return item.ownerId === actor.id;
}

const dayFloor = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86400000);

export function buildActionQueue(input: {
  tasks: Task[];
  submissions: TaskSubmission[];
  events: SeasonEvent[];
  users: User[];
  asOf: string;
  prefs: ActionPrefs;
}): ActionItem[] {
  const { tasks, submissions, events, users, asOf, prefs } = input;
  const today = asOf.slice(0, 10);
  const TERMINAL: Task['status'][] = ['approved', 'rejected', 'cancelled'];
  const items: ActionItem[] = [];

  const ownerName = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  tasks.forEach((task) => {
    // An archived row is history, not outstanding work.
    if (task.archivedAt) return;
    const open = !TERMINAL.includes(task.status);
    if (!open || !task.deadline) return;
    const dueInDays = dayFloor(today, task.deadline);
    const primary = task.assigneeIds[0] ?? null;
    // Two rules can cover one task: it is waiting for a decision, or its date has gone by.
    // They get distinct keys so each stage is raised once, not twice for the same row.
    items.push({
      key: `review:${task.id}:${task.status}`,
      kind: 'review',
      title: task.title,
      detail: `Task is ${task.status.replace(/_/g, ' ')} with a deadline of ${task.deadline}.`,
      owner: primary ? { id: primary, name: ownerName(primary) } : null,
      committeeId: task.committeeId,
      deadline: task.deadline,
      priority: task.priority,
      view: 'tasks',
      recordId: task.id,
      dueInDays,
      escalateAfterDays: prefs.escalateAfterDays,
    });
    if (dueInDays < 0) {
      items.push({
        key: `overdue:${task.id}`,
        kind: 'overdue',
        title: task.title,
        detail: `Past deadline by ${Math.abs(dueInDays)} day(s) and still ${task.status.replace(/_/g, ' ')}.`,
        owner: primary ? { id: primary, name: ownerName(primary) } : null,
        committeeId: task.committeeId,
        deadline: task.deadline,
        priority: task.priority === 'low' ? 'medium' : task.priority,
        view: 'tasks',
        recordId: task.id,
        dueInDays,
        escalateAfterDays: prefs.escalateAfterDays,
      });
    }
  });

  submissions
    .filter((s) => s.status === 'submitted' || s.status === 'under_review')
    .forEach((s) => {
      items.push({
        key: `approval:${s.id}:${s.status}`,
        kind: 'approval',
        title: s.taskTitle,
        detail: `${s.memberName}'s deliverable is ${s.status.replace(/_/g, ' ')} and needs a reviewer decision.`,
        owner: { id: s.memberId, name: s.memberName },
        committeeId: s.committeeId,
        deadline: tasks.find((t) => t.id === s.taskId)?.deadline ?? null,
        priority: tasks.find((t) => t.id === s.taskId)?.priority ?? 'medium',
        view: 'submissions',
        recordId: s.id,
        dueInDays: null,
        escalateAfterDays: prefs.escalateAfterDays,
      });
    });

  events.forEach((event) => {
    if (event.status === 'Completed') return;
    const isMilestone = event.category === 'Major Event';
    items.push({
      key: `${isMilestone ? 'milestone' : 'event'}:${event.id}:${event.status}`,
      kind: isMilestone ? 'milestone' : 'event',
      title: event.title,
      detail: `${event.category}, ${event.status}, dated ${event.dateOrQuarter || 'no date recorded'} — held by ${event.responsibleCommittee}.`,
      owner: null,
      committeeId: null,
      deadline: null,
      priority: isMilestone ? 'high' : 'medium',
      view: 'season_planner',
      recordId: event.id,
      dueInDays: null,
      escalateAfterDays: prefs.escalateAfterDays,
    });
  });

  return items.filter((item) => prefs.enabled[item.kind]);
}

export const PRIORITY_ORDER: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function sortQueue(items: ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    if (a.dueInDays !== null && b.dueInDays !== null && a.dueInDays !== b.dueInDays) return a.dueInDays - b.dueInDays;
    if (a.dueInDays === null && b.dueInDays !== null) return 1;
    if (a.dueInDays !== null && b.dueInDays === null) return -1;
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return byPriority !== 0 ? byPriority : a.title.localeCompare(b.title);
  });
}

/** Items whose deadline is inside the reminder lead time, or already gone by. */
export function dueForReminder(items: ActionItem[], leadDays: number): ActionItem[] {
  return items.filter((i) => i.dueInDays !== null && i.dueInDays <= leadDays);
}

/**
 * Past escalationAfterDays the queue stops naming an owner and names the level above.
 * The roles are fixed here: nobody is invented, and the item is not reassigned.
 */
export function escalationFor(item: ActionItem, actor: ActionScope, users: User[]): string | null {
  if (item.dueInDays === null || item.dueInDays > -item.escalateAfterDays) return null;
  const owner = users.find((u) => u.id === item.owner?.id);
  if (!owner) return 'No owner is recorded, so the item escalates to a Super Admin.';
  if (owner.role === 'member') return `Escalates to the head of ${owner.committeeId ?? 'the committee'}.`;
  if (owner.role === 'head') return `Escalates to the director of ${owner.committeeId ?? 'the committee'}.`;
  if (owner.role === 'director') return 'Escalates to a Super Admin.';
  return actor.role === 'super_admin' ? 'Already at the top of the chain.' : 'Escalates to a Super Admin.';
}

export type EmittedKey = { key: string; raisedAt: string };

export type PlannedNotification = { key: string; title: string; message: string; link: ActionTarget };

/**
 * Duplicate prevention: an item is announced once per key. A key already in `emitted` is
 * reported as suppressed instead of queued a second time, and the same batch cannot announce
 * a key twice either.
 */
export function planNotifications(items: ActionItem[], emitted: EmittedKey[]): {
  toEmit: PlannedNotification[];
  suppressed: string[];
} {
  const seen = new Set(emitted.map((e) => e.key));
  const toEmit: PlannedNotification[] = [];
  const suppressed: string[] = [];
  items.forEach((item) => {
    if (seen.has(item.key)) {
      suppressed.push(item.key);
      return;
    }
    seen.add(item.key);
    toEmit.push({
      key: item.key,
      title: `${item.kind === 'milestone' ? 'Milestone' : item.kind === 'event' ? 'Event' : item.kind === 'approval' ? 'Review' : 'Deadline'}: ${item.title}`,
      message: `${item.detail}${item.dueInDays !== null ? ` Due ${item.deadline} (${item.dueInDays >= 0 ? `${item.dueInDays} day(s)` : `${Math.abs(item.dueInDays)} day(s) ago`}).` : ''}`,
      link: item.view,
    });
  });
  return { toEmit, suppressed };
}
