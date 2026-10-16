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
| [`supabaseAdapter.ts`](src/auth/supabaseAdapter.ts) | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set | The production path. **Not yet verified**: no project or keys exist in this environment, so it has never completed a real sign-in, and the SQL in [`supabase/`](supabase/) has never run against Postgres. |
| [`localDevAdapter.ts`](src/auth/localDevAdapter.ts) | Development only, no provider configured | A browser-storage simulation so the UI and tests can exercise the rules. PBKDF2-SHA256 (210k iterations), 5-attempt lockout, 8-minute sessions. It renders a permanent warning banner and is **not** production authentication. |

A production build with no provider configured refuses to authenticate at all
([src/auth/index.ts](src/auth/index.ts)) rather than falling back to browser storage.

Follow [supabase/README.md](supabase/README.md) for provisioning, the first-administrator
bootstrap, the verification checklist, and backups.

## Where authorization lives

- **Enforced**: `esme_role_capabilities`, `esme_has_capability()` and the RLS policies in
  [`supabase/migrations/0002_functions_rls.sql`](supabase/migrations/0002_functions_rls.sql),
  plus the SECURITY DEFINER functions that write registrations, decisions, roles, statuses,
  reviews and score adjustments.
- **Mirrored for the UI**: [`src/domain/roles.ts`](src/domain/roles.ts) returns the same
  capability + scope matrix so a control the account cannot use is not offered. Hiding a
  button is never the authorization; the request is still refused server-side.
- **Account states**: `pending_email_verification` → `pending_approval` → `active`, with
  `rejected` and `suspended`. Only `active` reaches the ERP, and only approval produces
  `active` — a verified email alone grants nothing
  ([`src/domain/accountState.ts`](src/domain/accountState.ts)).
- Public registration cannot choose a role; it always creates a `member`-track request
  awaiting verification and approval ([`src/domain/registration.ts`](src/domain/registration.ts)).

## Data and browser storage

Operational collections (members, tasks, submissions, score ledger, applications, skill
matrix, notifications, audit) start empty and come from the backend. Browser storage is
versioned (`ESME_CU_STATE_V2_*`) and holds reference content — committee structure,
registration form schema, season plan, website copy, theme — plus drafts created on that
device. The one-time V1 → V2 migration in [`src/storage/migrations.ts`](src/storage/migrations.ts)
retired the previous unversioned cache with its fictional sample records; the tests in
[`src/storage/migrations.test.ts`](src/storage/migrations.test.ts) pin that behaviour.

Screenshots transcribed by hand are labelled as such — see
[`src/data/historyData.ts`](src/data/historyData.ts). No analytics API is connected, so the
social report is a static record, not a measurement.

## Tests

`npm test` runs 52 tests: the capability matrix and account-state machine, registration
rules, the V1 → V2 storage migration, and 20 auth-adapter cases (bootstrap, registration,
status gating, capability enforcement, duplicate handling, lockout, provider resolution).
They exercise the rules through the development adapter; they do **not** verify the
provider, its RLS policies, or email delivery.

## Motion

`motion/react` with `MotionConfig reducedMotion="user"`, so all animation collapses to
opacity when the operating system requests reduced motion
([src/motion/](src/motion/)).
