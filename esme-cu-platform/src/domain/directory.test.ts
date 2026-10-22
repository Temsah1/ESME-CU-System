// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import { mergeDirectory, type DirectoryAccount } from './directory';

/**
 * The committee repairs exposed a second stale-copy bug further upstream: the dashboard kept
 * its own copy of a person's name, role and status, so an approval or a rename in the provider
 * never reached the screens. These tests pin who wins when the two disagree.
 */

function account(patch: Partial<DirectoryAccount> & Pick<DirectoryAccount, 'id'>): DirectoryAccount {
  return {
    email: `${patch.id}@esme.example`,
    username: patch.id ?? 'account',
    displayName: 'Account Holder',
    role: 'member',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function profile(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'Cached Name',
    email: `${patch.id}@esme.example`,
    username: patch.id ?? 'cached',
    role: 'member',
    status: 'pending_approval',
    totalPoints: 40,
    approvedTasksCount: 3,
    joinedDate: '2025-09-01',
    lastActive: 'Yesterday',
    ...patch,
  };
}

describe('directory merge', () => {
  it('takes identity from the provider and keeps workspace records', () => {
    const cached = profile({ id: 'u1', name: 'Old Name', role: 'member', status: 'pending_approval', committeeId: 'comm_te' });
    const { merged, corrected, added } = mergeDirectory([cached], [account({ id: 'u1', displayName: 'New Name', role: 'head', status: 'active' })]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: 'New Name',
      role: 'head',
      status: 'active',
      committeeId: 'comm_te',
      totalPoints: 40,
      approvedTasksCount: 3,
      joinedDate: '2025-09-01',
      lastActive: 'Yesterday',
    });
    expect({ corrected, added }).toEqual({ corrected: 1, added: 0 });
  });

  it('seeds a committee home only when the cached profile has none', () => {
    const withoutHome = profile({ id: 'u2', committeeId: undefined });
    expect(mergeDirectory([withoutHome], [account({ id: 'u2', committeeId: 'comm_mc' })]).merged[0].committeeId).toBe('comm_mc');

    const withHome = profile({ id: 'u3', committeeId: 'comm_te' });
    expect(mergeDirectory([withHome], [account({ id: 'u3', committeeId: undefined })]).merged[0].committeeId).toBe('comm_te');
  });

  it('adds accounts the cache never held, using the provider’s own join date', () => {
    const { merged, added } = mergeDirectory([], [account({ id: 'u4', displayName: 'Aya', createdAt: '2026-03-05T10:00:00.000Z' })]);
    expect(added).toBe(1);
    expect(merged[0]).toMatchObject({ id: 'u4', name: 'Aya', joinedDate: '2026-03-05', totalPoints: 0 });
  });

  it('keeps local-only rows and reports them instead of deleting them', () => {
    const ghost = profile({ id: 'u5', name: 'Record With No Provider Account' });
    const { merged, unmatched } = mergeDirectory([ghost], [account({ id: 'u6' })]);
    expect(merged.map((u) => u.id)).toEqual(['u6', 'u5']);
    expect(unmatched).toEqual(['u5']);
  });

  it('counts an unchanged row as unchanged, so a sync is not mistaken for an edit', () => {
    const same = profile({ id: 'u7', name: 'Same', email: 'same@esme.example', username: 'u7', role: 'member', status: 'active' });
    const { unchanged, corrected } = mergeDirectory([same], [account({ id: 'u7', displayName: 'Same', email: 'same@esme.example', username: 'u7' })]);
    expect({ unchanged, corrected }).toEqual({ unchanged: 1, corrected: 0 });
  });

  it('refuses to let a cached suspended flag survive an activation', () => {
    const suspended = profile({ id: 'u8', status: 'suspended' });
    const { merged } = mergeDirectory([suspended], [account({ id: 'u8', status: 'active' })]);
    expect(merged[0].status).toBe('active');
  });
});
