# Database and migrations

## Read this first: what is real today

**This repository has no running backend.** There is no database instance, no API service, and
no deployed Supabase project attached to it. Concretely:

- The SQL in [`supabase/migrations/`](../supabase/migrations) is **authored and reviewed but
  has never been executed**. This environment has no `psql`, no Docker and no Supabase CLI, so
  it has not been parsed by Postgres, let alone tested against RLS. Treat it as a design that
  still needs a verification pass on a real project.
- A Supabase project exists and `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are filled in the
  untracked `.env.local` on this machine, but its remote schema is **empty**: no migration has been
  applied to it, so `esme_*` calls answer `PGRST202` and a first real sign-in cannot complete. The
  test suite pins both variables empty (`vite.config.ts` → `test.env`) so no run ever depends on
  whose `.env.local` is open.
- Everything the dashboard stores today is written to **versioned browser storage** by
  [`AppContext`](../src/context/AppContext.tsx). That is real persistence across reloads on one
  device — the committee CMS tests read their writes back out of `localStorage` after a remount
  — but it is **not** shared between browsers, not queryable server-side, and not a secure
  store. A production build with no provider configured refuses to authenticate at all rather
  than pretend otherwise.

The honest statement of the current architecture: *a real client, real rules, a real persistence
layer that is on the wrong side of the network.* The rest of this file is the plan to move it.

## Storage in use today

| Key | Contents |
| --- | --- |
| `ESME_CU_SCHEMA_VERSION` | `v5`. Set once by `runStorageMigrations()`. |
| `ESME_CU_STATE_V2_committees` | Committee rows (ids, names, descriptions, objectives, sub-teams, status, `directorId`, `headId`). |
| `ESME_CU_STATE_V2_userProfiles` | The ERP half of the directory — points, approved-task counts, questionnaire fields. Identity comes from the adapter and overwrites these on merge. |
| `ESME_CU_STATE_V2_formFields` | Registration questionnaire schema. |
| `ESME_CU_STATE_V2_seasonEvents` | Season plan milestones. |
| `ESME_CU_STATE_V2_websiteContent` | The public-page content document (`documentVersion: 2`): copy, section visibility and order, nav and footer links, socials, share text, image slots. Validated by `src/domain/cms.ts` on read and on write. |
| `ESME_CU_STATE_V2_theme` | `light` / `dark` / `system`. |
| `ESME_CU_STATE_V2_{tasks,submissions,scoreLedger,applications,skillMatrix,notifications,notificationKeys,actionPrefs,auditLogs,scoreAppeals,skillRequirements,courses,courseCompletions,developmentGoals,developmentFeedback,seasons,objectives,keyResults,rewardEntries,rewardPolicy}` | Operational collections. Written by the store, read back on the next mount; start empty and are device-local. `rewardEntries` is the bonus and warning ledger the rewards screen appends to; `rewardPolicy` is the permission matrix, seeded from `DEFAULT_REWARD_POLICY` and rewritten only by `updateRewardPolicy()`. |
| `ESME_CU_DEV_AUTH_V1` / `ESME_CU_DEV_SESSION_V1` / `ESME_CU_DEV_THROTTLE_V1` | Local development auth vault (PBKDF2 hash + salt, never the password), session, lockout counters. Development builds only. |

Keys outside the `ESME_CU_` namespace are never touched.

**One repair found while writing these docs.** `tasks`, `submissions`, `scoreLedger`,
`applications` and `skillMatrix` were React state only — no cache writer and no reader — so a
reload erased assigned work, reviews and scores. That is exactly the "local state as the only
persistence mechanism" defect this stage was told to eliminate, so those five collections now go
through `readV2()` / `writeV2()` like the rest, covered by
[`src/context/operationalCache.test.tsx`](../src/context/operationalCache.test.tsx): a task
created through the store is read back by a second mount.

### Migration history in the browser

- **v1 → v2**: deleted the old cache's fictional operational data (30 invented members, fake
  tasks, hand-written scores, sample applications, seeded audit events) and the browser-owned
  `currentUser` that let a device decide who was signed in. Only reference content was carried
  forward. The sweep runs on the recorded **major** version, not on "not the target version": a
  device already at v2 or later never re-runs it, so a stray `ESME_CU_STATE_V1_*` key left behind by
  an old build cannot overwrite the current v2 cache and cannot be reported as deleted.
- **v2 → v3**: rewrote stored committee rows to drop the cached `directorName` / `headName`
  columns, because a seat now references an account and the account owns the only copy of the
  name. Nothing is emptied or reseeded; an assignment whose account is gone is left exactly as
  it was, so the integrity warning can surface it instead of a silent clear hiding it.
- **v3 → v4**: rewrote the cached website document into the shape the CMS edits. The four text
  groups keep every character the operator wrote; section switches, nav and footer links, socials
  and image slots arrive as the published defaults the build ships, because the old shape had no
  field for them and leaving them empty took the navigation off the page.
- **v4 → v5**: applied the streamlined signup to the cached questionnaire schema. A row still
  sitting at what the build shipped is switched off (Student ID, Academic Year, Department, Phone,
  the second preference, skills, experience, motivation and availability), and the committee
  preference stops being required. A row this device's operator had already set some other way is
  left alone and reported — the migration corrects what the build shipped, not a decision somebody
  made. The two changes are reported separately — a field the form no longer shows is "switched off",
  the committee question the form still shows "stopped requiring" — because the operator is told
  different things about them. Nothing is deleted from the schema, so Registration → Form Schema can
  turn any of them back on.
- Tests: [`src/storage/migrations.test.ts`](../src/storage/migrations.test.ts) (25 cases), including
  one that pins `REFERENCE_FORM_FIELDS` against the table the v5 rewrite applies, so the two cannot
  drift without a test failing, and two that pin the V1 sweep to a device that never had it.
  The v5 rewrite was also run against the development browser's real cache; see
  [TESTING.md](TESTING.md#what-the-suite-does-not-prove) for what that found.

## SQL migrations (target state)

| File | Purpose |
| --- | --- |
| [`0001_schema.sql`](../supabase/migrations/0001_schema.sql) | Enums, `esme_profiles`, `esme_committees`, `esme_committee_memberships`, `esme_registration_requests`, `esme_content_pages` + `esme_content_revisions`, `esme_settings`, `esme_media`, `esme_season_events`, `esme_tasks` + assignments, `esme_submissions`, `esme_score_ledger`, `esme_skill_matrix`, `esme_kpi_targets`, `esme_notifications`, `esme_audit_log`, `esme_registration_fields`, `esme_role_capabilities`. |
| [`0002_functions_rls.sql`](../supabase/migrations/0002_functions_rls.sql) | Capability helpers, status-transition and primary-admin guards, the publication guard on `esme_content_pages`, append-only audit triggers, the new-user handler, and the DEFINER functions that decide registrations, statuses, roles, reviews and score adjustments. RLS policies and grants. |
| [`0003_bootstrap_admin.sql`](../supabase/migrations/0003_bootstrap_admin.sql) | Creates the first Super Admin only while no privileged account exists, and only a `service_role`/`postgres` session may arm the window and call it. |
| [`0004_committee_leadership.sql`](../supabase/migrations/0004_committee_leadership.sql) | The committee repair: leadership ledger, draft validation trigger, channel guards, `esme_assign_leader()`, `esme_set_account_committee()`, `esme_leadership_map()`, RLS on the ledger. |
| [`0005_email_notifications.sql`](../supabase/migrations/0005_email_notifications.sql) | The mail layer: `esme_email_outbox`, `esme_email_log`, `esme_email_preferences`, the triggers that fill the queue from the authoritative writes, the claim/record functions the sender calls, `esme_report_sign_in()`, `esme_queue_deadline_reminders()`, `esme_save_email_preferences()`, RLS and grants. |
| [`0006_rewards_discipline.sql`](../supabase/migrations/0006_rewards_discipline.sql) | The rewards layer: the `high_board` role, `esme_reward_entries` (append-only bonus and warning ledger), `esme_reward_policy` (the permission matrix), `esme_award_bonus()`, `esme_issue_warning()`, `esme_reverse_reward_entry()`, `esme_acknowledge_warning()`, `esme_update_reward_policy()`, the warning mail and escalation triggers, RLS and grants. |
| [`0007_remove_email_verification.sql`](../supabase/migrations/0007_remove_email_verification.sql) | Retires the `pending_email_verification` stage: moves rows to `pending_approval`, repoints the defaults, rewrites the transition guard, the new-user handler and `esme_decide_registration()`, shortens `esme_identity()`, and re-keys the decision mail so a later decision is not suppressed. |
| [`0008_seed_test_accounts.sql`](../supabase/migrations/0008_seed_test_accounts.sql) | The Head / Director / Member fixtures: `esme_declared_environment()`, `esme_arm_test_account_seed()`, `esme_seed_test_accounts()`, `esme_remove_test_accounts()`, all `service_role`-only. No new table. |
| [`0009_security_hardening.sql`](../supabase/migrations/0009_security_hardening.sql) | The two 2026-10-22 review findings, closed forward: `esme_assert_privilege_channel()` refuses a direct write to `esme_profiles.role` / `status`, and `esme_member_scores`, `esme_committee_rosters` and `esme_member_reward_records` become `security_invoker` views with the base-table `SELECT` grants that requires plus `revoke … from anon, public`. No earlier file was rewritten. |
| [`0010_privilege_hardening.sql`](../supabase/migrations/0010_privilege_hardening.sql) | The three findings the same review left open on the RPC side: `esme_assign_role()` refuses a self-targeted change (`ESME_SELF_ROLE_CHANGE`), treats every role that is not `member` as a privileged grant (0002's literal list of four labels left `high_board` out), and writes both role values into the audit row; `esme_set_account_status()` records `previous -> new` the same way. Both are `create or replace function` restatements — no earlier file was rewritten, and nothing new is created. |
| [`0011_registration_academic_fields.sql`](../supabase/migrations/0011_registration_academic_fields.sql) | The answers the signup form now asks. Six nullable columns on `esme_registration_requests` (`student_id`, `academic_year`, `department`, `phone`, `committee_membership`, `second_committee_preference_id`), a check that keeps `committee_membership` to `yes`/`no`/NULL, a new `esme_committee_reference()` that resolves a committee without ever raising, `esme_handle_new_auth_user()` restated to store the answers and to clear both committee references when the applicant answers `no`, the High Board committee row, and the matching `esme_registration_fields` rows. Additive and forward-only: no drop, no row rewritten, `esme_decide_registration()` untouched. |
| [`dev_seed_reference.sql`](../supabase/migrations/dev_seed_reference.sql) | Optional reference content for a fresh dev project. Not a production seed. |

### Why the publication rule is a trigger, not a policy (0002)

`esme_pages_update` used to read:

```sql
with check ( esme_has_capability('cms.content.publish') or published = old.published );
```

That is not a rule, it is a parse error. A row level security expression is evaluated against the
row as it is about to be stored; `old` and `new` exist only inside a trigger, so Postgres rejects
the statement with `column "old" does not exist`. Because every migration in this repository is one
`begin; … commit;` block, the error would have aborted 0002 in its entirety — no functions, no
grants, no policies, and nothing after it, since 0003–0009 all depend on it. It is the reason
"the SQL has never run" is a load-bearing caveat rather than a formality, and it is now the reason
[`migrationIntegrity.test.ts`](../supabase/migrations/migrationIntegrity.test.ts) reads every
`create policy` statement on its own and refuses a trigger-only record reference in one.

The requirement it was reaching for is still enforced, and more clearly:

- **The policy keeps the part a policy can decide.** `esme_pages_update` checks
  `cms.content.write` on both sides — who may write this row at all.
- **The guard keeps the part that needs both rows.** `esme_assert_publication_write()` fires
  `before insert or update on esme_content_pages` and raises `ESME_FORBIDDEN` unless the session
  holds `cms.content.publish`, comparing `published`, `published_at` and `published_by` with `is
  distinct from`, so an editor who sends the unchanged values is unaffected and one who sends a
  flipped flag is refused. The insert branch refuses a page that arrives already published, which
  would otherwise reach the same privilege by a different route.
- **An editor's workflow is unchanged.** Saving content touches `body`, `title`, `seo`, `nav_order`,
  `in_navigation` and `updated_at`; none of those are the guard's columns, so `cms.content.write`
  keeps working and only the publish action needs the publisher capability. This matches the client,
  where publishing files a revision and writes the live document in one guarded step while saving
  does neither.
- **An operator session is exempt, by the same reasoning as 0003 and 0008.** `esme_has_capability()`
  reads the signed-in profile, which a service-role call or a SQL-editor session (`postgres`,
  `supabase_admin`) does not have; refusing those would break the bootstrap path, not protect it.
  A browser session never satisfies this branch — it has no way to be `postgres`.

The residual risk is the one this repository has always carried: none of the above has been executed
by Postgres. The static check proves the invalid expression is gone and that the guard exists,
compares the right columns and names the right capability; it does not prove the trigger fires in
the order assumed. Verification 3 and 4 in
[Applying them](#applying-them-not-done--needs-a-real-project) are where that gets settled.

### Why 0009 exists: two findings closed forward, not rewritten

The line-by-line review of 0001–0008 reported two authorization defects. Both were confirmed by
reading the SQL, not by running it — **[static review]** — and both are fixed by a ninth file rather
than by editing the file that introduced them, because a migration that has already been applied
anywhere cannot be changed without the environments that hold it drifting.

- **Finding 1 (Critical) — self-service role escalation.** `esme_profiles_update` had a privileged
  branch that asked only whether the target row is *reachable*, and the `committee` scope includes
  the caller's own profile. A Head or Director holding `users.update` could therefore
  `PATCH /rest/v1/esme_profiles?id=eq.<self>` with `role: "super_admin"` and the policy said yes;
  the same branch let them flip another member `pending_approval → active` without
  `registrations.decide`. Narrowing the policy cannot express the rule either — `WITH CHECK` sees the
  row about to be stored and has no `old` to compare against, which is the identical limitation that
  moved the publication rule into a trigger. So `esme_assert_privilege_channel()` fires
  `before insert or update on esme_profiles`, and on a direct call (same `esme_called_directly()`
  test 0004 uses) refuses any change to `role` or `status`, or an insert that arrives with either
  one already set. Every sanctioned writer is a SECURITY DEFINER function — `esme_assign_role()`,
  `esme_decide_registration()`, `esme_set_account_status()`, the 0003 bootstrap, the 0008 seed, and
  the internal updates inside 0002/0004/0007 — so the exemption is what keeps them working, and a
  browser has no way to reach it. `UPDATE` on the table is deliberately **not** revoked: display
  name, bio, locale and the rest of the self-edit flows are intended, and 0009's job is the two
  columns that decide privilege.
- **Finding 2 (High) — cross-member reads through the aggregate views.** A plain view runs as its
  owner, and an owner bypasses the base tables' RLS, so `esme_member_scores`,
  `esme_committee_rosters` and `esme_member_reward_records` returned chapter-wide totals to anyone
  who could select them — including `anon`, because Supabase's default privileges grant `SELECT` on
  new public relations to `anon` and `authenticated`. `security_invoker = true` is the half that
  makes the view read as the caller; on its own it would only turn the hole into an error, because a
  caller with no base-table grant gets `42501 permission denied` instead of a filtered result. So the
  file does three things together: flips the option, grants the four base tables the views compose
  (`esme_profiles`, `esme_score_ledger`, `esme_committees`, `esme_committee_memberships`,
  `esme_reward_entries`) to `authenticated`, and revokes the views and the private tables from `anon`
  and `public`. The policies on those tables, not the view, now decide what a caller sees — which is
  why probes P16, P18 and P19 check both directions: fewer rows for a Member, and the same count a
  policy-driven read of the underlying table would give a Head.

The whole file is one `begin; … commit;` block, so a failure anywhere in it leaves the schema exactly
as 0008 left it. What it does not claim: that `security_invoker` is available on the target server
(15+; the file says so in its header, and a pre-15 project fails on the `alter view` with a named
error rather than silently keeping the owner path — a local Supabase CLI cache file from 2026-10-19
records the linked project's `postgres-version` as `17.11.0.003`, which is comfortably new enough, but
that is a stale file on a disk, not a query against the server, so it still gets checked with
`select version();` before the apply), and that either fix works — both are
**[static review + automated static tests]** until P15–P19 run on a staging project.
[`migrationIntegrity.test.ts`](../supabase/migrations/migrationIntegrity.test.ts) pins that the guard
exists, binds to `esme_profiles`, names both `ESME_*` codes, still leaves `esme_assign_role()` able to
set a role, and that exactly the three views are invoker-owned, granted to `authenticated` and revoked
from `anon`.

### Why 0010 restates two functions

0009 froze the *column*: a browser can no longer write `esme_profiles.role` directly. The role still
moves, though — through `esme_assign_role()`, which is exactly where the review's remaining three
findings sat, and which 0009 had no reason to touch.

The numbers below are the ones [PROJECT_MASTER_GUIDE.md](../PROJECT_MASTER_GUIDE.md) §2 carries: 1–2
are 0009's, 3–6 are the documentation and owner-decision items that need no SQL, and 7–9 are the three
this file closes.

- **Finding 7 — an administrator could move their own row.** 0002 checked the caller's capability,
  then the target's protected flag, and never compared the two ids. `esme_is_primary_admin(p_user_id)`
  only refused demoting or touching the *primary* account, so a second Super Admin (or any future role
  granted `users.role.assign`) could raise or lower itself. 0010 refuses `p_user_id = v_actor.id` with
  `ESME_SELF_ROLE_CHANGE` after the capability check and before the write: a privilege change is decided
  by somebody else, in the same shape the frontend now enforces in `validateRoleChange()`. Read with the
  primary-admin rule underneath it, the primary account's role becomes unmovable from either direction —
  it cannot move itself, and nobody else may touch it.
- **Finding 8 — `high_board` was not in the privileged list.** 0002:670 read
  `p_role in ('super_admin', 'director', 'head', 'moderator')`, and 0006 added a fifth label the list
  never learned. A grant of `high_board` therefore skipped the "only a Super Admin grants privilege"
  branch. 0010 inverts the test — anything that is not `member` is a privileged grant — so a label added
  later is covered without editing the function again.
- **Finding 9 — the audit row threw away the evidence it already held.** Both functions selected
  the target row `for update`, so they held the previous value and wrote a detail naming only the new
  one. 0010 writes `<email>: <old> -> <new>` for the role and the same shape for the status, which is
  what makes line 53 of the README checklist answerable.

What 0010 cannot do is record a *refusal*. The `raise` that turns a call down aborts the transaction
containing the audit insert, so a denied privilege change leaves no database row — the honest answer is
that denials are journalled by the client-side adapter and the store, not by Postgres. Probes P20 and
P21 test both halves on staging: that a self-targeted call raises and the role is unchanged, and that an
authorized grant lands with an audit row naming both roles. Like 0009, this file has never been executed
against Postgres: **[static review + automated static tests]**, pinned by
[`migrationIntegrity.test.ts`](../supabase/migrations/migrationIntegrity.test.ts).

### Why 0011 restates the signup trigger

The registration form asks where a student studies, which year they are in, whether they already
belong to a committee and which one. `src/auth/supabaseAdapter.ts` already sends those answers as
signup metadata; 0007's trigger read six metadata keys and none of these, so on a provider-backed
project a reviewer saw an identity with an empty questionnaire while the browser kept the whole
application in its own store.

The restatement is not only about the new columns. 0007:120 filed the committee as:

```sql
nullif(meta ->> 'committee_id', '')::uuid
```

This app identifies its committees by stable device-side ids (`comm_te`, `comm_high_board`), and a
uuid cast of one raises `invalid input syntax for type uuid`. `esme_handle_new_auth_user()` is a
BEFORE INSERT trigger on `auth.users`, so the raise does not lose the committee — it aborts the
signup and no account is created. 0011 replaces the cast with `esme_committee_reference()`, which
matches a uuid, a name, a short code or the `comm_…` id against `esme_committees` and answers NULL
when it cannot place the value. Fail-safe is the right shape here because a queue row with no
committee named is visible to a reviewer and correctable by them, while a refused registration is
invisible to everyone. The same rule is why an unrecognised membership answer becomes NULL instead of
tripping the check constraint from inside the trigger.

Two things this file deliberately does not do:

- **It does not assign anything.** `requested_committee_id` and the new
  `second_committee_preference_id` are what the applicant wrote. `assigned_committee_id` is still
  only written by `esme_decide_registration()`, which 0011 does not touch, and the profile's committee
  still comes from the reviewer's pick with the request as the fallback.
- **It does not make High Board a privilege.** `esme_role` has carried a `high_board` label since
  0006 and that role is not created, granted or referenced here; the row 0011 adds is an
  `esme_committees` record, guarded so a chapter that already lists that body under another spelling
  does not get a duplicate. The trigger still hardcodes `role = 'member'`, so selecting it changes
  nothing about authorization — which is what P23 tests rather than asserts.

Never executed against Postgres, like every other file here: **[static review + automated static
tests]**, pinned by `migrationIntegrity.test.ts` (five cases: the columns exist, the trigger body
contains no `::uuid`, the helper cannot raise, `no` clears the committee and 0011 does not rewrite the
decision function, and the SQL's academic option lists match `src/data/referenceContent.ts`). Probes
P22 and P23 are the behavioural half, and README checklist lines 54–56 are the manual one.

### Why 0004 is shaped the way it is

- **`esme_leadership_seats` + a unique index on `profile_id`.** "One person, one seat" becomes a
  constraint the database enforces, not a UI convention. It is added *after* the backfill so
  existing rows are validated rather than silently rewritten; a violation makes the migration
  fail loudly.
- **`esme_normalize_committee_draft()`** mirrors `normalizeDraft()` +
  `validateCommitteeDraft()` exactly (trim, uppercase acronym, the same length and format limits,
  the same cross-row name/acronym clash check) and raises `ESME_COMMITTEE_INVALID: …`. A request
  that skips the form hits the same wall.
- **`esme_assert_seat_channel()`** — the important one. Column-level `REVOKE UPDATE (director_id,
  head_id)` is ineffective where a whole-table grant already exists, so the guard is a trigger
  that detects a *direct* call (`esme_called_directly()`: `session_user` is
  `authenticated`/`anon` **and** `current_user = session_user`) and refuses to move a seat
  outside `esme_assign_leader()`. Inside a SECURITY DEFINER function the context differs, so the
  sanctioned path still works.
- **`esme_assign_leader()`** performs, in one transaction: capability + scope check, `FOR UPDATE`
  on the committee row, an optional `p_expected_updated_at` staleness check (`ESME_STALE_WRITE`),
  target account existence and `active` status, the two-seat and other-committee checks, then the
  write and an audit line. Every failure has its own `ESME_*` code so the client can explain it.
- **Audit is append-only** (`esme_audit_no_update` / `esme_audit_no_delete`), and every leadership
  or roster write adds a line.

### Why 0005 is shaped the way it is

- **Rows enter the queue from triggers on the authoritative writes**, not from a client request.
  A browser that wants to claim "an email was sent about this" would have to write the record
  first, and the record is what the trigger reads.
- **`idempotency_key` is unique on the outbox.** `esme_queue_email(...)` inserts
  `on conflict do nothing`, so an approver who double-clicks, a retried transaction or a replayed
  RPC produces one message.
- **The address is resolved at send time** (`esme_email_recipient`), never stored in the queue. A
  member who changes address between the decision and the delivery gets one mail at the current
  address instead of two at an old and a new one.
- **`esme_email_preferences` forces RLS, and `esme_save_email_preferences()` is SECURITY INVOKER**
  so the self-policy is what authorizes the write. It is the only function in these migrations
  that is not `definer`: the table applies RLS even to its owner, and no policy describes that
  role, so a definer function would either be refused by the policy it is supposed to honour or
  slip past it entirely depending on the owner's privileges. Running as the caller makes the
  answer the same on both.
- **Account-safety events cannot be muted** — checked in the function and again by a trigger on
  the table, so neither the UI nor a hand-made request is trusted for it.
- **Claiming is `for update skip locked`, one row at a time.** Two overlapping scheduler runs
  cannot send the same row twice, and a run that dies mid-message leaves a `processing` row that
  is recycled after ten minutes rather than stranded.
- **Client roles have no write path to the queue or the log.** `insert/update/delete` is revoked
  from `anon` and `authenticated` on both tables and `force row level security` is on; an officer
  can read them, nobody writing mail can forge a `sent` receipt.

### Why 0006 is shaped the way it is

- **`alter type esme_role add value` runs outside the transaction.** Postgres refuses to let a new
  enum label be consumed by the transaction that adds it, and this file seeds capability rows for
  `high_board`. It also lands last, so the label order says nothing about seniority — every
  comparison goes through `esme_role_rank()`, the SQL copy of `ROLE_RANK`.
- **One gate, four doors.** `esme_assert_reward_target()` holds the checks every reward action
  shares (capability, matrix role, reach, existence, self, primary admin, active status, rank,
  Head sub-team, Director committee) in the order `validateRewardAction()` uses, so awarding,
  warning and correcting cannot drift apart and a request that skips the form hits the same wall.
  The client runs the same function to draw the eligibility verdict beside each account — a hidden
  button is not the mechanism, the raise is.
- **`esme_called_directly()` again.** The browser holds no insert, update or delete on either
  table, and the channel trigger refuses a direct write even if a grant reappears. Acknowledging a
  warning and marking an entry reversed are the only two legal updates, and
  `esme_assert_reward_entry_frozen()` names every column that may not change — reason, number,
  timestamp, actor, target — for any caller, including a definer function.
- **A bonus is two rows and one id.** The entry pairs with an `esme_score_ledger` row that shares
  its uuid (the same pairing the client store uses), so the leaderboard, `totalPoints`, the KPI
  cards and the report builder keep reading one source of points instead of a second currency.
  The FK is `deferrable initially deferred` and the entry is inserted first: a request that loses a
  race on `idempotency_key` aborts before any point moves.
- **Idempotency is a lookup, not a lock.** A replayed key returns the entry that already exists and
  writes nothing, which is what a retried click needs; a second *different* attempt to reverse the
  same entry is refused by `ESME_ALREADY_REVERSED` after `for update` on the original row.
- **Corrections append.** `esme_reverse_reward_entry()` inserts a negative ledger row and an entry
  that names the original, then flips the original's status. The withdrawn warning never loses its
  text, and a warning reversal does not count as another warning toward escalation — the counters
  and the escalation trigger both read `reversed_by_entry_id is null`.
- **Warning mail and escalation are triggers** on the entry insert, in the same style as 0005, so a
  row written by any path announces itself. Bonus mail is not queued here: 0005 already turns the
  ledger row into `bonus_awarded`, and queueing it twice would be the duplicate the spec forbids.
- **The matrix's own limits are constraints.** `esme_reward_policy` carries the checks
  `validatePolicyEdit()` applies, including "three ordinary bonuses must fit inside the ceiling",
  so a hand-made request cannot draw a policy the product would refuse to honour.
- **Four of the five are wired; the policy RPC is not.** Since 2026-10-22
  `awardBonus` / `issueWarning` / `reverseRewardEntry` / `acknowledgeWarning` call
  `esme_award_bonus()` / `esme_issue_warning()` / `esme_reverse_reward_entry()` /
  `esme_acknowledge_warning()` through `AuthAdapter`, and the store mirrors only the receipt that came
  back — see the write flow in [ARCHITECTURE.md](ARCHITECTURE.md). `esme_update_reward_policy()` is
  deliberately left out for now: a device holding a stale copy of the policy would overwrite the
  chapter's current cap, so the write needs an RPC that reads the row it changes (or a compare-and-set
  on `updated_at`) before it can be put on the request path. Ledger **reads** move with the rest of
  the dashboard reads in [supabase/README.md](../supabase/README.md); until then the ledger header
  says the list is this browser's, because a device-local list that looks like the chapter's is the
  failure mode this stage was told to remove. None of it has been exercised against a real project —
  with the schema empty, every one of the four calls fails closed with `schema_missing`.

### Why 0007 is shaped the way it is

- **Rows move before the rules change.** The `update … set status = 'pending_approval'` statements
  run first, while the old transition trigger still permits the step; recreating
  `esme_assert_status_transition()` first would make the migration refuse its own data fix.
- **The retired label stays, unreachable.** Postgres cannot remove an enum value, and
  `esme_account_status` is in live function signatures, so recreating the type would mean dropping
  `esme_current_status()`, `esme_set_account_status()` and `esme_identity()`. Instead 0007 repoints
  both column defaults, deletes every transition that touches the label, and adds
  `esme_profiles_status_reachable` / `esme_registration_requests_status_reachable` so even a direct
  insert is refused.
- **`email_verified` is kept, and stops gating.** Dropping the columns would erase the only record
  of what the provider reported, so they stay as mirrors of `auth.users.email_confirmed_at` with
  column comments saying nothing may read them as a condition. The approval path simply no longer
  asks.
- **`esme_identity(uuid)` is dropped and recreated.** A function's returned columns cannot change in
  place, and the client's `AuthIdentity` no longer carries a verification flag, so the old
  definition is dropped and the grants re-applied — same body, one column shorter.
- **The decision mail is re-keyed.** `account_approved:<profile>` suppressed a second approval
  forever, which mattered once `rejected → pending_approval` became the ordinary re-application
  path. The key now carries the decision timestamp; a double click still cannot produce two
  messages, because the transition trigger and the row lock in `esme_decide_registration()` refuse
  the second update.
- **One latent bug closes on the way.** `esme_bootstrap_primary_admin()` activates a profile created
  by the signup trigger, and under the old default that profile sat in
  `pending_email_verification` — a status the guard did not allow to jump straight to `active`.
  With the new default the bootstrap path is `pending_approval → active`, which is legal.
- **Still not applied.** No `psql`, Docker or Supabase CLI exists in this environment, so 0007 has
  been read and diffed against 0002 and 0005, never executed.

### Why 0008 is shaped the way it is

0008 is the provider-side copy of `src/domain/testAccounts.ts`. It creates no table: three fixtures
do not deserve a schema, and a table would be a place for a fourth to appear.

- **Two guards, both required.** The project declares what it is in `esme_settings.key =
  'environment'`, and the operator arms a window. An undeclared project reads as `'undeclared'` and
  is refused — defaulting to refusal is the point, because a missing row is far more likely on a real
  deployment than on a test box someone is about to seed. The window row stores the environment it
  was armed under and `esme_seed_test_accounts()` re-reads that copy, so declaring production after
  arming does not open anything.
- **The window closes on a successful seed.** One arming, one seed: resetting three passwords is a
  deliberate act, not something a still-unexpired deadline keeps permitting. Removal needs no window,
  because it is the path that runs *after* the review and refusing it for a clock reason would leave
  the accounts in place.
- **Passwords are parameters.** The fixture passwords in `src/domain/testAccounts.ts` only ever open
  the local vault; a real project's credentials are supplied at the console (or generated by
  `npm run seed:test-accounts` and printed once) and hashed with the same
  `crypt(…, gen_salt('bf'))` as every other identity here. `esme_test_account_password_problem()` is
  the database copy of `passwordChecks()` in `src/domain/registration.ts`, minus the blocked-word
  list, which lives in the app.
- **Provisioning reuses the signup trigger rather than routing around it.** The `auth.users` insert
  carries `accepted_policies` in `raw_user_meta_data`, exactly as a browser registration does, so the
  profile and queue rows are written by `esme_handle_new_auth_user()` and nothing about a seeded
  tester bypasses the normal handler. The handler then activates it through the ordinary
  `pending_approval → active` transition.
  Reading that path is also what surfaced a defect in 0003: `esme_registration_requests` has
  `check (agreed_to_policies)`, while the handler inserts `coalesce((meta ->>
  'accepted_policies')::boolean, false)`. The bootstrap's metadata never carried that key, so the
  trigger would have aborted the first administrator's own `auth.users` insert. 0003 now supplies
  `'accepted_policies', 'true'` — a one-line change to a migration that has never been applied
  anywhere, which is the only reason editing it in place is honest rather than rewriting history.
- **Seeding repairs; it does not duplicate or take over.** A fixture already present has its password,
  role, committee, username and display name re-applied and is reported as `repaired`, so a reviewer
  who edited a tester away can get it back without deleting and re-creating. An identity held by an
  account that is *not* the fixture is refused and reported — never overwritten.
- **Deletion is stricter than the browser path, on purpose.** The vault matches a fixture by email or
  username because its own rows carry a `provisioned` marker; the SQL path requires both to match
  before dropping an `auth.users` identity, because that step is not reversible.
- **0006's rule is respected, not rediscovered.** `esme_reward_entries` references profiles
  `ON DELETE RESTRICT` — "accounts are suspended, never deleted". A tester the ledger holds
  accountable is refused by the removal path and named in its report, rather than forcing the
  migration to choose between a constraint violation and a silent cascade.
- **No leadership seat is touched.** Committee scope comes from role plus `committee_id`
  (`canActOn()` in `src/domain/roles.ts`, the committee checks in 0002), so a fixture exercises its
  role's screens without occupying a seat a real person may need. Filling one stays a deliberate act
  in Committee Management.
- **Committees are looked up, never created.** The fixture names a `short_code`; a project without it
  gets an unseated tester and a report line saying so. This is the same rule that made the reference
  data stop inventing committees — see [the no-invention rule](TESTING.md#nothing-on-these-screens-may-be-invented).
- **The two queued messages a seed causes are deleted from the outbox.** `account_created` and
  `account_approved` are both addressed to the tester's own profile on a reserved test domain; left
  in place they would fail at delivery and spend the provider's error budget. The in-app
  notification is kept.
- **`migrationIntegrity.test.ts` cannot see a set-returning helper.** Its relation check reads
  `from esme_*` as a table reference, so the fixture list is inlined as a `VALUES` table in each
  function. The drift guard is instead `seeds exactly the identities the domain module defines` in
  that same test file, plus `scripts/seed-test-accounts.test.mjs` for the command's own copy.
- **Still not applied.** Like 0001-0007, none of this has met Postgres. What is exercised here is the
  local-dev path (`src/auth/auth.test.ts`, `src/components/dashboard/ModeratorTools.test.tsx`) and
  the command's decision logic — not a seeded database.

## Applying them (not done — needs a real project)

The commands below are what a reviewer with a staging project runs. This environment has no `psql`, no
Docker and no Supabase CLI, so nothing here has been executed — and no file has ever reached a
Postgres, which is why the in-place edits described above are still legal.

```bash
ESME_ENVIRONMENT=staging npm run migrations:plan      # the ordered plan, no connection, no process
ESME_ENVIRONMENT=staging npm run migrations:apply -- --confirm-project <staging-ref>
```

`scripts/apply-migrations.mjs` is the runner. It refuses unless `ESME_ENVIRONMENT` says
`development` or `staging`, refuses Production by name, requires `--confirm-project` to match the
reference inside `SUPABASE_DB_URL`, passes the password to `psql` through `PGPASSWORD` rather than
argv, scrubs any connection string a failing `psql` echoes back, and prints one evidence row per file
with `ON_ERROR_STOP=1`. Without `--apply` it only prints the plan, and it asserts that it started no
process. Its own rules are tested in `scripts/apply-migrations.test.mjs` (21 cases) with a fake psql —
**the tests prove the tool behaves, not that the SQL is valid Postgres.**

By hand, the same sequence is:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc -f supabase/migrations/0001_schema.sql
# …then 0002 … 0009, one file at a time, recording each result
```

`supabase db push` is deliberately **not** the documented path, for two reasons that do not depend on
the Postgres version: it cannot be pinned to a named project (so it has no way to refuse Production),
and it cannot report a partially applied 0002. It is also the reason 0006 keeps its opening
`alter type esme_role add value if not exists 'high_board'` **above** `begin;`: whether a file wrapped
in one transaction may consume the label it just added depends on the server version and on where the
statement sits, and this schema does not need to find out. `node scripts/apply-migrations.mjs` runs
each file with `psql -f` and no `--single-transaction`, which keeps the question irrelevant; the
runner's test asserts the absence of that flag. If a different tool is used anyway, `supabase
migration list` first, and never point it at a Production connection.

Then the authorization probes — `supabase/probes/authorization_probes.sql`, twenty blocks that each
`begin`, switch role locally, assert one rule, and `rollback`:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc \
  -v head_id=<uuid> -v member_id=<uuid> -v alien_id=<uuid> -v page_id=<uuid> \
  -f supabase/probes/authorization_probes.sql
```

They cover the reward channel (a direct insert into `esme_reward_entries` refused twice over), the
frozen ledger, `rewards.write` absent on a Member, a Head reaching another committee, one idempotency
key offered twice, a reversal with no reason, a raw leadership-seat write, an audit `delete`, the
publication guard **and** the ordinary content edit it must not block, a suspended account holding a
valid token, `anon` reads, and an anonymous application. P15–P19, added by the 2026-10-22 review and
by [0009_security_hardening.sql](../supabase/migrations/0009_security_hardening.sql), test the two
holes that review found (`esme_profiles.role` written directly, and the three granted views read as
the view owner), the `force row level security` path that queues decision mail, the reward view across
a member boundary, and whether the roster view still returns what the scope grants. Read them as
**FAIL on a project that stops at 0008 — that is the finding, observed — and PASS once 0009 is
applied**; P17 is expected to PASS either way, and P19 prints SKIP when the probe identity reaches no
committee. A `permission denied for table …` on P16/P18/P19 is a third answer and means the
base-table grants did not land, not that access control is working. P20–P21, added with
[0010_privilege_hardening.sql](../supabase/migrations/0010_privilege_hardening.sql), test the RPC side
the 0009 trigger could not reach: a self-targeted `esme_assign_role()` raising `ESME_SELF_ROLE_CHANGE`
with the role unchanged, and an authorized grant filing an audit row that names both roles. They SKIP
when the project holds no Super Admin profile, and P21 reads "no audit row at all" as a separate answer
from "an audit row without the two values", because only the second means 0010 is installed. P22–P23,
added with [0011_registration_academic_fields.sql](../supabase/migrations/0011_registration_academic_fields.sql),
are the only two that insert into `auth.users` so the registration trigger itself runs: P22 files an
application answering `yes` with a device-side committee id and one answering `no` while the metadata
still names a committee, and P23 shows the High Board choice leaves the account `member` with no
capabilities and one committee row. Both print SKIP for a session that may not write `auth.users`,
which is a session problem rather than a missing guard. Each
prints PASS, FAIL or SKIP — a SKIP is a missing row to probe, not a pass, and the file says why zero
matching rows is not the same as a refusal. These are written for a session that can `set local role`;
if `current_user` answers `authenticated`, the probes are running as the wrong principal and prove
nothing.

Before each push, on a **copy** of the project:

1. `pg_dump` the database and restore it into a scratch instance — and actually restore it, see
   "Backups".
2. Apply the migration; it must either succeed or fail with a named violation. A failed
   constraint means existing data breaks an organizational rule — fix the data deliberately,
   with the operator seeing which rows, never by letting the migration guess.
3. Run the probe file above and record every notice line beside its expected answer.
4. Exercise `esme_assign_leader()` directly, including an unauthorized role, an inactive account,
   a double seat, a stale `updated_at`, and a raw `UPDATE esme_committees SET head_id = …`.
5. Exercise the five reward RPCs as each role through **PostgREST** as well as psql, because the two
   surfaces refuse differently: a raised `ESME_*` arrives as an error body the adapter maps, a revoked
   function answers 401/404, and a missing one answers `PGRST202`. Record which of the two answered,
   and cover the psql-only cases too — a Head naming themselves, the primary Super Admin as a target,
   a bonus above the per-action cap, and `esme_issue_warning()` for the third warning in the window,
   which must give each notify role exactly one `warning_escalated` queue row.
6. Apply 0006 with `psql -f`, not through a runner that wraps the whole file in one transaction:
   it opens with `alter type esme_role add value`, and Postgres will not let a new enum label be
   consumed by the transaction that adds it — the file then seeds capabilities for `high_board`.

Nothing here truncates, drops or reseeds a table. 0007 does rewrite `status` values on existing
rows and replaces the `esme_identity()` definition; both are listed above and neither removes data.
0008 writes three identities when — and only when — an operator arms it, and `esme_remove_test_accounts()`
deletes those three addresses and nothing else.

## Data ownership classification (A–E)

Before any collection moves, each one is answered on five questions. Reading the two sides together
produced real gaps — a rubric with no column, an audit vocabulary that does not match its own check
constraint — which is the point of doing this before writing queries.

**A** who is the authority today, and who must be. **B** what has to work with no network. **C** what
happens when two browsers disagree. **D** whether the SQL already holds the shape the client stores.
**E** the next concrete step, and what blocks it.

The ten operational collections the store writes to `ESME_CU_STATE_V2_*` that have a table waiting
for them:

| Collection | A — ownership | B — offline | C — conflict | D — schema compatibility | E — migration strategy |
| --- | --- | --- | --- | --- | --- |
| `committees` | device row is the authority today; target `esme_committees` + memberships + seats. Seat holders' names are already provider-owned. | read the structure; no offline create/edit | client `updatedAt` exists and 0004's `esme_assign_leader()` refuses a stale seat, but an ordinary committee edit has no server-side conflict rule → wire it with a condition on `updated_at` | compatible column-for-column: `name, short_code, description, category, objectives[], sub_teams[], is_public, status, director_id, head_id`. `memberCount` is derived, never stored | read switch first, then `addCommittee`/`updateCommittee` to the table. No device cache may be imported as data without an owner-approved import — see E for every row below |
| `tasks` | device cache; target `esme_tasks` + `esme_task_assignments` | high — assignees open the list on a phone | none today: two officers editing one task overwrite silently | status and priority enums match exactly (`draft…overdue`, `low…urgent`); `committeeName`, `assigneeNames`, `createdByName` have no column **by design** (references only); `startDate/deadline` are `date`, so `YYYY-MM-DD` is mandatory; assignees live in a join table the client keeps as an inline array; the client type has **no `updatedAt`**, which is what conflict detection needs | add `updatedAt` to the cached shape (storage v6), then reads, then writes with an explicit assignment call |
| `submissions` | device cache; target `esme_submissions` (`unique (task_id, profile_id, version)` is the double-award guard) | a member drafts offline, submits online | `version` settles re-submission; two reviewers remain last-write-wins, and the independent-review rule exists only in `src/domain/workflow.ts` | **the rubric has no home**: `reviewRubric` and `rubricPercent` are client-only fields. `attachments` is `jsonb`, but the urls inside are `blob:` addresses that die with the tab | do **not** switch this collection yet: a provider would accept the review and drop the marks. Needs a forward migration for the rubric plus the storage path for attachments |
| `scoreLedger` | device cache; target `esme_score_ledger` (has `idempotency_key`) | leaderboard reads offline | the client stores `previousTotal`/`newTotal` per row; SQL derives totals from the sum, so a replayed or reordered write changes the cached figures and not the answer | `actionType` enum matches; names are references; reward rows already pair to `esme_reward_entries.score_ledger_id` | move reward-generated rows only when reward **reads** come from the server, or the same bonus exists on two devices and in no Postgres. Manual adjustments follow the same path |
| `applications` | **already provider-owned** — `esme_profiles` + `esme_registration_requests`, read by `listRegistrations()`, written by `register()` / `decideRegistration()` | the portal needs network by design | `unique (profile_id)` plus the status machine settles it; the queue is a read, not a cache | the client's `status` (`pending/under_review/accepted/rejected/waitlisted`) is the board's projection of `esme_account_status`, mapped in `src/domain/accountState.ts`; waitlisted has no column value because it is a projection | nothing to migrate. This is the pattern the others move toward |
| `notifications` | device cache, per device; `esme_notifications` exists keyed by `profile_id` | an item list read offline is legitimate | two devices mark read independently; `read_at` is the only state, so last-write-wins is acceptable | client `sourceKey` and `delivery` (`in_app`/`suppressed`) have no columns, and the table has no per-event dedupe key — the same event raised twice files two rows | add the event key (0005's `esme_email_outbox` already has the shape worth copying), then switch. Until then the bell is a device's memory and the screen says so |
| `auditLogs` | device cache with a 500-entry cap; `esme_audit_log` is written only by SECURITY DEFINER functions — client DML is revoked | audit is a server concern: an offline row is a hole in the record, not a feature | none: append-only, and the freeze trigger blocks `update`/`delete` | **vocabulary mismatch**: the client's `targetType` says `user`/`application`/`cms` where the column check allows `profile`/`registration`/`content`; client `id` is a string against a bigint identity; `timestamp` against `recorded_at`; `ip_address` is never a value a browser should supply | pick the SQL vocabulary, map it in the adapter, and let the RPC that already runs in definer context write the row. `AuditTrailView` must keep admitting it shows one device |
| `rewardEntries` | **writes are provider-decided from this change on** — the store calls `esme_award_bonus()`, `esme_issue_warning()`, `esme_reverse_reward_entry()`, `esme_acknowledge_warning()` and mirrors only the receipt; reads are still the device cache | offline filing is refused, not queued: with no adapter the store throws `provider_unavailable` | `idempotency_key unique` is the duplicate guard; a reversal is a new row plus the original flipped, so two officers cannot both undo one entry — the frozen-row trigger answers the second | the receipt maps 1:1 to the columns; the two display names come from the directory and session, never the form; `issuedAt` arrives ISO, so display sites normalize it | next slice is the read: select the ledger and `esme_member_reward_records` on mount, then drop the cache writer. Blocked on 0006 being applied — before that every reward write on a real project answers `PGRST202` and fails closed, which is the intended behaviour |
| `rewardPolicy` | neither side owns it: `esme_reward_policy` + `esme_update_reward_policy()` exist and the store still writes a device row seeded from `DEFAULT_REWARD_POLICY` | the matrix is read before every cap preview | **why the write stays deferred**: without a server read a device holding a stale matrix can overwrite another officer's edit. The RPC refuses a matrix that would make the control meaningless but cannot tell a stale device from a deliberate one | role lists, period days and thresholds match the columns; `updated_at` exists server-side | one `select` first. Keep `updateRewardPolicy()` synchronous until the screen edits the server's row rather than the device's |
| `mediaAssets` | the cache holds the row; the bytes exist only as a `blob:` URL in the tab that picked them; `esme_media.storage_path` has no writer | cannot be honest offline, and must not pretend: an image cannot outlive its tab | not applicable until a server copy exists | `alt_text`, `content_type` and `byte_size` (≤25 MiB) match the client's own validation; the client's `url` has no column and must not get one; delete protection (`slotsUsingAsset`) is a client rule with no server guard | needs Supabase Storage: a bucket, an upload policy, a public or signed path, and a server-side usage check before delete. Blocked on owner provisioning, not on code |

Two rules the table makes explicit, because they decide more than one row:

- **A device cache is not a data source.** No row in `ESME_CU_STATE_V2_*` is imported into Postgres
  without an owner-approved, reviewed import. Switching a collection changes what the *next* write
  does; it does not retroactively invent the chapter's history from somebody's laptop.
- **A switch is only complete when the read has moved too.** `rewardEntries` is the current example:
  the RPC is the authority for new entries, but a second officer's device still shows its own cache,
  so the collection is listed as half-moved and the guide says so rather than calling it integrated.

Where the schema is not ready — `submissions` rubric, `notifications` event key, `auditLogs`
vocabulary, `mediaAssets` storage — the honest move is a **new numbered migration**, not a client that
stores less. Nothing has been applied anywhere yet, so those gaps can still be closed inside
0001–0011; the moment any environment applies a file, they cannot be.

## Pointing the client at the database

The order that keeps the app working the whole time:

1. Provision a project, apply 0001–0011, complete the README verification checklist (lines 46–50 are
   0009's acceptance test, 51–53 are 0010's, 54–56 are 0011's) and the P00–P23 probes.
2. Switch reads: `committees`, `tasks`, `submissions`, `scoreLedger`, `applications`,
   `notifications`, `auditLogs`, `rewardEntries` and `rewardPolicy` become queries in the Supabase
   adapter instead of `readV2()` defaults — `esme_reward_entries` for the ledger,
   `esme_member_reward_records` for the per-member figures, `esme_reward_policy` for the matrix.
   Keep the store API identical so components do not change. The A–E table above records which of
   these nine can be read today and which are waiting on a schema gap.
3. Switch writes one surface at a time, starting with committees. Then rewards — **done, ahead of the
   reads**: `awardBonus` calls `esme_award_bonus()`, `issueWarning` calls `esme_issue_warning()`,
   `reverseRewardEntry` calls `esme_reverse_reward_entry()` and `acknowledgeWarning` calls
   `esme_acknowledge_warning()`, each passing the idempotency key the form already mints when it
   opens, and the store mirrors only the receipt the function returned. `updateRewardPolicy` is
   deliberately still local until the matrix is read from `esme_reward_policy`, because a device with
   a stale matrix must not overwrite another officer's edit. Map `ESME_*` exception codes onto the
   existing field-keyed failures the forms already display.
4. Remove the `useEffect` cache writers for those collections; keep them for reference content
   and theme until a settings table backs them.
5. Bump the storage version and carry the last local draft forward once, so a returning operator
   does not lose work in the transition.

Do **not** ship a client that trusts a locally stored copy of a row after the backend owns it —
`updatedAt` and `id` come from the server, and the seat columns are read-only from the client's
point of view.

## Media and files

`esme_media` exists in the schema but nothing writes to it. The library the operator uses today is
the browser-side one: [`src/domain/media.ts`](../src/domain/media.ts) plus the Media Library screen
(`media_library`) already do the checks a server would — signature sniffing instead of trusting the
file name or the declared mime, an SVG refusal, a size cap, a required description, a delete refused
while a content slot still names the asset, replace-in-place that keeps the id — and it persists only
the *row* to `ESME_CU_STATE_V2_mediaAssets`. The bytes stay behind a `blob:` address in the tab that
picked them, which is why every upload is marked `deviceOnly`. There is no storage bucket
configuration and no image audit on the server. Wiring that pipeline to Supabase Storage must not use
browser storage or deployment-ephemeral paths as the permanent repository; the same rules belong
server-side, with a usage reference so a file still in use cannot be deleted there either.

## Backups

A backup is only a backup until it is restored.
[supabase/README.md](../supabase/README.md) keeps the restore procedure; run it against a scratch
instance on a schedule and record the result. Never report a backup as recoverable because the
job said "success".
