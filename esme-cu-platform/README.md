# ESME CU — chapter platform

Public website plus the members' ERP for the Engineering Students of Cairo University
chapter. One Vite app: `/` renders the public site, `/dashboard` renders the ERP behind
a real sign-in.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build
npm run lint      # oxlint
npm test          # vitest run
```

## Authentication status

The app is wired to a provider-agnostic `AuthAdapter`
([src/auth/types.ts](src/auth/types.ts)) with two implementations:

| Adapter | When it is used | What it proves |
| --- | --- | --- |
| [`supabaseAdapter.ts`](src/auth/supabaseAdapter.ts) | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set | The production path. **Not yet usable**: the project's schema is empty, because `supabase/migrations/` has never been applied — the RPC the app calls first answers `PGRST202`, and no SQL in this directory has ever run against Postgres. Until 0001–0011 are applied, sign-in here cannot succeed and the browser's own configuration check will refuse a bad URL or a secret key before credentials are even tried. |
| [`localDevAdapter.ts`](src/auth/localDevAdapter.ts) | Development only, no provider configured | A browser-storage simulation so the UI and tests can exercise the rules. PBKDF2-SHA256 (210k iterations), 5-attempt lockout, 8-minute sessions. It renders a permanent warning banner and is **not** production authentication. |

A production build with no provider configured refuses to authenticate at all
([src/auth/index.ts](src/auth/index.ts)) rather than falling back to browser storage.

Follow [supabase/README.md](supabase/README.md) for provisioning, the first-administrator
bootstrap, the verification checklist, and backups.

## Where authorization lives

- **Enforced**: `esme_role_capabilities`, `esme_has_capability()` and the RLS policies in
  [`supabase/migrations/0002_functions_rls.sql`](supabase/migrations/0002_functions_rls.sql),
  plus the SECURITY DEFINER functions that write registrations, decisions, roles, statuses,
  reviews and score adjustments — and, from
  [`0004_committee_leadership.sql`](supabase/migrations/0004_committee_leadership.sql), the
  committee draft rules, the seat channel guard, `esme_assign_leader()` and
  `esme_set_account_committee()`.
- **Mirrored for the UI**: [`src/domain/roles.ts`](src/domain/roles.ts) returns the same
  capability + scope matrix so a control the account cannot use is not offered. Hiding a
  button is never the authorization; the request is still refused server-side.
- **Account states**: `pending_approval` → `active`, with `rejected` and `suspended`. Only
  `active` reaches the ERP, and only approval produces `active` — no email verification step
  exists any more ([`src/domain/accountState.ts`](src/domain/accountState.ts)); a cached row
  left on the retired stage is repaired to `pending_approval` on read.
- Public registration cannot choose a role; it always creates a `member`-track request that
  enters the review queue the moment it exists
  ([`src/domain/registration.ts`](src/domain/registration.ts)).

## Data and browser storage

**There is no backend running in this repository.** No database instance, no API service, no
provisioned project. Operational collections (members' activity, tasks, submissions, score
ledger, applications, skill matrix, notifications, audit) start empty and are written to
versioned browser storage (`ESME_CU_STATE_V2_*`) by the store, which means they persist across
reloads on one device but are not shared between browsers and are not a server-side record.
Reference content — committee structure, registration form schema, season plan, website copy,
theme — lives in the same namespace. Identity does not: sessions come from the auth adapter, and
an account's role, status and capabilities are re-read from it.

The migration path (reads, then writes, one surface at a time) and the SQL that already describes
the target schema are written out in
[docs/DATABASE_AND_MIGRATIONS.md](docs/DATABASE_AND_MIGRATIONS.md). That file also states which
of those migrations have not been executed.

The one-time V1 → V2 migration in [`src/storage/migrations.ts`](src/storage/migrations.ts)
retired the previous unversioned cache with its fictional sample records and the browser-owned
`currentUser`; V2 → V3 dropped the cached leader names from committee rows. The tests in
[`src/storage/migrations.test.ts`](src/storage/migrations.test.ts) pin that behaviour.

## Committees

A committee stores its leadership as **references to accounts** (`directorId`, `headId`) and never
as a copied name, so renaming an office-holder updates every screen. Seats move only through the
leadership panel, which searches the accounts the signed-in actor is permitted to see, refuses
inactive or already-seated people, and leaves the account's role untouched. Editing covers every
stored field, rejects an invalid value before anything is written, and refuses a save built on a
stale copy of the row. [docs/COMMITTEE_MANAGEMENT.md](docs/COMMITTEE_MANAGEMENT.md) is the
operator's guide.

Screenshots transcribed by hand are labelled as such — see
[`src/data/historyData.ts`](src/data/historyData.ts). No analytics API is connected, so the
social report is a static record, not a measurement.

## Tests

`npm test` runs 282 tests across 16 files: the capability matrix and account-state machine,
registration and decision rules, committee and leadership rules, the directory merge, the
V1 → V2 → V3 storage migration, operational-cache reload safety, safe XLSX export, and 24
auth-adapter cases (bootstrap, registration, status gating, capability enforcement, duplicate
handling, lockout, provider resolution). Two files render real surfaces in jsdom:
[CommitteeManagement.test.tsx](src/components/dashboard/CommitteeManagement.test.tsx) drives the
committee CMS through its actual controls and reads the writes back out of browser storage after a
remount, and [operationalCache.test.tsx](src/context/operationalCache.test.tsx) proves a task
created in the store survives a remount.

They exercise the rules through the development adapter; they do **not** verify the provider,
its RLS policies, or email delivery. [docs/TESTING.md](docs/TESTING.md) records the exact
command output and lists what remains unproven.

## Documentation

| Read | For |
| --- | --- |
| [PROJECT_MASTER_GUIDE.md](PROJECT_MASTER_GUIDE.md) | The whole project in one file: architecture, every module, schema, migration risk table, deployment runbook, and the honest readiness verdict per category |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, the committee write path, account role vs. leadership seat |
| [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) | Install, scripts, environment variables, first sign-in, conventions |
| [docs/COMMITTEE_MANAGEMENT.md](docs/COMMITTEE_MANAGEMENT.md) | Creating and editing committees, appointing Directors and Heads, roster, archive |
| [docs/CMS_GUIDE.md](docs/CMS_GUIDE.md) | What an operator can change without source edits — and what still cannot |
| [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md) | The capability matrix, where each check runs, the planned `it` role |
| [docs/DATABASE_AND_MIGRATIONS.md](docs/DATABASE_AND_MIGRATIONS.md) | What is stored where, the SQL migrations, and how to connect a real backend |
| [docs/TESTING.md](docs/TESTING.md) | Test inventory, results, and the limits of what they prove |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | What must be true before a release: environment separation, the migration and probe procedure, the restore drill, monitoring, smoke test, forward-fix |
| [supabase/README.md](supabase/README.md) | Provisioning, bootstrap, RLS verification checklist, backup and restore |

## Motion

`motion/react` with `MotionConfig reducedMotion="user"`, so all animation collapses to
opacity when the operating system requests reduced motion
([src/motion/](src/motion/)).
