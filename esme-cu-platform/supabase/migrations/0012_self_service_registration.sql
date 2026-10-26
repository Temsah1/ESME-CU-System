-- ESME CU ERP — a registration opens the workspace without waiting for an administrator
-- Apply after 0011_registration_academic_fields.sql.
--
-- What changed, and what did NOT
--   Until now an applicant could create an account and still not sign in: esme_handle_new_auth_user()
--   wrote `status = 'pending_approval'` and nothing else could move the row except a reviewer calling
--   esme_decide_registration(). A new account now enters as `status = 'active'` with `role = 'member'`,
--   so signing up is enough to open the member workspace.
--
--   Only the access gate moved. The application review did not:
--     * esme_registration_requests is still created with `status = 'pending_approval'`, so the queue
--       still shows a reviewer an undecided application.
--     * Committee placement is still a reviewer's decision — esme_decide_registration('approve',
--       p_committee_id) is what writes esme_profiles.committee_id, and it is unchanged here.
--     * Rejection and suspension still work, which is why section 1 adds one transition.
--     * role is still forced to 'member'. Nothing in this file lets a signup choose a role, and
--       esme_assign_role() (0010) still requires super_admin for any privileged label.
--
--   Why 'active' costs no access: esme_has_capability() (0002:151) still refuses every capability for
--   a caller whose status is not 'active', so this is what newly activated members can reach. The
--   seeded matrix (0002:97-103, 0006:95) gives 'member' exactly committees.read(all), tasks.read(
--   committee), tasks.write(self), submissions.read(self), submissions.create(self), scores.read(self),
--   skills.read(self), rewards.read(self). There is no users.read, no registrations.read or .decide, no
--   audit.read, no cms.*, no settings.manage — and a tasks.read of `committee` scope resolves to
--   nothing at all until a reviewer assigns committee_id. The restricted member data therefore stays
--   closed, and RLS is what decides it, not this file's prose.
--
-- What this file does NOT do
--   * It does not touch the 0009 privilege-channel guard. esme_assert_privilege_channel() still
--     refuses a direct INSERT of any profile whose status is not 'pending_approval' from an API role;
--     esme_handle_new_auth_user() is SECURITY DEFINER, so esme_called_directly() (0004:159) is false
--     inside it and it was never subject to that branch. A hand-made REST insert still cannot create an
--     active profile, and esme_profiles still has no INSERT policy (0002:851).
--   * It does not activate anybody who already exists. Accounts sitting in 'pending_approval' stay
--     there for a reviewer — see the opt-in statement at the bottom. That is deliberate: a bulk update
--     here would open every stale or junk application at once, with no human having looked at any.
--   * It does not change Supabase Auth. "Confirm email" is a dashboard setting (see supabase/README.md
--     §Auth); this file only mirrors email_confirmed_at into email_verified as before.
--   * Nothing here has been executed against a project. There is no PostgreSQL in the authoring
--     environment; correctness is settled by probes P25-P29 on staging, not by this file.

begin;

-- ============ 1. a reviewer can still revoke an account that was never reviewed ====

/**
 * 0007's whitelist has no step out of 'active' except 'suspended', which was fine while only a
 * decision could produce 'active'. Now an applicant reaches 'active' by signing up, so the queue's
 * other answer — reject — starts from a status that had no way to reach 'rejected'. Without this
 * pair esme_decide_registration(..., 'reject') raises ESME_INVALID_STATUS_TRANSITION for every new
 * account, which would make this migration a one-way door. That is the opposite of removing a
 * control, so the pair is added rather than the guard being loosened any further.
 */
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
      -- 0012: an account that activated itself at signup is still revocable by a reviewer.
      ('active', 'rejected'),
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

-- ================== 2. the column default follows the new lifecycle =================

-- The trigger names the column, so this only matters for a path that omits it — esme_bootstrap_primary
-- _admin (0003) and esme_seed_test_accounts (0008) both state a status explicitly. Restating the
-- default keeps the schema from describing a lifecycle that no longer exists.
alter table esme_profiles
  alter column status set default 'active';

comment on column esme_profiles.status is
  'Server-side only. Guarded by the status transition trigger (0002, rewritten by 0007 and 0012) and by '
  'the 0009 privilege channel, which still refuses a direct status write from an API role. Since 0012 a '
  'self-registered account starts active; a reviewer can still reject or suspend it.';

comment on column esme_registration_requests.status is
  'The application, not the account. Still starts at pending_approval so the queue shows a reviewer a '
  'committee placement that has not been decided, even though the applicant can already sign in.';

-- ============ 3. signup initialises the account, idempotently, as an active member ====

/**
 * Three changes to 0011's body, and the reason for each:
 *
 * 1. status 'active'. The whole point of this file.
 *
 * 2. Idempotence. This is an AFTER INSERT trigger on auth.users, and every insert in 0011's version
 *    was bare. A second firing — a re-run of the trigger after a manual backfill, a replayed signup
 *    whose auth row was created while the transaction was still open — hit the esme_profiles primary
 *    key or the esme_registration_requests.profile_id unique index, and because a raised exception
 *    inside an AFTER trigger aborts the whole statement, the failure took the new auth user with it.
 *    That is the "account exists but the app says it does not" case, produced by the app's own retry.
 *    Each insert now answers the existing row instead of raising, and the function returns quietly if
 *    the profile is already there.
 *
 * 3. Username and display name are made to satisfy their own CHECKs before they are written.
 *    esme_profiles_username_fmt (0001:73) rejects a space, so the "Ahmed Khaled" typed into the form
 *    aborted the signup; the constraint needs at least 3 characters, so an address like ab@x.com
 *    aborted it too; and username is UNIQUE, so two students picking the same handle aborted the
 *    second one. Each of those surfaced to the applicant as "Registration is temporarily unavailable"
 *    with nothing for them to fix. They are cleaned, length-clamped and de-duplicated here instead.
 *    None of it touches authorization: role and status are still constants in this insert.
 */
create or replace function esme_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_membership text := lower(btrim(coalesce(meta ->> 'committee_membership', '')));
  v_requested uuid;
  v_second uuid;
  v_username text;
  v_display text;
  v_candidate text;
  v_attempt int;
  v_profile esme_profiles%rowtype;
  v_queue esme_registration_requests%rowtype;
begin
  -- Already initialised? Then this is a replay, not a new applicant. 0011 raised here and rolled
  -- back the auth user; a member who signs in again must never lose their row to a retry.
  select * into v_profile from esme_profiles where id = new.id;
  if found then
    return new;
  end if;

  -- Only 'yes' and 'no' are answers. Anything else is the question having never been asked, and it
  -- must reach the queue as NULL rather than trip esme_registration_membership_values.
  if v_membership not in ('yes', 'no') then
    v_membership := null;
  end if;

  v_requested := esme_committee_reference(meta ->> 'committee_id');
  v_second := esme_committee_reference(meta ->> 'second_committee_preference_id');

  -- src/domain/registration.ts resolveCommitteeAnswer(), on the trusted side this time.
  if v_membership = 'no' then
    v_requested := null;
    v_second := null;
  end if;

  -- esme_profiles_username_fmt: ^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$, lowercased the way the
  -- frontend's normalizeUsername() lowercases it so the two never disagree about who owns a handle.
  v_username := lower(btrim(coalesce(nullif(btrim(coalesce(meta ->> 'username', '')), ''),
                                     split_part(coalesce(new.email, ''), '@', 1))));
  v_username := regexp_replace(v_username, '[^a-z0-9._-]', '', 'g');
  v_username := regexp_replace(v_username, '^[._-]+', '', 'g');
  if char_length(v_username) < 3 then
    v_username := left(v_username || 'member', 30);
  end if;
  v_username := left(v_username, 30);

  -- A handle somebody already holds is not a reason to refuse this applicant. Short numeric
  -- suffixes first so a common name stays readable; the id itself is the last resort, and it is
  -- unique because it is the primary key of the row being inserted.
  v_candidate := v_username;
  v_attempt := 1;
  while exists (select 1 from esme_profiles where username = v_candidate) loop
    if v_attempt > 25 then
      v_candidate := left(v_username, 14) || '-' || left(replace(new.id::text, '-', ''), 12);
      exit;
    end if;
    v_candidate := left(v_username, 30 - length(v_attempt::text) - 1) || '_' || v_attempt::text;
    v_attempt := v_attempt + 1;
  end loop;
  v_username := v_candidate;

  -- esme_profiles_name_len: 3..120 characters of btrim'd text.
  v_display := btrim(coalesce(nullif(btrim(coalesce(meta ->> 'full_name', '')), ''),
                              initcap(split_part(coalesce(new.email, ''), '@', 1))));
  if char_length(v_display) < 3 then
    v_display := 'New member';
  end if;
  v_display := left(v_display, 120);

  insert into esme_profiles (
    id, email, username, display_name, role, status, email_verified,
    student_id, academic_year, department, phone
  ) values (
    new.id,
    lower(new.email),
    v_username,
    v_display,
    'member',   -- public registration cannot choose a role, High Board included
    'active',   -- 0012: signing up is enough to open the member workspace
    (new.email_confirmed_at is not null),  -- mirrored, never a gate
    nullif(btrim(coalesce(meta ->> 'student_id', '')), ''),
    nullif(btrim(coalesce(meta ->> 'academic_year', '')), ''),
    nullif(btrim(coalesce(meta ->> 'department', '')), ''),
    nullif(btrim(coalesce(meta ->> 'phone', '')), '')
  )
  on conflict (id) do nothing
  returning * into v_profile;

  if v_profile.id is null then
    -- A concurrent first insert won the race and this transaction must not duplicate the queue row
    -- or the audit entry for it. The winner already wrote both.
    return new;
  end if;

  -- The application waits for a placement decision even though the account is already usable.
  insert into esme_registration_requests (
    profile_id, full_name, email, username,
    requested_committee_id, second_committee_preference_id,
    student_id, academic_year, department, phone, committee_membership,
    technical_skills, previous_experience, motivation, availability_hours,
    agreed_to_policies, email_verified, status
  ) values (
    v_profile.id, v_profile.display_name, v_profile.email, v_profile.username,
    v_requested, v_second,
    v_profile.student_id, v_profile.academic_year, v_profile.department, v_profile.phone,
    v_membership,
    coalesce(meta ->> 'technical_skills', ''),
    coalesce(meta ->> 'previous_experience', ''),
    coalesce(meta ->> 'motivation', ''),
    coalesce(meta ->> 'availability_hours', ''),
    coalesce((meta ->> 'accepted_policies')::boolean, false),
    v_profile.email_verified,
    'pending_approval'
  )
  on conflict (profile_id) do nothing
  returning * into v_queue;

  if v_queue.id is null then
    return new;
  end if;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_profile.id, v_profile.display_name, 'member', 'REGISTRATION_SUBMITTED',
    'registration', v_profile.id::text,
    'New registration: account active as a member, application waiting for a committee placement'
  );

  return new;
end;
$$;

comment on function esme_handle_new_auth_user() is
  '0012 version: self-registered accounts enter as active members (role still forced to member), the '
  'application row still enters the queue as pending_approval, the initialization is idempotent, and a '
  'username or display name that cannot satisfy its own CHECK is repaired instead of aborting the signup.';

commit;

-- ============================== operator notes ====
--
-- Existing applicants are untouched.
--   Accounts already sitting in 'pending_approval' stay there and still need a reviewer, exactly as
--   before. If the chapter decides every one of them should be let in, that is a separate, deliberate
--   statement — run it only after reading the queue, because it includes applications nobody has
--   looked at and any test rows still lying around:
--
--     -- opt-in, NOT part of this migration
--     update esme_profiles set status = 'active'
--      where status = 'pending_approval'
--        and id in (select profile_id from esme_registration_requests
--                   where status = 'pending_approval' and agreed_to_policies);
--
--   esme_decide_registration() still works on any of them: an approve decision on an already-active
--   profile changes nothing about status (the transition trigger is a no-op when status does not move)
--   and still records the committee placement, the decided_by stamp and the notification.
--
-- The email that used to announce activation.
--   esme_email_on_account_decision() (0007:287) fires on a status change, so an account that arrives
--   already active gets no "your account was approved" mail when a reviewer later places it in a
--   committee. The in-app notification still lands, and the placement mail is what that reviewer's
--   decision should mean; if the chapter wants a welcome mail, it belongs in a separate trigger on
--   profile insert, not in re-using the decision one.
--
-- Probes that must pass on staging before this is called done (supabase/probes/authorization_probes.sql):
--   P25  signup from the public form -> esme_profiles row with role='member', status='active', and a
--        matching esme_registration_requests row with status='pending_approval' and no
--        assigned_committee_id. esme_identity() answers for that account, so it can sign in with no
--        reviewer involved.
--   P26  that same active member holds no privileged capability — no users.read, registrations.read,
--        registrations.decide, audit.read, settings.manage or cms.settings.global — and
--        esme_reaches_profile() still refuses it another member's row.
--   P27  the same member tries `update esme_profiles set role='super_admin'` and sets its own status
--        -> both refused by the 0009 channel, and it calling esme_decide_registration() on its own
--        application -> ESME_FORBIDDEN.
--   P28  a reviewer rejects an account created after this migration -> succeeds instead of raising
--        ESME_INVALID_STATUS_TRANSITION, and that account can no longer sign in.
--   P29  an account that was already 'pending_approval' before this migration is still pending after
--        it: this file activates nobody who already exists.
