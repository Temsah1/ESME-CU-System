import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  User,
  Committee,
  Task,
  TaskSubmission,
  ScoreLedgerEntry,
  RegistrationApplication,
  RegistrationFieldConfig,
  SeasonEvent,
  SkillMatrixEntry,
  AuditLogItem,
  NotificationItem,
  WebsiteContentConfig,
} from '../types';
import {
  REFERENCE_COMMITTEES,
  REFERENCE_FORM_FIELDS,
  REFERENCE_SEASON_EVENTS,
  REFERENCE_WEBSITE_CONTENT,
} from '../data/referenceContent';
import { readV2, runStorageMigrations, storageVersion, writeV2, type MigrationReport } from '../storage/migrations';
import { useAuth } from '../auth/AuthProvider';
import {
  canActOn,
  hasCapability,
  isPrimaryAdmin,
  scopeFor,
  validateRoleChange,
  type Capability,
  type Role,
} from '../domain/roles';
import type { AccountStatus } from '../domain/accountState';
import { applicationStageFor } from '../domain/accountState';
import type { RegistrationRecord } from '../auth/types';
import { assertTaskMove, canMoveSubmission, checkRevisionFeedback, checkReview, rubricFor, scoreRubric, selfServiceMoves } from '../domain/workflow';
import { appendAuditEntry } from '../domain/audit';
import {
  METRIC_DEFINITIONS,
  decideAppeal,
  validateAppeal,
  type AppealStatus,
  type MetricId,
  type ScoreAppeal,
} from '../domain/metrics';

/**
 * Operational collections start EMPTY.
 *
 * There is no fallback array of fictional members, tasks, submissions, scores,
 * applications, skill assessments, notifications or audit events in this file.
 * A fresh install renders empty states; real records arrive through the
 * authenticated backend once it is configured.
 */
const EMPTY_USERS: User[] = [];
const EMPTY_TASKS: Task[] = [];
const EMPTY_SUBMISSIONS: TaskSubmission[] = [];
const EMPTY_LEDGER: ScoreLedgerEntry[] = [];
const EMPTY_APPLICATIONS: RegistrationApplication[] = [];
const EMPTY_SKILLS: SkillMatrixEntry[] = [];
const EMPTY_NOTIFICATIONS: NotificationItem[] = [];
const EMPTY_AUDIT: AuditLogItem[] = [];

export class CapabilityError extends Error {
  constructor(capability: Capability) {
    super(`Not permitted: your role does not grant "${capability}".`);
    this.name = 'CapabilityError';
  }
}

interface AppContextType {
  /** Signed-in actor, derived from the provider session. Null while signed out. */
  currentUser: User | null;
  authStatus: ReturnType<typeof useAuth>['status'];
  can: (capability: Capability, target?: { id?: string; committeeId?: string }) => boolean;

  users: User[];
  addUser: (
    user: Omit<
      User,
      'id' | 'totalPoints' | 'approvedTasksCount' | 'joinedDate' | 'lastActive' | 'emailVerified' | 'status'
    >
  ) => void;
  updateUser: (id: string, updates: Partial<User>) => void;
  setAccountStatus: (id: string, status: AccountStatus) => Promise<void>;
  assignRole: (id: string, role: Role) => Promise<void>;
  deleteUser: (id: string) => void;

  committees: Committee[];
  addCommittee: (committee: Omit<Committee, 'id' | 'memberCount'>) => void;
  updateCommittee: (id: string, updates: Partial<Committee>) => void;
  archiveCommittee: (id: string) => void;

  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  /** Assignee-driven lifecycle moves; everything else comes from filing or reviewing. */
  moveTask: (id: string, to: Task['status']) => void;
  /** Board-side review moves. Approval is not one of them — see the review centre. */
  reviewTask: (id: string, to: 'under_review' | 'revision_requested' | 'rejected', feedback?: string) => void;

  submissions: TaskSubmission[];
  addSubmission: (submission: Omit<TaskSubmission, 'id' | 'submittedAt' | 'version' | 'status'>) => void;
  reviewSubmission: (
    submissionId: string,
    decision: 'approved' | 'rejected' | 'revision_requested',
    feedback: string,
    awardedPoints?: number,
    rubricMarks?: Record<string, 0 | 1 | 2 | null | undefined>
  ) => void;
  /** The UNDER_REVIEW step of the delivery lifecycle: claims the row without deciding it. */
  startSubmissionReview: (submissionId: string) => void;

  scoreLedger: ScoreLedgerEntry[];
  addManualPointAdjustment: (memberId: string, points: number, reason: string) => void;

  scoreAppeals: ScoreAppeal[];
  /** A member disputes a figure. Nothing here changes a score — it opens a record for an officer. */
  fileScoreAppeal: (input: { metric: MetricId; periodLabel: string; reason: string }) => void;
  decideScoreAppeal: (id: string, status: Exclude<AppealStatus, 'open'>, note: string) => void;

  applications: RegistrationApplication[];
  /** Where the queue was read from, so the board can say so out loud. */
  registrationQueue: { from: 'provider' | 'local'; error: string | null };
  refreshRegistrationQueue: () => Promise<void>;
  submitApplication: (
    application: Omit<RegistrationApplication, 'id' | 'appliedDate' | 'status' | 'emailVerified'>
  ) => void;
  updateApplicationStatus: (
    id: string,
    status: RegistrationApplication['status'],
    notes?: string,
    committeeId?: string
  ) => Promise<void>;

  formFields: RegistrationFieldConfig[];
  updateFormFields: (fields: RegistrationFieldConfig[]) => void;

  seasonEvents: SeasonEvent[];
  addSeasonEvent: (event: Omit<SeasonEvent, 'id'>) => void;
  updateSeasonEvent: (id: string, updates: Partial<SeasonEvent>) => void;

  skillMatrix: SkillMatrixEntry[];
  updateMemberSkill: (id: string, updates: Partial<SkillMatrixEntry>) => void;
  addMemberSkill: (entry: Omit<SkillMatrixEntry, 'id'>) => void;

  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;

  auditLogs: AuditLogItem[];
  logAction: (action: string, targetType: AuditLogItem['targetType'], targetId: string, details: string) => void;

  websiteContent: WebsiteContentConfig;
  updateWebsiteContent: (updates: Partial<WebsiteContentConfig>) => void;

  theme: 'light' | 'dark' | 'system';
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  resetLocalCache: () => void;
  exportDataJSON: () => string;
  importDataJSON: (jsonStr: string) => boolean;
  storageVersion: string;
  storageMigration: MigrationReport;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 16);

/**
 * The provider's queue row is the authority for who exists and where their request stands.
 * A locally captured questionnaire only fills fields the provider does not carry.
 */
function applicationFromRecord(record: RegistrationRecord, existing?: RegistrationApplication): RegistrationApplication {
  const base: RegistrationApplication = existing ?? {
    id: `app_${record.id}`,
    fullName: record.fullName,
    universityEmail: record.email,
    studentId: record.studentId ?? '',
    academicYear: record.academicYear ?? '',
    department: record.department ?? '',
    phone: record.phone ?? '',
    preferredCommitteeId: record.committeeId ?? '',
    secondCommitteePreferenceId: record.secondCommitteePreferenceId,
    technicalSkills: record.technicalSkills,
    previousExperience: record.previousExperience,
    motivation: record.motivation,
    availabilityHours: record.availabilityHours,
    agreedToPolicies: record.agreedToPolicies,
    appliedDate: record.submittedAt,
    status: applicationStageFor(record.status),
    emailVerified: record.emailVerified,
    authUserId: record.id,
  };
  return {
    ...base,
    fullName: record.fullName,
    universityEmail: record.email,
    emailVerified: record.emailVerified,
    status: applicationStageFor(record.status),
    accountStatus: record.status,
    authUserId: record.id,
    appliedDate: base.appliedDate || record.submittedAt,
    rejectionReason: record.rejectionReason ?? base.rejectionReason,
    assignedCommitteeId: record.assignedCommitteeId ?? base.assignedCommitteeId,
    reviewedBy: record.decisionBy ?? base.reviewedBy,
    technicalSkills: base.technicalSkills || record.technicalSkills,
    previousExperience: base.previousExperience || record.previousExperience,
    motivation: base.motivation || record.motivation,
    availabilityHours: base.availabilityHours || record.availabilityHours,
  };
}

// One-shot V1 -> V2 cleanup, run while this module loads so it precedes the first
// collection read. Idempotent: it writes a version key and returns early once present.
const storageMigration = runStorageMigrations();

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const identity = auth.identity;

  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() =>
    readV2<'light' | 'dark' | 'system'>('theme', 'system')
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  const [users, setUsers] = useState<User[]>(EMPTY_USERS);
  const [committees, setCommittees] = useState<Committee[]>(() => readV2('committees', REFERENCE_COMMITTEES));
  const [tasks, setTasks] = useState<Task[]>(EMPTY_TASKS);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>(EMPTY_SUBMISSIONS);
  const [scoreLedger, setScoreLedger] = useState<ScoreLedgerEntry[]>(EMPTY_LEDGER);
  const [applications, setApplications] = useState<RegistrationApplication[]>(EMPTY_APPLICATIONS);
  const [queueSource, setQueueSource] = useState<'provider' | 'local'>('local');
  const [queueError, setQueueError] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<RegistrationFieldConfig[]>(() =>
    readV2('formFields', REFERENCE_FORM_FIELDS)
  );
  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[]>(() =>
    readV2('seasonEvents', REFERENCE_SEASON_EVENTS)
  );
  const [skillMatrix, setSkillMatrix] = useState<SkillMatrixEntry[]>(EMPTY_SKILLS);
  const [notifications, setNotifications] = useState<NotificationItem[]>(EMPTY_NOTIFICATIONS);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => readV2('auditLogs', EMPTY_AUDIT));
  const [scoreAppeals, setScoreAppeals] = useState<ScoreAppeal[]>(() => readV2('scoreAppeals', []));
  const [websiteContent, setWebsiteContent] = useState<WebsiteContentConfig>(() =>
    readV2('websiteContent', REFERENCE_WEBSITE_CONTENT)
  );

  // Reference content is cached locally; the CMS publish path is what makes it authoritative.
  useEffect(() => writeV2('committees', committees), [committees]);
  useEffect(() => writeV2('formFields', formFields), [formFields]);
  useEffect(() => writeV2('seasonEvents', seasonEvents), [seasonEvents]);
  useEffect(() => writeV2('websiteContent', websiteContent), [websiteContent]);
  useEffect(() => writeV2('theme', theme), [theme]);
  // Audit entries survive a reload: an accountability record that lives only until F5 is not one.
  useEffect(() => writeV2('auditLogs', auditLogs), [auditLogs]);
  // A dispute lodged yesterday must still be answerable tomorrow.
  useEffect(() => writeV2('scoreAppeals', scoreAppeals), [scoreAppeals]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Theme applies to <html>, so the public site, dashboard, dialogs and charts all follow it.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const currentUser = useMemo<User | null>(() => {
    if (!identity) return null;
    const profile = users.find((u) => u.id === identity.id);
    return {
      id: identity.id,
      name: identity.displayName,
      email: identity.email,
      username: identity.username,
      role: identity.role,
      status: identity.status,
      emailVerified: identity.emailVerified,
      committeeId: identity.committeeId,
      subTeam: profile?.subTeam,
      academicYear: profile?.academicYear,
      department: profile?.department,
      studentId: profile?.studentId,
      phone: profile?.phone,
      avatar: profile?.avatar,
      totalPoints: profile?.totalPoints ?? 0,
      approvedTasksCount: profile?.approvedTasksCount ?? 0,
      joinedDate: profile?.joinedDate ?? '—',
      lastActive: profile?.lastActive ?? 'Just now',
    } as User;
  }, [identity, users]);

  const can = (capability: Capability, target?: { id?: string; committeeId?: string }) => {
    if (!currentUser) return false;
    if (!hasCapability(currentUser.role, capability)) return false;
    return canActOn(currentUser, capability, target ?? {});
  };

  const guard = (capability: Capability, target?: { id?: string; committeeId?: string }) => {
    if (!can(capability, target)) throw new CapabilityError(capability);
  };

  const logAction = (action: string, targetType: AuditLogItem['targetType'], targetId: string, details: string) => {
    if (!currentUser) return;
    const entry: AuditLogItem = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action,
      targetType,
      targetId,
      details,
      timestamp: stamp(),
    };
    setAuditLogs((prev) => appendAuditEntry(prev, entry));
  };

  /**
   * A member's tasks.write is scoped to rows they are on, so the target must name the
   * member; passing only a committee would let any member edit anyone's task.
   */
  const guardTaskWrite = (task: Task) => {
    if (!currentUser) throw new CapabilityError('tasks.write');
    if (scopeFor(currentUser.role, 'tasks.write') === 'self' && !task.assigneeIds.includes(currentUser.id)) {
      throw new CapabilityError('tasks.write');
    }
    guard('tasks.write', { id: currentUser.id, committeeId: task.committeeId });
  };

  const moveTask: AppContextType['moveTask'] = (id, to) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error('That task is not in this workspace.');
    guardTaskWrite(task);
    const allowed = selfServiceMoves(task.status);
    if (!allowed.includes(to)) {
      throw new Error(
        allowed.length
          ? `From ${task.status.replace(/_/g, ' ')} you may only move this task to ${allowed.join(' or ')}.`
          : `${task.title} is closed — its status is not changed from the board.`
      );
    }
    assertTaskMove(task.status, to);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
    logAction(
      'Moved Task',
      'task',
      id,
      `${currentUser?.name ?? 'An assignee'}: ${task.title} moved ${task.status.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}`
    );
  };

  /**
   * Claiming, returning or rejecting work from the board. Approval is deliberately absent:
   * it is recorded only in the review center, where the rubric and the independent-reviewer
   * check run, so a board shortcut cannot mint an approval with no quality basis.
   */
  const reviewTask: AppContextType['reviewTask'] = (id, to, feedback) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error('That task is not in this workspace.');
    if (!currentUser) throw new CapabilityError('submissions.review');
    if (task.status !== 'submitted' && task.status !== 'under_review') {
      throw new Error(`Only work that has been filed is reviewed; ${task.title} is ${task.status.replace(/_/g, ' ')}.`);
    }
    guard('submissions.review', { committeeId: task.committeeId });
    if (to === 'revision_requested') {
      const note = checkRevisionFeedback(feedback);
      if (!note.allowed) throw new Error(note.reason);
    }
    assertTaskMove(task.status, to);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
    logAction(
      'Reviewed Task',
      'task',
      id,
      `${currentUser.name}: ${task.title} ${to.replace(/_/g, ' ')}${feedback?.trim() ? ` — ${feedback.trim()}` : ''}`
    );
  };

  const addUser: AppContextType['addUser'] = (userData) => {
    guard('users.create');
    const newUser: User = {
      ...userData,
      id: `usr_${Date.now()}`,
      // A provisioned account still starts unapproved; activation is an explicit decision.
      status: 'pending_approval',
      emailVerified: false,
      totalPoints: 0,
      approvedTasksCount: 0,
      joinedDate: new Date().toISOString().split('T')[0],
      lastActive: 'Never signed in',
    };
    setUsers((prev) => [newUser, ...prev]);
    logAction('Provisioned User', 'user', newUser.id, `Created profile for ${newUser.name} as ${newUser.role}`);
  };

  const updateUser: AppContextType['updateUser'] = (id, updates) => {
    // Role, status and score totals never travel through a profile edit.
    const { role: _role, status: _status, totalPoints: _points, approvedTasksCount: _count, ...safe } = updates;
    const target = users.find((u) => u.id === id);
    if (id !== currentUser?.id) guard('users.update', { committeeId: target?.committeeId });
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...safe } : u)));
    logAction('Updated User Profile', 'user', id, `Modified fields: ${Object.keys(safe).join(', ') || 'none'}`);
  };

  const setAccountStatus: AppContextType['setAccountStatus'] = async (id, status) => {
    const target = users.find((u) => u.id === id);
    guard('users.suspend', { committeeId: target?.committeeId });
    if (!target) return;
    if (target.email === identity?.email && status !== 'active') {
      throw new Error('You cannot lock your own account.');
    }
    const result = auth.adapter ? await auth.adapter.setAccountStatus(id, status) : { ok: true as const };
    if (!result.ok) throw new Error(result.error.message);
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
    logAction(`Account ${status.replace(/_/g, ' ')}`, 'user', id, `Status set to ${status}`);
  };

  /** Role grants never ride on a profile edit — they are their own privileged operation. */
  const assignRole: AppContextType['assignRole'] = async (id, role) => {
    const target = users.find((u) => u.id === id);
    if (!target || !currentUser) throw new Error('Member not found.');
    guard('users.role.assign', { committeeId: target.committeeId });
    const verdict = validateRoleChange(currentUser, target, role, isPrimaryAdmin(target));
    if (!verdict.allowed) throw new Error(verdict.reason);
    const result = auth.adapter ? await auth.adapter.assignRole(id, role) : { ok: true as const };
    if (!result.ok) throw new Error(result.error.message);
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    logAction(`Role set to ${role.replace(/_/g, ' ')}`, 'user', id, `${target.name}: ${target.role} → ${role}`);
  };

  const deleteUser: AppContextType['deleteUser'] = (id) => {
    const target = users.find((u) => u.id === id);
    guard('users.delete', { committeeId: target?.committeeId });
    if (!target) return;
    if (target.role === 'super_admin') throw new Error('A Super Admin account cannot be deleted here.');
    setUsers((prev) => prev.filter((u) => u.id !== id));
    logAction('Deleted User', 'user', id, `Removed user ${target.name}`);
  };

  const addCommittee: AppContextType['addCommittee'] = (commData) => {
    guard('committees.write');
    const newComm: Committee = { ...commData, id: `comm_${Date.now()}` };
    setCommittees((prev) => [...prev, newComm]);
    logAction('Created Committee', 'committee', newComm.id, `Created committee: ${newComm.name}`);
  };

  const updateCommittee: AppContextType['updateCommittee'] = (id, updates) => {
    guard('committees.write', { committeeId: id });
    setCommittees((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    logAction('Updated Committee', 'committee', id, 'Updated committee settings');
  };

  const archiveCommittee: AppContextType['archiveCommittee'] = (id) => {
    guard('committees.archive', { committeeId: id });
    setCommittees((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'archived' } : c)));
    logAction('Archived Committee', 'committee', id, 'Archived committee');
  };

  const addTask: AppContextType['addTask'] = (taskData) => {
    guard('tasks.write', { committeeId: taskData.committeeId });
    const newTask: Task = {
      ...taskData,
      id: `task_${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setTasks((prev) => [newTask, ...prev]);
    logAction('Created Task', 'task', newTask.id, `Created task: ${newTask.title}`);
  };

  const updateTask: AppContextType['updateTask'] = (id, updates) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error('That task is not in this workspace.');
    guardTaskWrite(task);
    if (updates.status && updates.status !== task.status) assertTaskMove(task.status, updates.status);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    logAction('Updated Task', 'task', id, `${currentUser?.name ?? 'Someone'} edited ${task.title}`);
  };

  const deleteTask: AppContextType['deleteTask'] = (id) => {
    const task = tasks.find((t) => t.id === id);
    guard('tasks.delete', { committeeId: task?.committeeId });
    setTasks((prev) => prev.filter((t) => t.id !== id));
    logAction('Deleted Task', 'task', id, 'Removed task');
  };

  const addSubmission: AppContextType['addSubmission'] = (subData) => {
    if (!currentUser) throw new CapabilityError('submissions.create');
    guard('submissions.create', { id: currentUser.id });
    const task = tasks.find((t) => t.id === subData.taskId);
    if (!task) throw new Error('That deliverable names a task this workspace does not hold.');
    assertTaskMove(task.status, 'submitted');
    const version = submissions.filter((s) => s.taskId === subData.taskId && s.memberId === currentUser.id).length + 1;
    const newSub: TaskSubmission = {
      ...subData,
      memberId: currentUser.id,
      memberName: currentUser.name,
      id: `sub_${Date.now()}`,
      submittedAt: stamp(),
      version,
      status: 'submitted',
    };
    setSubmissions((prev) => [newSub, ...prev]);
    setTasks((prev) => prev.map((t) => (t.id === subData.taskId ? { ...t, status: 'submitted' } : t)));
    logAction(
      'Submitted Task Deliverables',
      'submission',
      newSub.id,
      `${currentUser.name} submitted v${version} for ${task?.title ?? newSub.taskTitle}`
    );
  };

  const reviewSubmission: AppContextType['reviewSubmission'] = (submissionId, decision, feedback, awardedPoints, rubricMarks) => {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    guard('submissions.review', { id: sub.memberId, committeeId: sub.committeeId });

    if (!currentUser) throw new CapabilityError('submissions.review');
    const task = tasks.find((t) => t.id === sub.taskId);
    const rubric = scoreRubric(rubricFor(task?.category), rubricMarks ?? {});
    const verdict = checkReview(currentUser.id, sub, decision, rubric);
    if (!verdict.allowed) throw new Error(verdict.reason);
    if (decision === 'revision_requested') {
      const note = checkRevisionFeedback(feedback);
      if (!note.allowed) throw new Error(note.reason);
    }
    assertTaskMove(task?.status ?? 'submitted', decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'revision_requested');
    const criteria = rubricFor(task?.category);
    const markedCriteria = criteria
      .filter((c) => rubricMarks?.[c.id] === 0 || rubricMarks?.[c.id] === 1 || rubricMarks?.[c.id] === 2)
      .map((c) => ({ label: c.label, mark: rubricMarks?.[c.id] as 0 | 1 | 2 }));

    // A decided submission cannot be reviewed again, so a retried request cannot
    // double-award. The backend holds the same rule with a partial unique index on
    // esme_score_ledger (submission_id) plus an explicit guard in esme_record_review().
    if (sub.status === 'approved' || sub.status === 'rejected') {
      throw new Error(`This submission was already ${sub.status.replace(/_/g, ' ')}.`);
    }

    const points = decision === 'approved' ? (awardedPoints ?? sub.proposedPoints) : 0;

    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === submissionId
          ? {
              ...s,
              status: decision,
              reviewerFeedback: feedback,
              reviewedBy: currentUser.name,
              reviewedAt: stamp(),
              awardedPoints: points,
              reviewRubric: markedCriteria.length > 0 ? markedCriteria : s.reviewRubric,
              rubricPercent: rubric.percent ?? s.rubricPercent,
            }
          : s
      )
    );

    setTasks((prev) => prev.map((t) => (t.id === sub.taskId ? { ...t, status: decision } : t)));

    const alreadyAwarded = scoreLedger.some(
      (l) => l.taskId === sub.taskId && l.memberId === sub.memberId && l.actionType === 'task_completion'
    );

    if (decision === 'approved' && points > 0 && !alreadyAwarded) {
      const member = users.find((u) => u.id === sub.memberId);
      const previousTotal = member?.totalPoints ?? 0;
      const newTotal = previousTotal + points;
      setScoreLedger((prev) => [
        {
          id: `ledg_${Date.now()}`,
          memberId: sub.memberId,
          memberName: sub.memberName,
          committeeId: sub.committeeId,
          taskId: sub.taskId,
          taskTitle: sub.taskTitle,
          points,
          actionType: 'task_completion',
          reviewerId: currentUser?.id ?? 'system',
          reviewerName: currentUser?.name ?? 'system',
          timestamp: stamp(),
          reason: `Approved deliverables: ${sub.taskTitle}`,
          previousTotal,
          newTotal,
        },
        ...prev,
      ]);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === sub.memberId
            ? { ...u, totalPoints: newTotal, approvedTasksCount: u.approvedTasksCount + 1 }
            : u
        )
      );
    }

    logAction(
      `Reviewed Submission: ${decision.toUpperCase()}`,
      'submission',
      submissionId,
      `${decision} for ${sub.taskTitle} (${points > 0 ? `+${points}` : '0'} pts, rubric ${
        rubric.percent === null ? 'left unassessed' : `${rubric.percent}% over ${rubric.assessed} criteria`
      })`
    );
  };

  const startSubmissionReview: AppContextType['startSubmissionReview'] = (submissionId) => {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    guard('submissions.review', { id: sub.memberId, committeeId: sub.committeeId });
    if (!currentUser) throw new CapabilityError('submissions.review');
    if (!canMoveSubmission(sub.status, 'under_review')) {
      throw new Error(`A submission that is ${sub.status.replace(/_/g, ' ')} is not waiting for a reviewer.`);
    }
    const task = tasks.find((t) => t.id === sub.taskId);
    assertTaskMove(task?.status ?? 'submitted', 'under_review');
    setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? { ...s, status: 'under_review' } : s)));
    setTasks((prev) => prev.map((t) => (t.id === sub.taskId ? { ...t, status: 'under_review' } : t)));
    logAction(
      'Started Review',
      'submission',
      submissionId,
      `${currentUser.name} took ${sub.taskTitle} from ${sub.memberName} into review`
    );
  };

  const addManualPointAdjustment: AppContextType['addManualPointAdjustment'] = (memberId, points, reason) => {
    const member = users.find((u) => u.id === memberId);
    guard('scores.adjust', { committeeId: member?.committeeId });
    if (!member) throw new Error('That member is not in the roster visible to your account.');
    if (!Number.isFinite(points) || points === 0) throw new Error('An adjustment needs a non-zero point value.');
    if (reason.trim().length < 3) throw new Error('A score adjustment needs a written reason.');
    const previousTotal = member.totalPoints;
    const newTotal = previousTotal + points;
    setScoreLedger((prev) => [
      {
        id: `ledg_${Date.now()}`,
        memberId: member.id,
        memberName: member.name,
        committeeId: member.committeeId ?? '',
        points,
        actionType: 'manual_adjustment',
        reviewerId: currentUser?.id ?? 'system',
        reviewerName: currentUser?.name ?? 'system',
        timestamp: stamp(),
        reason,
        previousTotal,
        newTotal,
      },
      ...prev,
    ]);
    setUsers((prev) => prev.map((u) => (u.id === memberId ? { ...u, totalPoints: newTotal } : u)));
    logAction('Adjusted Member Score', 'score', memberId, `${points > 0 ? '+' : ''}${points} pts — ${reason}`);
  };

  /**
   * Filing a review request writes a record, not a correction. The figure under dispute stays
   * exactly as the metrics module computed it until an officer decides, and a decision that
   * changes a score is made separately as a reasoned, audited adjustment.
   */
  const fileScoreAppeal: AppContextType['fileScoreAppeal'] = ({ metric, periodLabel, reason }) => {
    if (!currentUser) throw new CapabilityError('scores.read');
    guard('scores.read', { id: currentUser.id });
    const errors = validateAppeal({ metric, periodLabel, reason });
    if (errors.length) throw new Error(errors.join(' '));
    const appeal: ScoreAppeal = {
      id: `apl_${Date.now()}`,
      memberId: currentUser.id,
      memberName: currentUser.name,
      metric,
      periodLabel: periodLabel.trim(),
      reason: reason.trim(),
      filedAt: stamp(),
      status: 'open',
    };
    setScoreAppeals((prev) => [appeal, ...prev]);
    logAction(
      'Filed Score Review Request',
      'score',
      appeal.id,
      `${currentUser.name} disputed ${METRIC_DEFINITIONS[metric].label} for ${appeal.periodLabel}`
    );
  };

  const decideScoreAppeal: AppContextType['decideScoreAppeal'] = (id, status, note) => {
    const appeal = scoreAppeals.find((a) => a.id === id);
    if (!appeal) throw new Error('That review request is not in this workspace.');
    if (!currentUser) throw new CapabilityError('scores.adjust');
    const member = users.find((u) => u.id === appeal.memberId);
    guard('scores.adjust', { committeeId: member?.committeeId });
    if (appeal.memberId === currentUser.id) {
      throw new Error('You cannot decide your own review request; another officer must answer it.');
    }
    const decided = decideAppeal(appeal, status, note, currentUser.name, stamp());
    setScoreAppeals((prev) => prev.map((a) => (a.id === id ? decided : a)));
    logAction('Decided Score Review Request', 'score', id, `${decided.status}: ${decided.decisionNote}`);
  };

  /**
   * The recruitment queue is read from the provider, so an approver on any signed-in device
   * decides the same record the applicant created. Local rows only supply questionnaire
   * answers the provider does not carry and requests the provider cannot see.
   */
  const refreshRegistrationQueue = useCallback(async () => {
    if (!auth.adapter || !identity) return;
    if (!hasCapability(identity.role, 'registrations.read')) return;
    try {
      const records = await auth.adapter.listRegistrations();
      setApplications((prev) => {
        const byRef = new Map(prev.map((a) => [a.authUserId, a] as const));
        const visible = records.map((r) => applicationFromRecord(r, byRef.get(r.id)));
        const fromProvider = new Set(records.map((r) => r.id));
        return [...visible, ...prev.filter((a) => !a.authUserId || !fromProvider.has(a.authUserId))];
      });
      setQueueSource('provider');
      setQueueError(null);
    } catch (error) {
      setQueueSource('local');
      setQueueError(error instanceof Error ? error.message : 'The registration queue could not be loaded.');
    }
  }, [auth.adapter, identity]);

  useEffect(() => {
    void refreshRegistrationQueue();
  }, [refreshRegistrationQueue]);

  const submitApplication: AppContextType['submitApplication'] = (applicationData) => {
    const newApp: RegistrationApplication = {
      ...applicationData,
      id: `app_${Date.now()}`,
      appliedDate: stamp(),
      status: 'pending',
      // An applicant cannot mark their own email as verified.
      emailVerified: false,
    };
    setApplications((prev) => [newApp, ...prev]);
    logAction('Application Submitted', 'application', newApp.id, `Application received from ${newApp.fullName}`);
  };

  const updateApplicationStatus: AppContextType['updateApplicationStatus'] = async (id, status, notes, committeeId) => {
    guard('registrations.decide');
    const app = applications.find((a) => a.id === id);
    if (!app) return;
    if (app.status === 'accepted' || app.status === 'rejected') {
      throw new Error('This application already has a decision.');
    }
    if (status === 'accepted' && !app.emailVerified) {
      throw new Error('The applicant has not verified their email address yet.');
    }
    // A decision is the provider's record first and this browser's copy second, so the
    // account status, welcome mail and audit entry all move from the same transaction.
    if (auth.adapter && app.authUserId && (status === 'accepted' || status === 'rejected')) {
      const result = await auth.adapter.decideRegistration(
        app.authUserId,
        status === 'accepted' ? 'approve' : 'reject',
        { reason: notes, committeeId }
      );
      if (!result.ok) throw new Error(result.error.message);
    }
    setApplications((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status,
              internalNotes: notes !== undefined ? notes : a.internalNotes,
              assignedCommitteeId: committeeId || a.assignedCommitteeId,
              reviewedBy: currentUser?.name ?? 'system',
              reviewedAt: stamp(),
            }
          : a
      )
    );
    logAction('Updated Application Status', 'application', id, `Status changed to ${status}`);
    await refreshRegistrationQueue();
  };

  const updateFormFields: AppContextType['updateFormFields'] = (fields) => {
    guard('cms.settings.global');
    setFormFields(fields);
    logAction('Updated Registration Form Builder', 'cms', 'form_builder', 'Saved registration form schema');
  };

  const addSeasonEvent: AppContextType['addSeasonEvent'] = (evtData) => {
    guard('events.write');
    const newEvt: SeasonEvent = { ...evtData, id: `evt_${Date.now()}` };
    setSeasonEvents((prev) => [...prev, newEvt]);
    logAction('Added Season Event', 'system', newEvt.id, `Added event: ${newEvt.title}`);
  };

  const updateSeasonEvent: AppContextType['updateSeasonEvent'] = (id, updates) => {
    guard('events.write');
    setSeasonEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    logAction('Updated Season Event', 'system', id, `Updated season event: ${id}`);
  };

  const updateMemberSkill: AppContextType['updateMemberSkill'] = (id, updates) => {
    const entry = skillMatrix.find((s) => s.id === id);
    guard('skills.manage', { committeeId: entry?.committeeId });
    setSkillMatrix((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    logAction('Updated Member Skill', 'user', id, 'Updated skill assessment level');
  };

  const addMemberSkill: AppContextType['addMemberSkill'] = (entry) => {
    guard('skills.manage', { committeeId: entry.committeeId });
    const newEntry: SkillMatrixEntry = { ...entry, id: `sk_${Date.now()}` };
    setSkillMatrix((prev) => [...prev, newEntry]);
    logAction(
      'Added Skill Assessment',
      'user',
      newEntry.id,
      `Assessed ${newEntry.memberName} in ${newEntry.skillName}`
    );
  };

  const markNotificationRead = (id: string) =>
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

  const clearAllNotifications = () => setNotifications([]);

  /**
   * Public site copy is a single global document, so editing it needs the global
   * settings capability rather than committee-scoped content rights. Saving here writes
   * the cached draft; a deploy is what puts it on the internet, and this app does not
   * deploy anything.
   */
  const updateWebsiteContent: AppContextType['updateWebsiteContent'] = (updates) => {
    guard('cms.settings.global');
    setWebsiteContent((prev) => ({ ...prev, ...updates }));
    logAction('Saved Website Content Draft', 'cms', 'website_config', 'Modified public page content in this browser');
  };

  const setTheme = (next: 'light' | 'dark' | 'system') => setThemeState(next);


  /** Clears this app's own cache and restores reference content. Never touches a backend. */
  const resetLocalCache = () => {
    ['committees', 'formFields', 'seasonEvents', 'websiteContent'].forEach((key) => {
      try {
        localStorage.removeItem(`ESME_CU_STATE_V2_${key}`);
      } catch {
        /* storage unavailable */
      }
    });
    setCommittees(REFERENCE_COMMITTEES);
    setFormFields(REFERENCE_FORM_FIELDS);
    setSeasonEvents(REFERENCE_SEASON_EVENTS);
    setWebsiteContent(REFERENCE_WEBSITE_CONTENT);
    // Operational collections return to empty, not to a fictional dataset.
    setUsers(EMPTY_USERS);
    setTasks(EMPTY_TASKS);
    setSubmissions(EMPTY_SUBMISSIONS);
    setScoreLedger(EMPTY_LEDGER);
    setApplications(EMPTY_APPLICATIONS);
    setSkillMatrix(EMPTY_SKILLS);
    setNotifications(EMPTY_NOTIFICATIONS);
    setAuditLogs(EMPTY_AUDIT);
    setScoreAppeals([]);
  };

  /** A snapshot of what this browser holds — the backup capability owns it, and it is not a backend export. */
  const exportDataJSON = () => {
    guard('backups.manage');
    return JSON.stringify(
      {
        schemaVersion: storageVersion(),
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser?.email ?? 'anonymous',
        committees,
        tasks,
        submissions,
        scoreLedger,
        scoreAppeals,
        applications,
        formFields,
        seasonEvents,
        skillMatrix,
        notifications,
        auditLogs,
        websiteContent,
      },
      null,
      2
    );
  };

  const importDataJSON = (jsonStr: string) => {
    guard('backups.manage');
    try {
      const parsed = JSON.parse(jsonStr) as Partial<Record<string, unknown>>;
      if (Array.isArray(parsed.committees)) setCommittees(parsed.committees as Committee[]);
      if (Array.isArray(parsed.tasks)) setTasks(parsed.tasks as Task[]);
      if (Array.isArray(parsed.submissions)) setSubmissions(parsed.submissions as TaskSubmission[]);
      if (Array.isArray(parsed.scoreLedger)) setScoreLedger(parsed.scoreLedger as ScoreLedgerEntry[]);
      if (Array.isArray(parsed.scoreAppeals)) setScoreAppeals(parsed.scoreAppeals as ScoreAppeal[]);
      if (Array.isArray(parsed.applications)) setApplications(parsed.applications as RegistrationApplication[]);
      if (Array.isArray(parsed.formFields)) setFormFields(parsed.formFields as RegistrationFieldConfig[]);
      if (Array.isArray(parsed.seasonEvents)) setSeasonEvents(parsed.seasonEvents as SeasonEvent[]);
      if (Array.isArray(parsed.skillMatrix)) setSkillMatrix(parsed.skillMatrix as SkillMatrixEntry[]);
      if (parsed.websiteContent) setWebsiteContent(parsed.websiteContent as WebsiteContentConfig);
      logAction('Imported Data', 'system', 'import', 'Restored a data snapshot');
      return true;
    } catch {
      return false;
    }
  };

  const value: AppContextType = {
    currentUser,
    authStatus: auth.status,
    can,
    users,
    addUser,
    updateUser,
    setAccountStatus,
    assignRole,
    deleteUser,
    committees,
    addCommittee,
    updateCommittee,
    archiveCommittee,
    tasks,
    addTask,
    updateTask,
    moveTask,
    reviewTask,
    deleteTask,
    submissions,
    addSubmission,
    reviewSubmission,
    startSubmissionReview,
    scoreLedger,
    addManualPointAdjustment,
    scoreAppeals,
    fileScoreAppeal,
    decideScoreAppeal,
    applications,
    registrationQueue: { from: queueSource, error: queueError },
    refreshRegistrationQueue,
    submitApplication,
    updateApplicationStatus,
    formFields,
    updateFormFields,
    seasonEvents,
    addSeasonEvent,
    updateSeasonEvent,
    skillMatrix,
    updateMemberSkill,
    addMemberSkill,
    notifications,
    markNotificationRead,
    clearAllNotifications,
    auditLogs,
    logAction,
    websiteContent,
    updateWebsiteContent,
    theme,
    resolvedTheme,
    setTheme,
    resetLocalCache,
    exportDataJSON,
    importDataJSON,
    storageVersion: storageVersion(),
    storageMigration,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextType => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>.');
  return ctx;
};

/**
 * The acting member, for surfaces that only ever render inside <RequireAuth>.
 * Throws instead of inventing a stand-in user, so a session that expired mid-view
 * fails loudly rather than writing rows under the wrong actor.
 */
export const useActor = (): User => {
  const { currentUser } = useApp();
  if (!currentUser) throw new CapabilityError('users.read');
  return currentUser;
};
