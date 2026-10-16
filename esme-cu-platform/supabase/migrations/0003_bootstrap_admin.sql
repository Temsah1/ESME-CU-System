-- ESME CU ERP — first-administrator bootstrap
-- Apply after 0002_functions_rls.sql.
--
-- This is the ONLY way a Super Admin comes to exist. It is not a public endpoint and
-- it seeds nothing else: no members, tasks, submissions, scores or audit noise.
--
-- Two-step, operator-driven:
--   1. Open a session in the SQL editor (or run with the service role key server-side)
--      and arm the window:  select esme_arm_bootstrap(interval '15 minutes');
--   2. Call it from that same trusted session, with the real password:
--        select esme_bootstrap_primary_admin(
--          'Kareem Tamer', 'kareemeltemsah7@gmail.com', 'temsah1', '<operator password>');
--   3. The window closes itself after one success, or on expiry, whichever comes first.
--
-- Both functions are executable by service_role only. Until the first administrator
-- exists, nobody holds a privileged JWT, so a browser call could only come from an
-- anonymous or self-registered applicant; arming a window must never be reachable from
-- the client. The sign-in screen detects this state and shows these two statements
-- instead of submitting them.
--
-- The password is never stored in this repository, in the bundle, or in browser storage.
-- Supabase's auth layer hashes it (bcrypt) when the identity row is created.

begin;

create or replace function esme_bootstrap_window_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from esme_settings
    where key = 'primary_admin_bootstrap_deadline'
      and (value ->> 'until')::timestamptz > now()
  )
$$;

-- Arm the bootstrap window. Call from the SQL editor or with the service role key.
create or replace function esme_arm_bootstrap(p_window interval default interval '15 minutes')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'ESME_FORBIDDEN: arm the bootstrap window from the SQL editor or with the service role key';
  end if;
  if exists (select 1 from esme_profiles where role = 'super_admin') then
    raise exception 'ESME_NOT_REQUIRED: a Super Admin already exists';
  end if;
  insert into esme_settings (key, value)
    values ('primary_admin_bootstrap_deadline', jsonb_build_object('until', (now() + p_window)::text))
    on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

create or replace function esme_needs_primary_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from esme_profiles where role = 'super_admin')
$$;

create or replace function esme_bootstrap_primary_admin(
  p_full_name text,
  p_email text,
  p_username text,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid;
  v_profile_id uuid;
  email_norm text := lower(btrim(p_email));
  username_norm text := lower(btrim(p_username));
begin
  if not esme_bootstrap_window_open() then
    raise exception 'ESME_BOOTSTRAP_CLOSED: run esme_arm_bootstrap() first (15 minute window)';
  end if;

  -- One privileged account per bootstrapped chapter. Extra Super Admins are created
  -- afterwards by esme_assign_role() from an existing Super Admin session.
  if exists (select 1 from esme_profiles where role = 'super_admin') then
    raise exception 'ESME_ALREADY_BOOTSTRAPPED: a Super Admin exists';
  end if;

  if char_length(btrim(p_full_name)) < 3 then
    raise exception 'ESME_VALIDATION: full name is required';
  end if;
  if email_norm !~ '^[^@]+@[^@]+\.[a-zA-Z]{2,}$' then
    raise exception 'ESME_VALIDATION: valid email address required';
  end if;
  if username_norm !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'ESME_VALIDATION: username must be 3-30 characters (letters, digits, dot, dash, underscore)';
  end if;
  if char_length(p_password) < 10 then
    raise exception 'ESME_VALIDATION: password must be at least 10 characters';
  end if;

  v_auth_id := gen_random_uuid();

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values (
    v_auth_id,
    (select instance_id from auth.users limit 1),
    'authenticated',
    'authenticated',
    email_norm,
    -- Hashed by the same function the auth server uses; no plaintext is retained.
    crypt(p_password, gen_salt('bf')),
    now(),                      -- an operator-provisioned admin is not left awaiting email
    encode(gen_random_bytes(32), 'hex'),
    encode(gen_random_bytes(32), 'hex'),
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', btrim(p_full_name), 'username', username_norm)
  );

  -- The signup trigger creates a pending profile; an administrator is activated here.
  update esme_profiles
     set role = 'super_admin',
         status = 'active',
         email_verified = true
   where id = v_auth_id
  returning id into v_profile_id;

  if v_profile_id is null then
    raise exception 'ESME_BOOTSTRAP_FAILED: profile row was not created';
  end if;

  update esme_registration_requests
     set status = 'active', email_verified = true, decided_at = now(), decided_by_name = 'system bootstrap'
   where profile_id = v_profile_id;

  -- Close the window immediately: successful bootstrap cannot be replayed.
  delete from esme_settings where key = 'primary_admin_bootstrap_deadline';

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_profile_id, p_full_name, 'super_admin', 'BOOTSTRAP_SUPER_ADMIN', 'profile',
          v_profile_id::text, 'Primary administrator provisioned; bootstrap window closed');

  return v_profile_id;
end;
$$;

revoke all on function esme_bootstrap_primary_admin(text, text, text, text) from public, anon, authenticated;
revoke all on function esme_arm_bootstrap(interval) from public, anon, authenticated;
grant execute on function esme_arm_bootstrap(interval) to service_role;
grant execute on function esme_bootstrap_primary_admin(text, text, text, text) to service_role;
grant execute on function esme_needs_primary_admin() to anon, authenticated, service_role;
grant execute on function esme_bootstrap_window_open() to authenticated;

comment on function esme_bootstrap_primary_admin(text, text, text, text) is
  'One-time first-admin provisioning. service_role only: needs an armed window and zero existing Super Admins.';

commit;
