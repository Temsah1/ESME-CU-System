# ESME CU — Supabase integration guide

Everything in this folder is the **server side** of the platform: schema, authorization,
row level security and the one-time first-administrator procedure. The React app never
decides who is signed in or what they may do; it renders what these functions return.

## Status of this integration — read before deploying

**Applied to a live project: no.** No Supabase project URL, anon key or service-role key
was available in the development environment where this code was written, so:

- the SQL in `migrations/` has **never been executed against Postgres**. It is reviewed
  source, not a verified schema;
- the RLS policies have **not been probed** with a real token, so no policy has been
  confirmed to reject a hand-made request;
- email deliverability (verification links, password resets) has **not been tested**,
  because no SMTP sender is configured;
- `src/auth/supabaseAdapter.ts` has been type-checked and unit-tested only through the
  local development adapter, which simulates the same rules in browser storage.

Treat any claim of "secured by RLS" as pending until the checklist below is run against
your project and the results are recorded.

## Files

| File | Purpose |
| --- | --- |
| `migrations/0001_schema.sql` | Enums, tables, indexes, constraints. Operational tables are created **empty**. |
| `migrations/0002_functions_rls.sql` | Capability matrix, `esme_has_capability()`, scope helpers, SECURITY DEFINER functions, triggers, and RLS policies for all 19 `esme_*` tables. |
| `migrations/0003_bootstrap_admin.sql` | Arming window + `esme_bootstrap_primary_admin()`. The only way a Super Admin comes to exist. |
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
3. **Apply the migrations in order** (`supabase db push`, or `psql -f` one file at a time).
   0003 depends on 0002; both depend on 0001.
4. **Verify the schema landed** before provisioning anyone:

   ```sql
   select count(*) from esme_profiles;            -- 0 (or 1 after bootstrap)
   select count(*) from esme_tasks;               -- 0
   select count(*) from esme_score_ledger;        -- 0
   select count(*) from esme_audit_log;           -- 0
   select capability, scope from esme_role_capabilities
     where role = 'member' order by capability;   -- the member row of the matrix
   ```

5. **Provision the primary administrator** (next section). Nothing else seeds accounts.
6. **Optionally load reference content** on a development or freshly provisioned project:
   run `dev_seed_reference.sql` manually, once. It is not wired to any build or boot step.
7. **Configure authentication** in the dashboard: enable Email sign-in, disable phone and
   any third-party providers the chapter has not approved, set the site URL, and confirm
   the SMTP sender so verification and reset links actually arrive.
8. **Deploy** with the environment variables set in the hosting platform's secret store,
   then run the verification checklist below.

## First administrator

`esme_bootstrap_primary_admin()` is granted to `service_role` only. That is deliberate:
before the first administrator exists, every caller from a browser would be anonymous or a
self-registered applicant, and an anonymous caller must not be able to mint a Super Admin.

Run both statements in the Supabase SQL editor:

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

## Authorization model

- Roles: `super_admin`, `director`, `head`, `moderator`, `member`. Account statuses:
  `pending_email_verification`, `pending_approval`, `active`, `rejected`, `suspended`.
  Only `active` reaches the ERP; a verified email alone grants nothing.
- Rights live in `esme_role_capabilities (role, capability, scope)` where scope is
  `all`, `committee` or `self`. `esme_has_capability()` and `esme_capability_scope()` read
  that table inside the database session; policies and SECURITY DEFINER functions call them.
- `src/domain/roles.ts` mirrors the matrix so the UI can hide controls it cannot use. That
  mirror is a convenience only — hiding a button is not authorization, and the database
  decides every time.
- `esme_protect_primary_admin()` refuses deletion or downgrading of the primary account;
  `esme_assert_status_transition()` refuses status jumps that the state machine forbids;
  `esme_audit_is_append_only()` blocks updates and deletes on `esme_audit_log`.
- Registration always produces a `member`-track request with status
  `pending_email_verification`. A role submitted by a browser is ignored server-side.

## Verification checklist (record the result of each line)

Run as a non-privileged applicant token and as an administrator token, and note what differs:

1. `select * from esme_profiles` as anon → 0 rows visible.
2. As a pending applicant: `update esme_profiles set role='super_admin' where id=(select auth.uid())` → refused by policy.
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
10. Send a verification email and a reset email, and confirm both arrive.

Until these run against your project, the integration is **unverified**, and the product
must not present it otherwise.

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
| `ESME_BOOTSTRAP_CLOSED` | Arm the window first, or a previous window expired. |
| `permission denied for function esme_bootstrap_primary_admin` | Correct. It runs in the SQL editor or with `service_role`, never from the browser. |
