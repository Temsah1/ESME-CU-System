import type { Committee, Role, Task, User } from '../types';
import { scopeFor } from './roles';

/**
 * Task metadata is managed by the same roles that may create a task: the administrator and the
 * committee leadership. `tasks.write` scoped to `self` is what lets an assignee move their own
 * work through the delivery flow — it is not a licence to rewrite the brief, the deadline or the
 * point value the chapter set.
 */
export function mayEditTaskFields(role: Role): boolean {
  const scope = scopeFor(role, 'tasks.write');
  return scope === 'all' || scope === 'committee';
}

export const TASK_LIMITS = {
  title: 200,
  description: 4000,
  pointsMin: 10,
  pointsMax: 500,
  criteria: 20,
  criterion: 200,
  category: 60,
} as const;

export const TASK_CATEGORIES = ['general', 'Workshop', 'Major Event', 'Magazine Issue', 'Field Campaign'] as const;

export type TaskDraftField =
  | 'title'
  | 'description'
  | 'committeeId'
  | 'assigneeIds'
  | 'priority'
  | 'points'
  | 'startDate'
  | 'deadline'
  | 'acceptanceCriteria'
  | 'category';

export type TaskDraftIssue = { field: TaskDraftField; message: string };

/** The fields an editor manages. Status, ownership and history are not among them. */
export type TaskDraft = {
  title: string;
  description: string;
  committeeId: string;
  assigneeIds: string[];
  priority: Task['priority'];
  points: number;
  startDate: string;
  deadline: string;
  acceptanceCriteria: string[];
  category: string;
};

const PRIORITIES: Task['priority'][] = ['low', 'medium', 'high', 'urgent'];

export function draftFromTask(task: Task): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    committeeId: task.committeeId,
    assigneeIds: [...task.assigneeIds],
    priority: task.priority,
    points: task.points,
    startDate: task.startDate,
    deadline: task.deadline,
    acceptanceCriteria: [...task.acceptanceCriteria],
    category: task.category,
  };
}

/** Calendar dates only: a rolled-over value such as 2026-02-30 is not a deadline. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Runs on the stored write as well as in the form, so a call that skips the interface is held to
 * the same rules. The committee and the assignees are validated together: an assignee who does
 * not belong to the task's committee would be given work they cannot see.
 */
export function validateTaskDraft(
  draft: TaskDraft,
  committees: readonly Committee[],
  users: readonly User[]
): TaskDraftIssue[] {
  const issues: TaskDraftIssue[] = [];
  const title = draft.title.trim();
  const description = draft.description.trim();

  if (title.length < 3) issues.push({ field: 'title', message: 'A task title is at least 3 characters.' });
  if (title.length > TASK_LIMITS.title) {
    issues.push({ field: 'title', message: `Keep the title to ${TASK_LIMITS.title} characters.` });
  }
  if (description.length === 0) issues.push({ field: 'description', message: 'Write what the task asks for.' });
  if (description.length > TASK_LIMITS.description) {
    issues.push({ field: 'description', message: `Keep the description to ${TASK_LIMITS.description} characters.` });
  }

  const committee = committees.find((c) => c.id === draft.committeeId);
  if (!committee) issues.push({ field: 'committeeId', message: 'Choose the committee that owns this task.' });

  if (!PRIORITIES.includes(draft.priority)) issues.push({ field: 'priority', message: 'Choose a recorded priority.' });

  if (!Number.isInteger(draft.points)) {
    issues.push({ field: 'points', message: 'Points must be a whole number.' });
  } else if (draft.points < TASK_LIMITS.pointsMin || draft.points > TASK_LIMITS.pointsMax) {
    issues.push({
      field: 'points',
      message: `Points are between ${TASK_LIMITS.pointsMin} and ${TASK_LIMITS.pointsMax}.`,
    });
  }

  if (draft.startDate && !isCalendarDate(draft.startDate)) {
    issues.push({ field: 'startDate', message: 'The start date must be a real calendar date.' });
  }
  if (!draft.deadline) {
    issues.push({ field: 'deadline', message: 'A task needs a deadline.' });
  } else if (!isCalendarDate(draft.deadline)) {
    issues.push({ field: 'deadline', message: 'The deadline must be a real calendar date.' });
  } else if (draft.startDate && isCalendarDate(draft.startDate) && draft.deadline < draft.startDate) {
    issues.push({ field: 'deadline', message: 'The deadline cannot fall before the start date.' });
  }

  const assigneeIds = [...new Set(draft.assigneeIds)];
  if (committee) {
    const outsider = assigneeIds.find((id) => {
      const member = users.find((u) => u.id === id);
      return !member || member.committeeId !== committee.id;
    });
    if (outsider) {
      issues.push({
        field: 'assigneeIds',
        message: 'Every assignee must be a member of the committee that owns this task.',
      });
    }
  }

  if (draft.acceptanceCriteria.length > TASK_LIMITS.criteria) {
    issues.push({ field: 'acceptanceCriteria', message: `${TASK_LIMITS.criteria} acceptance criteria maximum.` });
  }
  if (draft.acceptanceCriteria.some((criterion) => criterion.trim().length > TASK_LIMITS.criterion)) {
    issues.push({
      field: 'acceptanceCriteria',
      message: `Keep each acceptance criterion to ${TASK_LIMITS.criterion} characters.`,
    });
  }

  if (draft.category.trim().length === 0) {
    issues.push({ field: 'category', message: 'Choose the category the rubric follows.' });
  } else if (draft.category.trim().length > TASK_LIMITS.category) {
    issues.push({ field: 'category', message: `Keep the category to ${TASK_LIMITS.category} characters.` });
  }

  return issues;
}

export function normalizeTaskDraft(draft: TaskDraft): TaskDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    description: draft.description.trim(),
    assigneeIds: [...new Set(draft.assigneeIds)],
    points: Number(draft.points),
    startDate: draft.startDate.trim(),
    deadline: draft.deadline.trim(),
    acceptanceCriteria: draft.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
    category: draft.category.trim(),
  };
}
