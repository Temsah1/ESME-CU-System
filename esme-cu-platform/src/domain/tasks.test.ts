import { describe, expect, it } from 'vitest';
import type { Committee, Task, User } from '../types';
import {
  draftFromTask,
  isCalendarDate,
  mayEditTaskFields,
  normalizeTaskDraft,
  TASK_LIMITS,
  validateTaskDraft,
  type TaskDraft,
} from './tasks';

const committee = (id: string, name: string): Committee => ({
  id,
  name,
  shortCode: id.replace('comm_', '').toUpperCase(),
  description: '',
  objectives: [],
  subTeams: [],
  isPublic: true,
  status: 'active',
  category: 'technical',
});

const member = (id: string, committeeId: string): User => ({
  id,
  name: id,
  email: `${id}@esme.test`,
  username: id,
  role: 'member',
  committeeId,
  status: 'active',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
});

const COMMITTEES = [committee('comm_te', 'Technical & Engineering'), committee('comm_mc', 'Media & Content')];
const USERS = [member('usr_nada', 'comm_te'), member('usr_omar', 'comm_mc')];

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  title: 'Write the NDT workshop brief',
  description: 'Scope, speakers and equipment list for the first technical session.',
  committeeId: 'comm_te',
  assigneeIds: ['usr_nada'],
  priority: 'high',
  points: 40,
  startDate: '2026-10-20',
  deadline: '2026-11-20',
  acceptanceCriteria: ['Brief approved by the Director'],
  category: 'Workshop',
  ...over,
});

const issuesFor = (over: Partial<TaskDraft>) =>
  validateTaskDraft(normalizeTaskDraft(draft(over)), COMMITTEES, USERS);

describe('who may rewrite a task brief', () => {
  it('allows the administrator and committee leadership, never an assignee', () => {
    expect(mayEditTaskFields('super_admin')).toBe(true);
    expect(mayEditTaskFields('director')).toBe(true);
    expect(mayEditTaskFields('head')).toBe(true);
    expect(mayEditTaskFields('member')).toBe(false);
    expect(mayEditTaskFields('moderator')).toBe(false);
    expect(mayEditTaskFields('high_board')).toBe(false);
  });
});

describe('a task draft is validated on the stored write', () => {
  it('accepts a complete draft', () => {
    expect(issuesFor({})).toEqual([]);
  });

  it('rejects a title that is empty or too long', () => {
    expect(issuesFor({ title: '  ' })).toContainEqual(expect.objectContaining({ field: 'title' }));
    expect(issuesFor({ title: 'x'.repeat(TASK_LIMITS.title + 1) })).toContainEqual(
      expect.objectContaining({ field: 'title' })
    );
  });

  it('requires a description so an assignee knows what to do', () => {
    expect(issuesFor({ description: '   ' })).toContainEqual(
      expect.objectContaining({ field: 'description' })
    );
  });

  it('rejects an unknown committee and an assignee outside it', () => {
    expect(issuesFor({ committeeId: 'comm_missing' })).toContainEqual(
      expect.objectContaining({ field: 'committeeId' })
    );
    expect(issuesFor({ assigneeIds: ['usr_omar'] })).toContainEqual(
      expect.objectContaining({ field: 'assigneeIds' })
    );
    expect(issuesFor({ assigneeIds: ['usr_missing'] })).toContainEqual(
      expect.objectContaining({ field: 'assigneeIds' })
    );
  });

  it('holds points to a whole number inside the task range', () => {
    expect(issuesFor({ points: 12.5 })).toContainEqual(expect.objectContaining({ field: 'points' }));
    expect(issuesFor({ points: TASK_LIMITS.pointsMin - 1 })).toContainEqual(
      expect.objectContaining({ field: 'points' })
    );
    expect(issuesFor({ points: TASK_LIMITS.pointsMax + 1 })).toContainEqual(
      expect.objectContaining({ field: 'points' })
    );
  });

  it('refuses impossible dates and a deadline before the start', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(issuesFor({ startDate: '2026-02-30' })).toContainEqual(
      expect.objectContaining({ field: 'startDate' })
    );
    expect(issuesFor({ deadline: '' })).toContainEqual(expect.objectContaining({ field: 'deadline' }));
    expect(issuesFor({ startDate: '2026-11-21', deadline: '2026-11-20' })).toContainEqual(
      expect.objectContaining({ field: 'deadline' })
    );
  });

  it('caps the criteria list and each criterion', () => {
    const many = Array.from({ length: TASK_LIMITS.criteria + 1 }, (_, i) => `criterion ${i}`);
    expect(issuesFor({ acceptanceCriteria: many })).toContainEqual(
      expect.objectContaining({ field: 'acceptanceCriteria' })
    );
    expect(issuesFor({ acceptanceCriteria: ['x'.repeat(TASK_LIMITS.criterion + 1)] })).toContainEqual(
      expect.objectContaining({ field: 'acceptanceCriteria' })
    );
  });

  it('requires a category and keeps it short enough to store', () => {
    expect(issuesFor({ category: '  ' })).toContainEqual(expect.objectContaining({ field: 'category' }));
    expect(issuesFor({ category: 'x'.repeat(TASK_LIMITS.category + 1) })).toContainEqual(
      expect.objectContaining({ field: 'category' })
    );
  });
});

describe('normalising a draft does not change what the editor chose', () => {
  it('trims text, removes blank criteria and de-duplicates assignees', () => {
    const normalized = normalizeTaskDraft(
      draft({
        title: '  Narrow the brief  ',
        assigneeIds: ['usr_nada', 'usr_nada'],
        acceptanceCriteria: ['  one  ', '   ', 'two'],
        category: '  Workshop  ',
      })
    );
    expect(normalized.title).toBe('Narrow the brief');
    expect(normalized.assigneeIds).toEqual(['usr_nada']);
    expect(normalized.acceptanceCriteria).toEqual(['one', 'two']);
    expect(normalized.category).toBe('Workshop');
  });

  it('round-trips a stored task without touching its history fields', () => {
    const task = {
      id: 'tsk_1',
      title: 'Ultrasonic Testing Lab',
      description: 'Run the session.',
      committeeId: 'comm_te',
      committeeName: 'Technical & Engineering',
      assigneeIds: ['usr_nada'],
      assigneeNames: ['usr_nada'],
      createdById: 'usr_admin',
      createdByName: 'Kareem',
      priority: 'high',
      points: 40,
      startDate: '2026-10-20',
      deadline: '2026-11-20',
      status: 'submitted',
      acceptanceCriteria: ['Report filed'],
      referenceLinks: ['https://example.test/report'],
      category: 'Workshop',
      createdAt: '2026-10-20',
      archivedAt: undefined,
    } satisfies Task;
    const editable = draftFromTask(task);
    expect(editable).not.toHaveProperty('status');
    expect(editable).not.toHaveProperty('archivedAt');
    expect(editable).not.toHaveProperty('referenceLinks');
    expect(editable).toMatchObject({ title: task.title, points: task.points, category: task.category });
  });
});
