# Development setup

## Requirements

- Node.js 20+ (the suite was run on Node 24).
- Git. No global installs are needed; every tool is a dev dependency.

## Install and run

```bash
npm install
npm run dev        # Vite dev server — http://localhost:5173
npm run build      # tsc -b && vite build  → dist/
npm run lint       # oxlint
npm test           # vitest run (one pass, 45 files / 645 tests as of 2026-10-22)
npm run test:watch # vitest in watch mode
npm run preview    # serve the production build locally
```

There is no database to start and no Dockerfile. Without provider configuration the app runs
on the local development auth adapter and browser storage.

## Environment

Copy `.env.example` to `.env.local` and fill in only what you have.

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | only to use the real provider | Project URL. When unset **in development**, the local-dev auth adapter is used; a production build with it unset refuses to authenticate. |
| `VITE_SUPABASE_ANON_KEY` | only to use the real provider | Publishable anon key. Never the service-role key. |
| `SUPABASE_DB_URL` | only for migration/backup commands | Direct Postgres URL used by `pg_dump` / `psql` in [supabase/README.md](../supabase/README.md). **Not read by the app** — keep it in the shell or CI secret store, never in a `VITE_` variable. |

`.env.example` deliberately lists only these. A variable is documented here because code reads
it, not because it might be useful one day. `.env.local` is git-ignored (`*.local`); never commit
a filled-in copy, and never put a secret in a `VITE_`-prefixed variable — the bundler inlines it
into the browser artifact.

## First sign-in

With no provider configured, `/dashboard` shows the primary-administrator bootstrap form.
It creates the first Super Admin in the local development vault
(`ESME_CU_DEV_AUTH_V1`) with a PBKDF2-SHA256 hash (210,000 iterations) — the password itself
is never stored, and an amber banner stays on screen for the whole session because this
fallback is not production authentication.

Against a real project, follow
[../supabase/README.md](../supabase/README.md) for provisioning, the bootstrap command, and
the verification checklist.

## Repository layout

```
src/
  auth/          AuthAdapter interface, Supabase + local-dev implementations, guards
  components/    public site + dashboard surfaces
    dashboard/committee/   committee form, leadership panel, account search, roster panel
  context/       AppContext — the single writer of operational state
  data/          reference content (committee structure, form schema, season plan, copy)
  domain/        pure rules: roles, account states, committees, decisions, workflow, metrics
  motion/        animation tokens, variants, shared components, toast
  storage/       versioned browser storage + migrations
supabase/
  migrations/    0001 schema · 0002 functions+RLS · 0003 admin bootstrap · 0004 committee leadership
  dev_seed_reference.sql
docs/            this set
```

## Conventions

- TypeScript strict; no `any` escapes and no `as never` shortcuts. `npm run build` typechecks
  the app and test sources together.
- `npm run lint` (oxlint) is expected to stay at zero errors; the current run reports
  16 warnings on 87 files, all pre-existing style notices.
- Domain modules stay framework-free — if a file imports React, the rule belongs one layer up.
- UI copy is written for operators: say what happened and what to do next, never a bare
  "Error" or a success message that nothing confirmed.

## Before opening a change

```bash
npm run lint && npm test && npm run build
```

Then read [TESTING.md](TESTING.md) for what the suite does and does **not** cover.
