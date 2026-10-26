// @vitest-environment jsdom
/**
 * The role-escalation matrix from the 2026-10-22 security review, run against the two layers that
 * actually answer in this environment: the development adapter's vault (the simulated server, whose
 * checks mirror the RLS policies) and the store (what the dashboard calls).
 *
 * Every refusal is asserted twice — that it refused, and that nothing moved — because a privilege
 * write that half-applied is worse than no guard at all. Denials are expected in the audit trail:
 * a trail that only holds successes cannot show that a boundary was ever tested.
 *
 * What this file cannot prove: Postgres. esme_assign_role(), the 0009 privilege-channel trigger and
 * the 0010 rules are checked as SQL *text* by migrationIntegrity.test.ts, and the behavioural proof
 * is probes P15–P21, which need a staging project and have never run.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../auth/types';
import type { AuditLogItem, User } from '../types';
import type { Role } from '../domain/roles';

const PASSWORD = 'Str0ng#Escalate1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const VAULT_KEY = 'ESME_CU_DEV_AUTH_V1';
const SESSION_KEY = 'ESME_CU_DEV_SESSION_V1';

type Store = {
  users: User[];
  auditLogs: AuditLogItem[];
  websiteContent: { hero: { headline: string }; images: Record<string, { assetId?: string; alt?: string }> };
  publishedContent: { hero: { headline: string }; images: Record<string, { assetId?: string; alt?: string }> };
  unpublishedChanges: string[];
  assignRole: (id: string, role: Role) => Promise<void>;
  setAccountStatus: (id: string, status: User['status']) => Promise<void>;
  updateUser: (id: string, updates: Partial<User>) => void;
  updateWebsiteContent: (updates: Partial<Store['websiteContent']>) => void;
  publishWebsiteContent: (label?: string) => { unresolvedSlots: string[] };
};

let TL: typeof import('@testing-library/react');
let V2: string;
let adapter: AuthAdapter;
let ctx: Store | null = null;

const vaultAccounts = () =>
  (JSON.parse(localStorage.getItem(VAULT_KEY) ?? '{"accounts":[]}') as {
    accounts: { id: string; email: string; role: Role; status: string; committeeId?: string }[];
  }).accounts;

const roleInVault = (id: string): Role | undefined => vaultAccounts().find((a) => a.id === id)?.role;

const journal = () =>
  (JSON.parse(localStorage.getItem(VAULT_KEY) ?? '{"audit":[]}') as {
    audit: { action: string; actorId?: string; targetId?: string; outcome?: string; previousRole?: Role; newRole?: Role }[];
  }).audit;

const auditLines = (match: (line: AuditLogItem) => boolean) => ctx?.auditLogs.filter(match) ?? [];

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  V2 = (await import('../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  ctx = null;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  const { createLocalDevAdapter } = await import('../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

async function mount() {
  const [{ AppProvider, useApp }, auth] = await Promise.all([import('../context/AppContext'), import('../auth/AuthProvider')]);

  const Probe: React.FC = () => {
    const value = useApp() as unknown as Store;
    React.useEffect(() => {
      ctx = value;
    }, [value]);
    return null;
  };
  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <auth.AuthProvider>
      <AppProvider>
        <Gate>
          <Probe />
        </Gate>
      </AppProvider>
    </auth.AuthProvider>
  );
  await TL.waitFor(() => {
    if (!ctx) throw new Error('the store has not rendered yet');
  });
}

/** An approved account with the role under test, built through the privileged paths. */
async function provision(key: string, role: Role = 'member'): Promise<string> {
  // Registration approval and role grants are privileged calls, so the administrator holds the
  // session while the fixture is built and gets out of the way again the moment it is not needed.
  const previous = localStorage.getItem(SESSION_KEY);
  await adapter.signOut();
  await adapter.signIn(ADMIN.email, PASSWORD);
  const id = await buildAccount(key, role);
  if (previous) localStorage.setItem(SESSION_KEY, previous);
  return id;
}

async function buildAccount(key: string, role: Role): Promise<string> {
  const identity = {
    fullName: `Test ${key}`,
    email: `${key}@escalation.test`,
    username: `esc_${key}`,
  };
  const reg = await adapter.register({
    ...identity,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    committeeId: 'comm_te',
    acceptedPolicies: true,
  });
  if (!reg.ok) throw new Error(`fixture registration refused: ${reg.failure.message}`);
  const id = reg.receipt.reference;
  const decide = await adapter.decideRegistration(id, 'approve');
  if (!decide.ok) throw new Error(`fixture approval refused: ${decide.error.message}`);
  if (role !== 'member') {
    const grant = await adapter.assignRole(id, role);
    if (!grant.ok) throw new Error(`fixture grant refused: ${grant.error.message}`);
  }
  localStorage.setItem(
    `${V2}userProfiles`,
    JSON.stringify([
      ...(JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[]),
      {
        id,
        name: identity.fullName,
        email: identity.email,
        username: identity.username,
        role,
        status: 'active',
        committeeId: 'comm_te',
        totalPoints: 0,
        approvedTasksCount: 0,
        joinedDate: '2026-01-01',
        lastActive: 'Just now',
      } satisfies User,
    ])
  );
  return id;
}

/** Signs in as somebody else and rebuilds the store, so no test inherits a stale session. */
async function signInAs(email: string) {
  await adapter.signOut();
  await adapter.signIn(email, PASSWORD);
  TL.cleanup();
  ctx = null;
  await mount();
}

describe('§7.1–7.3 — the accounts that must not be able to move a role', () => {
  it('refuses a member raising their own role, and leaves the row where it was', async () => {
    const id = await provision('self_raise');
    await signInAs('self_raise@escalation.test');

    await expect(ctx!.assignRole(id, 'super_admin')).rejects.toThrow(/users\.role\.assign|Only a Super Admin/);
    expect(roleInVault(id)).toBe('member');
    await TL.waitFor(() => {
      const refusal = auditLines((line) => line.action === 'Role Change Refused');
      if (refusal.length === 0) throw new Error('the refusal was not audited');
      expect(refusal[0].outcome).toBe('denied');
      expect(refusal[0].previousRole).toBe('member');
      expect(refusal[0].newRole).toBe('super_admin');
      expect(refusal[0].targetId).toBe(id);
    });
  });

  it('refuses a member raising somebody else', async () => {
    const other = await provision('peer_target', 'member');
    const caller = await provision('caller_member');
    await signInAs('caller_member@escalation.test');

    await expect(ctx!.assignRole(other, 'moderator')).rejects.toThrow();
    expect(roleInVault(other)).toBe('member');
    // The caller sees the row in the directory, and still cannot move it: scope decides reads, the
    // capability decides privilege, and neither is the other one's substitute.
    await TL.waitFor(() => {
      const refusal = auditLines((line) => line.outcome === 'denied');
      if (refusal.length === 0) throw new Error('the refusal was not audited');
      expect(refusal).toHaveLength(1);
      expect(refusal[0].targetId).toBe(other);
      expect(refusal[0].actorId).toBe(caller);
    });
  });

  it('refuses a Head and a Director granting themselves IT Moderator or High Board', async () => {
    const head = await provision('head_self', 'head');
    await signInAs('head_self@escalation.test');
    await expect(ctx!.assignRole(head, 'moderator')).rejects.toThrow(/users\.role\.assign/);
    expect(roleInVault(head)).toBe('head');

    const director = await provision('director_self', 'director');
    await signInAs('director_self@escalation.test');
    // high_board is the label 0002's privileged list left out; the matrix refuses the grant before
    // the list ever matters, and 0010 closes the same hole in SQL.
    await expect(ctx!.assignRole(director, 'high_board')).rejects.toThrow(/users\.role\.assign/);
    expect(roleInVault(director)).toBe('director');
  });
});

describe('§7.4–7.5 — the authorized paths', () => {
  it('gives IT Moderator no role-assignment capability, so an IT grant is refused until the matrix changes', async () => {
    // The review's policy is "only explicitly authorized IT administrators and Super Admins".
    // `moderator` is the IT role this project ships (docs/AUTHORIZATION.md), and it holds no
    // users.role.assign today, so the honest expected result here is a refusal — not a promotion.
    const it = await provision('it_admin', 'moderator');
    const target = await provision('it_target');
    await signInAs('it_admin@escalation.test');

    await expect(ctx!.assignRole(it, 'super_admin')).rejects.toThrow();
    await expect(ctx!.assignRole(target, 'high_board')).rejects.toThrow();
    expect(roleInVault(it)).toBe('moderator');
    expect(roleInVault(target)).toBe('member');
    await TL.waitFor(() => {
      const refusals = auditLines((line) => line.action === 'Role Change Refused');
      if (refusals.length !== 2) throw new Error(`expected two refusals, saw ${refusals.length}`);
      // Self-promotion is refused by the same row of the matrix that refuses a grant to somebody
      // else, so an IT account cannot reach Super Admin by either route.
      for (const line of refusals) expect(line.outcome).toBe('denied');
      expect(refusals.map((line) => line.targetId).sort()).toEqual([it, target].sort());
    });
    // The store refused before the vault was touched: the target's only vault line is the fixture
    // grant that made it an account, never a role change asked for by this session.
    expect(journal().filter((line) => line.targetId === target && line.action.startsWith('role_'))).toEqual([]);
  });

  it('applies a Super Admin grant and audits the actor, the target and both roles', async () => {
    const id = await provision('granted');
    await mount();

    await ctx!.assignRole(id, 'moderator');

    expect(roleInVault(id)).toBe('moderator');
    await TL.waitFor(() => {
      const grant = auditLines((line) => line.outcome === 'allowed' && line.newRole === 'moderator');
      if (grant.length === 0) throw new Error('the grant was not audited with its evidence');
      expect(grant[0].previousRole).toBe('member');
      expect(grant[0].actorId).toBe('usr_superadmin');
      expect(grant[0].targetId).toBe(id);
    });
    const line = journal().find((entry) => entry.targetId === id && entry.newRole === 'moderator');
    expect(line?.previousRole).toBe('member');
  });

  it('refuses the same administrator demoting their own account', async () => {
    await mount();
    await expect(ctx!.assignRole('usr_superadmin', 'member')).rejects.toThrow(/own role/);
    expect(roleInVault('usr_superadmin')).toBe('super_admin');
  });
});

describe('§7.6–7.8 — the paths that skip the interface', () => {
  it('refuses the adapter directly, which is what a hand-made request is', async () => {
    const target = await provision('direct_target', 'head');
    await signInAs('direct_target@escalation.test');
    TL.cleanup();
    ctx = null;

    // No store, no button, no React state: the call the browser would make if the UI were bypassed.
    await expect(adapter.assignRole(target, 'super_admin')).rejects.toThrow();
    expect(roleInVault(target)).toBe('head');
    const denial = journal().find((entry) => entry.action === 'role_change_denied' && entry.outcome === 'denied');
    expect(denial?.targetId).toBe(target);
  });

  it('refuses a peer activation by an ordinary member, who holds neither capability', async () => {
    await provision('status_actor');
    const pending = await adapter.register({
      fullName: 'Still Pending',
      email: 'pending_peer@escalation.test',
      username: 'esc_pending_peer',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      committeeId: 'comm_te',
      acceptedPolicies: true,
    });
    if (!pending.ok) throw new Error('registration refused');
    const pendingId = pending.receipt.reference;
    // The account signs up active; a reviewer's rejection is what leaves it inactive, so the
    // activation attempt below would be a real change rather than a no-op on an active row.
    const rejected = await adapter.decideRegistration(pendingId, 'reject', { reason: 'fixture' });
    expect(rejected.ok).toBe(true);

    await signInAs('status_actor@escalation.test');
    // The caller is one ordinary member trying to activate another — users.suspend and
    // registrations.decide are both outside the member row of the matrix.
    await expect(adapter.setAccountStatus(pendingId, 'active')).rejects.toThrow();
    expect(vaultAccounts().find((a) => a.id === pendingId)?.status).toBe('rejected');
    expect(journal().some((line) => line.action === 'status_change_denied' && line.outcome === 'denied')).toBe(true);
  });

  it('strips role and status from a profile edit, while keeping the fields that edit is for', async () => {
    const id = await provision('smuggle');
    await signInAs('smuggle@escalation.test');

    ctx!.updateUser(id, { name: 'Renamed By Its Owner', role: 'super_admin', status: 'active', totalPoints: 9999 });

    await TL.waitFor(() => {
      const row = ctx!.users.find((u) => u.id === id);
      if (!row) throw new Error('the directory lost the row');
      // The legitimate half of the write landed; the privileged half did not.
      expect(row.name).toBe('Renamed By Its Owner');
      expect(row.role).toBe('member');
      expect(row.totalPoints).toBe(0);
      expect(roleInVault(id)).toBe('member');
    });
    const refusal = auditLines((line) => line.action === 'Protected Field Write Refused');
    expect(refusal.length).toBe(1);
    expect(refusal[0].outcome).toBe('denied');
    expect(refusal[0].newRole).toBe('super_admin');
    expect(refusal[0].details).toMatch(/role member → super_admin/);
  });

  it('holds a member to their own committee even for a field that is not privileged', async () => {
    const other = await provision('other_committee', 'director');
    await provision('scoped_caller');
    await signInAs('scoped_caller@escalation.test');

    expect(ctx!.users.find((u) => u.id === other)?.committeeId).toBe('comm_te');
    expect(() => ctx!.updateUser(other, { subTeam: 'Moved by a member' })).toThrow();
    expect(ctx!.users.find((u) => u.id === other)?.subTeam).toBeUndefined();
  });

  it('cannot be handed a role by the registration request itself', async () => {
    const drafted = await adapter.register({
      fullName: 'Smuggled Applicant',
      email: 'smuggled@escalation.test',
      username: 'esc_smuggled',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      committeeId: 'comm_te',
      acceptedPolicies: true,
      // A client adding `role` to the body — the field the form never offers.
      ...{ role: 'super_admin', status: 'active' },
    } as never);
    if (!drafted.ok) throw new Error(`registration refused: ${drafted.failure.message}`);

    expect(roleInVault(drafted.receipt.reference)).toBe('member');
    // A `status: 'active'` in the request body is ignored in the sense that matters: the row
    // is active because that is the 0012 default for every signup, not because the client asked.
    expect(vaultAccounts().find((a) => a.id === drafted.receipt.reference)?.status).toBe('active');
    await adapter.signOut();
    const session = await adapter.signIn('smuggled@escalation.test', PASSWORD);
    expect(session.identity.role).toBe('member');
    expect(session.identity.capabilities).not.toContain('users.role.assign');
    expect(session.identity.capabilities).not.toContain('registrations.decide');
  });

  it('does not turn an approval into a promotion', async () => {
    const reg = await adapter.register({
      fullName: 'Approved Applicant',
      email: 'approved@escalation.test',
      username: 'esc_approved',
      password: PASSWORD,
      confirmPassword: PASSWORD,
      committeeId: 'comm_te',
      acceptedPolicies: true,
    });
    if (!reg.ok) throw new Error('registration refused');

    const decide = await adapter.decideRegistration(reg.receipt.reference, 'approve', { committeeId: 'comm_it' });
    expect(decide.ok).toBe(true);
    expect(roleInVault(reg.receipt.reference)).toBe('member');
    expect(vaultAccounts().find((a) => a.id === reg.receipt.reference)?.committeeId).toBe('comm_it');
  });
});

describe('§7.9–7.10 — the content editor', () => {
  it('refuses a draft save and a publish from roles that do not hold the capabilities', async () => {
    await provision('cms_member');
    await signInAs('cms_member@escalation.test');
    const before = JSON.stringify(ctx!.publishedContent);

    expect(() => ctx!.updateWebsiteContent({ hero: { ...ctx!.websiteContent.hero, headline: 'Hijacked' } })).toThrow(
      /cms\.settings\.global/
    );
    expect(() => ctx!.publishWebsiteContent()).toThrow(/cms\.content\.publish/);
    expect(JSON.stringify(ctx!.publishedContent)).toBe(before);

    // A Director writes committee copy but never the live page.
    await provision('cms_director', 'director');
    await signInAs('cms_director@escalation.test');
    expect(() => ctx!.publishWebsiteContent()).toThrow(/cms\.content\.publish/);
    expect(JSON.stringify(ctx!.publishedContent)).toBe(before);
    expect(auditLines((line) => line.targetType === 'cms').length).toBe(0);
  });

  it('lets the editor holding both capabilities change text, place a picture, and publish', async () => {
    await provision('cms_editor', 'moderator');
    await signInAs('cms_editor@escalation.test');

    ctx!.updateWebsiteContent({
      hero: { ...ctx!.websiteContent.hero, headline: 'Applications for the 2027 board are open' },
      images: { 'home.heroCard': { assetId: 'bund_2', alt: 'Members at the end-of-year celebration' } },
    });
    // The draft is state, so the publish has to read the document the write produced, not the one
    // this render was handed.
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['hero.headline', 'images.home.heroCard']));

    const receipt = ctx!.publishWebsiteContent('2027 recruitment');

    await TL.waitFor(() => expect(ctx!.publishedContent.hero.headline).toBe('Applications for the 2027 board are open'));
    expect(ctx!.publishedContent.images['home.heroCard']).toEqual({
      assetId: 'bund_2',
      alt: 'Members at the end-of-year celebration',
    });
    expect(receipt.unresolvedSlots).toEqual([]);
    await TL.waitFor(() => {
      expect(
        auditLines((line) => line.action === 'Published Website Content').length
      ).toBe(1);
    });
  });

  it('publishes a slot that names a missing picture as unresolved rather than inventing one', async () => {
    await provision('cms_editor2', 'moderator');
    await signInAs('cms_editor2@escalation.test');

    ctx!.updateWebsiteContent({ images: { 'about.campus': { assetId: 'bund_99', alt: 'Nothing here' } } });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['images.about.campus']));
    const receipt = ctx!.publishWebsiteContent();

    expect(receipt.unresolvedSlots).toContain('about.campus');
  });
});

describe('§4 — a role read out of browser storage is not a role', () => {
  it('keeps the session identity authoritative when the stored profile claims more', async () => {
    const id = await provision('tampered');
    const target = await provision('tamper_target');
    const profiles = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];
    localStorage.setItem(
      `${V2}userProfiles`,
      JSON.stringify(profiles.map((row) => (row.id === id ? { ...row, role: 'super_admin' } : row)))
    );
    await signInAs('tampered@escalation.test');

    expect(ctx!.users.find((u) => u.id === id)?.role).toBe('super_admin');
    await expect(ctx!.assignRole(target, 'head')).rejects.toThrow(/users\.role\.assign|Only a Super Admin/);
    expect(roleInVault(target)).toBe('member');
  });

  it('refuses a suspended account that still holds a live session key', async () => {
    const id = await provision('revoked');
    await signInAs('revoked@escalation.test');
    const session = localStorage.getItem(SESSION_KEY);
    expect(session).toBeTruthy();

    await adapter.signOut();
    await adapter.signIn(ADMIN.email, PASSWORD);
    const suspend = await adapter.setAccountStatus(id, 'suspended');
    expect(suspend.ok).toBe(true);

    // The key alone buys nothing: restoring re-reads the status from the vault.
    localStorage.setItem(SESSION_KEY, session!);
    expect(await adapter.restore()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
