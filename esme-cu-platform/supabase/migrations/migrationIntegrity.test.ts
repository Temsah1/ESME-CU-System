import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Postgres is not available in this environment, so no migration here has ever been executed —
 * that is recorded in supabase/README.md and in the delivery report, and this file does not
 * pretend otherwise.
 *
 * What it can prove without a server: a migration may not query a relation that no migration
 * created, a trigger may not read a column the table it fires on does not have, and it may not
 * call a function that is not defined. The first draft of 0005 failed the second check twice
 * (`esme_submissions.task_title`, `esme_leadership_seats.director_profile_id`) and nothing else
 * in this repository could have noticed, because nothing here runs SQL.
 */

const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const source = files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');

/** Everything between the parenthesis that opens at `from` and its matching close. */
function balanced(text: string, from: number): string {
  let depth = 1;
  let i = from;
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    i++;
  }
  return text.slice(from, i - 1);
}

const tableDefs = [...source.matchAll(/create table (?:if not exists )?(esme_[a-z_]+) \(/g)].map((m) => ({
  name: m[1],
  body: balanced(source, (m.index ?? 0) + m[0].length),
}));

const viewNames = [...source.matchAll(/create (?:or replace )?view (esme_[a-z_]+)/g)].map((m) => m[1]);

/** Column names: the leading identifier of each top-level definition inside the table body. */
const columnsOf = new Map<string, Set<string>>();
for (const table of tableDefs) {
  const columns = new Set<string>();
  let depth = 0;
  for (const line of table.body.split('\n')) {
    const trimmed = line.trim();
    if (depth === 0) {
      const column = trimmed.match(/^([a-z][a-z0-9_]*)\s+\w/);
      if (column && !/^(constraint|primary|foreign|unique|check|exclude|like)$/.test(column[1])) {
        columns.add(column[1]);
      }
    }
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
  }
  columnsOf.set(table.name, columns);
}

/** Columns a later migration added: an ALTER is as much a definition as the CREATE was. */
for (const statement of source.matchAll(/alter table (esme_[a-z_]+)([^;]*);/gi)) {
  const columns = columnsOf.get(statement[1]);
  if (!columns) continue;
  for (const added of statement[2].matchAll(/add column (?:if not exists )?([a-z_]+)/gi)) {
    columns.add(added[1]);
  }
}

/** Function bodies, taken from the `$$ ... $$` dollar-quoted block rather than the parameter list. */
const functionBodies = new Map<string, string>();
for (const match of source.matchAll(/create or replace function (esme_[a-z_]+)\s*\(/g)) {
  const name = match[1];
  const open = source.indexOf('$$', (match.index ?? 0) + match[0].length);
  const close = open < 0 ? -1 : source.indexOf('$$', open + 2);
  if (close > open) functionBodies.set(name, source.slice(open + 2, close));
}

/** Which table each trigger function fires on, so `new.x` has a definition to answer to. */
const triggersFor = new Map<string, string[]>();
for (const match of source.matchAll(
  /create trigger [a-z_]+[\s\S]{0,160}?\bon (esme_[a-z_]+)[\s\S]{0,160}?execute function ([a-z_]+)/g
)) {
  const [, table, fn] = match;
  triggersFor.set(fn, [...(triggersFor.get(fn) ?? []), table]);
}

const relationNames = new Set([...tableDefs.map((t) => t.name), ...viewNames]);

/**
 * Each `create policy … ;` read on its own. A policy is not a function body: it is a plain
 * expression evaluated against the candidate row, so `new.x` / `old.x` are not in scope and
 * Postgres rejects the statement with `column "old" does not exist` — which, because every
 * migration here is wrapped in `begin; … commit;`, would abort the file that contains it.
 *
 * Comments are stripped first: a `;` inside an explanatory comment would otherwise end a statement
 * early and hide the part of the policy that a check like this exists to read.
 */
const sqlCode = source.replace(/--[^\n]*/g, '');
const policies = [...sqlCode.matchAll(/create policy ([a-z_]+) on ([a-z_]+)([^;]*);/g)].map((m) => ({
  name: m[1],
  table: m[2],
  body: m[3],
}));

const perFile = files.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

describe('the migrations only mention relations and columns that exist', () => {
  it('parses enough of the schema for the checks below to mean something', () => {
    expect(tableDefs.length).toBeGreaterThanOrEqual(20);
    expect(functionBodies.size).toBeGreaterThanOrEqual(25);
    expect(triggersFor.size).toBeGreaterThanOrEqual(10);
    expect(policies.length).toBeGreaterThanOrEqual(25);
    expect(viewNames.sort()).toEqual([
      'esme_committee_rosters',
      'esme_member_reward_records',
      'esme_member_scores',
    ]);
    expect(columnsOf.get('esme_submissions')?.has('description')).toBe(true);
  });

  it('never reads a column the firing table does not have', () => {
    const problems: string[] = [];
    for (const [fn, tables] of triggersFor) {
      const body = functionBodies.get(fn);
      if (!body) {
        problems.push(`${fn} is bound by a trigger but has no parseable body`);
        continue;
      }
      const allowed = new Set(tables.flatMap((t) => [...(columnsOf.get(t) ?? [])]));
      for (const match of body.matchAll(/\b(?:new|old)\.([a-z_][a-z0-9_]*)\b/g)) {
        if (!allowed.has(match[1])) {
          problems.push(`${fn}: new/old.${match[1]} is not a column of ${tables.join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every esme_ relation it queries was created by some migration', () => {
    const missing = new Set<string>();
    for (const match of source.matchAll(/\b(?:from|join|update|into)\s+(esme_[a-z_]+)\b/g)) {
      if (!relationNames.has(match[1])) missing.add(match[1]);
    }
    expect([...missing]).toEqual([]);
  });

  it('every esme_ function it calls is defined in this schema', () => {
    const unresolved = new Set<string>();
    for (const match of source.matchAll(/\b(?:perform|select)\s+(esme_[a-z_]+)\s*\(/g)) {
      if (!functionBodies.has(match[1])) unresolved.add(match[1]);
    }
    expect([...unresolved]).toEqual([]);
  });

  it('declares every enum value the email layer writes', () => {
    // 0005's triggers insert these statuses; a value missing from the enum aborts the write.
    const statuses = [...source.matchAll(/create type esme_email_status as enum \(([^)]*)\)/g)][0]?.[1] ?? '';
    for (const value of ['queued', 'processing', 'sent', 'failed', 'suppressed']) {
      expect(statuses, `esme_email_status is missing ${value}`).toContain(`'${value}'`);
    }
  });

  it('keeps trigger-only record references out of policy expressions', () => {
    const offenders = policies
      .filter((p) => /\b(?:new|old)\.[a-z_]/i.test(p.body))
      .map((p) => `${p.name} on ${p.table}`);
    expect(offenders).toEqual([]);
  });

  it('holds publication changes in a guard that can see both rows', () => {
    // Replacing the invalid `published = old.published` with nothing would have quietly opened a
    // hole: an editor without cms.content.publish could flip a page live. The rule moved to a
    // trigger, so this pins both halves — the policy stays capability-only, and a BEFORE INSERT OR
    // UPDATE guard on the same table compares the publication columns.
    const update = policies.find((p) => p.name === 'esme_pages_update');
    expect(update?.body).toContain("esme_has_capability('cms.content.write')");
    expect(update?.body).not.toContain('cms.content.publish');

    const guarded = [...triggersFor.entries()].filter(
      ([fn, tables]) => fn === 'esme_assert_publication_write' && tables.includes('esme_content_pages')
    );
    expect(guarded).toHaveLength(1);
    const body = functionBodies.get('esme_assert_publication_write') ?? '';
    for (const column of ['published', 'published_at', 'published_by']) {
      expect(body, `the guard must compare ${column} on both sides`).toMatch(
        new RegExp(`new\\.${column}[\\s\\S]{0,80}old\\.${column}`)
      );
    }
    expect(body).toContain("esme_has_capability('cms.content.publish')");
    expect(
      /create trigger esme_pages_publication_guard[\s\S]{0,120}?\bbefore insert or update\b/i.test(sqlCode)
    ).toBe(true);
  });

  it('adds an enum label in its own transaction, before anything consumes it', () => {
    // ALTER TYPE … ADD VALUE may run inside a transaction block on this server version, but the new
    // label cannot be *used* until the transaction commits — so a migration that adds a label and
    // then seeds a row with it in the same begin/commit pair aborts. Each file here is one
    // transaction, so the statement has to sit outside it.
    for (const file of perFile) {
      for (const match of file.text.matchAll(/^alter type ([a-z_]+) add value/gim)) {
        const begin = file.text.search(/^begin;/im);
        const commit = file.text.search(/^commit;/im);
        const at = match.index ?? 0;
        expect(
          begin >= 0 && commit >= 0 && at > begin && at < commit,
          `${file.name}: ALTER TYPE ${match[1]} ADD VALUE is inside the file's transaction`
        ).toBe(false);
      }
    }
  });

  // ---- 0009 security hardening -------------------------------------------------------------
  // These two checks are static: they prove the guard exists and is shaped to work, not that
  // Postgres honoured it. The behavioural proof is P15–P19 in supabase/probes/, which need a real
  // staging database. Recorded that way in PROJECT_MASTER_GUIDE.md §1.

  it('keeps role and status out of a direct profile write', () => {
    const guarded = [...triggersFor.entries()].filter(
      ([fn, tables]) => fn === 'esme_assert_privilege_channel' && tables.includes('esme_profiles')
    );
    expect(guarded, '0009 must bind esme_assert_privilege_channel to esme_profiles').toHaveLength(1);
    const body = functionBodies.get('esme_assert_privilege_channel') ?? '';
    // It must exempt the definer path, or esme_assign_role(), the 0003 bootstrap and the 0008 seed
    // would all be locked out of the column they own.
    expect(body).toContain('esme_called_directly()');
    for (const column of ['role', 'status']) {
      expect(body, `the guard must compare ${column} on both sides`).toMatch(
        new RegExp(`new\\.${column}[\\s\\S]{0,60}old\\.${column}`)
      );
      expect(body, `a direct write to ${column} must be refused`).toContain(`ESME_${column.toUpperCase()}_FUNCTION_ONLY`);
    }
    expect(/create trigger esme_profiles_privilege_channel[\s\S]{0,140}?\bbefore insert or update\b/i.test(sqlCode)).toBe(true);

    // The approved workflow still owns the column, and an ordinary profile edit is untouched.
    expect(functionBodies.get('esme_assign_role') ?? '').toContain('set role = p_role');
    const update = policies.find((p) => p.name === 'esme_profiles_update');
    expect(update?.body).toContain("esme_reaches_profile(id, 'users.update')");
    expect(update?.body).toContain('esme_current_profile_id()');
  });

  it('reads the aggregate views as the caller, not as the owner', () => {
    const invoker = new Set(
      [...source.matchAll(/alter view (esme_[a-z_]+) set \(security_invoker = true\)/g)].map((m) => m[1])
    );
    // Every view this schema grants to a browser role must be invoker-owned; a future fourth view
    // added without the option fails here rather than in a staging audit.
    const grantedToCallers = new Set<string>();
    for (const match of source.matchAll(/grant select on ([^;]*?) to authenticated;/g)) {
      for (const name of match[1].split(/,\s*/)) if (viewNames.includes(name.trim())) grantedToCallers.add(name.trim());
    }
    expect([...grantedToCallers].sort()).toEqual([
      'esme_committee_rosters',
      'esme_member_reward_records',
      'esme_member_scores',
    ]);
    for (const view of grantedToCallers) {
      expect(invoker, `${view} is granted to authenticated but still reads as its owner`).toContain(view);
    }
    // ...and nothing may hand them to anonymous traffic, whatever the project's default privileges do.
    for (const match of source.matchAll(/grant ([^;]*?) to ([^;]*?)anon/g)) {
      for (const view of grantedToCallers) expect(match[1], `anon must not be granted ${view}`).not.toContain(view);
    }
    const revoked = new Set(
      [...source.matchAll(/revoke all on (esme_[a-z_]+) from anon, public/g)].map((m) => m[1])
    );
    for (const view of grantedToCallers) expect(revoked, `${view} must be revoked from anon`).toContain(view);
  });

  // ---- 0010 privilege hardening ------------------------------------------------------------
  // `functionBodies` keeps the last definition in file order, which is the one a project that has
  // applied every migration actually runs. These checks are still static: P20 and P21 in
  // supabase/probes/ are what would prove Postgres honours the rules.

  it('refuses a self-targeted role change and audits both roles', () => {
    const assign = functionBodies.get('esme_assign_role') ?? '';
    expect(assign, 'esme_assign_role is not defined anywhere').not.toBe('');
    // Capability first: "your role does not grant this" is the answer a member needs, and the
    // self-check is a rule for somebody who does hold the capability.
    const capability = assign.indexOf("esme_has_capability('users.role.assign')");
    const self = assign.indexOf('p_user_id = v_actor.id');
    expect(capability).toBeGreaterThanOrEqual(0);
    expect(self, '0010 must refuse an account changing its own role').toBeGreaterThan(capability);
    expect(assign).toContain('ESME_SELF_ROLE_CHANGE');
    // Privilege comes from the label not being `member`, not from a list somebody can forget to
    // update — which is how `high_board` stayed out of 0002's privileged set after 0006 added it.
    expect(assign).toMatch(/p_role\s*<>\s*'member'/);
    expect(assign, 'a granted-role list here would go stale the way 0002 s did').not.toMatch(/p_role\s+in\s*\(/);
    // The trail has to answer "from what to what".
    expect(assign).toMatch(/insert into esme_audit_log[\s\S]{0,400}v_target\.role[\s\S]{0,120}p_role/);
    expect(assign).toContain('esme_is_primary_admin(p_user_id)');
    expect(assign).toContain('set role = p_role');

    const status = functionBodies.get('esme_set_account_status') ?? '';
    expect(status).toMatch(/insert into esme_audit_log[\s\S]{0,400}v_target\.status[\s\S]{0,120}p_status/);
    expect(status).toContain('ESME_SELF_LOCKOUT');
  });

  it('declares every role the capability matrix names', async () => {
    const { ALL_ROLES } = await import('../../src/domain/roles');
    const declared = new Set<string>();
    for (const match of source.matchAll(/create type esme_role as enum \(([^)]*)\)/g)) {
      for (const value of match[1].matchAll(/'([a-z_]+)'/g)) declared.add(value[1]);
    }
    for (const match of source.matchAll(/alter type esme_role add value (?:if not exists )?'([a-z_]+)'/g)) {
      declared.add(match[1]);
    }
    for (const role of ALL_ROLES) {
      expect([...declared], `esme_role has no ${role} label`).toContain(role);
    }
  });

  it('seeds exactly the identities the domain module defines', async () => {
    // 0008 re-lists the fixtures as a VALUES table because a set-returning esme_ function would
    // read as a missing relation to the checks above. This is what keeps the two lists honest.
    const { TEST_ACCOUNT_FIXTURES } = await import('../../src/domain/testAccounts');
    for (const fixture of TEST_ACCOUNT_FIXTURES) {
      expect(source, `0008 must seed ${fixture.email}`).toContain(`'${fixture.email}'`);
      expect(source, `0008 must seed ${fixture.username}`).toContain(`'${fixture.username}'`);
      expect(source, `0008 must give ${fixture.email} the ${fixture.role} role`).toContain(
        `'${fixture.role}'::esme_role`
      );
    }
  });

  // ---- 0011 registration academic fields ---------------------------------------------------
  // Static again: P22 and P23 in supabase/probes/ are what prove Postgres runs the new trigger the
  // way the portal needs. These checks exist because 0007's version of that trigger carried a uuid
  // cast that would abort a signup — a defect no amount of browser testing could see.

  const file0011 = perFile.find((f) => f.name === '0011_registration_academic_fields.sql');
  const signupBody = () => functionBodies.get('esme_handle_new_auth_user') ?? '';

  it('gives the queue somewhere to put the answers the form asks for', () => {
    expect(file0011, '0011_registration_academic_fields.sql is missing').toBeTruthy();
    const queue = columnsOf.get('esme_registration_requests');
    for (const column of [
      'student_id',
      'academic_year',
      'department',
      'phone',
      'committee_membership',
      'second_committee_preference_id',
    ]) {
      expect([...(queue ?? [])], `the approval queue has no ${column}`).toContain(column);
    }
    // NULL has to stay legal: a request filed before this question existed did not skip it.
    expect(file0011!.text).toContain('committee_membership is null or committee_membership in');
  });

  it('resolves a committee reference without ever raising inside the signup trigger', () => {
    const body = signupBody();
    expect(body, 'the trigger must be the 0011 version').toContain('esme_committee_reference(');
    // The defect this replaces: `nullif(meta ->> 'committee_id', '')::uuid` raises on this app's own
    // committee ids, and a raise in a BEFORE INSERT trigger on auth.users destroys the signup.
    expect(body).not.toContain('::uuid');
    expect(functionBodies.get('esme_committee_reference') ?? '', 'the helper must be defined')
      // The cast is guarded by a CASE, which Postgres evaluates before the branch it protects.
      .toMatch(/case when s\.is_uuid then s\.raw::uuid else null end/);
    expect(functionBodies.get('esme_committee_reference'), 'an unresolvable committee must answer NULL, not raise')
      .not.toMatch(/\braise\b/i);
  });

  it('keeps an application an application: requested here, assigned by a decision', () => {
    const body = signupBody();
    expect(body).toContain("'member'");
    expect(body).not.toMatch(/meta ->> 'role'/);
    expect(body, 'the trigger must not record an assignment nobody decided').not.toContain('assigned_committee_id');
    expect(body).toMatch(/v_membership = 'no'[\s\S]{0,160}v_requested := null/);
    expect(file0011!.text, '0011 must not rewrite the decision function').not.toMatch(
      /create or replace function esme_decide_registration/i
    );
  });

  it('offers the choices the portal offers, in the migration and in the seed alike', async () => {
    const { ACADEMIC_YEAR_OPTIONS, DEPARTMENT_OPTIONS, COMMITTEE_MEMBERSHIP_CHOICES, HIGH_BOARD_COMMITTEE } =
      await import('../../src/data/referenceContent');
    const seed = readFileSync(join(dir, '../../supabase/dev_seed_reference.sql'), 'utf8');
    for (const text of [file0011!.text, seed]) {
      for (const year of ACADEMIC_YEAR_OPTIONS) expect(text, `academic year ${year}`).toContain(`'${year}'`);
      for (const department of DEPARTMENT_OPTIONS) {
        expect(text, `department ${department}`).toContain(`'${department}'`);
      }
      for (const choice of COMMITTEE_MEMBERSHIP_CHOICES) {
        expect(text, `membership ${choice.value}`).toContain(`'${choice.value}'`);
      }
      expect(text).toContain(`'${HIGH_BOARD_COMMITTEE.name}'`);
    }
    // One committee row per spelling, guarded rather than assumed.
    expect(file0011!.text).toMatch(/where not exists \([\s\S]{0,400}highboard/i);
  });

  it('does not drop or rewrite anything the earlier migrations installed', () => {
    const code = file0011!.text.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/\bdrop\b/i);
    expect(code).not.toMatch(/\bdelete from\b/i);
    expect(code).not.toMatch(/\balter table esme_registration_requests\s+drop\b/i);
    // Every new column is nullable: a forward-only migration may not demand an answer from a row
    // that was filed before the question existed.
    for (const column of ['student_id', 'academic_year', 'department', 'phone', 'committee_membership']) {
      const line = code.match(new RegExp(`add column if not exists ${column}[^,;]*`, 'i'))?.[0] ?? '';
      expect(line, `${column} must stay nullable`).not.toMatch(/not null/i);
    }
  });
});

// ---- 0014 task management -------------------------------------------------------------------
// Static, like the rest of this file: the deletion guard's behaviour is P35-P38 in
// supabase/probes/, which need a real staging database. These checks keep the policies and the
// trigger shaped so that a probe would be testing the intended rule.

const file0014 = perFile.find((f) => f.name === '0014_task_management.sql');

describe('task management archives instead of erasing history', () => {
  it('adds nullable archive columns and a live-row index', () => {
    expect(file0014, '0014_task_management.sql is missing').toBeTruthy();
    const tasks = columnsOf.get('esme_tasks') ?? new Set<string>();
    for (const column of ['archived_at', 'archived_by']) {
      expect([...tasks], `esme_tasks has no ${column}`).toContain(column);
      const line = file0014!.text.match(new RegExp(`add column if not exists ${column}[^,;]*`, 'i'))?.[0] ?? '';
      // A live row is the existing rows; the add cannot require a value from them.
      expect(line, `${column} must stay nullable`).not.toMatch(/not null/i);
    }
    expect(file0014!.text).toMatch(/where archived_at is null/i);
  });

  it('scopes deletion to the committee the task belongs to', () => {
    // 0002 defined the policy first; the last definition is the one a fully-migrated project runs.
    const deletes = policies.filter((p) => p.name === 'esme_tasks_delete');
    expect(deletes.length).toBeGreaterThanOrEqual(2);
    const current = deletes[deletes.length - 1];
    expect(current.body).toContain("esme_reaches_committee(committee_id, 'tasks.delete')");
    // The old capability-only check ignored the committee and is exactly what 0014 replaces.
    expect(current.body).not.toMatch(/esme_has_capability\('tasks\.delete'\)/);
  });

  it('refuses a hard delete while submissions or ledger rows refer to the task', () => {
    const guarded = [...triggersFor.entries()].filter(
      ([fn, tables]) => fn === 'esme_guard_task_delete' && tables.includes('esme_tasks')
    );
    expect(guarded, '0014 must bind esme_guard_task_delete to esme_tasks').toHaveLength(1);
    const body = functionBodies.get('esme_guard_task_delete') ?? '';
    expect(body).toContain('from esme_submissions where task_id = old.id');
    expect(body).toContain('from esme_score_ledger where task_id = old.id');
    expect(body).toContain('ESME_TASK_HAS_HISTORY');
    expect(body).toMatch(/return old/i);
    expect(
      /create trigger esme_tasks_guard_delete[\s\S]{0,140}?\bbefore delete\b/i.test(sqlCode)
    ).toBe(true);
  });

  it('deletes nothing and does not widen the capability matrix', () => {
    const code = file0014!.text.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/\bdelete from\b/i);
    expect(code).not.toMatch(/insert into esme_role_capabilities/i);
    expect(code).not.toMatch(/drop table/i);
  });
});

// ---- 0015 High Board content ---------------------------------------------------------------
// Static: the matrix row is the whole change, because the CMS/media/settings policies already
// read these capability names. P39-P42 in supabase/probes/ are what would prove Postgres honours
// them for a real High Board session.

describe('the High Board content grant is the content suite, not the platform', () => {
  const file0015 = perFile.find((f) => f.name === '0015_high_board_content.sql');
  const grants = () => {
    const rows: { role: string; capability: string; scope: string }[] = [];
    for (const match of (file0015?.text ?? '').matchAll(
      /\('([a-z_]+)',\s*'([a-z.]+)',\s*'([a-z]+)'\)/g
    )) {
      rows.push({ role: match[1], capability: match[2], scope: match[3] });
    }
    return rows;
  };

  it('grants the four cms capabilities to high_board and nobody else', () => {
    expect(file0015, '0015_high_board_content.sql is missing').toBeTruthy();
    const rows = grants();
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.capability).sort()).toEqual([
      'cms.content.publish',
      'cms.content.write',
      'cms.media.manage',
      'cms.settings.global',
    ]);
    for (const row of rows) {
      expect(row.role, `${row.capability} must not go to another role here`).toBe('high_board');
      expect(row.scope, `${row.capability} is organization-wide`).toBe('all');
    }
    // The upsert is what lets a re-run repair a drifted scope instead of failing.
    expect(file0015!.text).toMatch(/on conflict \(role, capability\) do update set scope = excluded\.scope/i);
  });

  it('adds no policy and touches no content row', () => {
    const code = file0015!.text.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(code).not.toMatch(/\b(?:insert into|update|delete from)\s+esme_(?:content_pages|media_assets)/i);
    expect(code).not.toMatch(/grants?\s+(?:users\.role\.assign|users\.suspend|settings\.manage|backups\.manage)/i);
  });
});

// ---- 0016 High Board bonus guard -----------------------------------------------------------
// Static: P43-P46 in supabase/probes/ are what would prove the trigger fires on staging. What can
// be read here is that it fires before insert on the table that stores the frozen target role, and
// that it changes neither the capability matrix nor any existing record.

describe('a bonus aimed at a High Board seat is refused at the table', () => {
  const file0016 = perFile.find((f) => f.name === '0016_high_board_bonus_guard.sql');

  it('binds a before-insert trigger to esme_reward_entries', () => {
    expect(file0016, '0016_high_board_bonus_guard.sql is missing').toBeTruthy();
    const guarded = [...triggersFor.entries()].filter(
      ([fn, tables]) => fn === 'esme_guard_high_board_bonus' && tables.includes('esme_reward_entries')
    );
    expect(guarded, '0016 must bind the guard to esme_reward_entries').toHaveLength(1);
    expect(
      /create trigger esme_reward_entries_high_board_guard[\s\S]{0,140}?\bbefore insert\b/i.test(sqlCode)
    ).toBe(true);
  });

  it('reads the frozen target role, not a value the caller can rewrite later', () => {
    const body = functionBodies.get('esme_guard_high_board_bonus') ?? '';
    const columns = columnsOf.get('esme_reward_entries') ?? new Set<string>();
    // Both identifiers have to exist on the firing table, or the trigger would fail at runtime.
    expect([...columns], 'esme_reward_entries has no target_role_at_time').toContain('target_role_at_time');
    expect(body).toContain("new.kind = 'bonus'");
    expect(body).toContain("new.target_role_at_time = 'high_board'");
    expect(body).toContain('ESME_HIGH_BOARD_TARGET');
    expect(body).toMatch(/return new/i);
    // A warning to a board member stays possible: the rule is about bonus points, not discipline.
    expect(body).not.toMatch(/ESME_HIGH_BOARD_TARGET[\s\S]*warning/i);
  });

  it('rewrites no entry and does not widen the capability matrix', () => {
    const code = file0016!.text.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/\b(?:update|delete from)\s+esme_reward_entries/i);
    expect(code).not.toMatch(/insert into esme_role_capabilities/i);
    expect(code).not.toMatch(/create policy|alter policy|drop policy/i);
  });
});
