-- ESME CU ERP — an account status decides *placement*, never whether you may enter
-- Apply after 0018_chat.sql. Forward-only: it adds two functions, redefines three, changes one policy,
-- and rewrites no row.
--
-- The rule this file implements
--   Authentication and directory status are separate questions. A credential that the provider
--   accepted opens the chapter; the status column records where that account sits in the roster and
--   what a reviewer has decided about it. Only the two sanctions — 'rejected' and 'suspended' — keep
--   an account out.
--
-- Why the trusted side had to change at all
--   0012 made a *new* signup 'active', so from the public form nobody waits for a reviewer. But the
--   database still answered every capability question with `esme_current_status() = 'active'`
--   (0002:163) and gave an empty capability array to any non-active identity (0007:259). A row left
--   in 'pending_approval' — an applicant from before 0012, or a profile the directory provisioned
--   for somebody who has not signed up yet — therefore passed the screen's check and arrived in a
--   workspace from which RLS refused everything. Removing the gate from the client alone would have
--   produced an empty shell rather than an admitted member, which is the failure this requirement is
--   about.
--
-- What is deliberately NOT changed here
--   * The capability matrix. Not one row of esme_role_capabilities moves: this file changes *when a
--     grant is honoured*, never *who holds which grant*. A member still holds no users.read,
--     registrations.decide, audit.read, settings.manage or cms.*; a Super Admin's set is untouched.
--   * The privileged-officer checks. esme_decide_registration() (0007:159), esme_assign_leader()
--     (0004:264, 0004:362), esme_award_bonus()/esme_issue_warning() (0006:345, 0006:866) and the chat
--     RPCs (0018) still demand that the acting account be 'active'. Those are eligibility rules for
--     holding a seat or taking a decision, not conditions of entry, and an account nobody has reviewed
--     should not be recording decisions. Consequence, stated plainly: a legacy privileged row still
--     parked in 'pending_approval' can sign in and read its own data, but its officer functions keep
--     answering ESME_UNAUTHORIZED until a Super Admin activates it. That is the safe direction and it
--     is what the reconciliation statement at the bottom is for.
--   * esme_chat_is_member() (0018:87) and the chat directory keep `= 'active'`, so internal chat stays
--     closed to a legacy unapproved account. Rewriting those four 0018 function bodies here would mean
--     copying them out of a file this project cannot execute against a server, for the benefit of rows
--     that one reviewed statement clears properly. Recorded as a known residual instead.
--   * Nothing is activated, deleted or edited. No UPDATE on esme_profiles, no DELETE anywhere. An
--     existing 'pending_approval' row keeps its value; only the reading of it changes.
--   * The 0009 privilege channel, the status-transition whitelist (0012) and esme_assign_role()
--     (0010) all stay exactly as they are. A browser still cannot write role or status.
--
-- Nothing in this file has been executed. There is no PostgreSQL in the authoring environment; the
-- behavioural proof is probes P47-P52 in supabase/probes/authorization_probes.sql on a staging
-- project, and the client half is proved by src/auth/noInternalApproval.test.tsx.

begin;

-- ================= 1. one definition of "this status may use the chapter" =================

/**
 * The only place the entry rule is written on the trusted side.
 *
 * It is `immutable`, not `stable`, because it reads nothing but its argument: every caller already
 * resolved the status, and this answers a question about it. Anything that should let an account in
 * or keep it out is added here and nowhere else — the failure mode this exists to prevent is the
 * rule living in five functions that drift apart, which is what happened to the privileged-role
 * list in 0002 (see 0010's note on `high_board`).
 *
 * 'pending_email_verification' is not in the admitted set on purpose. 0007 retired that stage and
 * repaired the rows; one that still carries it is a row this build cannot interpret, and an
 * uninterpretable status must fail closed. The frontend reaches the same conclusion through
 * `repairStoredStatus()` in src/domain/accountState.ts.
 */
create or replace function esme_status_grants_access(p_status esme_account_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('active', 'pending_approval')
$$;

comment on function esme_status_grants_access(esme_account_status) is
  'Entry rule, trusted side: which directory statuses let an authenticated account use the chapter. '
  'Only the two sanctions — rejected and suspended — keep an account out. Placement is a roster fact, '
  'not a permission. Authority is still whatever esme_role_capabilities grants to the role.';

-- ============ 2. capabilities follow the role, subject to that one rule ==================

/**
 * 0002's body with the status test replaced by the helper.
 *
 * Everything else is byte-for-byte: same capability lookup, same SECURITY DEFINER, same pinned
 * search_path. The `exists()` still returns false for a session with no profile row at all, because
 * esme_current_role() is then NULL and no matrix row matches a NULL role.
 */
create or replace function esme_has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from esme_role_capabilities rc
    where rc.role = esme_current_role()
      and rc.capability = p_capability
      and esme_status_grants_access(esme_current_status())
  )
$$;

comment on function esme_has_capability(text) is
  '0019 version: a capability is honoured for an account whose status is not a sanction. The matrix, '
  'the scopes and esme_reaches_profile()/esme_reaches_committee() are unchanged — they read through '
  'this function, so the entry rule has exactly one definition.';

/**
 * The matrix table itself is read through the same rule, so a screen that lists capabilities cannot
 * show a member one thing and grant it another.
 */
drop policy if exists esme_capabilities_read on esme_role_capabilities;

create policy esme_capabilities_read on esme_role_capabilities
  for select to authenticated
  using (esme_status_grants_access(esme_current_status()));

-- =================== 3. the identity response stops stripping ============================

-- A function's returned columns cannot be altered in place, so this is 0007's drop-and-recreate,
-- with the same two clauses and the same protection re-applied afterwards.
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
    case when esme_status_grants_access(p.status)
         then coalesce(array_agg(distinct rc.capability) filter (where rc.capability is not null), '{}')
         else '{}'
    end
  from esme_profiles p
  left join esme_role_capabilities rc on rc.role = p.role
  where p.id = p_user_id
    and (
      auth.role() = 'service_role'
      -- A session reads its own identity and gets the capabilities its role actually grants.
      -- Somebody else's row answers with none of that unless a reach check says otherwise, which is
      -- why the client resolves capabilities from the role it was handed rather than trusting this
      -- array: src/auth/supabaseAdapter.ts calls capabilitiesFor(row.role).
      or p.id = esme_current_profile_id()
    )
  group by p.id;
$$;

revoke all on function esme_identity(uuid) from anon;
revoke all on function esme_identity(uuid) from public;
grant execute on function esme_identity(uuid) to authenticated, service_role;

comment on function esme_identity(uuid) is
  '0019 version: the capability array is attached unless the account is under a sanction. The row it '
  'returns is the same row 0007 returned, and the visibility rule is unchanged — own row, or the '
  'service role.';

-- ======================= 4. recovering a profile that never appeared ======================

/**
 * Creates the caller's own chapter profile and answers whether one exists.
 *
 * This exists because of a specific failure: `esme_handle_new_auth_user()` is an AFTER INSERT
 * trigger on auth.users, and when it aborts — a username that collided, a re-run after a manual
 * backfill, a project where the trigger was never installed — the applicant is left with a working
 * credential and no profile row. The only reply the client could give was "ask an administrator to
 * complete it", which is a request to type SQL dressed up as advice to a student.
 *
 * Why this is recovery and not privilege:
 *   * It takes no argument. The id comes from auth.uid(), so a caller cannot name another account,
 *     and there is no parameter to forge.
 *   * role and status are constants in the insert — 'member' and 'active' — the same two values the
 *     signup trigger writes. A caller cannot ask to be anything else, and this is why the function is
 *     safe to hand to `authenticated`.
 *   * committee_id is never written here. Placement stays a reviewer's decision, so a self-recovered
 *     account lands with no committee and therefore no committee-scoped reach.
 *   * It refuses without a matching auth.users row. esme_profiles.id is a foreign key to
 *     auth.users(id), so an orphan cannot be created — and a row that already exists is answered, not
 *     overwritten, which makes the whole thing idempotent and safe to call from a retry.
 *   * It is SECURITY DEFINER, so the 0009 channel sees esme_called_directly() = false exactly the way
 *     0012's trigger does. A hand-made REST insert into esme_profiles is still refused: that table
 *     has no INSERT policy, and this function is the only definer path that writes it besides signup.
 *
 * What it does not do: recreate the esme_registration_requests row. That row is a placement request
 * the applicant made during signup, and writing one from stale auth metadata — an answer nobody has
 * re-confirmed since — would put a claim in front of a reviewer that the applicant never just made.
 * The account is usable without it; an officer who needs the request can record the placement
 * directly on the profile.
 */
create or replace function esme_ensure_own_profile()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_exists boolean;
  v_username text;
  v_candidate text;
  v_display text;
  v_attempt int;
begin
  if v_uid is null then
    raise exception 'ESME_NO_SESSION: there is no authenticated account to build a profile for'
      using hint = 'Sign in first; this function only ever writes the caller''s own row.';
  end if;

  select id, email, raw_user_meta_data, email_confirmed_at
    into v_user
  from auth.users
  where id = v_uid;

  if not found then
    -- The credential the client is holding is not in this project's auth schema. No insert is
    -- attempted: the foreign key would refuse it, and the reason would arrive as a constraint
    -- violation instead of this sentence.
    raise exception 'ESME_NO_AUTH_USER: this session does not belong to an account in this project';
  end if;

  select exists (select 1 from esme_profiles where id = v_uid) into v_exists;
  if v_exists then
    return true;
  end if;

  -- The same three-step repair 0012 applies, so a recovered row satisfies esme_profiles_username_fmt
  -- and the UNIQUE column instead of aborting the call: strip what the pattern forbids, pad a handle
  -- too short to pass, then walk off a collision with a suffix and finally with the id itself.
  v_username := lower(btrim(coalesce(nullif(btrim(coalesce(v_user.raw_user_meta_data ->> 'username', '')), ''),
                                     split_part(coalesce(v_user.email, ''), '@', 1))));
  v_username := regexp_replace(v_username, '[^a-z0-9._-]', '', 'g');
  v_username := regexp_replace(v_username, '^[._-]+', '', 'g');
  if char_length(v_username) < 3 then
    v_username := left(v_username || 'member', 30);
  end if;
  v_username := left(v_username, 30);

  v_candidate := v_username;
  v_attempt := 1;
  while exists (select 1 from esme_profiles where username = v_candidate) loop
    if v_attempt > 25 then
      v_candidate := left(v_username, 14) || '-' || left(replace(v_uid::text, '-', ''), 12);
      exit;
    end if;
    v_candidate := left(v_username, 30 - length(v_attempt::text) - 1) || '_' || v_attempt::text;
    v_attempt := v_attempt + 1;
  end loop;

  -- esme_profiles_name_len wants 3..120 characters of trimmed text.
  v_display := btrim(coalesce(nullif(btrim(coalesce(v_user.raw_user_meta_data ->> 'full_name', '')), ''),
                              initcap(split_part(coalesce(v_user.email, ''), '@', 1))));
  if char_length(v_display) < 3 then
    v_display := 'New member';
  end if;
  v_display := left(v_display, 120);

  insert into esme_profiles (id, email, username, display_name, role, status, email_verified)
  values (
    v_uid,
    lower(v_user.email),
    v_candidate,
    v_display,
    'member',                       -- never named by the caller
    'active',                       -- 0012's signup default, reproduced, not negotiated
    (v_user.email_confirmed_at is not null)
  )
  on conflict (id) do nothing;

  if not found then
    -- A concurrent call won the row. Its insert stands; this one reports the truth.
    return true;
  end if;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_uid, v_display, 'member', 'PROFILE_RECOVERED',
    'profile', v_uid::text,
    'Chapter profile created from the auth identity during sign-in; role member, no committee recorded'
  );

  return true;
end;
$$;

revoke all on function esme_ensure_own_profile() from anon;
revoke all on function esme_ensure_own_profile() from public;
grant execute on function esme_ensure_own_profile() to authenticated, service_role;

comment on function esme_ensure_own_profile() is
  'Idempotent self-recovery: creates the CALLER''S OWN esme_profiles row as an active member when the '
  'signup trigger did not run. Takes no argument, cannot name another account, cannot choose a role, '
  'never records a committee, and refuses without a matching auth.users row.';

-- ============ 5. the in-app notification stops describing a gate that no longer exists ====

/**
 * 0005 installs a trigger on esme_registration_requests that queues the 'account_created' mail and
 * mirrors it as an in-app notification titled "Application received / waiting for review". The mail is
 * rendered by supabase/functions/_shared/email.ts and is rewritten there; this is the notification,
 * which lives in SQL and is the only remaining place the trusted side tells a new member that
 * something must happen before they can enter.
 *
 * The function is recreated, not the trigger: same name, same firing table, same two calls, same
 * dedupe key, so the existing esme_email_registration_created trigger picks up the new body. Nothing
 * is queued twice and no row moves.
 */
create or replace function esme_email_on_registration_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform esme_queue_email(
    'account_created',
    new.profile_id,
    jsonb_build_object('fullName', new.full_name, 'reference', new.id::text),
    'account_created:' || new.id::text
  );
  perform esme_notify_from_email(
    new.profile_id,
    'Account created', 'You can sign in now. Your committee placement will be recorded later.', null
  );
  return new;
end;
$$;

comment on function esme_email_on_registration_request() is
  '0019 version: the notification a new applicant sees says the account works, because it does. The '
  'queue row and the mail event are the ones 0005 created.';

commit;

-- ============================== operator notes ============================================
--
-- Order matters if you apply this by hand.
--   esme_identity() is dropped and recreated in the same transaction, so a session that calls it
--   between the two statements is not possible; but this file must be applied whole, and after 0012.
--   Applying it to a project that has not run 0012 is coherent — a new signup then still lands in
--   'pending_approval' and this file is what makes that status usable — but it does not activate
--   anything, so 0012 is still the migration that ends the wait for a reviewer.
--
-- Reconciling the accounts that are already parked.
--   After this file, an existing 'pending_approval' account can sign in and read its own data as the
--   role it holds. Two things still require 'active': the officer functions listed at the top of this
--   file and internal chat. If the chapter has reviewed the queue and decided those accounts are
--   members, that is one deliberate statement, run only after reading the list:
--
--     -- opt-in, NOT part of this migration
--     begin;
--     select id, email, username, role, created_at from esme_profiles
--      where status = 'pending_approval' order by created_at;   -- read this first
--     update esme_profiles set status = 'active'
--      where status = 'pending_approval'
--        and role = 'member'
--        and id in (select profile_id from esme_registration_requests where agreed_to_policies);
--     commit;
--
--   It moves member rows only, only where the applicant accepted the policies, and leaves every
--   privileged and rejected row for a person. Nothing here deletes a status or a history row: the
--   audit trail and esme_profiles.decided_by keep recording what a reviewer did.
--
-- Probes that must pass on staging before this is called done (supabase/probes/authorization_probes.sql):
--   P47  a 'pending_approval' member row: esme_status_grants_access(status) is true,
--        esme_identity() returns its member capabilities, and esme_has_capability('tasks.read') is
--        true — while esme_has_capability('users.read') and ('registrations.decide') stay false.
--   P48  that same member calls esme_decide_registration() on any request -> ESME_UNAUTHORIZED, and
--        esme_assign_leader() -> ESME_UNAUTHORIZED. Privileged work still needs an active officer.
--   P49  a 'rejected' and a 'suspended' row: esme_status_grants_access() is false for both,
--        esme_identity() returns an empty capability array, and every capability-scoped select is
--        refused. The sanctions still mean what they say.
--   P50  esme_ensure_own_profile() with no session -> ESME_NO_SESSION; with a session whose profile
--        exists -> returns true and changes nothing (compare the row before and after, including
--        updated_at); called twice in a row -> one row, one audit line.
--   P51  esme_ensure_own_profile() for an auth user with no profile -> exactly one row,
--        role='member', status='active', committee_id IS NULL, and a username that satisfies
--        esme_profiles_username_fmt even when the requested handle was taken or too short.
--   P52  a hand-made REST request cannot reach the definer path: an anonymous or authenticated direct
--        INSERT into esme_profiles is refused (no INSERT policy), and `select esme_ensure_own_profile()`
--        run as another logged-in user creates only that user's own row.
