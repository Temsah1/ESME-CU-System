import { describe, expect, it } from 'vitest';
import {
  TEST_ACCOUNT_DOMAIN,
  TEST_ACCOUNT_FIXTURES,
  fixtureFor,
  planTestAccountSeed,
  resolveFixtureCommittee,
  testAccountSeedRefusal,
} from './testAccounts';
import { ALL_ROLES } from './roles';
import { validatePassword } from './registration';

/**
 * The rules around the three seeded testers, kept apart from the adapters that apply them: which
 * identities are claimed, what a seed may and may not write, and when the environment refuses.
 */

const gate = (over: Partial<Parameters<typeof testAccountSeedRefusal>[0]> = {}) => ({
  adapterKind: 'local-dev' as const,
  isProductionBuild: false,
  allowedByEnvironment: false,
  ...over,
});

describe('the fixtures', () => {
  it('names one account per role a reviewer has to see the workspace through', () => {
    expect(TEST_ACCOUNT_FIXTURES.map((f) => f.role)).toEqual(['head', 'director', 'member']);
    expect(TEST_ACCOUNT_FIXTURES.map((f) => f.email)).toEqual([
      `test.head@${TEST_ACCOUNT_DOMAIN}`,
      `test.director@${TEST_ACCOUNT_DOMAIN}`,
      `test.member@${TEST_ACCOUNT_DOMAIN}`,
    ]);
    expect(new Set(TEST_ACCOUNT_FIXTURES.flatMap((f) => [f.username, f.email])).size).toBe(6);
  });

  it('ships a password the registration policy itself accepts', () => {
    // A fixture that failed the policy would seed an account nobody could sign in to.
    for (const fixture of TEST_ACCOUNT_FIXTURES) {
      expect(validatePassword(fixture.password), fixture.username).toEqual([]);
    }
  });

  it('seats every fixture in a role the capability matrix knows', () => {
    for (const fixture of TEST_ACCOUNT_FIXTURES) {
      expect(ALL_ROLES).toContain(fixture.role);
    }
  });
});

describe('who counts as a test account', () => {
  it('matches the exact fixture email or username', () => {
    expect(fixtureFor({ id: 'a', email: 'test.head@esme.test', username: 'someone_else' })).toBe(
      TEST_ACCOUNT_FIXTURES[0]
    );
    expect(fixtureFor({ id: 'a', email: 'other@example.com', username: 'TEST_Head' })).toBe(
      TEST_ACCOUNT_FIXTURES[0]
    );
  });

  it('never matches another account that merely shares the domain', () => {
    // A delete is allowed to remove only what seeding created.
    expect(fixtureFor({ id: 'a', email: 'a.applicant@esme.test', username: 'applicant' })).toBeUndefined();
    expect(fixtureFor({ id: 'a', email: 'kareem.tamer@esme-cu.test', username: 'temsah1' })).toBeUndefined();
    expect(fixtureFor({ id: 'a', email: 'test_head@esme.test', username: 'test.head' })).toBeUndefined();
  });
});

describe('the environment gate', () => {
  it('allows the development vault by default', () => {
    expect(testAccountSeedRefusal(gate())).toBeNull();
  });

  it('refuses a production build until the operator switches the toggle on', () => {
    expect(testAccountSeedRefusal(gate({ isProductionBuild: true }))).toMatch(/production build/i);
    expect(testAccountSeedRefusal(gate({ isProductionBuild: true, allowedByEnvironment: true }))).toBeNull();
  });

  it('never seeds the real provider from a browser, toggle or not', () => {
    const refusal = testAccountSeedRefusal(
      gate({ adapterKind: 'supabase', isProductionBuild: true, allowedByEnvironment: true })
    );
    expect(refusal).toMatch(/not created from a browser/i);
    expect(refusal).toContain('esme_seed_test_accounts');
    expect(refusal).toContain('esme_remove_test_accounts');
  });
});

describe('what a seed would do', () => {
  it('creates all three against an empty vault', () => {
    const plan = planTestAccountSeed([]);
    expect(plan.create.map((f) => f.fixtureKey)).toEqual(['head', 'director', 'member']);
    expect(plan.repair).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('repairs a fixture that exists instead of adding a second one', () => {
    const plan = planTestAccountSeed([
      { id: 'usr_test_head', email: 'test.head@esme.test', username: 'test_head' },
    ]);
    expect(plan.repair.map((f) => f.fixtureKey)).toEqual(['head']);
    expect(plan.create.map((f) => f.fixtureKey)).toEqual(['director', 'member']);
  });

  it('refuses to take over an identity that belongs to somebody else', () => {
    const existing = [
      { id: 'dev_real', email: 'aya@esme-cu.edu', username: 'test_head' },
      { id: 'dev_other', email: 'other@esme-cu.edu', username: 'test_director' },
    ];
    const plan = planTestAccountSeed(existing);
    expect(plan.conflicts.map((c) => c.fixture.fixtureKey)).toEqual(['head', 'director']);
    expect(plan.conflicts[0].reason).toMatch(/not this fixture/);
    expect(plan.create.map((f) => f.fixtureKey)).toEqual(['member']);
    expect(plan.repair).toEqual([]);
  });

  it('still repairs when the same account holds both the fixture email and username', () => {
    const plan = planTestAccountSeed([
      { id: 'dev_weird', email: 'test.member@esme.test', username: 'test_member' },
    ]);
    expect(plan.repair.map((f) => f.fixtureKey)).toEqual(['member']);
    expect(plan.conflicts).toEqual([]);
  });
});

describe('seating a fixture', () => {
  it('prefers the reference committee id', () => {
    const committees = [
      { id: 'comm_te', shortCode: 'T&E' },
      { id: 'comm_custom', shortCode: 'MK' },
    ];
    expect(resolveFixtureCommittee(TEST_ACCOUNT_FIXTURES[0], committees)).toBe('comm_te');
  });

  it('falls back to the short code, ignoring case, when the id was replaced', () => {
    const committees = [{ id: 'comm_new_marketing', shortCode: 'mk' }];
    expect(resolveFixtureCommittee(TEST_ACCOUNT_FIXTURES[1], committees)).toBe('comm_new_marketing');
  });

  it('reports no seat rather than inventing one', () => {
    expect(resolveFixtureCommittee(TEST_ACCOUNT_FIXTURES[1], [{ id: 'comm_te', shortCode: 'T&E' }])).toBeUndefined();
  });
});
