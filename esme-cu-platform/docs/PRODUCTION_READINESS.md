# Production readiness and recovery

Everything below is written from this working tree. The evidence labels are the five from
`PROJECT_MASTER_GUIDE.md` §15 rule 11 — **automated-tests**, **real-Pg**, **static review only**,
**not verified**, **blocked** — and they are the point of this document: a release checklist that
cannot say which of the two it means is how an unexecuted schema gets described as secured.

**As of 2026-10-22 this application has never been deployed, no migration has run against any
Postgres, and no backup has been taken or restored, because there is no database to back up.**
Every row of the readiness table below is therefore either authored or open; none is closed.

## Readiness gate table

| Area | State today | What closes it | Label |
| --- | --- | --- | --- |
| Source builds and passes the suite | 48 files / 728 tests (36.52s, exit 0), `tsc -b --force` exit 0, `oxlint` 13 warnings / 0 errors on 147 files (exit 0), `vite build` succeeded in 837ms, CI's credential scan over `dist/` → 0 matches | Nothing — re-run on the release commit | **automated-tests** |
| CI on every push/PR | `.github/workflows/ci.yml` authored with no credentials and no provider | A push, then one green run on a real PR | **not verified** (never run) |
| Database schema | 0001–0011 authored — 0009 and 0010 are the forward fixes for the five 2026-10-22 findings and rewrite nothing, 0011 adds the registration answers additively; the remote project's `esme_%` table count is 0 and its RPCs answer `PGRST202` | `npm run migrations:apply` against a named staging project | **blocked** (owner: approval + `SUPABASE_DB_URL`) |
| RLS and role model | 48 policies over 25 tables reviewed; the schema's static invariants are enforced by `migrationIntegrity.test.ts` (18 cases, two written for 0009, one for 0010, five for 0011); P00–P23 written; the escalation paths are covered in code by `src/context/privilegeEscalation.test.tsx` (17 cases, proved non-vacuous by mutation); the five findings are **closed in code, not in a database** | Run the probes and `supabase/README.md`'s 56-line checklist, record each answer — lines 46–50 are the 0009 acceptance test, 51–53 the 0010 one, 54–56 the 0011 one | **static review + automated tests (no database)** |
| Outbound email | Queue, claim/record functions, templates and the Edge Function source exist; the sender fails closed with 503 without `RESEND_API_KEY` | Deploy the function, set the three secrets, verify the domain, run one real send and read `esme_email_log` | **not verified** (never executed in Deno) |
| First administrator | Bootstrap guards, one-shot window and audit append authored | The operator procedure in `supabase/README.md` → First administrator, executed once on staging | **blocked** — and no account was created by this work |
| Backup / restore | Commands documented; no dump exists | The restore drill below, performed and timed | **not verified** |
| Operational data in the server | Reward **writes** go through the four RPCs; reads, the policy row and the other eight collections are device-local | A–E plan in `DATABASE_AND_MIGRATIONS.md`, one vertical slice at a time | **automated-tests against stubbed providers** |
| Real provider sign-in | Never completed once | Step 8 of the runbook on staging | **not verified** |

## 1. Environment separation

Three things must agree before anything is called staging or production, and each is enforced in a
different place on purpose:

| Signal | Where it is read | What it refuses |
| --- | --- | --- |
| `ESME_ENVIRONMENT` in the process | `scripts/apply-migrations.mjs`, `scripts/seed-test-accounts.mjs` | Both refuse to start unless it is literally `development` or `staging`; a name containing `production` is refused by the gate **before** any file is read, any connection parsed or any process spawned |
| `esme_settings.key = 'environment'` row | `0008_seed_test_accounts.sql` | The seeding RPC re-checks the *database's* declaration, so a client that lies about its environment still cannot seed |
| `--confirm-project <ref>` versus the host inside `SUPABASE_DB_URL` | the runner | Apply stops if the reference you named is not the reference the connection string points at — the mistake it exists to prevent is meaning staging and connecting to production |

Browser-side, the same split is structural: a production build with no `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` throws `AuthNotConfiguredError` rather than falling back to the dev vault
(`src/auth/index.ts`), and `configurationProblems()` rejects an http URL, a URL with a path, and any
`sb_secret_` value in a public variable.

**Rules that do not relax:** staging builds and automated tests never point at the production
database; CI never receives a connection string; the service-role key never enters a browser, a
test fixture's expectations, stdout, or an error message.

## 2. Migration procedure

`PROJECT_MASTER_GUIDE.md` §13 is the ordered runbook. The mechanical part is
[scripts/apply-migrations.mjs](../scripts/apply-migrations.mjs):

```bash
ESME_ENVIRONMENT=staging npm run migrations:plan                 # prints the plan, starts nothing
ESME_ENVIRONMENT=staging npm run migrations:apply -- --confirm-project <ref>
```

- One `psql` process per file, `-v ON_ERROR_STOP=1 --no-psqlrc`, password through `PGPASSWORD` only.
- **No `--single-transaction` and no `supabase db push`**: `0006` puts
  `alter type esme_role add value 'high_board'` outside its `begin;` because the new label cannot be
  consumed in the transaction that adds it, and a runner that wraps the whole file reintroduces that
  failure. Each migration manages its own transactions.
- Stop at the first non-zero exit. Emit one evidence row per file (file, exit, first output line,
  with `|` escaped and any echoed connection string scrubbed).
- Before applying: take the backup in §5 and read the remote history
  (`supabase migration list`, or `supabase_migrations.schema_migrations`). A partially applied file
  is a different problem from an unapplied one and must not be "fixed" by re-running it.

## 3. Verifying RLS and roles, not just writing them

[supabase/probes/authorization_probes.sql](../supabase/probes/authorization_probes.sql) is a
scripted version of the questions a hand audit tends to skip. P00 records what the session actually
is; P01–P23 then attempt, in a transaction that always rolls back, the writes that must fail: a
direct `insert` into `esme_reward_entries`, an edit to a frozen ledger row, a Member calling
`esme_award_bonus()`, a cross-committee write, a replayed idempotency key, a blank reversal reason, a
raw `esme_committees.head_id` update, an `esme_audit_log` delete, a publication-column write without
`cms.content.publish`, and — P10 — an ordinary content write that must **still land**, because a
guard that blocks everyone is not a guard.

P15–P19 were added by the 2026-10-22 migration review, which found two holes, and by
`0009_security_hardening.sql`, which closes them forward. P20–P21 came from the same review's findings
3–5 and are written against `0010_privilege_hardening.sql`. P22–P23 are written against
`0011_registration_academic_fields.sql` and are the only blocks here that insert into `auth.users`, so
the registration trigger runs rather than being read. They are read differently from the rest:

- **P15** writes `esme_profiles.role` directly as a Head. The review found the policy's privileged
  branch checks reachability and nothing else ([PROJECT_MASTER_GUIDE.md](../PROJECT_MASTER_GUIDE.md)
  §2, finding 1), so **on a project that stops at 0008 this prints FAIL — that FAIL is the finding
  reproduced, which is the useful answer.** With 0009 applied it must print PASS, refused by
  `ESME_ROLE_FUNCTION_ONLY`. Do not edit the probe to make either case green.
- **P16** selects `esme_member_scores` as a Member and compares the row count with what the
  `esme_profiles` policy shows the same session. Before 0009 it counts as the view owner, so it is
  expected to FAIL wherever more than one member is active (finding 2); after 0009 the two counts
  must match. If it instead raises `permission denied for table esme_profiles`, that is a **FAIL of a
  different kind**: `security_invoker` is on but the base-table `SELECT` grant did not land, so the
  view raises rather than filters. Same distinction for P18 and P19.
- **P17** is the opposite kind: it calls `esme_queue_email()` from the owner session the triggers and
  the Edge Function use, and **expects a row to appear**. It exists because 0005 sets
  `force row level security` on `esme_email_outbox` while granting no insert policy, and whether the
  definer path survives that depends on role attributes only a live project can show.
- **P18** reads `esme_member_reward_records` as a Member and counts the rows that name somebody else.
  A non-zero answer is a FAIL, and zero is only meaningful when the session can see its own row —
  otherwise the policy, not the fix, is what silenced the view.
- **P19** checks parity: the rows `esme_committee_rosters` returns must equal the committees
  `esme_reaches_committee(id, 'committees.read')` reaches. It prints SKIP when the probe identity
  reaches no committee, because then both sides are zero and nothing was tested.
- **P20** has the Super Admin call `esme_assign_role()` on **its own** profile id. 0002 checked the
  caller's capability and the target's protected flag but never compared the two ids, so this is the
  statement that used to succeed; after 0010 it must raise `ESME_SELF_ROLE_CHANGE` **and** the role must
  be unchanged — the probe re-reads the row for exactly that reason, because a refusal that moved the
  column is worse than no guard. It prints SKIP when the project has no Super Admin profile, i.e. when
  0003 was never run.
- **P21** is the positive half: an authorized grant must still apply, and the `esme_audit_log` row it
  files has to name both values (`<email>: <old> -> <new>`). Three answers, not two — no audit row at
  all means the grant did not happen, a row naming only the outcome means 0002's function is still
  installed, and `permission denied for …` means the session cannot write or read the trail, which is a
  grant nobody can account for later.
- **P22** files two applications through the real trigger: one answering `yes` with the app's own
  `comm_high_board` id, one answering `no` while the metadata still names a committee. The first must
  arrive with the year, the department and a resolved `requested_committee_id`; the second must arrive
  with **neither** committee column set, and `assigned_committee_id` must be NULL in both. Before 0011
  the first case is not a wrong answer but no answer at all — the uuid cast raised inside the trigger
  and the auth user was never created, which is why this probe writes rather than inspects.
- **P23** is the one that answers the question the brief asks directly. It counts the rows that spell
  High Board, checks the seeded committee holds no leadership seat, and then asks for the applicant's
  own identity response: `member` with `capabilities = '{}'`. A second row means the duplicate guard
  missed; a capability means a committee selection was allowed to become a privilege.

Read the output with three distinctions kept apart:

- **refused** — the statement raised. That is a pass for a negative probe.
- **invisible** — the statement succeeded and `select` shows nothing, which is what RLS looks like
  from the wrong side of a policy, and is a pass for a read probe only.
- **absent data** — zero matching rows because the fixture was not there. The file prints this as a
  note (`get diagnostics v_rows = row_count`), never as a PASS, because "my where-clause matched
  nothing" is not evidence that authorization worked.

The probes are a `psql`/SQL-editor superuser session and need four identities from rows that already
exist in that project — `-v head_id=… -v member_id=… -v alien_id=… -v page_id=…`; an unset one makes
the cast raise, which is a mistake in the command rather than a missing guard. PostgREST answers a
browser differently — 401 for an RLS-failed `select`, 404 or `PGRST202` for a missing or ungranted
function, and an `ESME_*` message in the body for an RPC refusal — so the client half of the audit is
step 9's smoke test, not this file. `supabase/README.md`'s 56-line checklist remains the record, and
lines 42–45 (the publication guard), 46–50 (the 0009 fixes), 51–53 (the 0010 fixes), 54–56 (the 0011
registration answers) plus every Edge
Function and delivery line still need a human.

## 4. Edge Function configuration

`supabase/functions/send-email/` drains `esme_email_outbox` and records what the provider answered.
Deploying it is three secrets and a schedule, all of which are owner actions with no value recorded
in this repository:

| Secret | Purpose | Absent ⇒ |
| --- | --- | --- |
| `RESEND_API_KEY` | provider credentials | the function returns **503** and leaves the queue untouched — it never reports a send that did not happen |
| `RESEND_FROM_EMAIL` | verified sender address | same fail-closed path |
| `EMAIL_CRON_SECRET` | shared secret the scheduler presents | **401** from the function; a 401 with the header present means the two values drifted apart |

Order: apply `0005` → verify the sending domain at the provider → set the secrets → deploy → schedule
→ invoke once by hand with and without the secret header → read `esme_email_log`. Rows stuck in
`processing` are handed back to `queued` after ten minutes by `esme_claim_next_email`, and
`X-Entity-Ref-ID` is what stops a retry from becoming two messages in one inbox. The templates in
`supabase/functions/_shared/email.ts` are compared against `src/domain/email.ts` on every test run
(**automated-tests**) — that proves the wording matches, not that a provider accepted a message.

## 5. Backup, and the restoration test that has never happened

A backup is a claim until it is restored. Commands:

```bash
pg_dump "$SUPABASE_DB_URL" -f pre-migration-$(date +%F).dump      # before any migration
supabase: Dashboard → Database → Backups → take a manual backup   # point-in-time, provider side
```

The ERP's own *Export JSON* (Settings & Backups, `backups.manage`) contains only what that browser
holds. It is a device snapshot, and it is **not** a database backup — do not count it as one in a
recovery decision.

**Restore drill — run on staging, then repeat before the first production migration.** Nothing here
has ever been executed.

1. Take the dump of a staging project that has data in it (after the smoke test in §7, so the rows
   are real: a profile, a registration decision, a bonus entry, an audit row, a published page).
2. Record the counts you expect to see back:
   `select count(*) from esme_profiles;` and the same for `esme_audit_log`, `esme_reward_entries`,
   `esme_email_outbox`, `esme_content_pages`.
3. Restore into a **scratch** project — never over the source — with `pg_restore` into an empty
   database, or by pasting the dump. Note the wall-clock duration; an untested restore whose time is
   unknown is a recovery plan with a blank in it.
4. Re-run §3's probes against the restored project. A restore that loses grants or the
   `esme_role_capabilities` rows restores a database that authorizes differently, and the probes are
   how you find out before a member does.
5. Sign in as a seeded test account, read the directory, award and reverse a bonus, publish a page.
6. Write down: dump size, restore duration, the six counts before and after, and every probe line.
   **That record is the evidence that this application can be recovered.** Until it exists, §8's
   "backup and recovery: NOT VERIFIED" stands, and a migration on production is a one-way door.

## 6. Monitoring

There is no dashboard for operations yet — #59 (System Health + feature flags) is open, and until it
ships monitoring is queries plus the provider's own metrics. What the schema already records:

| Question | Where to look |
| --- | --- |
| Who changed what, when | `esme_audit_log` (append-only; an `delete` probe must fail — P08) |
| Did a sign-in come from an unexpected device | `esme_report_sign_in()` rows written by `supabaseAdapter.reportSignIn()` |
| Is mail actually leaving | `esme_email_log` status per queue row; a growing `esme_email_outbox` with an empty log means the function never ran |
| Is the reward ledger being written outside the RPC | it cannot be, if P01 passes: DML is revoked from `authenticated` and `esme_assert_reward_channel()` refuses a direct write |
| Is the database healthy at all | Supabase dashboard (disk, connections, RAM, PITR backup state) — provider-side, not in this repo |

What is **not** in place: no alerting, no error reporting, no uptime check, no scheduled probe run.
Deciding on those is an owner action; the honest interim is that a failure is noticed when somebody
opens the app.

## 7. Smoke test before any release is called good

Run against staging only, in a browser, and record the answers rather than the intent:

1. Fresh project, no administrator → the sign-in screen shows the bootstrap instructions and refuses
   to submit.
2. Register → a row in `esme_registration_requests` with no reviewer click; approve it → the status
   transitions and the decision mail is queued (then actually arrives).
3. Sign in as that member → dashboard renders with real empty states, not sample content.
4. Award a bonus to someone outside your committee → refused, and nothing was written (no ledger row,
   no new total, no mail). Award one inside scope → the entry carries the **server's** id and instant.
5. Submit the same bonus twice with the same idempotency key → one entry.
6. Reverse an entry → the original flips to `reversed` and a second row points at it; the ledger was
   never edited in place.
7. Publish as a `cms.content.publish` holder; try the same publication columns as a
   `cms.content.write` holder → refused, while an ordinary body edit still saves.
8. Suspend the account mid-session, refresh → refused, with a reason a member can read.
9. Sign in as each seeded test role and check the navigation matches the capability matrix.
10. Load the public site with the CMS holding one block switched off → the block is gone from the DOM.

## 8. Forward-fix strategy

- Migrations are **append-only from the first apply**. 0001–0011 can be edited in place only while
  no environment has executed them; the moment the runner records an applied file, the only legal
  change is a new numbered file.
- **That rule is already in use, not just written down.** The 2026-10-22 review found five
  authorization defects — two living in 0002's policy and 0001's views, three in the RPCs that still
  move `role` and `status` — and no earlier file was touched:
  `0009_security_hardening.sql` carries the first two forward and `0010_privilege_hardening.sql` the
  other three. It matters that no project has applied 0002
  yet — editing it would have been legal here, and would have made every future staging diff lie
  about what a project actually holds.
- 0010 restates `esme_assign_role()` and `esme_set_account_status()` with
  `create or replace function`, which is the sanctioned way to change a rule a numbered file owns:
  the old definition is replaced, the migration history is not, and re-applying 0010 on a project that
  already has it changes nothing. That idempotence is why a staging run can tell "0010 was not applied"
  apart from "0010 was applied twice" — P21's `names only the outcome` FAIL is the first, never the
  second.
- 0011 uses the same two sanctioned shapes: `add column if not exists` for what the queue gained, and
  `create or replace function` for `esme_handle_new_auth_user()`, whose signature never changes. Its
  new objects are each guarded against a second application — the check constraint by a
  `duplicate_table` exception handler (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`), the partial
  index by `if not exists`, the High Board committee by `where not exists` on both spellings — so
  re-applying the file changes nothing, which is the property that lets a staging run tell "0011 did
  not land" apart from "0011 landed twice". Nothing it writes is a rewrite of an existing row: a
  request filed before the question existed keeps its NULLs and reads as "Not recorded".
- Never re-run an applied file on a project that already has it, and never "repair" a partially
  applied file by hand-editing `supabase_migrations.schema_migrations`.
- A bad migration on staging: prefer a fresh project (the schema holds no production data yet, and a
  re-apply is the fastest honest path). On production: restore the §5 dump — which is why the drill
  must be performed **before** there is a production database to save — or write the forward fix.
- A bad release of the client: the build is a static bundle, so roll the host back to the previous
  deployment, then forward-fix. Browser storage is versioned
  (`ESME_CU_STATE_V2_*`, target v6) and upgraded on read
  (`src/storage/migrations.ts`), so an older bundle reading a document written by a newer one is a
  real failure mode — a rollback must also check that the cache upgrader is a no-op in that
  direction, which is what the v3 → v4 cases in `migrations.test.ts` exist to keep true.
