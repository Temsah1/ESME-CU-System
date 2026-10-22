# Authorization

Authority is a capability question, never a label question. Two roles matter: the **account
role**, which decides capabilities, and the **committee leadership seat**, which decides whose
records you can see — and grants nothing on its own.

## Where each check runs

| Layer | File | Enforces |
| --- | --- | --- |
| Database (target) | [`0002_functions_rls.sql`](../supabase/migrations/0002_functions_rls.sql) | `esme_role_capabilities` + `esme_has_capability()`, `esme_capability_scope()`, `esme_reaches_profile()`, `esme_reaches_committee()`; RLS policies on every table; SECURITY DEFINER functions for the writes that change authority. |
| Database (committees) | [`0004_committee_leadership.sql`](../supabase/migrations/0004_committee_leadership.sql) | Seat writes only through `esme_assign_leader()`, roster moves only through `esme_set_account_committee()`, draft rules in a trigger, one-person-one-seat as a unique constraint. |
| Database (privilege columns) | [`0009_security_hardening.sql`](../supabase/migrations/0009_security_hardening.sql) | `role` and `status` move only through the DEFINER functions that check `users.role.assign` / `registrations.decide`; the three aggregate views read as the caller, under the caller's own policies. |
| Database (privilege RPCs) | [`0010_privilege_hardening.sql`](../supabase/migrations/0010_privilege_hardening.sql) | Inside those functions: nobody is their own privilege gate (`ESME_SELF_ROLE_CHANGE`), every role that is not `member` counts as a privileged grant, and the audit row carries both the previous and the new value. |
| Database (signup answers) | [`0011_registration_academic_fields.sql`](../supabase/migrations/0011_registration_academic_fields.sql) | Deliberately *not* an authority layer: the new trigger stores what an applicant says about their department, year and committee membership, keeps `role = 'member'` and `status = 'pending_approval'` hardcoded whatever the metadata claims, records the committee as requested rather than assigned, and seeds High Board as a committee row — the `high_board` role is a separate record that nothing on the signup path can reach. |
| Application | [`src/context/AppContext.tsx`](../src/context/AppContext.tsx) | `guard(capability, target)` before every mutation; the actor always comes from the signed-in identity, never from a form field. |
| Domain | [`src/domain/roles.ts`](../src/domain/roles.ts) | The same matrix, mirrored so the UI can offer only controls the account can actually use. |
| Session | [`src/auth/**`](../src/auth/) | Sign-in, status gating, capability expansion, re-read on every refresh. |

Hiding a button is never the authorization. The domain mirror exists for usability; the store
and the database refuse the request anyway. Locally the refusal happens in
`localDevAdapter`, which re-checks the session's capabilities on every admin action — which is
what the adapter tests exercise.

## Capability matrix (current)

Scopes: **all** = every record · **committee** = records of the actor's own committee ·
**self** = the actor's own records.

| Capability | super_admin | moderator | director | head | member |
| --- | --- | --- | --- | --- | --- |
| `users.read` | all | all | committee | committee | — |
| `users.create` / `users.update` | all | — | committee (update) | — | — (self-edits skip the guard by design) |
| `users.delete` / `users.suspend` | all | — | — | — | — |
| `users.role.assign` | all | — | — | — | — |
| `registrations.read` | all | all | committee | — | — |
| `registrations.decide` | all | all | — | — | — |
| `committees.read` | all | all | all | all | all |
| `committees.write` | all | — | committee | — | — |
| `committees.archive` | all | — | — | — | — |
| `tasks.read` | all | all | all | all | committee |
| `tasks.write` / `tasks.assign` | all | — | committee | committee | self (write) |
| `tasks.delete` | all | — | — | — | — |
| `submissions.read` | all | all | committee | committee | self |
| `submissions.review` | all | all | committee | committee | — |
| `submissions.create` | self | — | self | self | self |
| `scores.read` | all | all | committee | committee | self |
| `scores.adjust` | all | — | — | — | — |
| `events.read` / `events.write` | all / all | all / — | all / committee | all / — | all / — |
| `skills.read` / `skills.manage` | all / all | — | committee / committee | committee / — | self / — |
| `analytics.configure` | all | — | committee | — | — |
| `cms.content.write` | all | all | committee | committee | — |
| `cms.settings.global` / `cms.content.publish` / `cms.media.manage` | all | all (settings, publish, media) | — | — | — |
| `notifications.manage` | all | all | — | — | — |
| `audit.read` | all | all | — | — | — |
| `settings.manage` / `integrations.manage` / `backups.manage` | all | — | — | — | — |

Notes worth stating plainly:

- **`head` has no `committees.write`.** A Team Head reads every committee and edits their own
  committee's tasks, submissions and content, but cannot move a leadership seat. Seat writes
  need `committees.write`, which Super Admin holds globally and a Director holds for their own
  committee only.
- **Content publish is not tied to content write.** `updateWebsiteContent` and
  `updateFormFields` guard on `cms.settings.global`, so the `committee`-scoped
  `cms.content.write` that Directors and Heads hold does not let them rewrite global site copy.
  That split is deliberate but incomplete: there is no committee-scoped content surface yet for
  the narrower grant to act on.

## Privileged roles and the primary administrator

`PRIVILEGED_ROLES = super_admin, director, head, moderator`. Only a Super Admin may grant or
revoke them (`validateRoleChange`). The primary administrator
(`kareemeltemsah7@gmail.com` / `temsah1`) cannot be demoted or edited by anyone else — enforced
in `esme_protect_primary_admin()` server-side and in `validateRoleChange` client-side. The
bootstrap path creates that account only while no privileged account exists.

## What is verified about authentication, and what is not

The distinction matters because authentication is the one place where a passing test can make an
unproven claim look proven. Every case below was run against the **local development adapter** or a
**stubbed** `createClient`; no session has ever been issued by a real GoTrue, and no `esme_*`
function has ever answered a call.

| Behaviour | Evidence |
| --- | --- |
| Identifier+password sign-in, session restore, session expiry, 5-failure lockout, device token | **automated-tests** — `src/auth/auth.test.ts` against the dev vault (PBKDF2, 210k iterations) |
| A production build with no provider refuses to authenticate; a malformed or secret-key-shaped config is rejected without echoing the value | **automated-tests** — `configurationProblems()`, `AuthNotConfiguredError`, `AuthMisconfiguredError` |
| Account status is re-read from the server on restore, and a non-`active` account is refused even with a live token | **automated-tests** for the client's refusal · **static review only** for `esme_identity()` and `esme_assert_status_transition()` |
| Every admin mutation re-checks capability and scope | **automated-tests** against a stubbed adapter · **static review only** for the RPC bodies |
| Reward writes are decided by the server (id, instant, roles, cap, escalation, idempotency) | **automated-tests** — the store refuses the whole write when the stub refuses · **never** a real RPC |
| A real sign-in completes; a suspended account is refused *by the database*; a hand-made REST request is rejected by RLS; a password reset arrives | **not verified** — blocked behind applying 0001–0011, which is itself blocked behind an owner decision and a connection string |
| A Head cannot escalate its own `role`, and cannot activate a peer, through a direct `esme_profiles` write | **static review + automated static tests** — `esme_assert_privilege_channel()` (0009), checked by `migrationIntegrity.test.ts`; probe P15 is what settles it, and it has never run |
| An administrator cannot change **their own** role, and no caller may hand out a privileged role they are not Super Admin for | **static review + automated static tests** — `ESME_SELF_ROLE_CHANGE` and the "not `member`" privilege test in `0010_privilege_hardening.sql`; probes P20 and checklist lines 51–53. The client halves of the same two rules are **automated-tests** — `validateRoleChange()` in `src/domain/roles.ts` and the ten escalation scenarios in `src/context/privilegeEscalation.test.tsx`; three of its guards (the self-role rule, the protected-field strip, the status re-read on restore) were each removed in turn and the matching case failed, so the suite is not vacuous |
| A role or status change records actor, target, previous value, new value, time and outcome | **automated-tests** for the store and the dev vault (audit rows carry `outcome`, `previousRole`, `newRole`; refusals are journalled as `*_denied`) · **static review + automated static tests** for `esme_audit_log`'s `<email>: <old> -> <new>` detail (0010, P21). **A refused RPC leaves no database row**: the `raise` aborts the insert that would have recorded it, so server-side *denials* are not auditable inside one transaction, and no probe claims otherwise |
| The three aggregate views answer with the caller's policies, not the owner's | **static review + automated static tests** — `security_invoker` + base-table grants (0009); probes P16, P18, P19 |

### Onboarding an administrator — the safe order

`supabase/README.md` → *First administrator* is the only procedure; nothing here creates an account
on anyone's behalf.

1. Confirm the project is staging and confirm what your session is:
   `select current_user, coalesce(auth.role(), 'no jwt in this session');`
2. Back up before you change anything (see `docs/PRODUCTION_READINESS.md` §5).
3. Arm the window **while you are at the console** — `esme_arm_bootstrap(interval '15 minutes')` is
   refused once a Super Admin exists and closes after one success.
4. Run `esme_bootstrap_primary_admin(…)` with a password typed at the console. Never a password
   committed to a file, never a value recorded in documentation, never a browser call — the function
   is `service_role`-only precisely so an anonymous or self-registered caller cannot mint one.
5. Sign in as that account, then create further privileged accounts through `esme_assign_role()`
   from the Super Admin session — the only path that can grant a privileged role.
6. If arming raises `ESME_FORBIDDEN`, the session is not privileged. Use `psql "$SUPABASE_DB_URL"`
   or the service-role RPC path; **do not** edit the guard to make the statement go through.

## Account states

`pending_approval → active`, with `rejected`, `suspended`, and `rejected → pending_approval` for a
re-application. Only `active` reaches the ERP. There is no verification stage: a submitted request
is reviewable the moment it exists, and the reviewer's decision is what activates an account.
Enforced in [`src/domain/accountState.ts`](../src/domain/accountState.ts) and by the
`esme_assert_status_transition()` trigger (`0007_remove_email_verification.sql`).

## Public registration

Registration cannot choose a role: it always creates a `member`-track request awaiting review
(`PUBLIC_REGISTRATION_ROLE`). Duplicate identities are refused with a field-keyed, deliberately
non-enumerating message.

The form asks for six things — full name, email, a username, a password twice, an optional
committee preference and the agreement — and `validateRegistration()` checks exactly those. It
never required the questionnaire, and the questionnaire fields now ship switched off in
`REFERENCE_FORM_FIELDS` rather than deleted: an operator who wants Student ID back turns it on in
Registration → Form Schema, which is the same `cms.settings.global` write that edits any other
field. What an applicant did not answer is **absent** from the stored application, not prefilled —
the portal used to send "Sophomore", "Metallurgical & Materials Engineering" and a second
committee for people who were never asked, and every screen and export downstream read that as an
answer.

Nobody proves they own the address at signup, so the queue is held back by rate instead of by a
click: `submissionThrottleBlocked()` refuses more than `MAX_SUBMISSIONS_PER_WINDOW` submissions
from one device inside `SUBMISSION_WINDOW_MINUTES`, and on a live project Supabase Auth's own
"Confirm email" and `/signup` rate limits sit in front of it. See the table in
[`supabase/README.md`](../supabase/README.md) for what each provider setting means for the queue.

## Committee seats are not authority

`esme_assign_leader()` writes `esme_committees.director_id` / `head_id` and nothing else. It
never touches `esme_profiles.role`, and no capability lookup reads a seat. A Head appointed
from a `member` account remains a `member` account. The seat-channel trigger rejects any
attempt to move a seat through a plain column update on the row, so the function is the only
channel.

## Role and status are not editable columns either — 0009

The paragraph above is the model this repository already had; two findings from the 2026-10-22
line-by-line review showed it was not finished, and **[`0009_security_hardening.sql`](../supabase/migrations/0009_security_hardening.sql)**
is the forward fix. Both are **[static review + automated static tests]**: no PostgreSQL exists in the
authoring environment, so nothing here has been refused by a real server yet.

- **What was open.** `esme_profiles_update` (0002:833-849) let a caller who holds `users.update` write
  any column of a *reachable* profile. Reachability is the only question its privileged branch asks,
  and the `committee` scope includes the caller's own row — so a Head or Director could send
  `PATCH /rest/v1/esme_profiles?id=eq.<self>` with `role: "super_admin"` and the policy approved it,
  because the capability that is supposed to gate that — `users.role.assign`, held by `super_admin`
  alone — was never consulted on the direct path. The same branch let a Head set another member's
  `status = 'active'`, which is `registrations.decide` arriving by a different route.
- **Why the fix is a trigger.** The rule needs the row as it was before the change. A policy
  expression only sees the row about to be stored — no `old`, no `new` — so it cannot tell
  "role unchanged" from "role escalated", which is the same limitation that moved the publication
  rule into `esme_assert_publication_write()`. `esme_assert_privilege_channel()` fires
  `before insert or update on esme_profiles`, and refuses a direct write that moves `role` or
  `status`, or an insert that arrives with either already set.
- **How the sanctioned path still works.** The guard's first test is
  `esme_called_directly()` (0004:159) — `session_user` is `authenticated`/`anon` **and**
  `current_user = session_user`, which is false inside a SECURITY DEFINER function. So
  `esme_assign_role()`, `esme_decide_registration()`, `esme_set_account_status()`, the 0003 bootstrap
  and the 0008 seed all keep writing; a browser cannot reach the exemption.
- **What stayed editable.** `UPDATE` on `esme_profiles` is not revoked, and the guard names two
  columns and nothing else. Display name, bio, phone, locale preferences — the self-edit flows this
  document already describes — are unchanged, and one of the probes exists specifically to prove the
  guard is a guard rather than a lockout.

## Aggregate views read as the caller — 0009

`esme_member_scores`, `esme_committee_rosters` and `esme_member_reward_records` are views over tables
whose RLS is scoped (`scores.read`, `users.read`, `rewards.read`). A plain view is evaluated with the
**owner**'s rights, so those policies never ran for anybody selecting through a view — and because
Supabase's default privileges grant `SELECT` on new public relations to `anon` and `authenticated`,
the widest of them was anonymously readable. Two things had to change together:

- `set (security_invoker = true)` on all three, so every base-table access uses the caller's
  privileges and policies.
- `grant select` on the tables each view composes — `esme_profiles`, `esme_score_ledger`,
  `esme_committees`, `esme_committee_memberships`, `esme_reward_entries` — to `authenticated`, because
  an invoker view whose caller lacks base-table rights **raises** `42501 permission denied` rather
  than returning fewer rows. Changing the option alone converts a leak into an outage, and a
  permission error is not an access control.
- `revoke … from anon, public` on the three views and on tables the public site has no business
  reading (`esme_audit_log`, `esme_email_outbox` / `_log`, `esme_leadership_seats`,
  `esme_role_capabilities`, `esme_registration_requests`, the ledgers). The `to anon` policies 0002
  writes for published content, public committees, public events and public media are untouched —
  those are the anonymous reads this schema intends.

Visibility is now decided by the base-table policies, which is why the acceptance test is a count and
not a single refusal: P16 (a Member's `esme_member_scores` count equals what the `esme_profiles`
policy shows that session), P18 (the reward view returns the caller's own row) and P19 (the roster
view still returns every committee the `committees.read` scope reaches — over-narrowing is a defect
too). Checklist lines 46–50 in [`supabase/README.md`](../supabase/README.md) are the manual half.

## The role RPCs stop deciding privilege about themselves — 0010

0009 closed the column. Three findings from the same review lived one level up, inside the SECURITY
DEFINER functions that are *allowed* to move it, and
**[`0010_privilege_hardening.sql`](../supabase/migrations/0010_privilege_hardening.sql)** restates two
of them. Same evidence label as 0009: **[static review + automated static tests]**, never executed
against Postgres.

- **Nobody is their own privilege gate.** 0002's `esme_assign_role()` checked the caller's capability,
  then whether the *target* was the protected primary account, and never compared the caller's id with
  the target's. An administrator with a second Super Admin account — or any future role granted
  `users.role.assign` — could move its own row. `ESME_SELF_ROLE_CHANGE` now refuses `p_user_id =
  v_actor.id`, and the primary-admin rule underneath it makes that account's role unmovable from either
  side. `validateRoleChange()` refuses the same call one layer down, so the UI never offers a control
  the database would turn away.
- **Privilege is a rule, not a list.** `v_privileged := p_role in ('super_admin','director','head','moderator')`
  was written before 0006 added `high_board`, so a High Board grant skipped the "only a Super Admin
  grants privilege" branch. 0010 tests `p_role <> 'member'` instead: a role that does not exist yet is
  privileged the day a migration creates it, with nobody having to remember this line.
- **The audit row keeps the evidence.** Both functions selected the target `for update` — they held the
  previous value in a variable and then wrote a detail naming only the new one. The role and status
  lines now read `<email>: <old> -> <new>`, which is what the brief's "previous role / new role /
  outcome / actor / target / timestamp" requirement means on the server side.
- **What it does not claim.** A refusal still leaves no database row: the `raise` aborts the audit
  insert in the same transaction. Server-side denial auditing would need the write to commit before the
  error, which is not how these functions are shaped, so denials are journalled by the dev adapter and
  the store and are simply absent from `esme_audit_log`. P21 checks the allowed half and says so.

## Planned: the `it` role

The IT Operations Center requires a distinct `it` role. It does **not** exist yet — IT
operations currently sit under `moderator` ("IT Moderator"). Adding it means, at minimum:

1. `Role` union in [`src/types/index.ts`](../src/types/index.ts) and `ALL_ROLES`,
   `ROLE_LABELS`, `PRIVILEGED_ROLES` in `roles.ts`, plus a `MATRIX.it` row.
2. The `esme_role` enum and `esme_role_capabilities` seed rows in SQL.
3. Nothing in the SQL privilege test: since 0010 `esme_assign_role()` treats **any** label that is not
   `member` as privileged, so a new role is covered the moment it exists. (Before that file this step
   was a hand-edit of 0002's four-name list — which is exactly how `high_board` came to be left out.)
4. `VIEW_REQUIREMENTS` in `DashboardRoutes.tsx` for the new surfaces.
5. Recruitment: move `registrations.decide` from `moderator` to `it` (and keep `super_admin`),
   so only Super Admin and IT decide applications.

**IT must not silently become Super Admin.** `it` gets operational capabilities (logs,
incidents, tickets, recovery) and must not be seeded with `users.role.assign`,
`users.delete`, `scores.adjust`, `cms.settings.global` or `backups.manage` unless a real
requirement says so. If `users.role.assign` is ever granted to it, the brief's "explicitly
authorized IT administrators and Super Admins" is then satisfied by the matrix rather than by the UI,
and 0010 already holds the line underneath it: an `it` holder of that capability may demote to
`member`, may not hand out any privileged label, and may not move its own row.

## Seeded test accounts

Three provisioned sign-ins — a Head, a Director and a Member — exist so the role-based screens can be
opened as each role. Their identities are `TEST_ACCOUNT_FIXTURES` in
[`src/domain/testAccounts.ts`](../src/domain/testAccounts.ts); the operator path is described in
[supabase/README.md](../supabase/README.md#test-accounts-development-and-staging-only).
Authorization-wise, four things are worth stating:

- **Seeding is an account-creating act and is gated as one.** The store's `seedTestAccounts()` calls
  `guard('users.create')` and the local-dev adapter calls `requireCapability('users.create')` before
  it reads the vault; removal needs `users.delete`. Both are `super_admin`-only rows in the matrix
  above, so the guard is the same one that already decides who may open an account — there is no
  "test account" capability to forget to revoke. Against the real provider neither is reachable from
  a browser at all: the adapter returns the operator's SQL statements as a refusal, and those
  functions are granted to `service_role` only.
- **A tester is an ordinary account the moment it exists.** It carries a role from `esme_role` and
  gets its capabilities from the same matrix lookup as everybody else. Nothing in the request path
  special-cases an `@esme.test` address, so seeding a Head cannot produce a Head with powers the
  matrix does not grant.
- **A seeded member is not an applicant.** The local vault marks the row `provisioned` and
  `listRegistrations()` skips marked rows; the SQL path files the queue row as already decided by
  `seeded test account`. A fixture must never appear in a reviewer's queue as somebody waiting to be
  approved, and it must never be mistaken for a real person's application.
- **A fixture can never be the protected account.** `PRIMARY_ADMIN` is matched by email and username,
  and none of the three addresses is it — the deletion guard that refuses to remove the primary
  administrator therefore has no interaction with the seed path.

## Red lines

- No privileged API key in the browser bundle; no service-role key in a `VITE_` variable.
- Browser state is never the source of truth for authority.
- No hardcoded email/password authentication path, and no plaintext password in storage.
- Never wipe or reseed a database to make a permission appear to work.
