# ESME CU — Supabase integration guide

Everything in this folder is the **server side** of the platform: schema, authorization,
row level security and the one-time first-administrator procedure. The React app never
decides who is signed in or what they may do; it renders what these functions return.

## Status of this integration — read before deploying

**Applied to a live project: no.** A Supabase project does now exist and the two `VITE_` values are
filled in the untracked `.env.local` on the development machine — but no migration has been applied to
that project, so its remote schema is empty and every `esme_*` call answers `PGRST202`. Concretely:

- the SQL in `migrations/` has **never been executed against Postgres**. It is reviewed
  source, not a verified schema;
- the RLS policies have **not been probed** with a real token, so no policy has been
  confirmed to reject a hand-made request; `probes/authorization_probes.sql` is written for that
  purpose and has never been run either;
- email deliverability (password resets, and every notification queued by
  `0005_email_notifications.sql`, `0006_rewards_discipline.sql` and
  `0007_remove_email_verification.sql`) has **not been tested**: no
  Resend API key existed in the environment where this was written, so **outbound email is
  not live**. The sender fails closed — with no `RESEND_API_KEY` the Edge Function returns
  503 and leaves the queue untouched rather than reporting sends that never happened;
- `supabase/functions/send-email/` has never run in Deno. Its template copy is checked
  against `src/domain/email.ts` by `src/domain/emailTemplates.server.test.ts`, which proves
  the wording matches, not that a provider accepted a message;
- `src/auth/supabaseAdapter.ts` is type-checked and unit-tested, including the four reward calls in
  `src/auth/rewardProvider.test.ts` — but those tests stub `createClient`. Nothing has completed a
  real sign-in or a real RPC round trip;
- **the four reward write RPCs in `0006_rewards_discipline.sql` are called from the client** as of
  2026-10-22: `awardBonus`, `issueWarning`, `reverseRewardEntry` and `acknowledgeWarning` go through
  the adapter, and the store mirrors only the receipt a provider returns, so with no adapter
  configured the write is refused rather than quietly kept on the device. `esme_update_reward_policy()`
  is still not called, and the ledger is still **read** from browser storage. The server-side scope
  rules are therefore on the request path but unexercised: until 0006 is applied, every reward write
  against a real project fails closed with `schema_missing`. See "Pointing the client at the database"
  and the A–E ownership table in
  [`docs/DATABASE_AND_MIGRATIONS.md`](../docs/DATABASE_AND_MIGRATIONS.md).

Treat any claim of "secured by RLS" as pending until the checklist below is run against
your project and the results are recorded.

## Files

| File | Purpose |
| --- | --- |
| `migrations/0001_schema.sql` | Enums, tables, indexes, constraints. Operational tables are created **empty**. |
| `migrations/0002_functions_rls.sql` | Capability matrix, `esme_has_capability()`, scope helpers, SECURITY DEFINER functions, triggers, and RLS policies for all 19 `esme_*` tables. |
| `migrations/0003_bootstrap_admin.sql` | Arming window + `esme_bootstrap_primary_admin()`. The only way a Super Admin comes to exist. |
| `migrations/0004_committee_leadership.sql` | Leadership seat ledger, draft guard, `esme_assign_leader()`, `esme_set_account_committee()`. A seat never touches `esme_profiles.role`. |
| `migrations/0005_email_notifications.sql` | Mail queue, delivery log, per-member preferences, the triggers that fill the queue from authoritative writes, and the claim/record functions the sender calls. |
| `migrations/0006_rewards_discipline.sql` | The `high_board` role, the bonus/warning ledger, the reward policy singleton, `esme_member_reward_records`, and the five RPCs that write them. Corrections are new rows; the ledger has no update path. |
| `migrations/0007_remove_email_verification.sql` | Retires the `pending_email_verification` stage. A submission enters the queue as `pending_approval` and is decidable at once; the reviewer's decision is the only gate. Also re-keys the decision emails so a later decision mails again. |
| `migrations/0008_seed_test_accounts.sql` | The Head / Director / Member fixtures, armed and seeded by an operator. Creates no table: three SECURITY DEFINER functions, a project-environment declaration, and `service_role`-only grants. |
| `migrations/0009_security_hardening.sql` | Closes the two 2026-10-22 review findings: `esme_assert_privilege_channel()` keeps `role` and `status` off any direct `esme_profiles` write, and the three aggregate views become `security_invoker` with the base-table `SELECT` grants that makes necessary. Forward-only — nothing earlier was rewritten. |
| `migrations/0010_privilege_hardening.sql` | Closes the three findings the same review left open on the RPC side: `esme_assign_role()` refuses a self-targeted change, defines a privileged grant as "not `member`" (so `high_board` is covered, which 0002's literal list missed), and writes both role values to the audit row; `esme_set_account_status()` records `previous → new` the same way. Forward-only restatement with `create or replace function` — nothing earlier was rewritten. |
| `migrations/0011_registration_academic_fields.sql` | Gives the approval queue somewhere to put the answers the signup now asks: `student_id`, `academic_year`, `department`, `phone`, `committee_membership` and `second_committee_preference_id`, all nullable so a request filed before the question exists still reads correctly. Restates `esme_handle_new_auth_user()` to store them, to resolve a committee reference through the new `esme_committee_reference()` (which answers NULL where 0007's `::uuid` cast would raise and abort the signup), and to clear both committee references when the applicant answers `no`. Seeds the High Board *committee* — the `high_board` role is a different record and is untouched. Forward-only: no drop, no rewrite, `esme_decide_registration()` unchanged. |
| `functions/send-email/index.ts` | The sender. Drains the queue, calls the provider, records what the provider answered. |
| `probes/authorization_probes.sql` | Twenty-four transactional probes (P00–P23) that switch role locally, assert one authorization rule each, and roll back. Prints PASS/FAIL/SKIP; has never been run. |
| `functions/_shared/email.ts` | Server copy of the templates in `src/domain/email.ts`; a test compares the two on every event. |
| `dev_seed_reference.sql` | Reference content for a first install: committee structure, registration form schema, season plan, website copy. Inserts **no people, tasks, submissions, scores, applications or audit rows**. |

## Setup

1. **Create the project** and note the Project URL and the *publishable* anon key.
2. **Copy the env template** — `.env.example` → `.env.local`:

   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable anon key>
   ```

   `VITE_`-prefixed variables are compiled into the browser bundle. The service-role key
   and the direct database URL must **never** use that prefix and must never be committed.
3. **Apply the migrations in order, one file at a time with `psql -f`.** Use the runner rather than
   retyping it: `ESME_ENVIRONMENT=staging npm run migrations:plan` prints the exact sequence and
   commands without touching anything, and `npm run migrations:apply -- --confirm-project <ref>` runs
   that list with `ON_ERROR_STOP=1`, refuses Production by name, and prints one evidence row per file.
   0003 depends on 0002; both depend on 0001. **0006 must go through `psql -f`**: it opens with
   `alter type esme_role add value 'high_board'` outside its transaction, and Postgres will not
   let a new enum label be consumed by the transaction that adds it. That is also why `supabase db
   push` is not the documented path here — a runner that wraps the whole file cannot apply it, and it
   cannot report a partially applied 0002 either.
   0008 adds the test-account guards on top of 0007's status lifecycle; it creates no tables.
   **0009 is the access-control fix** — it guards `esme_profiles.role` / `status` and turns the
   three aggregate views into the caller's own read, so it must be applied before anyone tests a
   privilege write or an aggregate read. Its `alter view … set (security_invoker = true)` needs
   PostgreSQL 15+; on an older server the file aborts inside its own transaction and the schema stays
   as 0008 left it.
   **0010 is last of the privilege fixes** — it restates the two role/status RPCs that a reviewer can
   call directly, so apply it after 0009 and before testing any privilege grant. It creates nothing, so
   a project that has already applied 0001–0009 can take it alone.
   **0011 is the signup answer set** — it adds the six queue columns, restates the registration trigger
   and seeds the High Board committee. Apply it after 0010; the order between 0010 and 0011 does not
   matter to Postgres (they touch disjoint objects), only to the numbering. The app reads the new queue
   columns as optional, so a project that has not applied 0011 keeps its current behaviour and shows
   nothing for the new answers rather than failing — and a project that applies it without the browser
   build that sends the metadata files requests with those columns NULL, which is the same read as
   "this applicant never asked".
   Then run `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc -v head_id=<uuid> -v member_id=<uuid> -v alien_id=<uuid> -v page_id=<uuid> -f supabase/probes/authorization_probes.sql`
   and record every PASS/FAIL/SKIP notice — P15–P19 are 0009's, P20–P21 are 0010's, P22–P23 are 0011's,
   and four
   identities from rows that already exist are what they need to mean anything. The probes switch
   role locally and roll back, so
   they change nothing that survives the run — but they are written for a session that can `set local
   role`, so check `select current_user` first (line 0 of the checklist below prints it). P22 and P23
   additionally write through `auth.users` so the registration trigger itself is exercised; run them as
   the database owner, and expect SKIP from a session that may not.
4. **Verify the schema landed** before provisioning anyone:

   ```sql
   select count(*) from esme_profiles;            -- 0 (or 1 after bootstrap)
   select count(*) from esme_tasks;               -- 0
   select count(*) from esme_score_ledger;        -- 0
   select count(*) from esme_audit_log;           -- 0
   select count(*) from esme_reward_entries;      -- 0
   select max_bonus_points_per_action, period_days, escalate_warnings_after
     from esme_reward_policy;                     -- one row: 25, 90, 3
   select capability, scope from esme_role_capabilities
     where role = 'member' order by capability;   -- the member row of the matrix
   select role, capability from esme_role_capabilities
     where role = 'moderator' and capability like 'rewards%';   -- 0 rows: the absence is the policy
   select count(*) from esme_profiles where status = 'pending_email_verification';          -- 0
   select count(*) from esme_registration_requests where status = 'pending_email_verification'; -- 0
   ```

5. **Provision the primary administrator** (next section). Nothing else seeds accounts.
6. **Optionally load reference content** on a development or freshly provisioned project:
   run `dev_seed_reference.sql` manually, once. It is not wired to any build or boot step.
7. **Configure authentication** in the dashboard: enable Email sign-in, disable phone and
   any third-party providers the chapter has not approved, and set the site URL.

   **Confirm email** is now the only thing standing between a fabricated address and the
   approval queue. The platform stopped checking it in 0007 — the applicant clicking a link
   was never proof of being a student, and the reviewer reads the application anyway — so
   this setting is a chapter decision rather than an app rule:

   | Setting | What the queue receives |
   | --- | --- |
   | On (recommended) | GoTrue will not finish a signup until the address is confirmed, so every request is a reachable inbox. `email_verified` reads `true` for all of them. |
   | Off | Anyone can submit with any address, including a false one. |

   Either way, keep the SMTP sender configured so password resets and the decision emails
   actually arrive, and leave rate limiting on: `/signup` throttling plus
   `submissionThrottleBlocked()` in `src/domain/registration.ts` are what hold the queue back
   now that waiting for a click no longer does.
8. **Deploy** with the environment variables set in the hosting platform's secret store,
   then run the verification checklist below.

## First administrator

`esme_bootstrap_primary_admin()` is granted to `service_role` only. That is deliberate:
before the first administrator exists, every caller from a browser would be anonymous or a
self-registered applicant, and an anonymous caller must not be able to mint a Super Admin.

Run both statements in the Supabase SQL editor — **after checking what that session actually is**:

```sql
select current_user, coalesce(auth.role(), 'no jwt in this session');
```

`esme_arm_bootstrap()` accepts either a `service_role` session or a `current_user` of `postgres` /
`supabase_admin`, because the SQL editor has no JWT and therefore reports no `auth.role()`. If that
query answers something else — a scoped role a project may grant an invited teammate — the arm
statement raises `ESME_FORBIDDEN`, and the correct path is the API: run the two calls with the
service-role key from a server, or with `supabase db execute` / `psql "$SUPABASE_DB_URL"`, which
connects as the database owner. Do not respond to that refusal by loosening the guard.

```sql
select esme_arm_bootstrap(interval '15 minutes');

select esme_bootstrap_primary_admin(
  'Kareem Tamer',
  'kareemeltemsah7@gmail.com',
  'temsah1',
  '<password you choose now>'
);
```

- The password is supplied at the console and hashed by `crypt(..., gen_salt('bf'))` inside
  the function. It is not stored in this repository, in the bundle, or in browser storage.
- Arming the window is refused once a Super Admin exists; the window closes itself after one
  success or on expiry. Arm it only while you are at the console.
- The function also marks the matching `esme_registration_requests` row active and appends a
  `BOOTSTRAP_SUPER_ADMIN` audit entry.
- Further privileged accounts are created afterwards by `esme_assign_role()` from an
  existing Super Admin session, which is the only path that can grant a privileged role.

The sign-in screen detects the un-provisioned state through `esme_needs_primary_admin()` and
shows these statements instead of submitting a form.

### What onboarding proves, and what it does not

Labelled, because "the bootstrap flow is tested" would be read as "an administrator exists somewhere".

| Claim | Evidence today |
| --- | --- |
| A build with no provider refuses to authenticate; the sign-in screen detects the un-provisioned state and prints the two statements | **automated-tests** — `src/auth/auth.test.ts`, against the development adapter |
| Arming is refused once a Super Admin exists, the window is one-shot and expires, the bootstrap marks the registration row active and appends a `BOOTSTRAP_SUPER_ADMIN` audit entry | **automated-tests** for the *rules* (the development adapter mirrors them) · **static review only** for the SQL that enforces them |
| `esme_arm_bootstrap()` and `esme_bootstrap_primary_admin()` run, hash a password with `gen_salt('bf')`, and survive the status-transition guard | **not verified** — never executed in Postgres. The `accepted_policies` fix in 0003 is reasoned from the signup trigger and the `check (agreed_to_policies)` constraint, not observed |
| The SQL editor reports a role these guards accept | **blocked** — it is a per-project fact. Run `select current_user, coalesce(auth.role(), 'no jwt in this session');` above and record what it answers before arming |
| A real Super Admin exists and signed in | **not verified** — no project has run 0003, and this document author created no account |

Two things an operator must not do while following the procedure above: arm the window and walk
away from the console, and respond to an `ESME_FORBIDDEN` from `esme_arm_bootstrap()` by editing the
guard. The second refusal means the session is not privileged, and the fix is a different session.

## Test accounts (development and staging only)

Three provisioned sign-ins — a Head, a Director and a Member — so the role-based screens can be
opened as each role. Their identities live in `TEST_ACCOUNT_FIXTURES`
(`src/domain/testAccounts.ts`); `0008_seed_test_accounts.sql` is the provider-side copy of the same
three rows.

| Address | Username | Role | Home committee |
| --- | --- | --- | --- |
| `test.head@esme.test` | `test_head` | Head | Technical & Engineering |
| `test.director@esme.test` | `test_director` | Director | Marketing |
| `test.member@esme.test` | `test_member` | Member | Technical & Engineering |

The brief asked for a Director of "Professional Development". This chapter's own structure has four
committees — Technical & Engineering, Media & Content, Marketing, Design — and no Professional
Development, so the fixture is seated in Marketing rather than inventing a committee to sign in to.
Seating is by `short_code` lookup, and a project that has no matching committee gets the account
**unseated** and reports it; the seed never creates a committee.

Nothing here reaches a browser against the real provider. `src/auth/supabaseAdapter.ts` returns the
operator's statements as a refusal, exactly as it does for the bootstrap.

Run in the SQL editor, or through `npm run seed:test-accounts` (which prints these and applies them
over RPC only when given `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment):

```sql
-- 1. Say what this project is. Absent means 'undeclared', and undeclared is refused.
insert into esme_settings (key, value)
  values ('environment', jsonb_build_object('name', 'staging'))
  on conflict (key) do update set value = excluded.value, updated_at = now();

-- 2. Arm the window (service_role only, and it refuses a production declaration).
select esme_arm_test_account_seed();

-- 3. Create what is missing, re-apply the fixture fields of what exists, report what it refused.
select esme_seed_test_accounts(
  '<head password>', '<director password>', '<member password>'
);

-- Later, when the review is over.
select esme_remove_test_accounts();
```

- Passwords are parameters and are hashed with `crypt(..., gen_salt('bf'))` like every other
  identity here. `npm run seed:test-accounts` generates them when not supplied and prints them once.
- Two guards must both hold: the `environment` declaration and the armed window, and the window
  carries a copy of the environment it was armed under. Seeding closes the window, so a replay has
  to be armed again — resetting three passwords must not be something a stale deadline keeps allowing.
- A re-seed repairs rather than duplicates: the password, role, committee and status are re-applied,
  and the report says `repaired` for those rows.
- An address or username that belongs to a different account is **refused and reported**, never
  taken over. `esme_remove_test_accounts()` is stricter still: it drops a row only when both the
  fixture address and the fixture username match, because deleting an `auth.users` identity is not
  reversible.
- No leadership seat is assigned. A Head or Director fixture is scoped by role plus home committee
  (`canActOn()` in `src/domain/roles.ts`, and the committee checks in 0002), so it exercises the
  role's screens without occupying a seat a real person may need.
- A tester that the reward ledger holds accountable is refused by the removal path — 0006 declared
  those keys `ON DELETE RESTRICT` precisely so an account with a decision recorded about it cannot
  be deleted out from under the record. Suspend it from the account directory instead.
- The `account_created` and `account_approved` messages that provisioning queues to a
  `@esme.test` address are deleted from the outbox before a sender can pick them up. The in-app
  notification stays.

The local development adapter has the same three fixtures, seeds them from the Technical Support
workspace under `users.create`, deletes them under `users.delete`, and keeps a seeded member out of
the approval queue with the vault row's `provisioned` marker. In a production *bundle* it refuses
unless `VITE_ALLOW_TEST_ACCOUNTS=true` is set at build time.

**Not verified:** none of 0008 has been executed against Postgres, so the seed window, the conflict
report and the reward-ledger refusal are reviewed SQL, not observed behaviour. The SQL path and the
`npm run seed:test-accounts` apply mode are covered only by static checks
(`supabase/migrations/migrationIntegrity.test.ts`) and unit tests of the command's own decision
logic (`scripts/seed-test-accounts.test.mjs`). The local-dev path is exercised end to end by
`src/auth/auth.test.ts` and `src/components/dashboard/ModeratorTools.test.tsx`.

## Outbound email

Mail leaves the server in two steps, and the browser is in neither.

```
authoritative write  ->  trigger  ->  esme_email_outbox  ->  send-email function  ->  provider
   (approve, assign,     (0005)        one row per          claims it under a row      Resend
    review, award)                      idempotency key      lock, sends, records  ->  esme_email_log
```

### 1. Apply the migration

`migrations/0005_email_notifications.sql` after 0004. It adds the queue, the delivery log, the
preferences table, the triggers that fill the queue, and the functions the sender calls
(`esme_claim_next_email`, `esme_email_recipient`, `esme_record_email_result`,
`esme_report_sign_in`).

What a member chooses to be mailed about is stored in `esme_email_preferences` and written only
through `esme_save_email_preferences(locale, muted_events)`, which keys the row to the session
rather than to the request. That table is the copy `esme_email_recipient` reads when it decides
whether to send, so the choice applies to every device and to mail the member did not trigger
themselves. A browser-side copy of the same settings would be honoured on one laptop and ignored
by the queue.

`migrations/0006_rewards_discipline.sql` adds two more queueing triggers to the same pipeline:
`warning_issued` to the member, and `warning_escalated` to each officer in
`esme_reward_policy.notify_roles_on_escalation`. A bonus is not queued there — 0005's
`esme_email_on_bonus` already turns the ledger row 0006 writes into `bonus_awarded`, and queueing
it twice would be the duplicate send this design forbids.

### 2. Verify the sending domain at the provider

In Resend: add the domain, then publish the **SPF** and **DKIM** records it shows you at your DNS
provider before requesting the API key.

- SPF: a `TXT` record at the sending domain (`v=spf1 include:amazonses.com ~all`).
- DKIM: three `CNAME` records, one per Resend selector.
- Add a `DMARC` `TXT` record at `_dmarc.<domain>` (`v=DMARC1; p=none;` is enough to start).

Mail from an unverified domain is what lands in spam, and a delivery that spam-foldered still
reads as `sent` in the log — the log records what the provider accepted, not what the inbox showed.

### 3. Set the function secrets

Secrets belong to the Edge Function, never to `.env.local` and never to a `VITE_` variable:

```bash
supabase functions deploy send-email --no-verify-jwt

supabase secrets set \
  RESEND_API_KEY=<provider key> \
  RESEND_FROM_EMAIL='ESME CU <members@members.example.edu>' \
  EMAIL_CRON_SECRET=<a long random string only the scheduler knows> \
  APP_PUBLIC_URL=https://<where the dashboard is served>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` already exist for every function.
`--no-verify-jwt` is required because pg_cron calls the function without a user token; the
`x-esme-cron-secret` header is what actually authorises the caller, so a public URL cannot
drain or probe the queue. `APP_PUBLIC_URL` composes the links inside messages; without it the
templates render with no button rather than a guessed host.

Optionally: `EMAIL_MAX_ATTEMPTS` (default 3), `EMAIL_BATCH_LIMIT` (default 20),
`EMAIL_SEND_DELAY_MS` (default 250, Resend accepts one request per second on the free tier).

### 4. Schedule it

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- drain the queue every five minutes
select cron.schedule('esme-send-email', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
      'x-esme-cron-secret', '<EMAIL_CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
$$);

-- raise tomorrow's deadline reminders once a day
select cron.schedule('esme-deadline-reminders', '0 7 * * *',
  $$ select esme_queue_deadline_reminders(3) $$);
```

The Supabase dashboard's Jobs scheduler does the same two entries if you prefer the console.
`esme_queue_deadline_reminders` is granted to `service_role` only, so it runs from the schedule,
not from a member's session.

### 5. Read what actually happened

```sql
select status, count(*) from esme_email_outbox group by status;

select e.event, e.status, e.recipient_email, e.error, e.attempted_at
  from esme_email_log e order by e.attempted_at desc limit 50;

select event, attempts, last_error, available_at
  from esme_email_outbox where status in ('failed', 'suppressed')
 order by updated_at desc;
```

`esme_email_log` is append-only by trigger, and the queue and the log have no write policy for
`authenticated` or `anon` — an admin can read them with `notifications.manage`, nobody can mark a
message as sent.

### Idempotency, in the three places it matters

- The queue key (`event:record:recipient`) is `unique`; a replayed write inserts nothing.
- The claim is `for update skip locked`, so two scheduler runs never send the same row twice.
- Each request carries `X-Entity-Ref-ID`, so even a provider retry that this function did not
  intend arrives once in the inbox.

A failure backs off `15 minutes × attempts` and stops being claimable at the attempt ceiling; it
stays `failed` with the provider's own error text for an admin to read.

### With no provider configured

The function answers 503 and touches nothing, so rows accumulate as `queued` and nothing claims a
delivery happened. Development builds keep using the labelled local outbox (`src/email/`), which
renders the same templates and stores them on the device — the Alerts & Email screen marks those
rows `simulated — not delivered`.

## Authorization model

- Roles: `super_admin`, `high_board`, `moderator`, `director`, `head`, `member`. Account
  statuses: `pending_approval`, `active`, `rejected`, `suspended`. Only `active` reaches the ERP.
  (`pending_email_verification` still exists inside the enum because Postgres cannot drop a label;
  0007 moved every row off it, repointed the defaults and refuses it with a check constraint, so
  nothing can reach it.)
- Seniority is `esme_role_rank()` (100/80/70/50/40/10), which mirrors `ROLE_RANK` in
  `src/domain/roles.ts`. Never compare the enum with `<` or `>` — a label added later lands
  last in the type, not in the order you meant.
- Rights live in `esme_role_capabilities (role, capability, scope)` where scope is
  `all`, `committee` or `self`. `esme_has_capability()` and `esme_capability_scope()` read
  that table inside the database session; policies and SECURITY DEFINER functions call them.
- `src/domain/roles.ts` mirrors the matrix so the UI can hide controls it cannot use. That
  mirror is a convenience only — hiding a button is not authorization, and the database
  decides every time.
- `esme_protect_primary_admin()` refuses deletion or downgrading of the primary account;
  `esme_assert_status_transition()` refuses status jumps that the state machine forbids;
  `esme_audit_is_append_only()` blocks updates and deletes on `esme_audit_log`;
  `esme_assert_publication_write()` refuses an update that changes `published`, `published_at` or
  `published_by`, or an insert that arrives already published, unless the session holds
  `cms.content.publish`. Editing needs `cms.content.write`, and that separation cannot live in a
  policy: `WITH CHECK` sees only the row about to be stored, so it cannot tell a flipped flag from an
  unchanged one. See [docs/DATABASE_AND_MIGRATIONS.md](../docs/DATABASE_AND_MIGRATIONS.md).
- `esme_assert_privilege_channel()` (0009) holds the same line for the two columns that decide
  privilege: `esme_profiles.role` moves through `esme_assign_role()`, and `status` through
  `esme_decide_registration()` / `esme_set_account_status()`, never through a `PATCH` from a browser.
  It exempts calls made inside a SECURITY DEFINER function with `esme_called_directly()`, which is why
  the 0003 bootstrap and the 0008 seed still work.
- The three aggregate views (`esme_member_scores`, `esme_committee_rosters`,
  `esme_member_reward_records`) are `security_invoker` as of 0009, so they read with the caller's
  privileges and the base-table policies apply. That option is not the whole fix: a plain view runs as
  its owner and skips RLS, and an invoker view whose caller lacks `SELECT` on the base tables raises
  `42501` instead of returning fewer rows — hence the grants, and the `revoke … from anon, public` that
  closes the route default privileges had left open.
- Registration always produces a `member`-track request with status
  `pending_approval`, reviewable the moment it exists. A role submitted by a browser is ignored
  server-side.
- Bonuses and warnings (0006) are written only by `esme_award_bonus()`,
  `esme_issue_warning()`, `esme_reverse_reward_entry()` and `esme_acknowledge_warning()`. Each
  one runs the same `esme_assert_reward_target()` gate: capability, then the policy's role list,
  then committee reach, then not-yourself, then not the primary administrator, then rank, then a
  Head's own sub-team or a Director's own committee. `esme_reward_entries` has a channel trigger
  that refuses a direct insert/update/delete, and its freeze trigger refuses any change to a
  stored field — the only writes it allows are an acknowledgement and the reversal pointer.
  A correction is a new row.

## Verification checklist (record the result of each line)

Run as a non-privileged applicant token and as an administrator token, and note what differs:

`supabase/probes/authorization_probes.sql` automates the part of this list that fits inside one
rolling-back transaction — the session identity that line 1 of any run depends on, the reward channel
and ledger freeze, `rewards.write` absent on a Member, the cross-committee reach, the replayed
idempotency key, the blank reversal reason, the audit `delete`, the publication guard **and** the
ordinary content write it must not block, a suspended account holding a valid token, (written for
0009, P15–P19) a direct `role` write, a Member counting an aggregate view, an outbox insert under
`force row level security`, the reward-records view returning other members' rows, and the roster
view's parity with `esme_reaches_committee()`, and (written for 0010, P20–P21) a self-targeted
`esme_assign_role()` and an authorized grant whose audit row has to name both roles. It prints
PASS/FAIL/SKIP for each. Run the file, then
work down the numbered lines by hand for the rest — the
Edge Function, provider domain check, second-device preferences and delivery receipts cannot be
answered from psql, and a probe's PASS is not a substitute for them.

1. `select * from esme_profiles` as anon → 0 rows visible.
2. As a pending applicant: `update esme_profiles set role='super_admin' where id=(select auth.uid())`
   → refused. Before 0009 this depended on which branch of `esme_profiles_update` answered; now
   `esme_assert_privilege_channel()` refuses it first, whatever the policy says. See line 46.
3. As a pending applicant: `select esme_assign_role((select auth.uid()), 'super_admin')` → refused.
4. As an applicant: `select esme_decide_registration(...)` on your own request → refused.
5. As a `head`: read a submission from another committee → no rows returned.
6. As a `head`: `select esme_adjust_score(...)` for another committee's member → refused.
7. `select esme_record_review(...)` for a task you neither own nor review → refused.
8. Suspended account with a still-valid JWT: any `esme_*` select → refused, because
   `esme_current_status()` is re-read per request.
9. `insert into esme_audit_log ...` as `authenticated` → refused: the log has no
   insert/update/delete policy for client roles and is written only by the SECURITY
   DEFINER functions; `update` and `delete` are additionally blocked by trigger.
10. Send a password-reset email, and confirm it arrives.

Email layer (0005, and the decision keys re-cut by 0007), same rule — record what each line
actually returned:

11. Approve a registration twice with the same request id → the second call raises
    `ESME_ALREADY_DECIDED` and one `account_approved` queue row exists.
12. `insert into esme_email_outbox ...` as `authenticated` → refused: no insert policy for client
    roles, and `force row level security` is on.
13. `select * from esme_email_outbox` as a `member` → 0 rows; as a moderator → the queue.
14. Mute `login_security_alert` in `esme_email_preferences` → refused by
    `esme_preferences_block_security_mute`.
15. Run the function without the secret header → 401; with it but no `RESEND_API_KEY` → 503 and
    `select count(*) from esme_email_outbox where status = 'processing'` unchanged.
16. Queue a row whose profile has no address → it lands as `suppressed` with
    `recipient has no email address on file`, not as `sent`.
17. As a member: `select esme_save_email_preferences('ar', array['deadline_reminder'])`, then
    sign in on a second device → the same locale and mute come back, and a queued
    `deadline_reminder` for that member is recorded `suppressed`. Calling the same function with
    `array['login_security_alert']` → refused.
18. As a member: `update esme_email_preferences set locale='ar' where profile_id=<someone else>`
    → 0 rows, because the self policy covers writes as well as reads.

Rewards and discipline (0006). Each line below is the request the UI would make; record which
`ESME_*` code answered, and paste no result you did not actually observe:

19. As a `head`: `select esme_award_bonus(<a member of their own committee>, 10, 'Ran the
    workshop', null, 'probe:1')` → one entry **and** one `esme_score_ledger` row with the same id.
20. As a `head`: the same call for an account in another committee → `ESME_OUTSIDE_TEAM`; as a
    `director` for another committee's account → `ESME_OUTSIDE_COMMITTEE`.
21. As a `member`: the same call for anyone → `ESME_FORBIDDEN` (the matrix grants no
    `rewards.write`), and `select esme_issue_warning(...)` likewise — a `moderator` too, which
    reads rewards but was deliberately given no `rewards.write` row. `ESME_POLICY_DISABLED` is the
    answer when a role holds the capability but the matrix switched its list off, so re-run this
    line after clearing `can_award_bonus` down to one role.
22. As a `director` or `high_board`: `select esme_award_bonus(<your own id>, …)` →
    `ESME_SELF_TARGET`; the primary Super Admin as the target → `ESME_PROTECTED`; a suspended
    account → `ESME_INACTIVE_ACCOUNT`; an account ranked at or above the actor → `ESME_ABOVE_RANK`.
23. Repeat line 19's call with the **same** `p_idempotency_key` → the existing entry comes back
    and `select count(*) from esme_score_ledger where idempotency_key = 'reward:probe:1'` is still
    1. The points did not move twice.
24. As a `head`: `select esme_award_bonus(<own member>, 0, '…')` → `ESME_BAD_POINTS`, and 26
    points against the default cap → `ESME_OVER_ACTION_CAP`; a fifth bonus in the window that
    breaks the period ceiling → `ESME_OVER_PERIOD_CAP`. In all three cases
    `select count(*) from esme_reward_entries` is unchanged — nothing was written, not even a
    rejected row.
25. Issue the third warning in one window → `esme_issue_warning()` succeeds **and** the queue
    holds one `warning_escalated` row per notify role, plus a `WARNING_ESCALATED` audit entry.
26. `select esme_reverse_reward_entry(<bonus id>, '')` → `ESME_NO_REASON`; with a reason → a
    negative ledger row, the original flipped to `reversed`, and the original's reason text still
    readable. Reversing the same entry again → `ESME_ALREADY_REVERSED`.
27. As the target: `select esme_acknowledge_warning(<warning id>)` sets the timestamp once and a
    second call changes nothing; as anyone else → refused.
28. `update esme_reward_entries set reason = '…' where id = <entry>` → refused by the channel
    trigger; `delete from esme_reward_entries` likewise.
29. As a role with no `rewards.configure` (everything except `super_admin`):
    `select esme_update_reward_policy(...)` → `ESME_FORBIDDEN`. As `super_admin`: a ceiling
    smaller than three per-action bonuses → `ESME_INVALID_POLICY`; a role in
    `p_can_award_bonus` that lacks `rewards.write` → `ESME_INVALID_POLICY`, and the audit log
    records the update with "never to entries already filed".
30. `select * from esme_member_reward_records` as a member → your own row only; as a director →
    your committee's. The figures are sums of entries, so they cannot disagree with the ledger.
31. As `authenticated`: `select * from esme_reward_entries` returns only what your scope reaches —
    an entry naming you as target or actor is visible even when the committee is not.

Account lifecycle (0007). The stage the platform removed has to stay removed:

32. Sign up from a browser → `select status from esme_profiles where id = <new id>` answers
    `pending_approval`, and so does the matching `esme_registration_requests` row. No click needed
    before the queue will show it.
33. `insert into esme_profiles (id, email, username, display_name, status) values (…,
    'pending_email_verification')` → refused by `esme_profiles_status_reachable`; the same for the
    queue table. The retired label is unreachable even to a direct insert.
34. Approve a request whose `email_verified` is `false` → the approval succeeds. `email_verified`
    is recorded and never consulted.
35. Take a rejected account back through `rejected → pending_approval` and approve it → a **second**
    `account_approved` queue row appears. Under the old key it would have been swallowed.

Test accounts (0008), on a project you have declared as development or staging:

36. `select esme_arm_test_account_seed()` before declaring anything → `ESME_PRODUCTION_ENVIRONMENT`,
    and the message names what it read as `'undeclared'`. A project that never said what it is does
    not get seeded by accident.
37. Declare `staging`, arm, then seed with three passwords → the summary reports three `created`.
    `select role, status, committee_id from esme_profiles where email = 'test.head@esme.test'` answers
    `head`, `active` and the T&E committee's id, and that address signs in with the password supplied.
38. Seed again in the same window → `ESME_SEED_CLOSED`; the first seed consumed it. Re-arm and seed a
    third time, after editing one fixture's role and signing in with a changed password → the summary
    says `repaired`, `select count(*) from esme_profiles where email like '%@esme.test'` is still 3,
    and the fixture's role and password are back.
39. Create an account whose username is `test_head` but whose address is somebody else's, then seed →
    the report names a conflict for that fixture and `select encrypted_password from auth.users where
    username = 'test_head'` is unchanged. Nothing was written to an account that is not the fixture.
40. `select count(*) from esme_email_outbox where recipient_profile_id = <a tester>` → 0, while
    `select count(*) from esme_notifications where profile_id = <the same tester>` is not: the mail
    that could never be delivered is gone, the in-app notice stayed.
41. Award that tester a bonus, then `select esme_remove_test_accounts()` → the removal reports that
    fixture as refused and leaves its `esme_reward_entries` row readable; the other two disappear from
    `auth.users`, and `select committee_id, director_id, head_id from esme_committees` shows no seat
    that pointed at a dropped account.

Content publication (0002), the rule that used to live in an impossible policy. `esme_pages_update`
once carried `with check (… old.published …)`, which Postgres cannot parse — a policy expression has
no row *before* the change to name — so the enforcement moved into `esme_assert_publication_write()`.
Run all four lines, because the third and fourth are what prove the guard is a guard and not a
lockout:

42. As a token that holds `cms.content.write` but not `cms.content.publish`:
    `update esme_content_pages set published = true where id = <page>` → `ESME_FORBIDDEN`, raised by
    the guard, naming the three columns. Then `select published from esme_content_pages where id =
    <page>` is unchanged.
43. For the same actor: `insert into esme_content_pages (…, published) values (…, true)` → likewise
    refused. The guard fires on `before insert or update`, so a fresh page cannot be born published;
    the same insert with `published = false` succeeds.
44. Edit the body only, as that same actor → accepted. `title`, `blocks` and the rest stay writable
    under `cms.content.write`; only the publication columns are held back.
45. As a token that holds `cms.content.publish` (or from the API with `service_role`, or in the SQL
    editor as `postgres` / `supabase_admin`): line 42's update → accepted, and `esme_audit_log` gains
    the CMS entry. If it is refused, run `select current_user, coalesce(auth.role(), 'no jwt in this
    session');` before touching the guard — the exemption list is the likely failure, not the rule.

Security hardening (0009), the two findings that the line-by-line review of 0001–0008 reported. These
five lines are the only evidence that either fix is real — both are **static review only** until
someone runs them on a staging project:

46. As a `head` or `director` token: `update esme_profiles set role = 'super_admin' where id =
    (select auth.uid())` → `ESME_ROLE_FUNCTION_ONLY`, raised by `esme_profiles_privilege_channel`.
    Before 0009 the same statement was accepted by `esme_profiles_update`, because its privileged
    branch only asks whether the target row is *reachable* — and `committee` scope includes the
    caller's own row. `select role from esme_profiles where id = <that profile>` must still answer
    the original role.
47. As the same token: `update esme_profiles set status = 'active' where id = <another pending
    applicant you can reach>` → `ESME_STATUS_FUNCTION_ONLY`. This is the second half of the same
    hole: a reachability check alone also let a Head promote `pending_approval → active` without
    holding `registrations.decide`. Approving through `esme_decide_registration()` still works.
48. As that token: `update esme_profiles set display_name = '…', bio = '…' where id =
    (select auth.uid())` → **accepted**, and the row shows the change. Every ordinary profile edit has
    to survive the guard; a fix that only knows how to refuse is not a fix. Same for
    `committee_id` written through `esme_set_account_committee()`, and for `role` written through
    `esme_assign_role()` by a role that holds it.
49. As a `member` token in the SQL editor: `select count(*) from esme_member_scores`,
    `esme_committee_rosters` and `esme_member_reward_records`. The first two answer **0** (or raise
    `permission denied for view`), never a chapter-wide total; the third returns your own row only.
    Repeat as a `head` — the roster count then matches `select count(*) from esme_committees c where
    esme_reaches_committee(c.id, 'committees.read')`, which is probe P19's parity check. If any of
    the three raises `permission denied for table esme_profiles` / `esme_score_ledger` /
    `esme_committee_memberships` / `esme_reward_entries` instead of filtering, that is not the view
    protecting anything: a `security_invoker` view reads with the caller's own privileges, so the
    base-table `SELECT` grants at the end of 0009 did not land.
50. As `anon` (no JWT): `select * from esme_member_scores` → refused. Before 0009 the views executed
    as their owner, so RLS on `esme_profiles` and `esme_score_ledger` was skipped entirely, and the
    project's default privileges handed that owner-evaluated result to `anon`. `revoke … from anon,
    public` is what closes the second half; re-check it with `select relacl from pg_class where
    relname in ('esme_member_scores','esme_committee_rosters','esme_member_reward_records');`.

Privilege RPCs (0010), the three findings the 2026-10-22 review left open on the function side. 0009
froze the *column*; these lines are about the RPC that is still allowed to move it. P20 and P21 in
`supabase/probes/authorization_probes.sql` automate the first and the third:

51. As any signed-in token, including a Super Admin's: `select esme_assign_role(<your own profile
    id>, 'moderator')` → `ESME_SELF_ROLE_CHANGE`, and `select role from esme_profiles where id =
    (select auth.uid())` is unchanged. Before 0010 the function checked the caller's capability and
    the target's protected flag, so an administrator holding `users.role.assign` could move their own
    row — the one account that ought to be decided by somebody else.
52. As a role that holds `users.role.assign` but is not `super_admin` (there is no such row in the
    matrix today, which is why this line needs a temporary `esme_role_capabilities` edit, and why you
    should clear it afterwards): `select esme_assign_role(<another id>, 'high_board')` → `ESME_FORBIDDEN`.
    0002's `esme_assign_role` listed four privileged labels literally and `high_board` — added by 0006
    — was not one of them, so a grant of it skipped the "only a Super Admin grants privilege" branch.
    0010 defines the test as "any role that is not `member`", so a fifth label cannot be forgotten the
    same way. Same call for `'member'` → accepted: demoting is not granting.
53. Repeat line 52 as a Super Admin for a peer, then `select action, details from esme_audit_log
    order by created_at desc limit 5` → the row names both values (`<email>: member → moderator`), not
    just the outcome. `esme_set_account_status()` is checked the same way (`<email>: active ->
    suspended`). A grant that lands without its evidence is a grant nobody can account for later.
    Refusals do **not** appear: the `raise` that refuses the write aborts the audit insert with it,
    which is a limitation of one-transaction denial auditing, not something this file fixed.

Registration answers (0011), the half of the signup that only the database can settle. P22 and P23 in
`supabase/probes/authorization_probes.sql` automate the first and the third, and they are the only
probes here that write through `auth.users` so the trigger itself runs:

54. Register from the portal with a department, an academic year, "Yes — I belong to a committee" and
    High Board selected, then `select committee_membership, academic_year, department,
    requested_committee_id, assigned_committee_id from esme_registration_requests order by submitted_at
    desc limit 1` → the four answers are present, `requested_committee_id` names the High Board row,
    and `assigned_committee_id` is NULL. `select role, capabilities from esme_identity(<that profile
    id>)` → `member` and `{}`. An application that arrives already assigned, or already holding a
    capability, means the request was allowed to decide its own authorization.
55. Register again and answer "No" after the browser still holds a committee selection: the queue row
    must read `committee_membership = 'no'` with **both** committee columns NULL. This is
    `resolveCommitteeAnswer()` from `src/domain/registration.ts` enforced where a reviewer reads it,
    and it is why the answer is stored rather than inferred from an empty committee.
56. `select name, short_code, count(*) over () from esme_committees where
    lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) = 'highboard'` → exactly one row. A second
    spelling is the failure mode 0011's guard exists to prevent: two High Board committees means an
    approval can seat someone in the copy nobody means.

Until these run against your project, the integration is **unverified**, and the product
must not present it otherwise. `0007_remove_email_verification.sql` has the same caveat as every
other file here: no Postgres existed in the environment where it was written, so it has been read
and diffed against 0002 and 0005, not applied.

## Backup and restore

- **Before any migration or destructive change**: Dashboard → Database → Backups → take a
  manual backup, or `pg_dump "$SUPABASE_DB_URL" -f pre-migration-$(date +%F).sql`.
- The ERP's own export (Settings & Backups → *Export JSON*, guarded by `backups.manage`)
  contains only what that browser can see. It is **not** a database backup.
- `dev_seed_reference.sql` inserts with `on conflict ... do nothing` on the natural keys, so
  re-applying it on a database that already holds the reference content changes nothing —
  but it will not undo local edits to those rows either.
- Never restore a production dump into a shared development project without deciding what
  happens to real member rows, and back up the target first.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Build refuses to start: "Authentication is not configured" | No `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in a production build. The local fallback is compiled out on purpose. |
| Sign-in works, dashboard is empty | Expected for a fresh project: operational tables start empty. Create committees, then members, then tasks. |
| `ESME_FORBIDDEN` on every admin action | The role's row in `esme_role_capabilities` is missing — re-run 0002, or the profile status is not `active`. |
| `ESME_FORBIDDEN: published, published_at and published_by need the cms.content.publish capability` | Correct, and the intended behaviour. An editor holding `cms.content.write` may change the page but not its publication state; publish from a session holding `cms.content.publish`. If that session is refused too, check `current_user` / `auth.role()` — do not relax `esme_assert_publication_write()`. |
| Applying 0002 fails with `column "old" does not exist` (and the whole file rolls back) | The copy being applied predates the publication guard: `esme_pages_update` put a trigger-only record reference inside a policy expression. Pull the current file; 0003–0009 cannot apply until 0002 does, because each file is one `begin; … commit;`. |
| A profile write fails with `ESME_ROLE_FUNCTION_ONLY` / `ESME_STATUS_FUNCTION_ONLY` | Expected, and it is 0009 working: `role` and `status` move through `esme_assign_role()` / `esme_decide_registration()` / `esme_set_account_status()`. If a save that only meant to change `display_name` raises it, the request carried a role or status value that is **different** from the stored one — a PATCH that echoes a stale cached copy is enough, because the guard compares with `is distinct from`. Send the columns you changed, or read the row first. |
| `select … from esme_member_scores` raises `permission denied for table esme_profiles` | `security_invoker` is on but 0009's base-table `SELECT` grants were not applied. The view is filtering correctly in the sense that it obeys the caller — the caller simply holds nothing. Re-check the grants; do **not** undo the `alter view`. |
| `ESME_SELF_ROLE_CHANGE` from `esme_assign_role()` | Expected, and it is 0010 working: nobody decides their own privilege, including a Super Admin. Run the grant from a second administrative account, or hand the change to whoever holds `users.role.assign` beside you. A UI that offers "change my own role" is the bug, not this refusal. |
| `esme_assign_role(<id>, 'high_board')` refused for a caller who is not `super_admin` | Expected since 0010. 0002 compared the requested role against a literal list of four labels and left `high_board` out, so a High Board grant skipped the privilege branch. 0010 treats every role that is not `member` as privileged, so a label added later is covered without editing the function. |
| A role change succeeded but `esme_audit_log` holds no row naming both roles | 0010's detail is `<email>: <old> → <new>`. If the row shows the outcome only, the project is still running 0002's version of the function — 0010 was written but not applied. Re-run the file; `create or replace function` makes it idempotent. |
| `ESME_BOOTSTRAP_CLOSED` | Arm the window first, or a previous window expired. || `ESME_INVALID_STATUS_TRANSITION: pending_email_verification -> active` during bootstrap | `0007_remove_email_verification.sql` has not been applied. Until it runs, the profile the signup trigger creates sits on a stage the guard will not let jump to `active`. |
| `permission denied for function esme_bootstrap_primary_admin` | Correct. It runs in the SQL editor or with `service_role`, never from the browser. |
| Alerts & Email shows `local-outbox` and every row reads `simulated — not delivered` | Correct for a build with no provider configured. Nothing was delivered; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset, so the local sender is active. |
| The queue grows and `esme_email_log` stays empty | The function never ran: check the schedule, and run it once by hand. A 401 means `EMAIL_CRON_SECRET` differs between the secret and the scheduler's header; a 503 means the provider is not configured. |
| Rows stuck in `processing` | A run died mid-message. Anything older than ten minutes is handed back to `queued` by `esme_claim_next_email`; the queue is never lost, and `X-Entity-Ref-ID` stops a second copy reaching the inbox. |
| A member gets no mail but the queue row says `sent` | The address they signed up with is not theirs or bounced. `esme_email_log` keeps the address that was used at send time, so compare it with `esme_profiles.email`. |
| `ESME_REWARD_FUNCTION_ONLY` | Correct — a bonus or warning was written with a raw `insert`/`update`. Only `esme_award_bonus()`, `esme_issue_warning()`, `esme_reverse_reward_entry()` and `esme_acknowledge_warning()` may write that table, and each of them runs the scope gate first. |
| `ESME_OVER_PERIOD_CAP` on a bonus the UI let through | The two browsers disagree. `src/domain/rewards.ts` reads this device's copy of `esme_reward_policy`; with the client still on local storage, another officer's bonus is invisible here. Until the adapter queries the ledger, treat the RPC's answer as the truth. |
| `0 rows` from `select * from esme_reward_entries` for an officer who expects to see their committee | Read RLS is scoped by `esme_reaches_profile(target_id, 'rewards.read')`. A member sees only entries naming them; a head or director only their committee. Check the profile's `committee_id` before suspecting a lost write. |
