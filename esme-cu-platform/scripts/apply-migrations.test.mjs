// @vitest-environment node
/**
 * The migration runner's own rules, tested without a database and without psql.
 *
 * What matters here is that the tool refuses before it acts: an operator typing `--apply` out of
 * habit against Production must be stopped by the gate, and a connection string with a password in
 * it must never reach a printed line, because the printed line becomes the evidence table in the
 * guide. Nothing in this file proves the SQL is valid Postgres — only a project that accepted it can.
 */
import { EventEmitter } from 'node:events';
import { readdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  connectionEnv,
  evidenceRow,
  gate,
  MIGRATIONS_DIR,
  migrationFiles,
  parseDbUrl,
  projectRefOf,
  psqlArgs,
  psqlCommand,
  redactedHost,
  run,
  scrub,
} from './apply-migrations.mjs';

const REF = 'iaoduiiyhareewvsctiw';
const PASSWORD = 'Sup3rS3cret-Passw0rd';
const DB_URL = `postgres://postgres:${PASSWORD}@db.${REF}.supabase.co:5432/postgres?sslmode=require`;
const STAGING = { ESME_ENVIRONMENT: 'staging' };

describe('migration order', () => {
  it('sorts by the numeric prefix, not by the whole name', () => {
    const names = ['0010_ten.sql', '0002_two.sql', '0001_one.sql', 'notes.md', 'migrationIntegrity.test.ts', '9_draft.sql'];
    expect(migrationFiles(names).map((f) => f.split(/[\\/]/).pop())).toEqual(['0001_one.sql', '0002_two.sql', '0010_ten.sql']);
  });

  it('lists every migration this repository actually ships, in prefix order', () => {
    // Read the real directory rather than a list typed into the test: a new forward migration has
    // to appear here on its own, or the runner's ordering claim is being asserted against a fixture
    // that no longer matches what will be applied.
    const files = migrationFiles(readdirSync(MIGRATIONS_DIR));
    expect(files.map((f) => f.split(/[\\/]/).pop())).toEqual([
      '0001_schema.sql',
      '0002_functions_rls.sql',
      '0003_bootstrap_admin.sql',
      '0004_committee_leadership.sql',
      '0005_email_notifications.sql',
      '0006_rewards_discipline.sql',
      '0007_remove_email_verification.sql',
      '0008_seed_test_accounts.sql',
      '0009_security_hardening.sql',
      '0010_privilege_hardening.sql',
      '0011_registration_academic_fields.sql',
      '0012_self_service_registration.sql',
      '0013_season_planner_management.sql',
    ]);
    expect(files[files.length - 1].split(/[\\/]/).pop()).toBe('0013_season_planner_management.sql');
  });
});

describe('the gate refuses before anything runs', () => {
  it('refuses Production by name, whatever the URL says', () => {
    expect(gate({ env: { ESME_ENVIRONMENT: 'production' }, apply: true, confirmProject: REF })).toContain('staging');
  });

  it('refuses an undeclared environment rather than guessing from the host', () => {
    expect(gate({ env: {}, apply: true, confirmProject: REF })).toContain('unset');
    expect(gate({ env: { ESME_ENVIRONMENT: 'prod' }, apply: true, confirmProject: REF })).toContain('development or staging');
  });

  it('needs both a connection string and an explicit project reference to change anything', () => {
    expect(gate({ env: STAGING, apply: true, confirmProject: REF })).toContain('SUPABASE_DB_URL');
    expect(gate({ env: { ...STAGING, SUPABASE_DB_URL: DB_URL }, apply: true })).toContain('--confirm-project');
  });

  it('catches a reference belonging to a different project than the URL', () => {
    const refusal = gate({ env: { ...STAGING, SUPABASE_DB_URL: DB_URL }, apply: true, confirmProject: 'otherprojectref' });
    expect(refusal).toContain('otherprojectref');
    // The message is printed by an operator tool: the host appears, the credential does not.
    expect(refusal).not.toContain(PASSWORD);
  });

  it('lets a declared staging project with a matching reference through', () => {
    expect(gate({ env: { ...STAGING, SUPABASE_DB_URL: DB_URL }, apply: true, confirmProject: REF })).toBeNull();
    // Printing the plan needs none of that: no URL, no reference, no project to break.
    expect(gate({ env: STAGING, apply: false })).toBeNull();
  });
});

describe('the connection string', () => {
  it('refuses the dashboard placeholder by name', () => {
    expect(parseDbUrl(`postgres://postgres:[YOUR-PASSWORD]@db.${REF}.supabase.co:5432/postgres`).problem).toContain('placeholder');
  });

  it('refuses shapes that would fail in a confusing way', () => {
    expect(parseDbUrl('https://example.com').problem).toContain('postgres://');
    expect(parseDbUrl('not a url at all').problem).toContain('read');
    expect(parseDbUrl(`postgres://postgres@db.${REF}.supabase.co/postgres`).problem).toContain('no password');
    expect(parseDbUrl(`postgres://postgres:x@db.${REF}.supabase.co/postgres`).ok).toBe(true);
  });

  it('splits into the variables psql reads, so the password never sits in argv', () => {
    const parsed = parseDbUrl(DB_URL);
    expect(parsed).toMatchObject({ ok: true, host: `db.${REF}.supabase.co`, port: '5432', user: 'postgres', database: 'postgres', sslMode: 'require' });
    expect(connectionEnv(parsed).PGPASSWORD).toBe(PASSWORD);
  });

  it('names the project reference the operator has to confirm', () => {
    expect(projectRefOf(`db.${REF}.supabase.co`)).toBe(REF);
    expect(projectRefOf('localhost')).toBeNull();
    expect(redactedHost(`db.${REF}.supabase.co`)).toBe(`db.${REF}.supabase.co`);
  });
});

describe('the printed command', () => {
  it('stops on the first error and takes the file with -f, without --single-transaction', () => {
    const args = psqlArgs('supabase/migrations/0006_rewards_discipline.sql');
    expect(args).toContain('ON_ERROR_STOP=1');
    expect(args).not.toContain('--single-transaction');
    expect(args[args.length - 1]).toContain('0006_');
  });

  it('shows a target that carries no credential', () => {
    const line = psqlCommand('/tmp/0001_schema.sql', parseDbUrl(DB_URL));
    expect(line).toContain(`postgres@db.${REF}.supabase.co:5432/postgres`);
    expect(line).not.toContain(PASSWORD);
    expect(psqlCommand('/tmp/0001_schema.sql', null)).toContain('$SUPABASE_DB_URL');
  });

  it('scrubs a URL that psql echoes back', () => {
    const line = scrub(`could not connect to server at ${DB_URL}`);
    expect(line).not.toContain(PASSWORD);
    expect(line).toContain('***');
  });

  it('escapes the output it puts in the evidence table, so a pipe cannot forge a row', () => {
    const row = evidenceRow('/x/0002_functions_rls.sql', parseDbUrl(DB_URL), { code: 0, output: 'ERROR:|  bad\nsecond line' });
    expect(row).toContain('ERROR:\\|  bad');
    expect(row.split('\n')).toHaveLength(1);
    expect(row).not.toContain(PASSWORD);
  });
});

/** A psql that answers whatever the test says, and records how it was called. */
function fakeSpawn(results) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    calls.push({ cmd, args, opts });
    process.nextTick(() => {
      const answer = results[args[args.length - 1]] ?? { code: 0, out: '' };
      child.stdout.push(answer.out ?? '');
      child.stderr.push(answer.err ?? '');
      child.stdout.push(null);
      child.stderr.push(null);
      // 'data' is emitted on a later tick than the push above, so closing here would beat the
      // runner's collectors and record an empty result for a run that did produce output.
      setImmediate(() => child.emit('close', answer.code));
    });
    return child;
  };
  return { spawn, calls };
}

// The runner resolves names against the real migrations directory, so the test asks it for the same
// absolute paths rather than assuming a separator.
const [F1, F2, F6] = migrationFiles(['0001_schema.sql', '0002_functions_rls.sql', '0006_rewards_discipline.sql']);

describe('a plan run', () => {
  it('prints the order and starts no process', async () => {
    const lines = [];
    const { spawn, calls } = fakeSpawn({});
    const code = await run({
      env: STAGING,
      argv: [],
      log: (line) => lines.push(line),
      spawnImpl: () => {
        throw new Error('a plan must never start psql');
      },
      readDir: () => ['0001_schema.sql', '0002_functions_rls.sql', '0006_rewards_discipline.sql'],
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(lines.join('\n')).toContain('0001_schema.sql → 0002_functions_rls.sql → 0006_rewards_discipline.sql');
    expect(lines.join('\n')).toContain('This was a plan, not a change');
    expect(lines.join('\n')).not.toContain('supabase.co');
    void spawn;
  });

  it('refuses an unknown flag instead of ignoring it', async () => {
    const lines = [];
    expect(await run({ env: STAGING, argv: ['--force'], log: (l) => lines.push(l), spawnImpl: () => { throw new Error('no'); } })).toBe(2);
    expect(lines[0]).toContain('unknown flag');
  });

  it('refuses to apply without the environment, and says how to get a plan', async () => {
    const lines = [];
    expect(await run({ env: {}, argv: ['--apply', '--confirm-project', REF], log: (l) => lines.push(l), spawnImpl: () => { throw new Error('no'); } })).toBe(2);
    expect(lines[0]).toContain('refused');
    expect(lines.join('\n')).toContain('only prints the plan');
  });
});

describe('an apply run', () => {
  const env = { ...STAGING, SUPABASE_DB_URL: DB_URL };

  it('runs every file in order and records the evidence', async () => {
    const lines = [];
    const { spawn, calls } = fakeSpawn({});
    const code = await run({
      env,
      argv: ['--apply', '--confirm-project', REF],
      log: (l) => lines.push(l),
      spawnImpl: spawn,
      readDir: () => ['0002_functions_rls.sql', '0001_schema.sql', '0006_rewards_discipline.sql'],
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.args[c.args.length - 1])).toEqual([F1, F2, F6]);
    expect(calls[0].cmd).toBe('psql');
    // The credential travels as an environment variable, exactly as documented, and nowhere else.
    expect(calls[0].opts.env.PGPASSWORD).toBe(PASSWORD);
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(PASSWORD);
    const printed = lines.join('\n');
    expect(printed).not.toContain(PASSWORD);
    expect(printed).toContain('All files applied');
  });

  it('stops at the first file the database rejects, and keeps its message', async () => {
    const lines = [];
    const { spawn, calls } = fakeSpawn({ [F2]: { code: 3, err: 'ERROR:  syntax error at or near "policy"' } });
    const code = await run({
      env,
      argv: ['--apply', '--confirm-project', REF],
      log: (l) => lines.push(l),
      spawnImpl: spawn,
      readDir: () => ['0001_schema.sql', '0002_functions_rls.sql', '0006_rewards_discipline.sql'],
    });
    expect(code).toBe(1);
    expect(calls).toHaveLength(2); // 0006 never ran
    const printed = lines.join('\n');
    expect(printed).toContain('Stopped at 0002_functions_rls.sql');
    expect(printed).toContain('syntax error at or near "policy"');
  });

  it('names a missing psql rather than retrying it', async () => {
    const lines = [];
    const code = await run({
      env,
      argv: ['--apply', '--confirm-project', REF],
      log: (l) => lines.push(l),
      spawnImpl: () => {
        const child = new EventEmitter();
        child.stdout = null;
        child.stderr = null;
        process.nextTick(() => child.emit('error', Object.assign(new Error('spawn psql ENOENT'), { code: 'ENOENT' })));
        return child;
      },
      readDir: () => ['0001_schema.sql'],
    });
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('psql was not found on PATH');
  });
});
