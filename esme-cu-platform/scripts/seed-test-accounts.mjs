#!/usr/bin/env node
// Operator action for the seeded test accounts against a real Supabase project.
//
// It never touches the browser vault (that is the local-dev adapter's job, and it seeds itself
// from the Technical Support workspace), and it never connects anywhere unless asked with
// --apply and given a service-role key through the environment. Without those it prints exactly
// the statements the SQL editor needs, which is the same path supabase/README.md documents.
//
//   node scripts/seed-test-accounts.mjs              print the statements
//   node scripts/seed-test-accounts.mjs --remove     print the removal statement
//   node scripts/seed-test-accounts.mjs --apply      run them as RPC calls
//
// Read from the environment:
//   VITE_ALLOW_TEST_ACCOUNTS   must be the literal 'true' — the same toggle the app checks
//   ESME_ENVIRONMENT           'development' or 'staging'; anything else, including nothing, refuses
//   ESME_TEST_PASSWORD_HEAD / _DIRECTOR / _MEMBER   optional; generated when absent
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY         only for --apply
//
// A generated password is printed once, on the terminal, and is the only moment it exists anywhere
// outside the database's bcrypt hash. The service-role key is never printed.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FIXTURES = [
  { key: 'head', email: 'test.head@esme.test', username: 'test_head', role: 'head', passwordEnv: 'ESME_TEST_PASSWORD_HEAD' },
  { key: 'director', email: 'test.director@esme.test', username: 'test_director', role: 'director', passwordEnv: 'ESME_TEST_PASSWORD_DIRECTOR' },
  { key: 'member', email: 'test.member@esme.test', username: 'test_member', role: 'member', passwordEnv: 'ESME_TEST_PASSWORD_MEMBER' },
];

const TESTED_ENVIRONMENTS = ['development', 'staging'];

/** The database copy of passwordChecks() in src/domain/registration.ts. */
export function passwordProblem(password) {
  if (!password || password.length < 10) return 'at least 10 characters';
  if (password.length > 72) return 'no more than 72 characters';
  if (!/[a-z]/.test(password)) return 'one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'one uppercase letter';
  if (!/\d/.test(password)) return 'one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'one symbol';
  return null;
}

/**
 * Refusal before anything is built: this command exists so a reviewer can open a test box, and the
 * one way it does harm is being run against production out of habit.
 */
export function gate(env) {
  if (env.VITE_ALLOW_TEST_ACCOUNTS !== 'true') {
    return 'VITE_ALLOW_TEST_ACCOUNTS is not "true". Test accounts are switched off by default; set it deliberately.';
  }
  const declared = (env.ESME_ENVIRONMENT ?? '').trim().toLowerCase();
  if (!TESTED_ENVIRONMENTS.includes(declared)) {
    return (
      `ESME_ENVIRONMENT is "${declared || 'unset'}". This command only seeds a project declared development ` +
      'or staging, and the database refuses the same thing twice over — see supabase/migrations/0008_seed_test_accounts.sql.'
    );
  }
  return null;
}

const ALPHABETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*()-_=+',
};

/** Ambiguous glyphs are left out: these are typed by hand into a sign-in form. */
export function generatePassword(size = 16, random = randomBytes) {
  const pools = Object.values(ALPHABETS);
  const all = pools.join('');
  const chars = pools.map((pool) => pool[pick(random, pool.length)]);
  while (chars.length < size) chars.push(all[pick(random, all.length)]);
  // Shuffle so the four required classes are not always in the first four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = pick(random, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function pick(random, n) {
  return random(n)[0] % n;
}

/** Names that already belong to somebody are not overwritten; that check is the database's, not ours. */
export function resolvePasswords(env) {
  return FIXTURES.map((fixture) => {
    const given = env[fixture.passwordEnv];
    if (given === undefined || given === '') return { ...fixture, password: generatePassword(), source: 'generated' };
    const problem = passwordProblem(given);
    if (problem) throw new Error(`${fixture.passwordEnv} needs ${problem}.`);
    return { ...fixture, password: given, source: 'supplied' };
  });
}

export function buildStatements({ environment, passwords, mode }) {
  const declaration =
    `insert into esme_settings (key, value)\n` +
    `  values ('environment', jsonb_build_object('name', '${environment}'))\n` +
    `  on conflict (key) do update set value = excluded.value, updated_at = now();`;
  if (mode === 'remove') {
    return [declaration, 'select esme_remove_test_accounts();'];
  }
  const args = passwords
    .map((p) => `    '${p.password}'  -- ${p.email}`)
    .join(',\n');
  return [
    declaration,
    'select esme_arm_test_account_seed();',
    `select esme_seed_test_accounts(\n${args}\n);`,
  ];
}

export function rpcCalls({ url, passwords, mode }) {
  const base = `${url.replace(/\/$/, '')}/rest/v1/rpc/`;
  if (mode === 'remove') return [{ fn: 'esme_remove_test_accounts', body: {} }];
  return [
    { fn: 'esme_arm_test_account_seed', body: {} },
    {
      fn: 'esme_seed_test_accounts',
      body: {
        p_password_head: passwords[0].password,
        p_password_director: passwords[1].password,
        p_password_member: passwords[2].password,
      },
    },
  ].map((call) => ({ ...call, url: `${base}${call.fn}` }));
}

export async function run({ env = process.env, argv = process.argv.slice(2), log = console.log, fetchImpl = fetch }) {
  const mode = argv.includes('--remove') ? 'remove' : 'seed';
  const apply = argv.includes('--apply');

  const refusal = gate(env);
  if (refusal) {
    log(`refused: ${refusal}`);
    return 2;
  }
  const environment = env.ESME_ENVIRONMENT.trim().toLowerCase();

  let passwords;
  try {
    passwords = resolvePasswords(env);
  } catch (error) {
    log(`refused: ${error.message}`);
    return 2;
  }

  if (mode === 'seed') {
    log(`Environment: ${environment}. The database re-checks this declaration and refuses a project that has not made it.`);
    for (const p of passwords) {
      if (p.source === 'generated') log(`  ${p.email}  password: ${p.password}   (copy now; it is not stored anywhere)`);
      else log(`  ${p.email}  password: from ${p.passwordEnv}`);
    }
  }

  if (!apply) {
    log('\nRun these in the SQL editor of the project you declared, or re-run with --apply:\n');
    for (const statement of buildStatements({ environment, passwords, mode })) log(`${statement}\n`);
    return 0;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    log('refused: --apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The anon key cannot create an identity.');
    return 2;
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  for (const call of rpcCalls({ url: env.SUPABASE_URL, passwords, mode })) {
    // The key is a header and nothing else: it is never part of a printed line or an exception message.
    log(`\n→ ${call.fn}`);
    try {
      const response = await fetchImpl(call.url, {
        method: 'POST',
        headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(call.body),
      });
      const text = await response.text();
      if (!response.ok) {
        log(`   refused (${response.status}): ${text}`);
        return 1;
      }
      log(`   ${text}`);
    } catch (error) {
      log(`   could not reach the project: ${error.message}`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`)) {
  void run().then((code) => {
    process.exitCode = code;
  });
}
