import type { Role } from '../types';

export type { Role };

export type Capability =
  | 'users.read'
  | 'users.create'
  | 'users.update'
  | 'users.delete'
  | 'users.role.assign'
  | 'users.suspend'
  | 'registrations.read'
  | 'registrations.decide'
  | 'committees.read'
  | 'committees.write'
  | 'committees.archive'
  | 'tasks.read'
  | 'tasks.write'
  | 'tasks.assign'
  | 'tasks.delete'
  | 'submissions.read'
  | 'submissions.review'
  | 'submissions.create'
  | 'scores.read'
  | 'scores.adjust'
  | 'events.read'
  | 'events.write'
  | 'skills.read'
  | 'skills.manage'
  | 'analytics.configure'
  | 'cms.settings.global'
  | 'cms.content.write'
  | 'cms.content.publish'
  | 'cms.media.manage'
  | 'notifications.manage'
  | 'audit.read'
  | 'settings.manage'
  | 'integrations.manage'
  | 'backups.manage';

/**
 * `all` — every record.
 * `committee` — records belonging to the actor's committee.
 * `self` — only the actor's own records.
 */
export type Scope = 'all' | 'committee' | 'self';

export const ALL_ROLES: Role[] = ['super_admin', 'director', 'head', 'moderator', 'member'];

/** Display names only — never an authority. */
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  moderator: 'IT Moderator',
  director: 'Committee Director',
  head: 'Team Head',
  member: 'Member',
};

/** Roles that hold privileged power. Only a Super Admin may grant or revoke them. */
export const PRIVILEGED_ROLES: Role[] = ['super_admin', 'director', 'head', 'moderator'];

/** The single pre-provisioned administrator. Email/username identify it; the provider authenticates it. */
export const PRIMARY_ADMIN = {
  email: 'kareemeltemsah7@gmail.com',
  username: 'temsah1',
} as const;

type Matrix = Partial<Record<Role, Partial<Record<Capability, Scope>>>>;

const MATRIX: Matrix = {
  super_admin: {
    'users.read': 'all',
    'users.create': 'all',
    'users.update': 'all',
    'users.delete': 'all',
    'users.role.assign': 'all',
    'users.suspend': 'all',
    'registrations.read': 'all',
    'registrations.decide': 'all',
    'committees.read': 'all',
    'committees.write': 'all',
    'committees.archive': 'all',
    'tasks.read': 'all',
    'tasks.write': 'all',
    'tasks.assign': 'all',
    'tasks.delete': 'all',
    'submissions.read': 'all',
    'submissions.review': 'all',
    'submissions.create': 'self',
    'scores.read': 'all',
    'scores.adjust': 'all',
    'events.read': 'all',
    'events.write': 'all',
    'skills.read': 'all',
    'skills.manage': 'all',
    'analytics.configure': 'all',
    'cms.settings.global': 'all',
    'cms.content.write': 'all',
    'cms.content.publish': 'all',
    'cms.media.manage': 'all',
    'notifications.manage': 'all',
    'audit.read': 'all',
    'settings.manage': 'all',
    'integrations.manage': 'all',
    'backups.manage': 'all',
  },
  moderator: {
    'users.read': 'all',
    'registrations.read': 'all',
    'registrations.decide': 'all',
    'committees.read': 'all',
    'tasks.read': 'all',
    'submissions.read': 'all',
    'submissions.review': 'all',
    'scores.read': 'all',
    'events.read': 'all',
    'cms.settings.global': 'all',
    'cms.content.write': 'all',
    'cms.content.publish': 'all',
    'cms.media.manage': 'all',
    'notifications.manage': 'all',
    'audit.read': 'all',
  },
  director: {
    'users.read': 'committee',
    'users.update': 'committee',
    'registrations.read': 'committee',
    'committees.read': 'all',
    'committees.write': 'committee',
    'tasks.read': 'all',
    'tasks.write': 'committee',
    'tasks.assign': 'committee',
    'submissions.read': 'committee',
    'submissions.review': 'committee',
    'submissions.create': 'self',
    'scores.read': 'committee',
    'events.read': 'all',
    'events.write': 'committee',
    'skills.read': 'committee',
    'skills.manage': 'committee',
    'analytics.configure': 'committee',
    'cms.content.write': 'committee',
  },
  head: {
    'users.read': 'committee',
    'committees.read': 'all',
    'tasks.read': 'all',
    'tasks.write': 'committee',
    'tasks.assign': 'committee',
    'submissions.read': 'committee',
    'submissions.review': 'committee',
    'submissions.create': 'self',
    'scores.read': 'committee',
    'events.read': 'all',
    'skills.read': 'committee',
    'cms.content.write': 'committee',
  },
  member: {
    'committees.read': 'all',
    'tasks.read': 'committee',
    'tasks.write': 'self',
    'submissions.read': 'self',
    'submissions.create': 'self',
    'scores.read': 'self',
    'events.read': 'all',
    'skills.read': 'self',
  },
};

export function scopeFor(role: Role, capability: Capability): Scope | null {
  return MATRIX[role]?.[capability] ?? null;
}

export function hasCapability(role: Role, capability: Capability): boolean {
  return scopeFor(role, capability) !== null;
}

export function capabilitiesFor(role: Role): Capability[] {
  return Object.keys(MATRIX[role] ?? {}) as Capability[];
}

/**
 * Committee-scoped capabilities only apply when the actor actually belongs to the
 * target committee. `self`-scoped capabilities apply only to the actor's own records.
 */
export function canActOn(
  actor: { role: Role; id: string; committeeId?: string },
  capability: Capability,
  target: { id?: string; committeeId?: string } = {}
): boolean {
  const scope = scopeFor(actor.role, capability);
  if (scope === null) return false;
  if (scope === 'all') return true;
  if (scope === 'self') return target.id === undefined || target.id === actor.id;
  if (actor.committeeId === undefined) return false;
  return target.committeeId === undefined || target.committeeId === actor.committeeId;
}

export function isPrimaryAdmin(account: { email?: string; username?: string }): boolean {
  const email = account.email?.trim().toLowerCase();
  const username = account.username?.trim().toLowerCase();
  return email === PRIMARY_ADMIN.email || username === PRIMARY_ADMIN.username.toLowerCase();
}

export type RoleChangeRejection =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Server-side privilege-escalation rules. Mirrored by the RLS policies in supabase/migrations. */
export function validateRoleChange(
  actor: { role: Role; id: string },
  target: { id: string; role: Role },
  nextRole: Role,
  targetIsPrimaryAdmin = false
): RoleChangeRejection {
  if (!hasCapability(actor.role, 'users.role.assign')) {
    return { allowed: false, reason: 'Only a Super Admin may change roles.' };
  }
  if (targetIsPrimaryAdmin && nextRole !== 'super_admin') {
    return { allowed: false, reason: 'The primary Super Admin account cannot be demoted.' };
  }
  if (targetIsPrimaryAdmin && target.id !== actor.id) {
    return { allowed: false, reason: 'The primary Super Admin account is protected.' };
  }
  const grantsPrivilege = PRIVILEGED_ROLES.includes(nextRole);
  if (grantsPrivilege && actor.role !== 'super_admin') {
    return { allowed: false, reason: 'Only a Super Admin may grant a privileged role.' };
  }
  if (nextRole === 'super_admin' && actor.role !== 'super_admin') {
    return { allowed: false, reason: 'Only a Super Admin may create another Super Admin.' };
  }
  return { allowed: true };
}

/** Roles an applicant may request through public registration — never a privileged role. */
export const PUBLIC_REGISTRATION_ROLE: Role = 'member';
