// @vitest-environment node
/**
 * The operator command beside the migration. Two things are proved here that the app's own tests
 * cannot reach: this script's copy of the fixture table has not drifted from
 * src/domain/testAccounts.ts, and the gate refuses before any request is made — including the one
 * request that would carry a service-role key.
 */
import { describe, expect, it } from 'vitest';
import {
  FIXTURES,
  buildStatements,
  gate,
  generatePassword,
  passwordProblem,
  resolvePasswords,
  rpcCalls,
  run,
} from './seed-test-accounts.mjs';
import { TEST_ACCOUNT_FIXTURES } from '../src/domain/testAccounts.ts';

const OK = {
  VITE_ALLOW_TEST_ACCOUNTS: 'true',
  ESME_ENVIRONMENT: 'staging',
  ESME_TEST_PASSWORD_HEAD: 'HeadTest#2026a',
  ESME_TEST_PASSWORD_DIRECTOR: 'DirectorTest#2026',
  ESME_TEST_PASSWORD_MEMBER: 'MemberTest#2026',
};

describe('the CLI and the domain module name the same three accounts', () => {
  it('has not drifted from TEST_ACCOUNT_FIXTURES', () => {
    expect(FIXTURES.map((f) => f.key)).toEqual(TEST_ACCOUNT_FIXTURES.map((f) => f.fixtureKey));
    expect(FIXTURES.map((f) => f.email)).toEqual(TEST_ACCOUNT_FIXTURES.map((f) => f.email));
    expect(FIXTURES.map((f) => f.username)).toEqual(TEST_ACCOUNT_FIXTURES.map((f) => f.username));
    expect(FIXTURES.map((f) => f.role)).toEqual(TEST_ACCOUNT_FIXTURES.map((f) => f.role));
  });
});

describe('the gate', () => {
  it('refuses unless the toggle is the literal true', () => {
    expect(gate({ ...OK, VITE_ALLOW_TEST_ACCOUNTS: undefined })).toContain('VITE_ALLOW_TEST_ACCOUNTS');
    expect(gate({ ...OK, VITE_ALLOW_TEST_ACCOUNTS: '1' })).toContain('VITE_ALLOW_TEST_ACCOUNTS');
  });

  it('refuses an undeclared project and a production one alike', () => {
    expect(gate({ ...OK, ESME_ENVIRONMENT: undefined })).toContain('ESME_ENVIRONMENT');
    expect(gate({ ...OK, ESME_ENVIRONMENT: 'production' })).toContain('ESME_ENVIRONMENT');
    expect(gate({ ...OK, ESME_ENVIRONMENT: ' Staging ' })).toBeNull();
  });
});

describe('passwords', () => {
  it('applies the same character rules the app applies', () => {
    expect(passwordProblem('short1!')).toContain('at least 10');
    expect(passwordProblem('alllowercase1!')).toContain('one uppercase letter');
    expect(passwordProblem('ALLUPPERCASE1!')).toContain('one lowercase letter');
    expect(passwordProblem('NoDigitsHere!!')).toContain('one number');
    expect(passwordProblem('NoSymbolsHere22')).toContain('one symbol');
    expect(passwordProblem('x'.repeat(73))).toContain('no more than 72');
    expect(passwordProblem(OK.ESME_TEST_PASSWORD_HEAD)).toBeNull();
  });

  it('takes what the operator supplied and generates the rest in a form that passes', () => {
    const resolved = resolvePasswords({ ...OK, ESME_TEST_PASSWORD_MEMBER: '' });
    expect(resolved.map((p) => p.source)).toEqual(['supplied', 'supplied', 'generated']);
    expect(resolved[2].password.length).toBe(16);
    for (const p of resolved) expect(passwordProblem(p.password)).toBeNull();
  });

  it('refuses a supplied password that would not survive its own check', () => {
    expect(() => resolvePasswords({ ...OK, ESME_TEST_PASSWORD_HEAD: 'weak' })).toThrow(/at least 10/);
  });

  it('generates passwords whose required classes are not positional', () => {
    const samples = Array.from({ length: 40 }, () => generatePassword());
    expect(samples.some((s) => !/[a-z]/.test(s[0]))).toBe(true);
    for (const s of samples) expect(passwordProblem(s)).toBeNull();
  });
});

describe('the statements it prints', () => {
  it('names the declaration, the window and the seed', () => {
    const text = buildStatements({ environment: 'staging', passwords: resolvePasswords(OK), mode: 'seed' }).join('\n');
    expect(text).toContain("jsonb_build_object('name', 'staging')");
    expect(text).toContain('select esme_arm_test_account_seed();');
    expect(text).toContain('select esme_seed_test_accounts(');
    expect(text).not.toContain('esme_remove_test_accounts');
  });

  it('in remove mode it prints the cleanup and no seed', () => {
    const text = buildStatements({ environment: 'development', passwords: resolvePasswords(OK), mode: 'remove' }).join('\n');
    expect(text).toContain('select esme_remove_test_accounts();');
    expect(text).not.toContain('esme_seed_test_accounts(');
  });
});

describe('the calls --apply would make', () => {
  it('arms first, then seeds with the three passwords in order', () => {
    const calls = rpcCalls({ url: 'https://proj.supabase.co/', passwords: resolvePasswords(OK), mode: 'seed' });
    expect(calls.map((c) => c.fn)).toEqual(['esme_arm_test_account_seed', 'esme_seed_test_accounts']);
    expect(calls[1].url).toBe('https://proj.supabase.co/rest/v1/rpc/esme_seed_test_accounts');
    expect(calls[1].body).toEqual({
      p_password_head: OK.ESME_TEST_PASSWORD_HEAD,
      p_password_director: OK.ESME_TEST_PASSWORD_DIRECTOR,
      p_password_member: OK.ESME_TEST_PASSWORD_MEMBER,
    });
  });
});

describe('running it', () => {
  const collect = () => {
    const lines = [];
    return { lines, log: (line) => lines.push(line) };
  };

  it('prints the statements and makes no request when --apply is absent', async () => {
    const { lines, log } = collect();
    let fetched = 0;
    const code = await run({
      env: OK,
      argv: [],
      log,
      fetchImpl: async () => {
        fetched += 1;
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    expect(code).toBe(0);
    expect(fetched).toBe(0);
    expect(lines.join('\n')).toContain('select esme_seed_test_accounts(');
  });

  it('refuses a production declaration before it builds anything', async () => {
    const { lines, log } = collect();
    let fetched = 0;
    const code = await run({
      env: { ...OK, ESME_ENVIRONMENT: 'production', SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret-key' },
      argv: ['--apply'],
      log,
      fetchImpl: async () => {
        fetched += 1;
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    expect(code).toBe(2);
    expect(fetched).toBe(0);
    expect(lines[0]).toContain('refused');
    // The key was in the environment and must not have been printed on the way out.
    expect(lines.join('\n')).not.toContain('secret-key');
  });

  it('applies over RPC without ever printing the service-role key', async () => {
    const { lines, log } = collect();
    const seen = [];
    const code = await run({
      env: { ...OK, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret-key' },
      argv: ['--apply'],
      log,
      fetchImpl: async (url, init) => {
        seen.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 200, text: async () => '{"created":3}' };
      },
    });
    expect(code).toBe(0);
    expect(seen.map((s) => s.url)).toEqual([
      'https://proj.supabase.co/rest/v1/rpc/esme_arm_test_account_seed',
      'https://proj.supabase.co/rest/v1/rpc/esme_seed_test_accounts',
    ]);
    expect(seen[1].headers.apikey).toBe('secret-key');
    expect(seen[1].headers.authorization).toBe('Bearer secret-key');
    expect(JSON.parse(seen[1].body)).toEqual({
      p_password_head: OK.ESME_TEST_PASSWORD_HEAD,
      p_password_director: OK.ESME_TEST_PASSWORD_DIRECTOR,
      p_password_member: OK.ESME_TEST_PASSWORD_MEMBER,
    });
    expect(lines.join('\n')).not.toContain('secret-key');
  });

  it('reports a database refusal instead of pretending the seed ran', async () => {
    const { lines, log } = collect();
    const code = await run({
      env: { ...OK, SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret-key' },
      argv: ['--apply'],
      log,
      fetchImpl: async (url) =>
        url.endsWith('esme_seed_test_accounts')
          ? { ok: false, status: 400, text: async () => 'ESME_SEED_CLOSED: run esme_arm_test_account_seed() first' }
          : { ok: true, status: 200, text: async () => 'null' },
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('ESME_SEED_CLOSED');
  });

  it('refuses --apply without a key that can create an identity', async () => {
    const { lines, log } = collect();
    const code = await run({ env: { ...OK, SUPABASE_SERVICE_ROLE_KEY: undefined }, argv: ['--apply'], log, fetchImpl: async () => { throw new Error('should not be reached'); } });
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
