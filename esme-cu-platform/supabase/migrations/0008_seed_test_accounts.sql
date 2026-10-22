-- ESME CU ERP — seeded test accounts for the role-based screens
-- Apply after 0007_remove_email_verification.sql.
--
-- What this is
--   Three provisioned sign-ins — a Head, a Director and a Member — so a reviewer can open the
--   workspace as each role and see what that role reaches. They mirror TEST_ACCOUNT_FIXTURES in
--   src/domain/testAccounts.ts: same addresses, same usernames, same roles. That file is the
--   source of truth for the identities; this migration is the provider-side half of the same
--   feature and is written to agree with it.
--
-- Why it is not a browser call
--   Creating an identity means writing to auth.users. That is granted to service_role only, exactly
--   like esme_bootstrap_primary_admin() in 0003, so the sign-in path can never be reached by
--   something a client sent. The card in the Technical Support workspace prints these statements
--   instead of executing them, and src/auth/supabaseAdapter.ts returns the same refusal.
--
-- How a production project is protected
--   Two independent guards, both required:
--     1. the project must declare its environment, and the declaration must not be production:
--          insert into esme_settings (key, value)
--            values ('environment', jsonb_build_object('name', 'staging'))
--            on conflict (key) do update set value = excluded.value, updated_at = now();
--        A project that never declared anything reads as 'undeclared' and is refused. Defaulting to
--        refusal is deliberate: the missing row is far more likely on a real deployment than on a
--        test box someone is about to seed.
--     2. an armed window, opened by that same declaration:
--          select esme_arm_test_account_seed();
--        It stores the environment it was armed under, and esme_seed_test_accounts() re-reads it,
--        so arming 'staging' then declaring 'production' afterwards still refuses.
--
-- Operator sequence
--   select esme_arm_test_account_seed();   -- 15 minute window, service_role only
--   select esme_seed_test_accounts(
--     '<head password>', '<director password>', '<member password>');
--   select esme_remove_test_accounts();    -- later, when the review is over
--
-- The passwords are parameters. No credential for a real provider is stored in this repository, in
-- the bundle, or in browser storage; bcrypt hashing is the same crypt()/gen_salt('bf') the auth
-- server uses. The fixture passwords in src/domain/testAccounts.ts only ever open the local
-- development vault.
--
-- What seeding does NOT touch
--   No leadership seat. A Head or Director fixture is scoped by its role and its home committee —
--   canActOn() in src/domain/roles.ts, and the committee checks in 0002 — so it exercises the
--   role's screens without occupying a seat a real person may need. Assign it deliberately from
--   Committee Management if you want the seat filled too.
--
-- Known divergence from the browser path, stated rather than hidden:
--   * The vault matches a fixture by email OR username. Here a row must match BOTH before it is
--     deleted, because dropping an auth identity is not reversible and a uuid-keyed provider row
--     has to be unmistakably the fixture.
--   * esme_reward_entries references profiles ON DELETE RESTRICT ("accounts are suspended, never
--     deleted", 0006). A tester that was used to record a bonus or a warning is therefore refused
--     and reported, not deleted; the accountability record stays attached to it.
--   * The status of an existing row is only moved along transitions the trigger in 0007 permits,
--     so a previously rejected fixture is stepped through pending_approval instead of forced.

begin;

-- ===================================================== the environment gate ====

/**
 * What this project says it is. Absent means 'undeclared', and every guard below treats an
 * undeclared project as one it must not seed.
 */
create or replace function esme_declared_environment()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(
    (select value ->> 'name' from esme_settings where key = 'environment'),
    'undeclared'
  ))
$$;

create or replace function esme_test_account_seed_window_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from esme_settings
    where key = 'test_account_seed_deadline'
      and (value ->> 'until')::timestamptz > now()
      -- The environment is part of the window, not a separate lookup: it cannot be changed
      -- underneath an armed seed and leave the seed believing it is still in a test box.
      and lower(value ->> 'environment') in ('development', 'staging')
  )
$$;

/** Arm the seed window. Call from the SQL editor or with the service role key. */
create or replace function esme_arm_test_account_seed(
  p_window interval default interval '15 minutes',
  p_environment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_env text := lower(btrim(coalesce(p_environment, esme_declared_environment())));
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'ESME_FORBIDDEN: arm the test-account window from the SQL editor or with the service role key';
  end if;

  if v_env not in ('development', 'staging') then
    raise exception 'ESME_PRODUCTION_ENVIRONMENT: this project is declared as "%". Test accounts are only seeded where the operator has named development or staging.', v_env
      using hint = 'Declare it first: insert into esme_settings (key, value) values (''environment'', jsonb_build_object(''name'', ''staging'')) on conflict (key) do update set value = excluded.value, updated_at = now();';
  end if;

  insert into esme_settings (key, value)
    values ('test_account_seed_deadline',
            jsonb_build_object('until', (now() + p_window)::text, 'environment', v_env))
    on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

/**
 * The database copy of passwordChecks() in src/domain/registration.ts, minus the blocked-word list,
 * which lives in the app. Refusing a weak password here is what stops a seeded tester from being
 * the reason a staging box gets opened.
 */
create or replace function esme_test_account_password_problem(p_password text)
returns text
language plpgsql
immutable
as $$
begin
  if p_password is null or char_length(p_password) < 10 then
    return 'at least 10 characters';
  end if;
  if char_length(p_password) > 72 then
    return 'no more than 72 characters';
  end if;
  if p_password !~ '[a-z]' then return 'one lowercase letter' end if;
  if p_password !~ '[A-Z]' then return 'one uppercase letter' end if;
  if p_password !~ '[0-9]' then return 'one number' end if;
  if p_password !~ '[^A-Za-z0-9]' then return 'one symbol' end if;
  return null;
end;
$$;

-- ================================================================ the seed ====

/**
 * Create what is missing, re-apply the fixture fields of what is already there, and refuse an
 * identity that belongs to somebody else. Returns a per-fixture summary rather than a count,
 * because the operator needs to read which of the three happened.
 */
create or replace function esme_seed_test_accounts(
  p_password_head text,
  p_password_director text,
  p_password_member text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fix record;
  v_problem text;
  v_id uuid;
  v_held_by uuid;
  v_held_email text;
  v_status esme_account_status;
  v_committee uuid;
  v_committee_name text;
  v_is_new boolean;
  v_created jsonb := '[]'::jsonb;
  v_repaired jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_unseated jsonb := '[]'::jsonb;
begin
  if not esme_test_account_seed_window_open() then
    raise exception 'ESME_SEED_CLOSED: run esme_arm_test_account_seed() first, in a project declared development or staging';
  end if;

  for v_fix in
    select t.fixture_key, t.email, t.username, t.display_name, t.role, t.short_codes,
           case t.fixture_key
             when 'head' then p_password_head
             when 'director' then p_password_director
             when 'member' then p_password_member
           end as password
      from (values
        ('head', 'test.head@esme.test', 'test_head', 'Test Head', 'head'::esme_role,
         array['T&E', 'TE']::text[]),
        ('director', 'test.director@esme.test', 'test_director', 'Test Director', 'director'::esme_role,
         array['MK']::text[]),
        ('member', 'test.member@esme.test', 'test_member', 'Test Member', 'member'::esme_role,
         array['T&E', 'TE']::text[])
      ) as t (fixture_key, email, username, display_name, role, short_codes)
  loop
    v_problem := esme_test_account_password_problem(v_fix.password);
    if v_problem is not null then
      raise exception 'ESME_VALIDATION: the % fixture needs a password of %', v_fix.fixture_key, v_problem;
    end if;

    -- A username held by an account with a different address is somebody else's account.
    select p.id, lower(p.email::text) into v_held_by, v_held_email
      from esme_profiles p
      where p.username = v_fix.username;
    if v_held_by is not null and v_held_email <> v_fix.email then
      v_conflicts := v_conflicts || jsonb_build_object(
        'fixtureKey', v_fix.fixture_key,
        'reason', v_fix.username || ' is already used by ' || v_held_email ||
                  ', which is not this fixture, so nothing was written to it.'
      );
      continue;
    end if;

    -- Seat the tester in a committee this project actually has. short_code is the only stable
    -- handle across the two spellings a chapter may use, and nothing is invented when neither matches.
    select c.id, c.name into v_committee, v_committee_name
      from esme_committees c
      where upper(c.short_code) = any (select upper(x) from unnest(v_fix.short_codes) as code(x))
        and c.status = 'active'
      order by c.created_at
      limit 1;
    if v_committee is null then
      v_unseated := v_unseated || jsonb_build_object(
        'fixtureKey', v_fix.fixture_key,
        'shortCode', v_fix.short_codes[1]
      );
    end if;

    select p.id into v_id from esme_profiles p where p.email = v_fix.email;
    v_is_new := v_id is null;

    if v_is_new then
      v_id := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, confirmation_token, recovery_token,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data
      ) values (
        v_id,
        (select instance_id from auth.users limit 1),
        'authenticated',
        'authenticated',
        v_fix.email,
        crypt(v_fix.password, gen_salt('bf')),
        now(),                     -- provisioned, not awaiting a click nobody will make
        encode(gen_random_bytes(32), 'hex'),
        encode(gen_random_bytes(32), 'hex'),
        now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', v_fix.display_name, 'username', v_fix.username,
                           'accepted_policies', 'true')
      );
    else
      -- The fixture is re-applied, including the password: a tester whose credentials drifted is
      -- the one case where resetting it is the expected behaviour.
      update auth.users
         set encrypted_password = crypt(v_fix.password, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             raw_user_meta_data = jsonb_build_object(
               'full_name', v_fix.display_name, 'username', v_fix.username,
               'accepted_policies', 'true'),
             updated_at = now()
       where id = v_id;
    end if;

    select p.status into v_status from esme_profiles p where p.id = v_id;
    if v_status is null then
      raise exception 'ESME_SEED_FAILED: no profile row was created for %', v_fix.email;
    end if;

    -- rejected -> active is not a legal step, but rejected -> pending_approval -> active is.
    if v_status = 'rejected' then
      update esme_profiles set status = 'pending_approval' where id = v_id;
      v_status := 'pending_approval';
    end if;

    update esme_profiles
       set display_name = v_fix.display_name,
           username = v_fix.username,
           role = v_fix.role,
           committee_id = coalesce(v_committee, committee_id),
           email_verified = true,
           rejection_reason = null,
           decided_at = now(),
           updated_at = now(),
           status = case when v_status = 'pending_approval'
                         then 'active'::esme_account_status
                         else status end
     where id = v_id;

    -- A provisioned tester never applied. Mirror 0003: keep its queue row so the history is
    -- complete, but file it as decided, so it cannot be read as an applicant waiting for review.
    update esme_registration_requests
       set status = 'active',
           email_verified = true,
           assigned_committee_id = v_committee,
           decided_by_name = 'seeded test account',
           decided_at = now(),
           rejection_reason = null
     where profile_id = v_id;

    -- Both messages the seeding caused are addressed to this profile: 'account_created', queued by
    -- the request-row trigger in 0005, and 'account_approved', queued by the status change above.
    -- Neither has a reader — the address is on a reserved test domain — and both would fail at
    -- delivery and burn the provider's error budget, so the queued rows go. The in-app
    -- notification is left where it is: it is harmless, and it tells whoever signs in as this
    -- fixture that the account was provisioned rather than recruited.
    delete from esme_email_outbox where recipient_profile_id = v_id;

    insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
    values (
      v_id, v_fix.display_name, v_fix.role,
      case when v_is_new then 'TEST_ACCOUNT_CREATED' else 'TEST_ACCOUNT_REPAIRED' end,
      'profile', v_id::text,
      'Seeded by esme_seed_test_accounts() in a ' ||
        coalesce((select value ->> 'environment' from esme_settings where key = 'test_account_seed_deadline'), 'undeclared') ||
        ' project; committee ' || coalesce(v_committee_name, 'unseated') || '; no password is recorded here'
    );

    if v_is_new then
      v_created := v_created || jsonb_build_object(
        'fixtureKey', v_fix.fixture_key, 'email', v_fix.email, 'username', v_fix.username,
        'role', v_fix.role::text, 'committeeId', v_committee, 'committeeName', v_committee_name);
    else
      v_repaired := v_repaired || jsonb_build_object(
        'fixtureKey', v_fix.fixture_key, 'email', v_fix.email, 'username', v_fix.username,
        'role', v_fix.role::text, 'committeeId', v_committee, 'committeeName', v_committee_name);
    end if;
  end loop;

  -- One window, one seed: replaying it must not be a way to keep resetting passwords.
  delete from esme_settings where key = 'test_account_seed_deadline';

  return jsonb_build_object(
    'created', v_created,
    'repaired', v_repaired,
    'conflicts', v_conflicts,
    'unseated', v_unseated,
    'removed', '[]'::jsonb,
    'refusal', null
  );
end;
$$;

-- ============================================================== the removal ====

/**
 * Drop exactly the three fixtures. No window is needed: this is the cleanup path, and refusing it
 * because a 15-minute deadline passed would leave the accounts in place. It is still
 * service_role-only, it still matches on both address and username, and it still refuses an
 * account the reward ledger holds accountable.
 */
create or replace function esme_remove_test_accounts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fix record;
  v_id uuid;
  v_removed jsonb := '[]'::jsonb;
  v_refused jsonb := '[]'::jsonb;
begin
  for v_fix in
    select t.fixture_key, t.email, t.username
      from (values
        ('head', 'test.head@esme.test', 'test_head'),
        ('director', 'test.director@esme.test', 'test_director'),
        ('member', 'test.member@esme.test', 'test_member')
      ) as t (fixture_key, email, username)
  loop
    -- Both halves have to match. An applicant who registered one of these addresses keeps their
    -- account; the seed already reported that collision, and a person is not deleted to tidy up.
    select p.id into v_id
      from esme_profiles p
      where lower(p.email::text) = v_fix.email
        and lower(p.username::text) = v_fix.username;
    if v_id is null then
      continue;
    end if;

    if exists (select 1 from esme_reward_entries r
                where r.actor_id = v_id or r.target_id = v_id) then
      v_refused := v_refused || jsonb_build_object(
        'fixtureKey', v_fix.fixture_key, 'email', v_fix.email,
        'reason', 'the reward ledger holds a decision recorded by or about this account, so it was '
                  || 'left in place; suspend it from the account directory instead of deleting it'
      );
      continue;
    end if;

    delete from auth.users where id = v_id;
    -- esme_profiles cascades from auth.users, and the queue row cascades from the profile, so this
    -- is the one statement the operation needs. Anything that referenced the tester by id and is
    -- not owned by it was set null or cascaded by the constraints declared in 0001 and 0006.
    v_removed := v_removed || jsonb_build_object(
      'fixtureKey', v_fix.fixture_key, 'email', v_fix.email, 'username', v_fix.username);
  end loop;

  -- The entry is written only when something was actually dropped.
  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  select null, 'service_role', null, 'TEST_ACCOUNT_REMOVED', 'system', 'test_accounts',
         'Removed ' || jsonb_array_length(v_removed) || ' seeded test account(s): ' ||
         coalesce((select string_agg(entry.value ->> 'email', ', ')
                     from jsonb_array_elements(v_removed) as entry(value)), '')
  where jsonb_array_length(v_removed) > 0;

  return jsonb_build_object(
    'created', '[]'::jsonb,
    'repaired', '[]'::jsonb,
    'conflicts', v_refused,
    'unseated', '[]'::jsonb,
    'removed', v_removed,
    'refusal', null
  );
end;
$$;

-- ============================================================ who may call ====

revoke all on function esme_seed_test_accounts(text, text, text) from public, anon, authenticated;
revoke all on function esme_remove_test_accounts() from public, anon, authenticated;
revoke all on function esme_arm_test_account_seed(interval, text) from public, anon, authenticated;
revoke all on function esme_test_account_password_problem(text) from public, anon, authenticated;
revoke all on function esme_test_account_seed_window_open() from public, anon, authenticated;
revoke all on function esme_declared_environment() from public, anon, authenticated;
grant execute on function esme_arm_test_account_seed(interval, text) to service_role;
grant execute on function esme_seed_test_accounts(text, text, text) to service_role;
grant execute on function esme_remove_test_accounts() to service_role;
grant execute on function esme_test_account_seed_window_open() to service_role;
grant execute on function esme_declared_environment() to service_role;

comment on function esme_arm_test_account_seed(interval, text) is
  'Opens a seed window in a project declared development or staging. service_role only; refuses production and an undeclared project.';
comment on function esme_seed_test_accounts(text, text, text) is
  'Provisions the three fixtures from src/domain/testAccounts.ts. service_role only, one armed window per call, passwords arrive as parameters and are hashed with bcrypt.';
comment on function esme_remove_test_accounts() is
  'Drops only accounts matching both a fixture address and its username, and refuses any the reward ledger holds accountable. service_role only.';
comment on column esme_settings.value is
  'Two keys matter here: ''environment'' declares which project this is (absent means undeclared, and every test-account guard refuses it), and ''test_account_seed_deadline'' carries the armed window together with the environment it was armed under.';

commit;

-- After applying, in a declared staging project: arm the window, seed, and sign in as each of the
-- three. The Head sees committee-scoped assignment, the Director sees the recruitment queue for
-- one committee, the Member sees only their own work. Re-running the seed without arming must
-- raise ESME_SEED_CLOSED, and seeding an address a real applicant already holds must report a
-- conflict and write nothing to that account. None of this has been executed against a live
-- Postgres — see supabase/README.md.
