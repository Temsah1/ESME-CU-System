import type { AccountStatus } from './accountState';
import type { Role } from './roles';
import type { User } from '../types';

/**
 * The provider's view of one account, shaped like `AuthAccount` in the auth layer.
 * Declared here so this module keeps no dependency on the auth implementation — the
 * context passes adapter results straight in and TypeScript checks the fit.
 */
export type DirectoryAccount = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  committeeId?: string;
  createdAt: string;
};

export type DirectoryMerge = {
  merged: User[];
  added: number;
  corrected: number;
  unchanged: number;
  /** Ids the local cache holds that the provider did not return for this actor. */
  unmatched: string[];
};

/**
 * Joins the provider's accounts with the workspace records kept beside them.
 *
 * Two rules make the committee bugs impossible rather than merely rarer:
 *
 * 1. Identity is the provider's. A name, role, status or committee that the provider
 *    reports replaces whatever the cache held, so an approval or a rename cannot be
 *    shadowed by a stale copy — the same defect that kept a retired Head's name on the
 *    public site was a name copied onto a row that nothing ever refreshed.
 *
 * 2. Everything else is the workspace's. Points, approved-task counts, sub-team and the
 *    rest of a questionnaire are recorded here, not by the identity provider, so they
 *    survive the sync untouched.
 *
 * Local-only rows are kept, never deleted: a task or a score can still point at them, and
 * `unmatched` reports them so an operator sees the gap instead of trusting a silent merge.
 */
export function mergeDirectory(existing: User[], accounts: DirectoryAccount[]): DirectoryMerge {
  const byId = new Map(existing.map((u) => [u.id, u]));
  let added = 0;
  let corrected = 0;
  let unchanged = 0;
  const seen = new Set<string>();

  const merged: User[] = accounts.map((account) => {
    const current = byId.get(account.id);
    seen.add(account.id);
    if (!current) {
      added += 1;
      return {
        id: account.id,
        name: account.displayName,
        email: account.email,
        username: account.username,
        role: account.role,
        status: account.status,
        committeeId: account.committeeId,
        totalPoints: 0,
        approvedTasksCount: 0,
        joinedDate: account.createdAt ? account.createdAt.slice(0, 10) : '—',
        lastActive: 'Never signed in',
      };
    }
    const next: User = {
      ...current,
      name: account.displayName,
      email: account.email,
      username: account.username,
      role: account.role,
      status: account.status,
      committeeId: account.committeeId ?? current.committeeId,
    };
    if (JSON.stringify(next) === JSON.stringify(current)) unchanged += 1;
    else corrected += 1;
    return next;
  });

  const leftovers = existing.filter((u) => !seen.has(u.id));
  return {
    merged: merged.concat(leftovers),
    added,
    corrected,
    unchanged,
    unmatched: leftovers.map((u) => u.id),
  };
}
