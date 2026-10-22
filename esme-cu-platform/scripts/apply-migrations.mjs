#!/usr/bin/env node
// Operator tooling for applying supabase/migrations/*.sql to a staging project, in order, with the
// evidence recorded as it goes.
//
// Nothing in this repository's history has ever reached a Postgres, so the first run of this script
// is the project's first real validation. It is written so that run is safe to interrupt and honest
// to publish: one file at a time, `ON_ERROR_STOP=1`, stop at the first failure, and print the exact
// command and result for each file so the record can be pasted into the guide.
//
//   node scripts/apply-migrations.mjs                      print the ordered plan and commands
//   node scripts/apply-migrations.mjs --apply \
//     --confirm-project <project-ref>                      run them with psql
//   node scripts/apply-migrations.mjs --probes             print the authorization probe commands
//
// Read from the environment:
//   ESME_ENVIRONMENT     must be 'development' or 'staging'. 'production' is refused outright.
//   SUPABASE_DB_URL      the direct connection string from the dashboard's Connected branches page.
//
// The connection string carries a password. It is therefore never written to argv: psql receives it
// through PGHOST/PGUSER/PGPASSWORD/… the way it documents, and every printed line shows the host and
// database with the credential replaced. The service-role key and the anon key belong to other
// systems and are not read by this script at all.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
export const PROBE_FILE = join(REPO_ROOT, 'supabase', 'probes', 'authorization_probes.sql');

const TESTED_ENVIRONMENTS = ['development', 'staging'];

/** Filename order is the migration order, and only `0001_…`-style files count. */
export function migrationFiles(names) {
  return names
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((a, b) => a.slice(0, 4).localeCompare(b.slice(0, 4)) || a.localeCompare(b))
    .map((name) => join(MIGRATIONS_DIR, name));
}

/**
 * Refusal before anything is built. The harm this command can do is being run against the wrong
 * project out of habit, so the environment declaration and an explicit project reference are both
 * required, and neither is inferred from the connection string.
 */
export function gate({ env, apply, confirmProject }) {
  const declared = (env.ESME_ENVIRONMENT ?? '').trim().toLowerCase();
  if (declared === 'production') {
    return (
      'ESME_ENVIRONMENT is "production". This runner exists to validate migrations on a staging ' +
      'project. A Production apply is a separate, owner-approved change made after staging is green — ' +
      'see PROJECT_MASTER_GUIDE.md §13 step 10.'
    );
  }
  if (!TESTED_ENVIRONMENTS.includes(declared)) {
    return (
      `ESME_ENVIRONMENT is "${declared || 'unset'}". Set it to development or staging; this runner will not ` +
      'guess which project a connection string belongs to.'
    );
  }
  if (!apply) return null;
  if (!env.SUPABASE_DB_URL) {
    return 'SUPABASE_DB_URL is not set. --apply needs the direct database connection string, not the API URL.';
  }
  if (!confirmProject) {
    return 'Pass --confirm-project <project-ref>, the reference of the staging project you intend to change.';
  }
  const parsed = parseDbUrl(env.SUPABASE_DB_URL);
  if (!parsed.ok) return parsed.problem;
  // A Supabase host carries the reference in its first label after `db.`; a local or self-hosted
  // staging box has no reference, so the operator confirms the host instead.
  const ref = projectRefOf(parsed.host);
  const matches = ref ? ref === confirmProject : parsed.host === confirmProject;
  if (!matches) {
    return (
      `--confirm-project says "${confirmProject}" but the connection string points at "${redactedHost(parsed.host)}". ` +
      'Either the reference or the URL is for a different project.'
    );
  }
  return null;
}

/**
 * The dashboard hands out `postgres://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres`,
 * placeholder included, and that string would fail in a confusing way. Refuse it by name.
 */
export function parseDbUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: 'SUPABASE_DB_URL is not a connection URL I can read.' };
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    return { ok: false, problem: `SUPABASE_DB_URL must be a postgres:// URL, not ${url.protocol}` };
  }
  if (!url.hostname) return { ok: false, problem: 'SUPABASE_DB_URL names no host.' };
  if (/\[|\]/.test(url.password) || /YOUR.?PASSWORD/i.test(url.password)) {
    return { ok: false, problem: 'SUPABASE_DB_URL still holds the dashboard placeholder for the password. Paste the real value.' };
  }
  if (!url.password) {
    return { ok: false, problem: 'SUPABASE_DB_URL carries no password. The direct connection needs one; the pooler URL is not what psql wants here.' };
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) return { ok: false, problem: 'SUPABASE_DB_URL names no database.' };
  return {
    ok: true,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || '5432',
    user: decodeURIComponent(url.username || 'postgres'),
    password: url.password,
    database,
    sslMode: url.searchParams.get('sslmode') || 'require',
  };
}

/** `db.iabox123.supabase.co` → `iabox123`, the reference the dashboard and `supabase link` use. */
export function projectRefOf(host) {
  const m = /^(?:db\.)?([a-z0-9]+)\.supabase\.co$/i.exec(host);
  return m ? m[1] : null;
}

/** What appears on the terminal and in the evidence file: never the credential. */
export function redactedHost(host) {
  return projectRefOf(host) ? `db.${projectRefOf(host)}.supabase.co` : host;
}

export function connectionEnv(parsed) {
  return {
    PGHOST: parsed.host,
    PGPORT: parsed.port,
    PGUSER: parsed.user,
    PGPASSWORD: parsed.password,
    PGDATABASE: parsed.database,
    PGSSLMODE: parsed.sslMode,
    PGCONNECT_TIMEOUT: '20',
  };
}

/**
 * `-f` on the file, and no `--single-transaction`: these files manage their own transactions and
 * 0006 opens with `alter type esme_role add value`, a statement Postgres will not let a transaction
 * consume in the same breath it adds.
 */
export function psqlArgs(file) {
  return ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '--set', 'QUIET=on', '-f', file];
}

export function psqlCommand(file, parsed) {
  const target = parsed ? `${parsed.user}@${redactedHost(parsed.host)}:${parsed.port}/${parsed.database}` : '$SUPABASE_DB_URL';
  return `psql ${target} ${psqlArgs(file).join(' ')}`;
}

export function evidenceHeader() {
  return [
    '| file | command | exit code | first line of output |',
    '| --- | --- | --- | --- |',
  ].join('\n');
}

export function evidenceRow(file, parsed, result) {
  const first = (result.output ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '(no output)';
  return `| ${file.split(/[\\/]/).pop()} | \`${psqlCommand(file, parsed)}\` | ${result.code} | ${first.replace(/\|/g, '\\|')} |`;
}

const SECRET_SHAPES = [/postgres(?:ql)?:\/\/[^\s]+/gi, /PGPASSWORD=\S+/g];

/** Belt and braces: a DB URL echoed by psql itself must not survive into the printed record. */
export function scrub(text) {
  return SECRET_SHAPES.reduce(
    (acc, pattern) =>
      acc.replace(pattern, (match) => {
        const parsed = parseDbUrl(match);
        return parsed.ok ? `postgres://${parsed.user}:***@${redactedHost(parsed.host)}:${parsed.port}/${parsed.database}` : '***';
      }),
    text
  );
}

export async function run({
  env = process.env,
  argv = process.argv.slice(2),
  log = console.log,
  spawnImpl,
  readDir = () => readdirSync(MIGRATIONS_DIR),
} = {}) {
  const apply = argv.includes('--apply');
  const probes = argv.includes('--probes');
  const confirmIndex = argv.indexOf('--confirm-project');
  const confirmProject = confirmIndex >= 0 ? argv[confirmIndex + 1] : undefined;
  const unknown = argv.filter((flag) => flag.startsWith('--') && !['--apply', '--probes', '--confirm-project'].includes(flag));
  if (unknown.length) {
    log(`refused: unknown flag ${unknown.join(', ')}. This runner understands --apply, --probes and --confirm-project.`);
    return 2;
  }

  const refusal = gate({ env, apply, confirmProject });
  if (refusal) {
    log(`refused: ${refusal}`);
    log('');
    log('Without --apply this command only prints the plan, and printing the plan needs no database at all.');
    return 2;
  }

  const parsed = parseDbUrl(env.SUPABASE_DB_URL ?? '');
  const files = migrationFiles(readDir());
  if (files.length === 0) {
    log(`refused: no numbered migrations found in ${MIGRATIONS_DIR}.`);
    return 2;
  }

  log(`Project: ${parsed.ok ? redactedHost(parsed.host) : 'none named — SUPABASE_DB_URL is unset, so this is a plan only'}   Environment: ${env.ESME_ENVIRONMENT.trim().toLowerCase()}`);
  log(`Order: ${files.map((f) => f.split(/[\\/]/).pop()).join(' → ')}`);
  log('');

  if (probes) {
    log('After the migrations, run the authorization probes as a superuser session (each block switches');
    log('role inside a transaction that ends in rollback, so an attempted write is undone — which is also');
    log('why this file belongs to a staging project and never to production):\n');
    log(`  ${psqlCommand(PROBE_FILE, parsed.ok ? parsed : null)}\n`);
    log('Add -v head_id=<uuid> -v member_id=<uuid> -v alien_id=<uuid> -v page_id=<uuid>: an unset');
    log('identifier makes the cast raise, which is a mistake in the command, not a missing guard.');
    log('Record each probe line beside its expected answer. P15–P19 belong to 0009, P20–P21 to 0010 and');
    log('P22–P23 to 0011 — the only two that write through auth.users, so a session that may not do that');
    log('answers SKIP rather than proving anything.');
    log('A FAIL there on a project that stops at 0008 is the finding observed, PASS is the fix working, and');
    log('`permission denied for table …` is neither — it means 0009\'s base-table SELECT grants did not land.');
    log('The file explains');
    log('its own identifiers and what a PASS, FAIL or SKIP line means, and why zero matching rows is not');
    log('the same thing as a refusal.');
  }

  if (!apply) {
    log('This was a plan, not a change. No process was started and no connection was made. To run:');
    for (const file of files) log(`  ${psqlCommand(file, parsed.ok ? parsed : null)}`);
    log('');
    log('Each file is applied as written, with ON_ERROR_STOP=1. Stop at the first failure and fix that');
    log('file forward — never re-run a file a project has already applied.');
    log('Before applying, run `select version();` on the same connection: 0009 sets security_invoker on');
    log('three views, which needs PostgreSQL 15+ and fails loudly on anything older.');
    return 0;
  }

  if (!parsed.ok) {
    log(`refused: ${parsed.problem}`);
    return 2;
  }

  let spawn = spawnImpl;
  if (!spawn) {
    try {
      ({ spawn } = await import('node:child_process'));
    } catch {
      log('refused: node:child_process is unavailable, so psql cannot be started here.');
      return 2;
    }
  }

  log(evidenceHeader());
  for (const file of files) {
    const result = await runOne(spawn, file, parsed);
    log(evidenceRow(file, parsed, result));
    if (result.code !== 0) {
      log('');
      log(`Stopped at ${file.split(/[\\/]/).pop()}. ON_ERROR_STOP means the file aborted; anything it`);
      log('had already committed inside its own transactions stays applied, so re-read the file before');
      log('retrying, and decide between a fresh project and a forward fix (PROJECT_MASTER_GUIDE.md §13).');
      if (result.code === 'ENOENT') {
        log('psql was not found on PATH. Install the Postgres client, or run these commands from a machine that has it.');
      }
      return 1;
    }
  }
  log('');
  log('All files applied. Now run the P00–P23 probes and the 56-line checklist in supabase/README.md, and paste');
  log('the real output beside each item — a checklist line with no answer next to it is still unverified.');
  log('Lines 46–50, with P15/P16/P18/P19, are what shows 0009 did something; lines 51–53, with P20/P21, show');
  log('0010 did; lines 54–56, with P22/P23, show 0011 did. A FAIL is a finding observed, and');
  log('`permission denied for table` on P16/P18/P19 means its');
  log('base-table grants did not land.');
  return 0;
}

function runOne(spawn, file, parsed) {
  return new Promise((done) => {
    const child = spawn('psql', psqlArgs(file), { env: { ...process.env, ...connectionEnv(parsed) } });
    let output = '';
    // psql writes its own errors to stderr; keep both streams so the record shows what actually happened.
    child.stdout?.on('data', (chunk) => (output = scrub(`${output}${chunk}`)));
    child.stderr?.on('data', (chunk) => (output = scrub(`${output}${chunk}`)));
    child.on('error', (error) => done({ code: error.code ?? 'spawn_failed', output: error.message }));
    child.on('close', (code) => done({ code, output }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`)) {
  void run().then((code) => {
    process.exitCode = code;
  });
}
