-- ESME CU ERP — the approval queue no longer waits on an email click
-- Apply after 0006_rewards_discipline.sql.
--
-- What changed
--   Verification used to be a stage of its own. A new account sat in
--   `pending_email_verification` until the applicant confirmed the address, and both the
--   transition trigger and esme_decide_registration() refused to activate an account that
--   had not. That stage is gone: a submission enters the queue as `pending_approval`, is
--   reviewable the moment it exists, and only an authorized reviewer's decision moves it.
--   This mirrors src/domain/accountState.ts and src/domain/registration.ts.
--
-- Where address proof now lives
--   With the signup flow, in Supabase Auth — not in this schema. GoTrue's "Confirm email"
--   setting decides whether an unconfirmed address can ever create an auth user, and its
--   rate limits cap repeated /signup calls from one origin. auth.users.email_confirmed_at is
--   still mirrored into email_verified so an operator can see what the provider reported;
--   per the column comments below, nothing may gate on it. Turning "Confirm email" off has a
--   real cost — a fabricated address can reach the queue — so the queue is protected by the
--   submission throttle in src/domain/registration.ts (registration.ts:122) and by the
--   reviewer reading the application, not by waiting for a click.
--
-- The enum label cannot be dropped
--   Postgres can rename an enum value but cannot remove one, and `esme_account_status`
--   appears in live function signatures (esme_current_status(), esme_set_account_status(),
--   esme_identity()), so recreating the type is not an option here. `pending_email_verification`
--   therefore stays in the type and is made unreachable instead: rows are moved off it, the
--   column defaults point at `pending_approval`, no write path produces it, the transition
--   trigger no longer lists it, and a check constraint refuses it on insert.

begin;

-- 1. Move every row off the retired stage -------------------------------------
--    Runs first, while the old transition rule still permits the step.

update esme_profiles
   set status = 'pending_approval'
 where status = 'pending_email_verification';

update esme_registration_requests
   set status = 'pending_approval'
 where status = 'pending_email_verification';

-- 2. A new submission starts in the queue, not behind a link -------------------

alter table esme_profiles
  alter column status set default 'pending_approval';

alter table esme_registration_requests
  alter column status set default 'pending_approval';

alter table esme_profiles
  add constraint esme_profiles_status_reachable
  check (status <> 'pending_email_verification');

alter table esme_registration_requests
  add constraint esme_registration_requests_status_reachable
  check (status <> 'pending_email_verification');

-- 3. The lifecycle, without the verification step ------------------------------
--    The old rule also refused to activate an unverified address; that raise is
--    removed with the stage it guarded.

create or replace function esme_assert_status_transition()
returns trigger
language plpgsql
as $$
declare
  allowed boolean;
begin
  if new.status is distinct from old.status then
    -- Same set src/domain/accountState.ts documents; anything else is refused.
    allowed := (old.status, new.status) in (
      ('pending_approval', 'active'),
      ('pending_approval', 'rejected'),
      ('active', 'suspended'),
      ('rejected', 'pending_approval'),
      ('suspended', 'active'),
      ('suspended', 'rejected')
    );
    if not allowed then
      raise exception 'ESME_INVALID_STATUS_TRANSITION: % -> %', old.status, new.status
        using hint = 'Use esme_set_account_status() from an authorized session.';
    end if;
  end if;
  return new;
end;
$$;

-- 4. Signup becomes a pending request directly ---------------------------------

create or replace function esme_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_profile esme_profiles%rowtype;
begin
  insert into esme_profiles (
    id, email, username, display_name, role, status, email_verified
  ) values (
    new.id,
    lower(new.email),
    lower(coalesce(meta ->> 'username', split_part(new.email, '@', 1))),
    coalesce(meta ->> 'full_name', initcap(split_part(new.email, '@', 1))),
    'member',                     -- public registration cannot choose a role
    'pending_approval',           -- reviewable the moment it exists
    (new.email_confirmed_at is not null)  -- mirrored, never a gate
  )
  returning * into v_profile;

  insert into esme_registration_requests (
    profile_id, full_name, email, username, requested_committee_id,
    technical_skills, previous_experience, motivation, availability_hours,
    agreed_to_policies, email_verified, status
  ) values (
    v_profile.id, v_profile.display_name, v_profile.email, v_profile.username,
    nullif(meta ->> 'committee_id', '')::uuid,
    coalesce(meta ->> 'technical_skills', ''),
    coalesce(meta ->> 'previous_experience', ''),
    coalesce(meta ->> 'motivation', ''),
    coalesce(meta ->> 'availability_hours', ''),
    coalesce((meta ->> 'accepted_policies')::boolean, false),
    v_profile.email_verified,
    v_profile.status
  );

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_profile.id, v_profile.display_name, 'member', 'REGISTRATION_SUBMITTED',
    'registration', v_profile.id::text, 'New registration entered the approval queue'
  );

  return new;
end;
$$;

-- 5. The decision is the only gate ---------------------------------------------

/** Approve or reject one request. Idempotent under concurrent reviewers. */
create or replace function esme_decide_registration(
  p_request_id uuid,
  p_decision esme_decision,
  p_reason text default null,
  p_committee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request esme_registration_requests%rowtype;
  v_actor esme_profiles%rowtype;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;
  if not esme_has_capability('registrations.decide') then
    raise exception 'ESME_FORBIDDEN: only a Super Admin or Moderator may decide registrations';
  end if;

  -- Row lock: two reviewers clicking at once cannot both win.
  select * into v_request
    from esme_registration_requests
    where id = p_request_id
    for update;

  if v_request.id is null then
    raise exception 'ESME_NOT_FOUND: registration request';
  end if;
  if v_request.status <> 'pending_approval' then
    raise exception 'ESME_ALREADY_DECIDED: request % is %', p_request_id, v_request.status;
  end if;

  if esme_is_primary_admin(v_request.profile_id) then
    raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin is not in the approval queue';
  end if;

  if p_decision = 'approve' then
    update esme_profiles
       set status = 'active',
           role = 'member',
           committee_id = coalesce(p_committee_id, requested_committee_id, committee_id),
           decided_by = v_actor.id,
           decided_at = now()
     where id = v_request.profile_id;
  else
    update esme_profiles
       set status = 'rejected',
           rejection_reason = p_reason,
           decided_by = v_actor.id,
           decided_at = now()
     where id = v_request.profile_id;
  end if;

  update esme_registration_requests
     set decided_by = v_actor.id,
         decided_by_name = v_actor.display_name,
         decided_at = now(),
         rejection_reason = p_reason,
         assigned_committee_id = coalesce(p_committee_id, assigned_committee_id)
   where id = p_request_id;

  insert into esme_notifications (profile_id, title, message, type)
  values (
    v_request.profile_id,
    case p_decision when 'approve' then 'Registration approved' else 'Registration not approved' end,
    case p_decision
      when 'approve' then 'Your account was activated. Sign in to open the chapter workspace.'
      else 'An administrator reviewed your request and did not approve it. Reason: ' ||
           coalesce(p_reason, 'not stated')
    end,
    case p_decision when 'approve' then 'success' else 'alert' end
  );

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_actor.id, v_actor.display_name, v_actor.role,
    'REGISTRATION_' || upper(p_decision::text), 'registration', p_request_id::text,
    'Decision on ' || v_request.email::text
  );
end;
$$;

-- 6. The identity response stops claiming a state the app no longer reads -------
--    A function's returned columns cannot be changed in place, so this one is
--    dropped and recreated, then re-protected the way 0002 did.

drop function esme_identity(uuid);

create or replace function esme_identity(p_user_id uuid)
returns table (
  id uuid,
  email text,
  username text,
  display_name text,
  role esme_role,
  status esme_account_status,
  committee_id uuid,
  capabilities text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.email::text,
    p.username::text,
    p.display_name,
    p.role,
    p.status,
    p.committee_id,
    case when p.status = 'active'
         then coalesce(array_agg(distinct rc.capability) filter (where rc.capability is not null), '{}')
         else '{}'
    end
  from esme_profiles p
  left join esme_role_capabilities rc on rc.role = p.role
  where p.id = p_user_id
    and (
      auth.role() = 'service_role'
      -- A session can read its own identity; only an active account leaves this
      -- function with capabilities attached.
      or p.id = esme_current_profile_id()
    )
  group by p.id;
$$;

revoke all on function esme_identity(uuid) from anon;
grant execute on function esme_identity(uuid) to authenticated, service_role;

-- 7. One decision email per decision, not one per lifetime -----------------------
--    The old outbox keys were `account_approved:<profile>` and
--    `account_rejected:<profile>`, which esme_queue_email() swallows on conflict.
--    With rejected -> pending_approval as a normal re-application path, that key would
--    silently suppress the second decision's mail. The key now carries the decision
--    timestamp, so a double click still produces one message (the transition trigger
--    and the row lock in esme_decide_registration() make a second identical update
--    impossible) while a genuinely later decision mails again.

create or replace function esme_email_on_account_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_committee text;
  -- Microseconds, not a formatted timestamp: an outbox key must not depend on DateStyle.
  v_at text := floor(extract(epoch from coalesce(new.decided_at, now())) * 1000000)::bigint::text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'active' then
    select name into v_committee from esme_committees where id = new.committee_id;
    perform esme_queue_email(
      'account_approved',
      new.id,
      jsonb_build_object('fullName', new.display_name, 'committeeName', v_committee),
      'account_approved:' || new.id::text || ':' || v_at
    );
    perform esme_notify_from_email(new.id, 'Account approved', 'You can sign in to the member workspace now.', null);
  elsif new.status = 'rejected' then
    perform esme_queue_email(
      'account_rejected',
      new.id,
      jsonb_build_object('fullName', new.display_name, 'reason', coalesce(new.rejection_reason, '')),
      'account_rejected:' || new.id::text || ':' || v_at
    );
    perform esme_notify_from_email(new.id, 'Application not approved', 'The review of your request is finished.', null);
  elsif new.status = 'suspended' then
    -- Suspension is an account-safety notice too. It reuses the rejection template's address
    -- resolution, keyed by the status change so one suspension mails once.
    perform esme_queue_email(
      'account_rejected',
      new.id,
      jsonb_build_object('fullName', new.display_name, 'reason', 'This account has been suspended.'),
      'account_suspended:' || new.id::text || ':' || v_at
    );
  end if;

  return new;
end;
$$;

-- 8. Say what the leftovers are for ----------------------------------------------

comment on type esme_account_status is
  'pending_email_verification is a retired value: Postgres cannot remove an enum label, so it '
  'stays in the type but is unreachable. Column defaults, both transition rules, the *_reachable '
  'check constraints and every write path refuse it.';

comment on column esme_profiles.email_verified is
  'Mirror of auth.users.email_confirmed_at, recorded for the operator. Informational only: since '
  '0007 nothing may gate on it. Proof of the address is Supabase Auth''s signup setting, not this column.';

comment on column esme_registration_requests.email_verified is
  'Copy of the profile mirror, kept for the queue view. Not a gate — see esme_profiles.email_verified.';

comment on column esme_profiles.status is
  'Server-side only. Guarded by the status transition trigger. A submitted request is '
  'pending_approval and is decidable immediately.';

commit;

-- After applying: a fresh signup lands in the queue as pending_approval, an administrator can
-- decide it without the applicant clicking anything, and the accepted or rejected mail goes out
-- once, from the profile status change. Re-run supabase/README's manual checks.
