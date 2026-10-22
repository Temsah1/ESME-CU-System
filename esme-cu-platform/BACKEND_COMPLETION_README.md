# ESME CU Platform — Backend Completion Audit and Roadmap

**Type:** evidence-based audit and documentation only. **Written:** 2026-10-22.
**Codebase root:** `esme-cu-platform/` (git root is its parent). **All paths in this file are relative to the codebase root** unless they start with `../`.

## 0. How to read this document

Every claim carries one of these labels, and a label is only as strong as the command behind it:

| Label | Meaning |
| --- | --- |
| `[ran: automated]` | Executed on this tree during this audit session, with the exit status recorded. |
| `[static]` | Read from source, migration text, or configuration. Proves intent and shape, never behaviour. |
| `[in code]` | The mechanism exists in source. Says nothing about whether it has ever run. |
| `UNVERIFIED` | Cannot be settled without a database, a deployment, a provider, or a browser. The verification procedure is stated. |
| `POTENTIAL` | A risk reasoned from code that has not been observed failing. Not reported as a confirmed vulnerability. |

**Commands actually executed in this audit session, on this exact tree, immediately before this file was written:**

| Command | Result | Exit |
| --- | --- | --- |
| `npx vitest run` | 48 files / 728 tests passed, 68.42s | **0** |
| `npx tsc -b --force` | no errors | **0** |
| `npx oxlint .` | 14 warnings, 0 errors, 147 files, 116 rules | **0** |
| `npm run build` | built in 1.47s, chunk-size notices only | **0** |

No test was added, skipped, weakened or re-run against a database. Nothing in this file was verified by executing SQL: **no command in this audit opened a network connection, and no migration, seed, probe, or `pg_dump` was run anywhere.**

**Safety confirmation for the whole audit:** no source file, migration, test, config, package file, lockfile or environment file was modified; no file was deleted, reverted, staged, committed, pushed or deployed; `.env.local` was inspected only as variable *names and set/empty status*, never as values; the remote Supabase project was not queried or changed; no account was created, modified, suspended, promoted or deleted; no password was set or reset. The only file created is this one.

---

## A. Executive status

**The backend is a two-part system where only one part has ever been switched on.**

1. **Client half — real and green.** A framework-free domain layer (`src/domain/`, 19 modules) holds the RBAC matrix, account-state machine, committee, registration, reward, workflow, CMS and media rules. `src/context/AppContext.tsx` (~2,842 ln) is the service layer. 728 automated cases exercise them, including 17 escalation cases that were each proved to fail when their guard was deleted. `[ran: automated]`
2. **Server half — authored, never executed.** 11 migrations (5,406 SQL lines: 25 `enable row level security`, 48 policies, 79 functions of which 59 `security definer`, 29 triggers), an Edge Function (`supabase/functions/send-email/index.ts`, 274 ln) and 23 authorization probes (`supabase/probes/authorization_probes.sql`, 867 ln) exist. **Postgres has never parsed any of it.** `[static]` / `UNVERIFIED`
3. **What the app actually uses today is a mixture that is mostly not a backend.** Identity and the registration queue *would* come from Supabase, but the provider path cannot authenticate anyone because the schema is absent. Everything else — tasks, submissions, score ledger, reward reads and policy, committees, notifications, audit trail, CMS content, media metadata, seasons and OKRs — lives in `localStorage` under `ESME_CU_STATE_V2_*`, per browser, per device. `[static]`

**Most important blockers**, expanded in §C:

- `BE-001` no migration applied → no Supabase sign-in is possible anywhere this repository can speak for.
- `BE-002` all authoritative business data is device-local → this is not a multi-user system yet.
- `BE-003` server-side authorization has never refused anything → the RLS half of "strict RBAC" is unproven.
- `BE-005` **there is no recovery path for the Super Admin password** — see §D.1.
- `BE-006`/`BE-007` uploaded images and outbound email have no durable server-side path at all.

**Status: `NOT READY`.**

More precisely: the repository is *code complete for the client* and *ready for isolated staging verification* (§G Phase 2), and is **not** ready for staging acceptance or production. `READY FOR LOCAL VERIFICATION` would be an overstatement of what local verification can prove here: the local run exercises stubs and browser storage, never the server. `PRODUCTION READY` is refused outright — §I lists twelve gates and zero are passed.

---

## B. Evidence-based implementation inventory

Status vocabulary: **Implemented** = mechanism exists and is exercised by a test that ran here · **Partial** = mechanism exists, a load-bearing part of it is missing or unreachable · **Missing** = no mechanism · **Unverified** = mechanism exists but nothing has observed it work.

| Area | Current implementation | Evidence | Status | Missing work | Verification method |
| --- | --- | --- | --- | --- | --- |
| Supabase client init + env config | `isSupabaseConfigured()` gates adapter choice; `resolveAdapter()` falls back to the dev vault in DEV and to `null` in a production build with no config | `src/auth/supabaseAdapter.ts:606-608`, `src/auth/index.ts:14-22` | Implemented (client) / Unverified (server) | Nothing reachable from the app confirms the project it points at is the intended one | `configurationProblems()` output on a staging build; a deliberate bad-ref run |
| Authentication + session persistence | `restore()`, `subscribe()`, 5-failure lockout, device token, `AccessRevokedError` on status re-read | `src/auth/localDevAdapter.ts:218,358,363`, `src/auth/auth.test.ts` (46 cases) | Implemented for the dev adapter; **Unverified for Supabase** | A completed real provider sign-in has never happened | Apply migrations, sign in through GoTrue in a browser, observe session restore + refresh |
| Registration, approval, provisioning | Domain validation incl. academic fields, queue read/decide, `requested` vs `assigned` committee, audit on decision | `src/domain/registration.ts:59-170`, `src/auth/localDevAdapter.ts:449+`, `src/context/AppContext.tsx:1904` | Partial — the SQL queue is unreachable | 0011 never applied; `esme_decide_registration()` never run | Probes P22/P23 on staging; queue round-trip in a browser |
| User profiles and roles | Capability-scoped reads, `updateUser` refuses `role`/`status`/totals, `assignRole` via adapter | `src/context/AppContext.tsx:959-997,1044`, `src/domain/roles.ts:252-280` | Implemented (client) / Unverified (DB column guard) | 0009's `esme_assert_privilege_channel()` never executed | P15/P20/P21 |
| Authorization + server enforcement | `hasCapability`/`scopeFor`/`canActOn` mirrored by `esme_has_capability()` + 48 policies | `src/domain/roles.ts:212-239`, `supabase/migrations/0002_functions_rls.sql:806-1045` | **Unverified** | Every policy, grant and trigger | §E workflow + P01–P23 |
| Schema + migration sequence | 0001→0011, each `begin;…commit;`, headers state dependencies; 0006 opens its own transaction for the enum | `supabase/migrations/0001_schema.sql:1-16,23`, `0006_rewards_discipline.sql:33-35` | Implemented (text) / Unverified (applied) | Applied state of every file | `supabase migration list`, `select version()`, `pg_policies` |
| Tables, constraints, indexes | 25 tables, FKs, partial uniques (`one primary membership`, `one award per submission`), CHECKs | `0001_schema.sql:50-416`, `0011:81` | Implemented (text) / Unverified | Constraint behaviour under real writes | staging insert/update rejection tests |
| RLS policies | 19 tables enabled in 0002:806-824, more in later files; `auth.uid()` confined to one helper | `0002_functions_rls.sql:116,806-1045` | **Unverified** — no policy has refused a request | Observation of denials | P01–P23 with four identities |
| Views and security behaviour | 3 aggregate views; `security_invoker = true` only arrives in 0009:105-107 | `0001:301,311`, `0006:192`, `0009:105-107,122-124` | Partial / **POTENTIAL exposure** (see `BE-004`) | Confirm the flag exists on a live project | `select relname, reloptions from pg_class …` |
| Functions, RPCs, triggers | 79 functions (59 definer, all with `set search_path`), 29 triggers; reward RPCs are the client's only write path | `supabase/migrations/*.sql` census `[static]`, `src/auth/supabaseAdapter.ts:500-552` | Implemented (text) / Unverified | Execution of any kind | P-blocks + RPC calls from a session |
| Application data access | Store owns 30 collections; 7 go to the provider, 23 stay in `localStorage` | `src/context/AppContext.tsx:562-606,1013,1044,1492,1817-1866` | Partial (see `BE-002`) | Persistence for tasks, submissions, ledger, audit, content, media, notifications | §F refresh / logout / second-browser matrix |
| File and image storage | `URL.createObjectURL` → `blob:` address; metadata persisted; **no Supabase Storage call anywhere in `src/`** | `src/components/dashboard/MediaLibrary.tsx:82`, `src/domain/media.ts:164-166,297-314` | **Missing** (bytes) | Bucket, upload, signed URL, deletion accounting | Upload → refresh → second browser |
| Email notifications + outbox | Queue + drain in the browser, 3 sender strategies, DB outbox tables, claim/record RPCs, Deno function | `src/email/queue.ts:32,50,104`, `src/email/localOutboxSender.ts:47-85`, `supabase/functions/send-email/index.ts:191-239` | Partial / **Unverified** — never delivered | Deployment, schedule, `RESEND_API_KEY`, domain verification | One real message + matching `esme_email_log` row |
| Audit logging | `appendAuditEntry` → `writeV2('auditLogs')`, cap 500; server table exists but receives nothing | `src/context/AppContext.tsx:656-677`, `src/domain/audit.ts:4-7`, `0001:370` | Partial | Client→server audit writes; retention beyond 500 | Query `esme_audit_log` after a store action |
| Error handling + observability | Typed error classes, honest refusals, no `console.*` anywhere in `src/`, no logger/metrics/health endpoint | `src/auth/errors.ts:2-65`, `src/context/AppContext.tsx:154`, `src/components/dashboard/ModeratorTools.tsx:41` | Partial | Any operational signal at all | §G Phase 7 |
| Seed / bootstrap | `esme_arm_bootstrap()` + `esme_bootstrap_primary_admin()` (0003); `esme_seed_test_accounts()` (0008); `dev_seed_reference.sql` inserts **no accounts** | `0003:26-173`, `0008:157-285`, `supabase/dev_seed_reference.sql:1-8` | Implemented (text) / Unverified | Both service-role paths unexecuted | §D.1 procedure, on staging only |
| Automated tests | 48 files / 728 cases, node + jsdom, provider pinned off | `vite.config.ts:9-25`, §H | **Implemented and green** `[ran: automated]` | Integration and E2E layers | §H |
| Manual verification | No E2E harness; browser pass blocked (`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`; hidden tab has no `requestAnimationFrame`) | no Playwright/Cypress in `package.json:29-44` | **Missing** | Role-by-role manual matrix executed and recorded | §H matrix |
| Deployment + backup/recovery | No Dockerfile / vercel.json / netlify.toml / `supabase/config.toml`; export-JSON only; restore drill never run | `package.json:6-16` `[static]`, `supabase/README.md:692-702`, `docs/PRODUCTION_READINESS.md:178-195` | **Missing** / Unverified | Deploy target, `pg_dump`/`pg_restore` drill, monitoring | §I gate 8–10 |
| CI | `.github/workflows/ci.yml` (typecheck, lint, test, build, bundle secret-scan) is **untracked** (`?? .github/`), never pushed, so it has never run | `../.github/workflows/ci.yml:16-76` `[static]` + `git status`/`git log` `[ran: automated]` | Missing (in effect) | A push + one green run; a DB service job for integration | First Actions run |

---

## C. Exact backend blockers

Compact per blocker: **Severity · Affects · Evidence · Expected · Actual/Unverified · Fix · Dependencies/Risks · Safe verification · Acceptance.**

### BE-001 · Critical · Provider authentication is impossible
- **Affects:** every sign-in, every RPC, every remote read.
- **Evidence:** `0001-0011` exist and are internally consistent `[static]`; the apply runner refuses to connect without `SUPABASE_DB_URL`, which is **empty in `.env.local`** on this machine `[ran: static check of names/emptiness only]`; `docs/AUTHORIZATION.md:92` records sign-in/reset as *not verified*.
- **Expected:** a chapter member signs in against Supabase and gets a JWT whose claims the policies read.
- **Actual:** no project has run these files, so the `esme_*` objects the app calls do not exist. Earlier sessions recorded `PGRST202` from the configured project; that is a historical observation, not re-measured here. `UNVERIFIED`
- **Fix:** apply 0001→0011 to a named **staging** project through `npm run migrations:apply`, in order, then the probes.
- **Dependencies/Risks:** needs `SUPABASE_DB_URL` + owner approval. 0006 runs an `alter type … add value` **outside** its transaction (`0006:33`), so a mid-file failure leaves a partial state that `supabase db push` cannot survive — `0001:4-6` forbids it. The target project may be Production: `BE-015`.
- **Verification:** `node scripts/apply-migrations.mjs` (plan, no connection) → review → `--apply --confirm-project <ref>` → `select count(*) from pg_policies where tablename like 'esme_%';`
- **Acceptance:** all 11 files report one evidence row, `esme_needs_primary_admin()` returns `true` before bootstrap, and P01–P23 return PASS/SKIP with reasons — zero unexplained FAIL.

### BE-002 · Critical · Authoritative business data is browser-local
- **Affects:** tasks, submissions, score ledger, reward entries read + policy, committees, memberships, leadership seats, notifications, audit, CMS content/revisions, media metadata, seasons, OKRs, skill matrix, courses, goals.
- **Evidence:** one effects block writes all of it to `ESME_CU_STATE_V2_*` — `src/context/AppContext.tsx:562-606`; only 4 calls leave the device besides directory/queue reads: `setAccountStatus` `:1013`, `assignRole` `:1044`, `decideRegistration` `:1904`, reward writes `:1492-1745`. Provider reads are `listAccounts` `:1849-1866` and `listRegistrations` `:1817-1834`.
- **Expected:** two members on two devices see the same task board and the same leaderboard.
- **Actual:** they see their own browser. Nothing in the store writes a task, submission, ledger row, notification or content revision to the provider. `[static]`
- **Fix:** per-collection cutover, write-through first then read-from-server, using the A–E ownership classes in `docs/DATABASE_AND_MIGRATIONS.md`.
- **Dependencies/Risks:** BE-001 first; the schema has at least two known gaps (a submissions rubric with no column, an audit `targetType` vocabulary that contradicts its own CHECK — recorded in `PROJECT_MASTER_GUIDE.md` §5). Storage keys must not change without a backward-compatible migration (`src/storage/migrations.ts:54` is `v6`).
- **Verification:** for each collection, create → refresh → sign out → sign in → open a second browser profile.
- **Acceptance:** every operational collection has a server row and survives the second browser; `from:'local'` is only ever a documented fallback state, not the normal path.

### BE-003 · Critical · Server-side authorization has never refused anything
- **Affects:** all RBAC claims at the database tier.
- **Evidence:** `0002_functions_rls.sql:806-1045` (RLS + 48 policies), `0009:55-107` (privilege channel + invoker views), `0010:62-120` (role/status RPC rules); `supabase/probes/authorization_probes.sql:1` states it has not been executed. Client-side guards *are* proven — `src/context/privilegeEscalation.test.tsx` (17 cases, mutation-checked) `[ran: automated]`.
- **Expected:** a hand-made REST request with a valid JWT cannot write outside its scope.
- **Actual:** unknown. Enabling RLS is not enforcement; no policy has been observed filtering a row. `UNVERIFIED`
- **Fix:** run P01–P23 on staging with four identities, record each notice.
- **Dependencies/Risks:** BE-001, plus at least two active members in different committees and one bootstrapped Super Admin.
- **Verification:** `psql -v ON_ERROR_STOP=1 -v head_id=… -v member_id=… -v alien_id=… -v page_id=… -f supabase/probes/authorization_probes.sql` (all blocks `rollback`).
- **Acceptance:** every probe PASS with the refusal code named; SKIP only with a stated reason; zero FAIL.

### BE-004 · High · Aggregate views are owner-rights until 0009 is applied — POTENTIAL exposure
- **Affects:** `esme_member_scores`, `esme_committee_rosters`, `esme_member_reward_records`.
- **Evidence:** created without `security_invoker` (`0001:301,311`, `0006:192`); the flag appears only at `0009:105-107`, with the anon/public revocations at `0009:122-124`. `0002:1047` claims "views run with the caller's rights", which is false until 0009 — admitted in `0009:23-25`.
- **Expected:** a member reading scores sees only rows in their `scores.read` scope.
- **Actual:** if a project has 0001-0008 but not 0009, the views evaluate as the owner and the policy filter never applies. `POTENTIAL` — never observed, because nothing has run.
- **Fix:** apply 0009 in sequence; assert `reloptions` on a live project.
- **Dependencies/Risks:** 0009 also installs the privilege-channel trigger (`0009:55,87`); a project that applies it while non-`super_admin` roles hold `users.role.assign` may see writes start failing — that is the intended behaviour, but it is an operator-visible change.
- **Verification:** `select relname, reloptions from pg_class where relname in ('esme_member_scores','esme_committee_rosters','esme_member_reward_records');` then read a view as a member.
- **Acceptance:** all three show `security_invoker=true`, and a member's `select * from esme_member_scores` returns only in-scope rows.

### BE-005 · High · No Super Admin password recovery path exists
- **Affects:** the one account that can grant roles, edit content, and unlock the rest of the system.
- **Evidence:** bootstrap refuses to re-run once any Super Admin exists — `0003:51-53,93-95`; the dev adapter's reset is a deliberate no-op with no token issuer — `src/auth/localDevAdapter.ts:430-434` (while `confirmPasswordReset` `:436-447` exists, nothing in the local path can produce its token); the Supabase path calls `resetPasswordForEmail` — `src/auth/supabaseAdapter.ts:384` — which needs an SMTP sender that has never been configured (`supabase/README.md:18`, `docs/TESTING.md:215`); admin-side password management is unimplemented (roadmap item #58, `PROJECT_MASTER_GUIDE.md` §16).
- **Expected:** a locked-out primary administrator can be restored by a documented, auditable operator procedure.
- **Actual:** no such procedure exists in any file. This is a **confirmed documentation/feature gap**, not a speculative one. `UNVERIFIED` for whether lockout is reachable in practice, since no provider sign-in has happened.
- **Fix:** write the operator runbook (GoTrue recovery-link path with a verified sender; or a service-role reset statement) and/or implement #58 with `must_change_password` semantics.
- **Dependencies/Risks:** a `service_role` password-reset statement touches `auth.users.encrypted_password` — the same table 0003 writes (`0003:112-113,123`). Any new statement must stay service-role-only and must not become a second bootstrap path.
- **Verification:** on staging, arm, bootstrap, sign in, forget the password, execute the documented recovery, sign in again.
- **Acceptance:** a written runbook that a different person follows end-to-end on staging, with the audit row it produces.

### BE-006 · High · Uploaded images are never persisted
- **Affects:** Media Library, CMS image slots, chapter logo.
- **Evidence:** `addressFor()` returns `URL.createObjectURL(file)` — `src/components/dashboard/MediaLibrary.tsx:82`; `isDeviceOnlySrc()` treats `blob:`/`data:` as device-only — `src/domain/media.ts:164-166,297-314`; only metadata is stored (`AppContext.tsx:574`); **zero** Supabase Storage calls in `src/` (`grep` for `.storage`/bucket/upload RPC returns nothing) `[static]`.
- **Expected:** an uploaded poster renders tomorrow and on another device.
- **Actual:** the address dies with the tab. The code says so honestly (`deviceOnly` flag) — good, but the feature is not delivered.
- **Fix:** a Storage bucket with policy-scoped upload/select, persist the permanent path, keep `blob:` strictly as a preview.
- **Dependencies/Risks:** BE-001; bucket policies are new RLS surface; deletion must stay usage-aware (`src/domain/media.ts` safe-delete already models this).
- **Verification:** upload → hard refresh → new browser profile → same URL renders.
- **Acceptance:** byte persistence verified, and deleting an in-use asset is refused by the server.

### BE-007 · High · Email never leaves the process
- **Affects:** password resets, registration decisions, task assignment and deadline notices.
- **Evidence:** three client senders — local outbox is explicitly `simulated: true` (`src/email/localOutboxSender.ts:47-60`), the Supabase strategy only records a receipt meaning "the database queue owns delivery" (`:70-85`); the claim/record RPCs and the Deno function exist (`supabase/functions/send-email/index.ts:191-239`); `RESEND_API_KEY` is unset and no deploy/schedule exists.
- **Expected:** an approved applicant receives exactly one decision email, and `esme_email_log` records the provider id.
- **Actual:** nothing sends. `UNVERIFIED` end-to-end.
- **Fix:** deploy + schedule the function, verify a sending domain, run one message.
- **Dependencies/Risks:** BE-001; secrets in the function environment; a mis-scheduled claim loop can double-send — the idempotency in 0005 is untested.
- **Verification:** staging trigger of `esme_email_outbox` insert → observe one claim, one send, one log row.
- **Acceptance:** a real inbox message with a matching log row and no duplicate.

### BE-008 · Medium-High · The audit trail is neither durable nor tamper-evident
- **Evidence:** `logAction` → `appendAuditEntry` → `writeV2('auditLogs')` (`AppContext.tsx:656-677`); retention cap 500 (`src/domain/audit.ts:7`); `esme_audit_log` exists (`0001:370`) and receives nothing from the client.
- **Expected:** privilege and content decisions survive a refresh, a cleared cache and a device change.
- **Actual:** they survive a refresh only. Clearing site data destroys the trail. `[static]`
- **Fix:** write-through audit rows, keep the local copy as cache.
- **Verification:** perform an action → clear site data → query the server table.
- **Acceptance:** the row exists server-side with the same actor/action/target vocabulary — noting the known `targetType` CHECK mismatch must be closed first.

### BE-009 · Medium · Reward writes and reads are split across two systems
- **Evidence:** four writes go through RPCs (`supabaseAdapter.ts:500-552`, `AppContext.tsx:1492-1745`) and mirror only the receipt; reads and `esme_reward_policy` remain device-local (`PROJECT_MASTER_GUIDE.md` §16 P1 row).
- **Actual:** against the configured-but-empty project every reward write fails closed with `schema_missing` — the correct behaviour, but the feature is unusable. `UNVERIFIED` against a real schema.
- **Acceptance:** ledger and policy read from `esme_reward_entries`/policy through a granting view or RPC; a stale local policy cannot overwrite the chapter's row.

### BE-010 · Medium · The protected identity is hardcoded, and disclosed
- **Evidence:** `esme_is_primary_admin()` matches `email = 'kareemeltemsah7@gmail.com' or username = 'temsah1'` — `supabase/migrations/0002_functions_rls.sql:237`; the same pair in `src/domain/roles.ts:81-84`; repeated in `0003:12` and `supabase/README.md:174-175`.
- **Consequence:** the protection triggers (`0002:345-368`, `0010:90`) silently no-op if the bootstrap is ever run for a different identity, and the identity is visible to anyone who can read the repository. Full analysis in §D.1.
- **Fix:** make the protected identity a configuration row (`esme_settings`) read by the trigger, or refuse bootstrap when the email does not match the pinned identity, and document that the identifier is public.
- **Acceptance:** a bootstrap with a non-matching identity either refuses or re-pins atomically, tested on staging.

### BE-011 · Medium · PUBLIC EXECUTE retained on three leadership functions — POTENTIAL
- **Evidence:** `grant execute … to authenticated` without a matching `revoke … from public` for `esme_assign_leader`, `esme_set_account_committee`, `esme_leadership_map` (`0004:449-451`); the 0009 sweep (`:113-137`) touches tables and views, not these functions. Postgres default-grants EXECUTE to PUBLIC.
- **Mitigation already in code:** each function re-resolves the actor via `esme_current_profile_id()` and refuses an absent/non-active session and an out-of-scope committee (`0004:27-33` for `esme_assign_leader`), so an anonymous call cannot act.
- **Actual risk:** defence-by-function-body rather than defence-by-privilege; if one guard is later edited, nothing stops the call at the ACL. `POTENTIAL` — unproven without Postgres.
- **Fix:** add `revoke execute … from public, anon` for these (and audit the other 50 definer functions for the same pattern) in a forward migration.
- **Acceptance:** `information_schema.routine_privileges` shows no PUBLIC/anon EXECUTE beyond the deliberately public read helpers.

### BE-012 · Medium · The migration runner has no applied-version ledger
- **Evidence:** `scripts/apply-migrations.mjs` plans by default (`:234-243`), gates the environment name (`:49-56`), requires `SUPABASE_DB_URL` + `--confirm-project` and matches the host to that ref (`:63-80`), scrubs output (`:167-179`), stops at the first failure (`:264-273`) — but never reads `supabase_migrations.schema_migrations`, computes no checksum, and does not use `--single-transaction` (`:146-148,239`).
- **Consequence:** re-running an already-applied file is possible; 0006's out-of-transaction enum (`0006:33`) makes a partial application reachable.
- **Fix:** record applied versions after each file, refuse a file the ledger already names, and add a `--resume` that reports drift.
- **Acceptance:** the runner refuses to re-apply a version present in the ledger, tested by `scripts/apply-migrations.test.mjs`.

### BE-013 · Medium · Bootstrap detection fails closed into silence
- **Evidence:** `requiresPrimaryAdminBootstrap()` returns `false` when the RPC errors — `src/auth/supabaseAdapter.ts:578-583`.
- **Consequence:** against an unapplied schema — i.e. the current configured state — `esme_needs_primary_admin` raises, the call returns `false`, and the sign-in screen shows an ordinary form instead of the two statements the operator needs (`supabase/README.md:189-190`). The onboarding path is unreachable precisely when it is required.
- **Fix:** distinguish "RPC failed" from "no bootstrap needed" and render the diagnostic.
- **Acceptance:** a browser against an empty project displays the migration error and the statements; `src/auth/auth.test.ts` covers the three-state result.

### BE-014 · Medium · No integration or E2E layer; CI has never run
- **Evidence:** no Playwright/Cypress/testcontainers/k6 in `package.json:29-44`; no `setupFiles`, no coverage config in `vite.config.ts:9-25`; `.github/workflows/ci.yml` is untracked (`?? .github/`) with no git history, and `origin/main` is level with `main` `[ran: automated git queries]`.
- **Acceptance:** one green Actions run on a PR, plus a job that brings up Postgres and applies 0001-011.

### BE-015 · Medium · Environment and secret posture
- **Evidence:** `.env.local` on this machine has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` **set** (values never read or printed in this audit); `SUPABASE_DB_URL`, `ESME_ENVIRONMENT`, `VITE_ALLOW_TEST_ACCOUNTS` and the three test passwords are **empty**; `supabase/.temp/project-ref` exists (ref not printed). A publishable key was previously committed in a tracked test file; rotation is recorded as OPEN (`PROJECT_MASTER_GUIDE.md` §16). No CSP or SRI in `index.html`. `npm audit --omit=dev` records 2 moderate advisories (`exceljs → uuid`, GHSA-w5hq-g745-h8pq) left untriaged deliberately.
- **Risk:** the repo cannot tell whether the configured project is staging or production, so any apply step is blind; and the dev-vault fallback is *not* what this machine gets, because the Supabase branch wins (`src/auth/index.ts:15`).
- **Fix:** print the resolved ref + a "is this production?" confirmation before any remote step; rotate the old key; add CSP/SRI; record the advisory decision.
- **Acceptance:** an operator can prove which project a step will touch, from the tool's own output.

### BE-016 · Low · No observability, no health surface, no real fonts
- **Evidence:** zero `console.*` in `src/`, no logger, no metrics, no health endpoint; `ModeratorTools.tsx:41` explicitly refuses to report an unmeasured status (correct, but there is no way to measure it); System Health (#59) unimplemented; `'Inter'` is named in `src/index.css` with no `@font-face`, link or bundled file, and IBM Plex Sans Arabic is referenced nowhere (#60).
- **Acceptance:** a health screen whose every number comes from a queryable source, and a `font-family` that resolves.

### BE-017 · Low · Documentation drift
- **Evidence:** `README.md:90` says "282 tests across 16 files" against 48/728 measured today; `PROJECT_MASTER_GUIDE.md:613` says 13 lint warnings while its own newest row (added during the 2026-10-22 recovery) records 14 — measured 14 again in this session; the guide's §5/§16 refer to probes "P00–P23" whereas the file defines P01–P23 (`grep` of the probe headers, 23 blocks).
- **Acceptance:** counts in docs match a recorded run, and probe ids are quoted as they exist.

---

## D. Security audit and authorization matrix

### D.1 Super Admin account audit *(the explicitly requested additional requirement)*

**How the initial Super Admin is created — the implemented procedure.**

Exactly two paths can produce a `super_admin`, and no SQL file grants the role anywhere else `[static]`:

| Path | Mechanism | Who can call it |
| --- | --- | --- |
| First administrator | `esme_arm_bootstrap(interval '15 minutes')` then `esme_bootstrap_primary_admin(full_name, email, username, password)` | `service_role` only, plus `current_user` in (`postgres`, `supabase_admin`) — `0003:48-50`, grants `0003:163-168` |
| Every later privileged account | `esme_assign_role()` from a live Super Admin session | capability `users.role.assign`; refuses self-change (`0010:81`), bars non-super-admins from granting privileged roles (`0010:98`), locks the primary account's role from both directions (`0010:90`) |

Bootstrap behaviour, read from `0003:70-160`: refuses if the window is not armed (`ESME_BOOTSTRAP_CLOSED`) or a Super Admin already exists (`ESME_ALREADY_BOOTSTRAPPED`); validates name/email/username and a ≥10-character password; inserts an `auth.users` row with `crypt(p_password, gen_salt('bf'))` and `email_confirmed_at = now()`; sets the generated profile to `role='super_admin', status='active'`; marks the matching `esme_registration_requests` row active; **deletes the window key so it cannot be replayed**; appends a `BOOTSTRAP_SUPER_ADMIN` audit row. It must pass `accepted_policies` in the metadata or the signup trigger aborts (`0003:129-133`, reasoned from `0001:137`). All of this is `[static]` — **never executed.**

The client never calls it: `bootstrapPrimaryAdmin()` in the Supabase adapter returns `code: 'operator_required'` and prints the two statements (`src/auth/supabaseAdapter.ts:591-602`), and `LoginScreen.tsx:45,94,232` shows a bootstrap panel rather than submitting to the provider. That is the correct design: an endpoint that mints auth identities must not be reachable with a publishable key.

**Account identity — available in non-secret tracked files.** The designated primary administrator is stated in four tracked, non-secret places:

- `src/domain/roles.ts:81-84` — `PRIMARY_ADMIN = { email: 'kareemeltemsah7@gmail.com', username: 'temsah1' }`
- `supabase/migrations/0002_functions_rls.sql:237` — the same pair inside `esme_is_primary_admin()`
- `supabase/migrations/0003_bootstrap_admin.sql:12` — the same pair in the header example
- `supabase/README.md:172-177` — the same pair in the operator procedure, with the password left as `'<password you choose now>'`

Name: Kareem Tamer. **No password, token, key or connection string appears in any of these, and none was read or reproduced by this audit** (`.env.local` was inspected for variable names and set/empty status only; `ESME_TEST_PASSWORD_*` are empty).

**Is a Super Admin account already configured?** Three separate answers:

1. **In any Supabase project — NO, and unknowable without a query.** No project has run `0003`; `SUPABASE_DB_URL` is empty here, so even the plan tool cannot reach one. Whether the configured project *already* holds a `super_admin` row from outside this repository is **UNVERIFIED** — confirming it needs one read-only statement (§below, step 4), which this audit is not permitted to run.
2. **On this device's dev vault — UNVERIFIED.** The dev vault holds accounts in `localStorage` under `ESME_CU_DEV_AUTH_V1` (`src/auth/localDevAdapter.ts:32`), which is browser state, not repository state. Note also that on *this* machine the app resolves the **Supabase** adapter, because `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set (`src/auth/index.ts:15`) — so the dev vault is not the active path here.
3. **In code and documentation — YES, designated.** One and only one identity is pinned as the primary administrator, and it is the account the protection triggers defend.

**How the account authenticates.** Identifier + password against the provider (`signIn`, `src/auth/types.ts:209`), PBKDF2-210k in the dev vault (`localDevAdapter.ts:111-112,346-357`) or bcrypt inside Postgres for the bootstrapped row. Sessions restore through `restore()`/`subscribe()`; a suspended account with a live session key is refused on re-read (`localDevAdapter.ts:363`), and that guard is mutation-proven `[ran: automated]`.

**Setting the password.** Only ever at the console, at bootstrap time, hashed by `crypt(..., gen_salt('bf'))` (`0003:123`); the repository stores nothing and the client never sees it.

**Resetting the password — there is no implemented path.** `BE-005` in full: bootstrap is one-shot; the dev adapter's `requestPasswordReset` is a deliberate no-op with no token issuer (`localDevAdapter.ts:430-434`), so `confirmPasswordReset` is unreachable locally; the Supabase path needs an SMTP sender that has never been configured (`supabaseAdapter.ts:384`, `docs/TESTING.md:215`); admin-side reset (#58) does not exist. **No file in this repository documents how to recover a locked-out primary administrator.** That is the single most consequential gap in this section.

**Safest local-only verification procedure (no database, no writes, no accounts).**
1. `npm run dev`, open `http://localhost:5173`, and read the sign-in screen. Do not submit anything.
2. If a bootstrap panel appears, the *active adapter* reports no Super Admin in its own store; if an ordinary form appears against the provider path, read step 3 before concluding anything — `BE-013` means an RPC failure also renders the ordinary form.
3. In DevTools, **read only** (never edit, never clear) `localStorage['ESME_CU_DEV_AUTH_V1']` → `accounts[].role`. Presence of `usr_superadmin` proves a device-local administrator exists on this browser; its absence proves nothing about the server.
4. To answer the server-side question at all requires one read-only statement, run by the owner against a **confirmed-staging** project: `select count(*) filter (where role = 'super_admin') as admins, bool_or(email = 'kareemeltemsah7@gmail.com') as pinned_identity_present from esme_profiles;` — plus `select version, name from supabase_migrations.schema_migrations order by version;` to establish what has been applied. This audit did not run it and does not authorise running it against the project currently in `.env.local`, which may be Production.

**Never do these while verifying:** arm a bootstrap window "to see what happens" (it is a live 15-minute privilege-creation window), call `esme_bootstrap_primary_admin` twice, clear site data to reset the vault, or loosen the `ESME_FORBIDDEN` guard on `0003:48-50`.

### D.2 Role × capability matrix, from `src/domain/roles.ts` `[static]`

Six roles — `super_admin`, `high_board`, `director`, `head`, `member`, plus `moderator` (IT) — 37 capability strings, each scoped `all | committee | self` by `scopeFor()` (`roles.ts:212`).

| Capability group | super_admin | high_board | director | head | moderator (IT) | member |
| --- | --- | --- | --- | --- | --- | --- |
| Read profiles | all | all | committee | committee | all (read) | self |
| Create / update / delete profiles | all | no | no | no | no | no |
| **Change a role** (`users.role.assign`) | **all** | no | no | no | **no** | no |
| Suspend / restore | all | no | no | no | no | no |
| Read scores / adjust | all | all | committee | committee | no | self (read) |
| Tasks: read / create / assign | all | all | committee | committee | no | self scope |
| Review & approve submissions | all | yes | yes | yes | no | no |
| Rewards: award / warn / reverse / policy | all (+policy) | yes | committee | no | no | self (read) |
| CMS text (`cms.edit_text`) | yes | yes | no | no | **no** | no |
| CMS media (`media.*`) | yes | yes | no | no | **yes, media only** — never text | no |
| Backups / destructive local reset (`backups.manage`) | yes | no | no | no | no | no |
| Audit read | all | all | no | no | read | no |

Boundaries the code enforces deliberately: IT may manage media but **not** website text; public registration can only ever yield `member` (`roles.ts:283`, `PUBLIC_REGISTRATION_ROLE`); a profile edit can never carry `role`/`status`/totals (`AppContext.tsx:959-997`); a demotion or self-change is refused (`roles.ts:252-280`).

**Unclear or inconsistent permissions — to resolve, not to assume:**
- `high_board` vs `moderator` seniority is encoded twice (`ROLE_RANK` in TS, `esme_role_rank()` in `0006:41`); drift is possible because the enum's physical order is meaningless (`0006:30-31`) and nothing tests the two tables agree. Roadmap #76 (generate `docs/PERMISSION_MATRIX.md` from `roles.ts` with a drift test) closes it.
- Whether `moderator` may read the whole directory while being barred from role assignment is intentional in the matrix but surprising for an IT operator — document it explicitly.
- Reward *policy* rights for `high_board` (configure vs read) is the open half of `BE-009`.

### D.3 Escalation vectors examined

| Vector | Client evidence | Server evidence | Verdict |
| --- | --- | --- | --- |
| Self-escalation through a profile edit | strip + logged refusal, mutation-checked (`privilegeEscalation.test.tsx`) | `0009:55-87` privilege channel; `0010:81` self-change refusal | Closed in code; **UNVERIFIED** in SQL |
| Self-demotion / lockout by the same admin | `validateRoleChange` `roles.ts:263` | `0010:81,90` | Closed; unproven |
| Granting a privileged role by a non-super-admin | `roles.ts:273-278` | `0010:98` (replaces 0002's forgettable granted-role list) | Closed; unproven |
| Cross-committee reads | `scopeFor` + `canActOn` (`roles.ts:228-239`) | 48 policies; P16/P18/P19 designed for this | **UNVERIFIED** |
| Over-narrowing / widening through views | n/a | `0009:105-107,122-124` | **UNVERIFIED**, see `BE-004` |
| Anonymous REST request with the publishable key | not applicable client-side | RLS + `revoke` sweep | **UNVERIFIED**; `BE-011` notes retained PUBLIC EXECUTE on 3 functions |
| Minting a first admin from the browser | refused with `operator_required` (`supabaseAdapter.ts:591`) | `0003:48-50,163-168` | Closed by design |
| Seeding privileged test accounts | gated by env + build mode (`localDevAdapter.ts` gate, `testAccounts.ts`) | `0008` grants only `head`/`director`/`member` and is service-role armed | Closed; unproven |

### D.4 Negative-test coverage

Refusal-asserting suites, i.e. the tests that would fail if a guard were deleted: `src/context/privilegeEscalation.test.tsx` (17), `src/auth/auth.test.ts` (46), `src/domain/{domain,rewards,decisions,registration,publishing,committees,cms,testAccounts}.test.ts`, `src/storage/migrations.test.ts` (35), `supabase/migrations/migrationIntegrity.test.ts` (18), `scripts/apply-migrations.test.mjs` (21), `scripts/seed-test-accounts.test.mjs` (15), and the screens `ModeratorTools`, `RegistrationManager`, `RewardsAndDiscipline`, `MediaLibrary`, `WebsiteCMS`, `MemberManagement`, `SettingsAndBackups`. `[ran: automated — all green this session]`

**What no negative test can prove:** that Postgres refuses. Every refusal asserted above happens in TypeScript. `docs/PRODUCTION_READINESS.md` and `supabase/README.md:196-202` already label this honestly; this audit confirms the labels are accurate.

---

## E. Database migration and Supabase completion plan

### E.1 Per-file inventory `[static]`

| File | Ln | Creates / changes | Depends on |
| --- | --- | --- | --- |
| `0001_schema.sql` | 416 | `pgcrypto` + `citext` (`:17-18`), 6 enums, 19 tables, 2 views, ~15 indexes. No policies, grants, triggers or seeds | — (and `:4-6` forbids `supabase db push`) |
| `0002_functions_rls.sql` | 1050 | capability matrix seed (`:12`), 17 functions, 12 triggers, RLS on all 19 tables (`:806-824`), ~43 policies, grants | 0001 |
| `0003_bootstrap_admin.sql` | 173 | 4 definer functions, service-role grants (`:163-168`) | 0002 |
| `0004_committee_leadership.sql` | 461 | `esme_leadership_seats`, 8 functions, 4 triggers, 1 policy, grants (`:449-451`) | 0003 |
| `0005_email_notifications.sql` | 814 | 2 enums, preferences/outbox/log tables, 16 functions, 8 triggers, 3 policies | 0004 |
| `0006_rewards_discipline.sql` | 990 | `alter type esme_role add value 'high_board'` **outside** the transaction (`:33`, then `begin` at `:35`), 2 tables, reward view, 12 functions, 6 triggers, drops/re-adds the audit `targetType` CHECK (`:945`) | 0005 |
| `0007_remove_email_verification.sql` | 356 | data move, new default + 2 CHECKs, replaces 4 functions, `drop function esme_identity(uuid)` | 0006 |
| `0008_seed_test_accounts.sql` | 456 | 6 guard/seed functions that write and delete `auth.users` rows; no DDL | 0007 |
| `0009_security_hardening.sql` | 162 | `esme_assert_privilege_channel()` + trigger, `security_invoker` on 3 views, table/view revoke-grant sweep | 0008 |
| `0010_privilege_hardening.sql` | 177 | replaces `esme_assign_role` + `esme_set_account_status` only | 0009 |
| `0011_registration_academic_fields.sql` | 351 | 6 columns, CHECK via exception handler, `esme_committee_reference()`, third body of `esme_handle_new_auth_user()`, High Board committee insert, registration field upsert | 0010 |

**Internally consistent but order-sensitive.** Six functions are redefined across files (`esme_handle_new_auth_user` three times: `0002:391`, `0007:91`, `0011:182`; also `esme_assert_status_transition`, `esme_decide_registration`, `esme_identity`, `esme_email_on_account_decision`, `esme_assign_role`/`esme_set_account_status`). Only the highest-numbered body is authoritative, so **partial application silently reinstates superseded semantics.** `0007` also narrows a public contract: `esme_identity` drops `email_verified`. `0002:1047`'s comment about views is false until `0009`. Guards depend on rows inserted elsewhere: `esme_role_capabilities` is empty until `0002:12`, and `0009:64-70` demands new profiles be `member`/`pending_approval`, bypassed only because the trigger is definer. `0006:945` drops an auto-named constraint by literal name.

### E.2 Required extensions, roles and configuration

`pgcrypto` and `citext` (`0001:17-18`); Supabase roles `anon`, `authenticated`, `service_role`, `supabase_admin`, `postgres`, whose existence `esme_called_directly()` (`0004:159-166`) and `0008:106` assume; `auth.users` write capability for bootstrap and test-account seeding; PostgreSQL ≥ 15 for `security_invoker` (`0009:102`). **None of these is confirmed on any project — `UNVERIFIED`.**

### E.3 How migration state must be verified

`select version, name from supabase_migrations.schema_migrations order by version;`, `supabase migration list`, `select extname from pg_extension;`, `select relname, relrowsecurity from pg_class where relname like 'esme_%';`, `select * from pg_policies where tablename like 'esme_%';`, `select relname, reloptions from pg_class where relname in (…3 views…);`, `information_schema.routine_privileges` and `role_table_grants` for `anon`/`authenticated`/`service_role`, `select rolname from pg_roles;`, and `select id, role, status from esme_profiles;`. All read-only; all require a connection this environment does not have.

### E.4 Unknown database state

Which of 0001-0011 (if any) are applied, and in what order; the Postgres version; whether the extensions are installable; whether default privileges were tightened by the project owner; whether any non-`super_admin` role already holds `users.role.assign` (finding 8 has no observable probe until that exists); whether a `super_admin` row already exists (`0003:93` refuses on it); whether prior project state already violates `0004:19-22` or `0007:37-41`; whether `supabase/.temp/project-ref` names a production project.

### E.5 Safe workflow

1. **Preserve:** the tree is currently uncommitted with 48 files modified/untracked. A commit or a tagged snapshot is an owner decision and was **not** performed here.
2. **Isolate:** provision a project that is *not* the one in `.env.local`, or confirm the configured one is staging, from the provider console — not from the repo.
3. **Tooling:** this machine has no `psql`, no Docker and no Supabase CLI, and `SUPABASE_DB_URL` is empty. Nothing can be applied from here today.
4. **Plan then apply:** `npm run migrations:plan` → review the printed sequence → `npm run migrations:apply -- --confirm-project <staging-ref>`, one file at a time, watching for a partial 0006 (`BE-012`).
5. **Validate:** §E.3 queries, then `npx vitest run supabase/migrations/migrationIntegrity.test.ts` for the text invariants (they do not become real by applying anything).
6. **Authorize-test:** P01–P23, then the role-by-role negative matrix in §H.
7. **Back up:** `pg_dump` immediately after a clean apply, and restore it into a scratch project once — a backup never restored is a hope.
8. **Approval:** explicit, per step, before touching the project in `.env.local`.

---

## F. Data persistence audit

**Keys in use** (`[static]`, `src/storage/migrations.ts:52-57`, `src/auth/localDevAdapter.ts:32-34`, `src/email/queue.ts:32`, `src/email/localOutboxSender.ts:13`, `src/context/AppContext.tsx:383-392`): `ESME_CU_STATE_V2_*` (30 collections), `ESME_CU_SCHEMA_VERSION` (`v6`), `ESME_CU_DEV_AUTH_V1`, `ESME_CU_DEV_SESSION_V1`, `ESME_CU_DEV_THROTTLE_V1`, `ESME_CU_DEV_OUTBOX_V1`, `ESME_CU_DEVICE_TOKEN_V1`, `emailQueue`, `emailPreferences`. No `sessionStorage` writes were found.

| Workflow | UI → store → persistence today | Correct source of truth | Persists across refresh / logout+login / another device | Verdict |
| --- | --- | --- | --- | --- |
| Register | `RegistrationPortal` → `adapter.register` → `auth.users` + trigger profile | Postgres | only if the provider path works, which it cannot today (`BE-001`) | **Unverified** |
| Approve / reject | `RegistrationManager` → `decideRegistration` (`AppContext.tsx:1904`) | Postgres | same | **Unverified** |
| Role change / status | `assignRole` `:1044`, `setAccountStatus` `:1013` | Postgres | same | **Unverified** |
| Task create / move / submit | `addTask`, `moveTask`, `addSubmission` → `writeV2` (`:562-606`) | Postgres | refresh ✔ · logout ✔ (same browser) · other device ✘ | **Incorrectly local-only** |
| Score ledger + manual adjustment | `addManualPointAdjustment` → `writeV2('scoreLedger')` | Postgres | as above | **Incorrectly local-only** |
| Bonus / warning / reversal / acknowledge | four RPCs via `rewardWriter()` (`:1492-1745`), receipt mirrored locally | Postgres | refuses entirely without a provider (`BE-009`) | **Mixed** |
| Reward policy + ledger reads | `writeV2` | Postgres | device-only | **Incorrectly local-only** |
| Committees, memberships, leadership seats | `writeV2('committees')` + server RPCs exist but are unused by the client | Postgres | device-only | **Incorrectly local-only** |
| CMS text, publish, revisions | `writeV2('websiteContent' / 'publishedContent' / 'contentRevisions')` | Postgres | device-only | **Incorrectly local-only** |
| Media assets | `writeV2('mediaAssets')` metadata + `blob:` address | Postgres + Storage | metadata device-only, bytes vanish with the tab (`BE-006`) | **Missing** |
| Notifications, action centre | `writeV2('notifications')` | Postgres (derived) | device-only | **Incorrectly local-only** |
| Audit trail | `writeV2('auditLogs')`, cap 500 (`BE-008`) | Postgres | device-only, and cache-clearing destroys it | **Incorrectly local-only** |
| Season / OKR / skill / development plans | `writeV2` | Postgres | device-only | **Incorrectly local-only** |
| Theme, action prefs, device token | `writeV2` | **legitimately client-local** | device-only by design | Correct |
| Email preferences | `adapter.saveEmailPreferences` (`useEmailPipeline.ts:67` null offline) | Postgres | Unverified | **Unverified** |
| Export / import JSON | `exportDataJSON` / `importDataJSON`, `can('backups.manage')` (`SettingsAndBackups.tsx:35-52`) | not a backup | device-to-device | Correct, and must not be presented as a backup (`supabase/README.md:692-702`) |

**Not a defect:** theme, per-device prefs, the device token, and the dev vault itself — those are legitimately local. **The defect class is that the ERP's operational record is in that same local tier.**

---

## G. Phased implementation roadmap

Each task: **ID · priority · depends on · files · completion criteria · how to test · environment/credential/approval needs.**

### Phase 0 — preserve and baseline *(no code change; owner-gated)*
- **T0.1 · P0 · none · git state.** Establish a durable checkpoint of the working tree (commit or archive) so a tool revert cannot destroy this work again — an incident that already happened once on 2026-10-22 (recorded in `PROJECT_MASTER_GUIDE.md` §17, reconstructed from the session transcript). *Criteria:* a recoverable snapshot exists. *Test:* `git log -1` / archive listing. *Needs:* explicit authorisation to commit. **Not done by this audit.**
- **T0.2 · P0 · T0.1 · `PROJECT_MASTER_GUIDE.md`, `docs/PRODUCTION_READINESS.md`.** Record the four verification commands and their exits as the baseline. *Criteria:* numbers in docs equal a recorded run (closes `BE-017`). *Test:* re-run §H.
- **T0.3 · P0 · none · owner knowledge.** Answer in writing: which project is in `.env.local`, staging or production, and who owns it. *Criteria:* a named ref + environment recorded. *Needs:* provider console access; **no repo change can tell you this.**

### Phase 1 — confirmed security blockers in code
- **T1.1 · P0 · none · `supabase/migrations/0012_*.sql` (new, forward-only).** Revoke PUBLIC/anon EXECUTE on `esme_assign_leader`, `esme_set_account_committee`, `esme_leadership_map` and audit the remaining definer set (`BE-011`). *Criteria:* `routine_privileges` shows no PUBLIC execute. *Test:* new `migrationIntegrity` case + P-probe. *Needs:* staging to verify.
- **T1.2 · P0 · none · `src/auth/supabaseAdapter.ts:578-583`, `src/components/LoginScreen.tsx`.** Three-state bootstrap detection: needed / not needed / cannot tell (`BE-013`). *Criteria:* an empty schema renders the statements and the error, not a silent sign-in form. *Test:* `src/auth/auth.test.ts` case.
- **T1.3 · P0 · T0.3 · docs + optionally `0012`.** Write the Super Admin password-recovery runbook and/or implement #58 (`BE-005`). *Criteria:* a second person follows it on staging. *Needs:* approval; service-role usage.
- **T1.4 · P1 · none · `0002:237`, `src/domain/roles.ts:81-84`.** Decide whether the pinned primary-admin identity stays hardcoded (`BE-010`). *Criteria:* either a settings-driven lookup with a test, or a documented statement that the identifier is public and the pin is deliberate.
- **T1.5 · P1 · none · `index.html`.** CSP + SRI posture (`BE-015`). *Criteria:* policy tested against Supabase endpoints without breaking sign-in.

### Phase 2 — validate the chain in isolation *(the critical path)*
- **T2.1 · P0 · T0.3 · `scripts/apply-migrations.mjs`.** Add an applied-version ledger and per-file record (`BE-012`). *Criteria:* refuses to re-apply a recorded version; covered by `scripts/apply-migrations.test.mjs`.
- **T2.2 · P0 · T2.1, tooling install · staging project.** Plan → apply 0001→0011 in order, one file at a time, evidence row per file. *Criteria:* all 11 recorded; `pg_policies` non-empty; the 3 views report `security_invoker=true`. *Needs:* `SUPABASE_DB_URL`, a non-production ref, explicit approval per step.
- **T2.3 · P0 · T2.2 · `supabase/probes/authorization_probes.sql`.** Run P01–P23 with four identities. *Criteria:* every block PASS or justified SKIP; `BE-003`, `BE-004` close.
- **T2.4 · P1 · T2.2.** `pg_dump` + restore into a scratch project + re-run probes. *Criteria:* counts equal, probes still PASS (`docs/PRODUCTION_READINESS.md` §5).

### Phase 3 — persistence and service integrations
- **T3.1 · P0 · T2.3 · `AppContext.tsx`, `supabaseAdapter.ts`, `docs/DATABASE_AND_MIGRATIONS.md` classes B/C.** Write-through for tasks, submissions, score ledger, notifications, audit (`BE-002`, `BE-008`). *Criteria:* §F matrix passes on three devices.
- **T3.2 · P1 · T3.1.** Read-from-server for the same collections, with honest empty states instead of cache.
- **T3.3 · P1 · T2.2 · `supabase/migrations`, `src/domain/media.ts`.** Storage bucket + upload path for media bytes (`BE-006`).
- **T3.4 · P1 · T2.2 · `send-email` function.** Deploy, schedule, verify a domain, one real delivery (`BE-007`).
- **T3.5 · P2 · T3.1 · `AppContext.tsx`.** Finish the reward slice: reads and policy from the server (`BE-009`).

### Phase 4 — authentication and provisioning
- **T4.1 · P0 · T2.2.** First-administrator bootstrap executed once on staging per §D.1. *Criteria:* a real Super Admin session completes; `BOOTSTRAP_SUPER_ADMIN` audit row exists; a second arm refuses.
- **T4.2 · P1 · T4.1.** Real provider sign-in, lockout, `AuthFailedError` vs `AccessRevokedError` observed in a browser (`docs/AUTHORIZATION.md:87-92`).
- **T4.3 · P1 · T4.1.** Test-account seeding on staging (`0008`), then removal; confirm no `super_admin` is minted.

### Phase 5 — integration, regression, negative tests
- **T5.1 · P0 · T2.2 · CI.** Commit `.github/workflows/ci.yml`, add a Postgres service job running `psql -f` on 0001→0011 + probes. *Criteria:* first green run on a real PR; the bundle scan demonstrably fails on a planted secret (`BE-014`).
- **T5.2 · P1.** Playwright project covering the §H browser matrix.
- **T5.3 · P1.** Per-collection server-side negative tests (a foreign committee's member attempting each write).

### Phase 6 — verify every workflow in every role
Member · Head · Director · High Board · IT/moderator · Super Admin, success **and** denial cases, from the matrix in §D.2; record results in `docs/TESTING.md`. Prerequisite: T4.2. Completion: each row has an observed outcome, not an inferred one.

### Phase 7 — operations
Logging/metrics/health surface (`BE-016`, roadmap #59), monitoring and alerting ownership, real fonts (#60), error-reporting posture, generated permission matrix (#76).

### Phase 8 — release
Staging smoke checklist (`supabase/README.md` §"checklist" lines 1-56), production migration plan with rollback, explicit approval, post-release verification, restore drill evidence.

---

## H. Test and verification plan

**Runnable right now, no infrastructure** `[ran: automated]` — the four commands in §0 are the whole local gate, and they are green on this tree.

| Purpose | Command | Notes |
| --- | --- | --- |
| Unit + component | `npm run test` (`vitest run`) | 48 files / 728 cases |
| Watch mode | `npm run test:watch` | |
| Typecheck | `npx tsc -b --force` | `npm run build` also runs it |
| Lint | `npm run lint` / `npx oxlint .` | 14 warnings, 0 errors; CI fails only on errors |
| Production build | `npm run build` | chunk-size notices only |
| SQL static invariants | `npx vitest run supabase/migrations/migrationIntegrity.test.ts` | 18 cases; parses text, proves nothing about Postgres |
| Escalation suite | `npx vitest run src/context/privilegeEscalation.test.tsx` | 17 cases, mutation-checked |
| Auth rules | `npx vitest run src/auth/auth.test.ts` | 46 cases vs the dev vault |
| Reward provider | `npx vitest run src/auth/rewardProvider.test.ts src/context/rewardProvider.test.tsx` | stubbed client |
| Operator CLIs | `npx vitest run scripts/` | 36 cases, stubbed spawn/fetch |
| Migration plan, no connection | `npm run migrations:plan` | prints the sequence, opens nothing |

**Provider-independence mechanism, and its limit.** `vite.config.ts:15-18` pins `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` to empty strings, and CI re-pins them (`../.github/workflows/ci.yml:39-40`), because Vite otherwise loads `.env.local` into `import.meta.env` for tests — the mechanism behind a recorded 40+ failure run. Consequence to state plainly: **these tests pass whether or not a real project is configured, so a green suite is not evidence about Supabase.** There is no `.skip`/`it.todo` anywhere, so nothing is silently skipped.

**Needs infrastructure:** behavioural SQL tests (P01–P23), migration apply tests, real sign-in and RPC integration, email delivery in Deno, storage byte persistence, first CI run, restore drill. **Needs a browser:** the §D.2 role matrix, motion/reduced-motion behaviour (currently blocked here: hidden tab has no `requestAnimationFrame`, and the automation surface reports `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`), and every "does it look right" claim.

**Manual matrix to execute after T4.2** — for each of the six roles: sign in; read own profile; attempt a role change (expect refusal); attempt a foreign-committee write (expect refusal); task assign/submit/review; award bonus and issue warning; edit CMS text (expect IT refused); manage media (expect text still refused); read audit; export JSON; sign out, clear nothing, sign in on a second browser and confirm the record came from the server.

---

## I. Production readiness gate

| # | Gate | Evidence required | Today |
| --- | --- | --- | --- |
| 1 | Migration sequence verified on an isolated database | apply evidence rows + §E.3 query output | ✘ BLOCKED (`BE-001`) |
| 2 | No unresolved critical/high security issue | §C critical/high items closed | ✘ `BE-002/003/004/005` open |
| 3 | Server-side authorization enforced, negative tests passing | P01–P23 PASS log | ✘ never run (`BE-003`) |
| 4 | Critical workflows persisted in the database | §F matrix passing on two devices | ✘ (`BE-002`) |
| 5 | Required suites green | vitest 728/728 | ✔ `[ran: automated]` — client tier only |
| 6 | Typecheck / lint / build | exits 0 | ✔ `[ran: automated]` |
| 7 | Secrets and environment handled safely | old key rotated; no secret in bundle; confirmation of which project a step touches | ✘ partial (`BE-015`) |
| 8 | Backup/recovery tested | `pg_dump` + restore + probe re-run record | ✘ never taken |
| 9 | Monitoring/error handling reviewed | a health source that is not a disclaimer | ✘ (`BE-016`) |
| 10 | Staging smoke tests completed | checklist lines 1–56 recorded | ✘ |
| 11 | Production migration + rollback reviewed | written plan, approved | ✘ |
| 12 | Explicit approval before production change | recorded owner approval | ✘ none given |

**Status ladder.** *Code Complete* — client tier: yes; server tier: authored-only, so **no overall**. *Locally Verified* — achieved for the client tier (`[ran: automated]`); it does not transfer to the server. *Staging Verified* — requires gates 1–4, 8, 10; **zero** of them have evidence. *Production Ready* — all twelve gates plus 11 and 12.

**To advance one level, the evidence that is missing is exactly:** an applied-migration ledger and `pg_policies`/`reloptions` output from a named staging project; a probe file run with PASS notices; a §F three-device persistence record; one real sign-in; one restore; and one rotation confirming the old publishable key is dead.

---

## J. Final checklist and handoff

**Next five actions, in order**
1. **T0.3 / T0.1** — the owner states which project `.env.local` points at (staging or production), and a durable checkpoint of the working tree is created. Both are owner decisions; this audit made neither.
2. **T2.1 + T2.2** — add the applied-version ledger, then apply 0001→0011 to a *named staging* project and capture the evidence rows. Nothing else in this document can be closed before this.
3. **T2.3** — run P01–P23. `BE-003`/`BE-004` are design-confirmed and stay open until they refuse something in front of you.
4. **T1.3 + T4.1** — resolve the Super Admin recovery gap (`BE-005`) *before* the first real administrator is provisioned, not after someone is locked out.
5. **T5.1** — put CI on a host, with a database job, so that "green" starts meaning something about SQL.

**Unknowns that repository inspection cannot resolve**
Whether any migration is applied anywhere · the Postgres version and installed extensions · existing roles, grants and default-privilege tightening · whether a `super_admin` row exists in the configured project · whether that project is production · whether `esme_is_primary_admin()`'s pinned identity matches the account that was actually provisioned · whether the email Edge Function is deployed or scheduled · whether a publishable key was ever rotated · whether the CI workflow has any run history · whether any RLS policy has ever filtered a row · whether a backup exists · how the UI behaves on a real viewport with real motion.

**Files future implementation work is expected to modify**
`scripts/apply-migrations.mjs` · new `supabase/migrations/0012_*.sql` · `src/auth/supabaseAdapter.ts` · `src/auth/localDevAdapter.ts` · `src/context/AppContext.tsx` (write-through per §F) · `src/components/LoginScreen.tsx` · `src/components/dashboard/MediaLibrary.tsx` + `src/domain/media.ts` (Storage) · `supabase/functions/send-email/index.ts` · `src/storage/migrations.ts` (only with a backward-compatible version bump) · `../.github/workflows/ci.yml` · `index.html` (CSP/SRI, fonts) · `docs/TESTING.md`, `docs/AUTHORIZATION.md`, `docs/PRODUCTION_READINESS.md`, `docs/DATABASE_AND_MIGRATIONS.md`, `supabase/README.md`, `README.md`, `PROJECT_MASTER_GUIDE.md` · roadmap items #34, #38, #58, #59, #60, #76, #78.

**Reminder:** this audit changed no database, applied no migration, ran no probe, created no account, reset no password, exposed no secret, and touched no file except `BACKEND_COMPLETION_README.md`. The four verification commands in §0 were the only programs executed, and all four ran offline against this tree.
