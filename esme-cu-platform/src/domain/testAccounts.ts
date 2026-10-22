import type { AccountStatus } from './accountState';
import type { Role } from './roles';

/**
 * Test accounts for the role-based screens.
 *
 * They exist so a reviewer can sign in as a Head, a Director and a Member and see what each one
 * is allowed to reach, without inventing thirty fake people in the reference data. Nothing here is
 * operational content: the fixtures are three rows, they are named by an address under a reserved
 * domain, and every reader that lists them calls itself out as a fixture.
 *
 * The passwords below are part of the fixture, not a secret. They only ever authenticate against
 * the local development vault (a browser sandbox that announces itself as not production
 * authentication) or a development/staging database the operator seeds by hand. The SQL path takes
 * them as parameters for exactly that reason: a credential belonging to a real provider must never
 * be committed, and a production deployment cannot be opened by someone who read this file.
 */
export const TEST_ACCOUNT_DOMAIN = 'esme.test';

export type TestAccountFixture = {
  /** Stable key: a re-seed repairs the same tester instead of adding a second one. */
  fixtureKey: string;
  email: string;
  username: string;
  displayName: string;
  password: string;
  role: Role;
  /** The committee id in the browser's reference set. */
  committeeId: string;
  /** The `short_code` the same committee carries in the SQL schema. */
  committeeShortCode: string;
  /** What this account is for, printed beside it so a tester knows which screen to open. */
  exercises: string;
};

/**
 * The three roles the spec asks to be able to sign in as.
 *
 * The brief named a "Professional Development" committee for the Director. This chapter's own
 * structure has four committees — Technical & Engineering, Media & Content, Marketing and Design —
 * and no Professional Development among them, so the fixture points the Director at Marketing
 * instead of inventing a committee to sign in to. The committee a tester lands in is the one field
 * here that an operator is expected to change; nothing else in the workspace reads `fixtureKey`.
 */
export const TEST_ACCOUNT_FIXTURES: TestAccountFixture[] = [
  {
    fixtureKey: 'head',
    email: 'test.head@esme.test',
    username: 'test_head',
    displayName: 'Test Head',
    password: 'TestHead@123',
    role: 'head',
    committeeId: 'comm_te',
    committeeShortCode: 'T&E',
    exercises: 'Committee-scoped task assignment and submission review',
  },
  {
    fixtureKey: 'director',
    email: 'test.director@esme.test',
    username: 'test_director',
    displayName: 'Test Director',
    password: 'TestDir@123',
    role: 'director',
    committeeId: 'comm_marketing',
    committeeShortCode: 'MK',
    exercises: 'Director home, committee-scoped writes and the recruitment queue for one committee',
  },
  {
    fixtureKey: 'member',
    email: 'test.member@esme.test',
    username: 'test_member',
    displayName: 'Test Member',
    password: 'TestMem@123',
    role: 'member',
    committeeId: 'comm_te',
    committeeShortCode: 'T&E',
    exercises: 'The member home, self-scoped reads and submitting work for review',
  },
];

export type TestAccountIdentity = { id: string; email: string; username: string };

/**
 * A fixture is matched by its exact email or its exact username — never by a suffix — so an
 * applicant who happens to register an address on the same domain cannot be swept up by a delete.
 */
export function fixtureFor<T extends TestAccountIdentity>(
  account: T
): TestAccountFixture | undefined {
  const email = account.email.trim().toLowerCase();
  const username = account.username.trim().toLowerCase();
  return TEST_ACCOUNT_FIXTURES.find((f) => f.email === email || f.username === username);
}

export function isTestAccount<T extends TestAccountIdentity>(account: T): boolean {
  return fixtureFor(account) !== undefined;
}

/** What the store keeps on a directory row to say "this one was seeded, not recruited". */
export const TEST_ACCOUNT_NOTE = 'Seeded test account — development and staging only';

export type TestAccountGate = {
  adapterKind: 'supabase' | 'local-dev';
  /** `import.meta.env.PROD` at the caller: a bundled build is not a development sandbox. */
  isProductionBuild: boolean;
  /** `VITE_ALLOW_TEST_ACCOUNTS === 'true'`, read by the caller so this module stays framework-free. */
  allowedByEnvironment: boolean;
};

/**
 * Null means seeding may go ahead. Anything else is the whole reason, worded for the operator.
 * The default is refusal: a production bundle only seeds when someone sets the toggle, and the real
 * provider never seeds from a browser, because that is the one path where these addresses would
 * become logins to something that matters.
 */
export function testAccountSeedRefusal(gate: TestAccountGate): string | null {
  if (gate.adapterKind === 'supabase') {
    return (
      'These accounts are not created from a browser against the real provider. ' +
      'Declare the environment, arm the window and seed them in the SQL editor:\n' +
      "  insert into esme_settings (key, value) values ('environment', jsonb_build_object('name', 'staging'))\n" +
      '    on conflict (key) do update set value = excluded.value, updated_at = now();\n' +
      '  select esme_arm_test_account_seed();\n' +
      "  select esme_seed_test_accounts('<head password>', '<director password>', '<member password>');\n" +
      'Removal is the same operator path: select esme_remove_test_accounts();'
    );
  }
  if (gate.isProductionBuild && !gate.allowedByEnvironment) {
    return (
      'This is a production build, so the test accounts are switched off. ' +
      'Set VITE_ALLOW_TEST_ACCOUNTS=true and rebuild to seed them deliberately.'
    );
  }
  return null;
}

export type TestAccountPlan = {
  create: TestAccountFixture[];
  /** Already present: the password, role, committee and status are re-applied, no row is added. */
  repair: TestAccountFixture[];
  /** The email or username belongs to an account this fixture is not — never overwritten. */
  conflicts: { fixture: TestAccountFixture; reason: string }[];
};

/**
 * Decide what a seed would do before doing it, against the accounts that already exist.
 *
 * The conflict branch is the point: a seed is allowed to add and to repair, and is not allowed to
 * take over somebody's account because it matched an address.
 */
export function planTestAccountSeed(existing: TestAccountIdentity[]): TestAccountPlan {
  const plan: TestAccountPlan = { create: [], repair: [], conflicts: [] };
  for (const fixture of TEST_ACCOUNT_FIXTURES) {
    const takenByEmail = existing.find((a) => a.email.trim().toLowerCase() === fixture.email);
    const takenByUsername = existing.find((a) => a.username.trim().toLowerCase() === fixture.username);
    const clash = [takenByEmail, takenByUsername].find(
      (a) => a && a.email.trim().toLowerCase() !== fixture.email
    );
    if (clash) {
      plan.conflicts.push({
        fixture,
        reason: `${fixture.username} is already used by ${clash.email}, which is not this fixture, so nothing was written to it.`,
      });
      continue;
    }
    plan[takenByEmail ? 'repair' : 'create'].push(fixture);
  }
  return plan;
}

/** The committee a fixture is seated in, resolved against the workspace's own list. */
export function resolveFixtureCommittee(
  fixture: TestAccountFixture,
  committees: { id: string; shortCode?: string; name?: string }[]
): string | undefined {
  const byId = committees.find((c) => c.id === fixture.committeeId);
  if (byId) return byId.id;
  const byCode = committees.find(
    (c) => (c.shortCode ?? '').trim().toUpperCase() === fixture.committeeShortCode.trim().toUpperCase()
  );
  return byCode?.id;
}

/** The row shape both adapters write, so the report reads the same whichever provider answered. */
export type TestAccountReport = {
  created: { email: string; username: string; role: Role; committeeId?: string }[];
  repaired: { email: string; username: string; role: Role; committeeId?: string }[];
  removed: string[];
  conflicts: { fixtureKey: string; reason: string }[];
  /** Committees the fixture names but this workspace does not have. The account is still created, unseated. */
  unresolvedCommittees: string[];
  refusal: string | null;
};

export function emptyTestAccountReport(refusal: string | null): TestAccountReport {
  return { created: [], repaired: [], removed: [], conflicts: [], unresolvedCommittees: [], refusal };
}

/** The status a seeded tester is filed under: a provisioned account is not an applicant. */
export const TEST_ACCOUNT_STATUS: AccountStatus = 'active';
