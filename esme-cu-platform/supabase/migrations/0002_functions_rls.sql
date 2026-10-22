-- ESME CU ERP — capability matrix, server-side functions, triggers, RLS
-- Apply after 0001_schema.sql.
--
-- Every authorization decision in this file is the one the product enforces.
-- src/domain/roles.ts is a mirror used for UI affordances and tests; where the two
-- disagree, this file wins because it runs inside the database session.

begin;

-- ===================================================== capability matrix ====

insert into esme_role_capabilities (role, capability, scope) values
  -- super_admin
  ('super_admin', 'users.read', 'all'),
  ('super_admin', 'users.create', 'all'),
  ('super_admin', 'users.update', 'all'),
  ('super_admin', 'users.delete', 'all'),
  ('super_admin', 'users.role.assign', 'all'),
  ('super_admin', 'users.suspend', 'all'),
  ('super_admin', 'registrations.read', 'all'),
  ('super_admin', 'registrations.decide', 'all'),
  ('super_admin', 'committees.read', 'all'),
  ('super_admin', 'committees.write', 'all'),
  ('super_admin', 'committees.archive', 'all'),
  ('super_admin', 'tasks.read', 'all'),
  ('super_admin', 'tasks.write', 'all'),
  ('super_admin', 'tasks.assign', 'all'),
  ('super_admin', 'tasks.delete', 'all'),
  ('super_admin', 'submissions.read', 'all'),
  ('super_admin', 'submissions.review', 'all'),
  ('super_admin', 'submissions.create', 'self'),
  ('super_admin', 'scores.read', 'all'),
  ('super_admin', 'scores.adjust', 'all'),
  ('super_admin', 'events.read', 'all'),
  ('super_admin', 'events.write', 'all'),
  ('super_admin', 'skills.read', 'all'),
  ('super_admin', 'skills.manage', 'all'),
  ('super_admin', 'analytics.configure', 'all'),
  ('super_admin', 'cms.settings.global', 'all'),
  ('super_admin', 'cms.content.write', 'all'),
  ('super_admin', 'cms.content.publish', 'all'),
  ('super_admin', 'cms.media.manage', 'all'),
  ('super_admin', 'notifications.manage', 'all'),
  ('super_admin', 'audit.read', 'all'),
  ('super_admin', 'settings.manage', 'all'),
  ('super_admin', 'integrations.manage', 'all'),
  ('super_admin', 'backups.manage', 'all'),
  -- moderator — registration queue and content, never role grants or platform settings
  ('moderator', 'users.read', 'all'),
  ('moderator', 'registrations.read', 'all'),
  ('moderator', 'registrations.decide', 'all'),
  ('moderator', 'committees.read', 'all'),
  ('moderator', 'tasks.read', 'all'),
  ('moderator', 'submissions.read', 'all'),
  ('moderator', 'submissions.review', 'all'),
  ('moderator', 'scores.read', 'all'),
  ('moderator', 'events.read', 'all'),
  ('moderator', 'cms.settings.global', 'all'),
  ('moderator', 'cms.content.write', 'all'),
  ('moderator', 'cms.content.publish', 'all'),
  ('moderator', 'cms.media.manage', 'all'),
  ('moderator', 'notifications.manage', 'all'),
  ('moderator', 'audit.read', 'all'),
  -- director — authority confined to one committee
  ('director', 'users.read', 'committee'),
  ('director', 'users.update', 'committee'),
  ('director', 'registrations.read', 'committee'),
  ('director', 'committees.read', 'all'),
  ('director', 'committees.write', 'committee'),
  ('director', 'tasks.read', 'all'),
  ('director', 'tasks.write', 'committee'),
  ('director', 'tasks.assign', 'committee'),
  ('director', 'submissions.read', 'committee'),
  ('director', 'submissions.review', 'committee'),
  ('director', 'submissions.create', 'self'),
  ('director', 'scores.read', 'committee'),
  ('director', 'events.read', 'all'),
  ('director', 'events.write', 'committee'),
  ('director', 'skills.read', 'committee'),
  ('director', 'skills.manage', 'committee'),
  ('director', 'analytics.configure', 'committee'),
  ('director', 'cms.content.write', 'committee'),
  -- head — same committee shape, fewer levers
  ('head', 'users.read', 'committee'),
  ('head', 'committees.read', 'all'),
  ('head', 'tasks.read', 'all'),
  ('head', 'tasks.write', 'committee'),
  ('head', 'tasks.assign', 'committee'),
  ('head', 'submissions.read', 'committee'),
  ('head', 'submissions.review', 'committee'),
  ('head', 'submissions.create', 'self'),
  ('head', 'scores.read', 'committee'),
  ('head', 'events.read', 'all'),
  ('head', 'skills.read', 'committee'),
  ('head', 'cms.content.write', 'committee'),
  -- member — no administrative capability at all
  ('member', 'committees.read', 'all'),
  ('member', 'tasks.read', 'committee'),
  ('member', 'tasks.write', 'self'),
  ('member', 'submissions.read', 'self'),
  ('member', 'submissions.create', 'self'),
  ('member', 'scores.read', 'self'),
  ('member', 'skills.read', 'self');

-- ============================================ identity helpers (definer) ====
-- SECURITY DEFINER so a caller cannot read another profile to discover its role,
-- and cannot widen these functions by granting themselves rows.

create or replace function esme_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid()
$$;

create or replace function esme_current_role()
returns esme_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from esme_profiles p where p.id = esme_current_profile_id()
$$;

create or replace function esme_current_status()
returns esme_account_status
language sql
stable
security definer
set search_path = public
as $$
  select p.status from esme_profiles p where p.id = esme_current_profile_id()
$$;

create or replace function esme_current_committee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.committee_id
  from esme_profiles p
  where p.id = esme_current_profile_id()
$$;

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
      and esme_current_status() = 'active'
  )
$$;

create or replace function esme_capability_scope(p_capability text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rc.scope
  from esme_role_capabilities rc
  where rc.role = esme_current_role() and rc.capability = p_capability
$$;

/** Row-level test used by policies: does the current actor reach this profile? */
create or replace function esme_reaches_profile(p_target uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case esme_capability_scope(p_capability)
    when 'all' then true
    when 'self' then p_target = esme_current_profile_id()
    when 'committee' then
      p_target is not null and (
        p_target = esme_current_profile_id()
        or (
          esme_current_committee_id() is not null
          and exists (
            select 1 from esme_profiles t
            where t.id = p_target and t.committee_id = esme_current_committee_id()
          )
        )
      )
    else false
  end
  and esme_has_capability(p_capability)
$$;

create or replace function esme_reaches_committee(p_committee uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case esme_capability_scope(p_capability)
    when 'all' then true
    when 'committee' then p_committee = esme_current_committee_id()
    else false
  end
  and esme_has_capability(p_capability)
$$;

/**
 * The primary administrator, identified by the credential stored on the profile row.
 * Ownership of that mailbox is proven by the auth provider, not by this check;
 * the list here only decides which row is protected from demotion and deletion.
 */
create or replace function esme_is_primary_admin(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from esme_profiles
    where id = p_profile
      and role = 'super_admin'
      and (email = 'kareemeltemsah7@gmail.com' or username = 'temsah1')
  )
$$;

-- ============================================================= triggers ====

create or replace function esme_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger esme_profiles_touch
  before update on esme_profiles
  for each row execute function esme_touch_updated_at();

create trigger esme_committees_touch
  before update on esme_committees
  for each row execute function esme_touch_updated_at();

create trigger esme_tasks_touch
  before update on esme_tasks
  for each row execute function esme_touch_updated_at();

create trigger esme_pages_touch
  before update on esme_content_pages
  for each row execute function esme_touch_updated_at();

-- Publishing is a different privilege from editing, and a row level security policy cannot express
-- that rule by itself: WITH CHECK is evaluated against the row as it is about to be stored, with no
-- access to the row as it was. `old` is a trigger variable, so the `published = old.published` this
-- guard replaces was never a rule — it is a parse error (column "old" does not exist) that would
-- have aborted this whole migration. Comparing the two versions belongs in a trigger.
create or replace function esme_assert_publication_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  touches_publication boolean;
begin
  -- esme_has_capability() reads the signed-in profile, which an operator session does not have: the
  -- service role, and the SQL editor's postgres session, are the paths 0003 and 0008 are built on.
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;
  if esme_has_capability('cms.content.publish') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    touches_publication := new.published is distinct from old.published
                        or new.published_at is distinct from old.published_at
                        or new.published_by is distinct from old.published_by;
  else
    -- Inserting an already-published row would reach the same privilege by a different route.
    touches_publication := new.published or new.published_at is not null or new.published_by is not null;
  end if;
  if touches_publication then
    raise exception 'ESME_FORBIDDEN: published, published_at and published_by need the cms.content.publish capability'
      using hint = 'Edit the content with cms.content.write; publish it from a session that holds cms.content.publish.';
  end if;
  return new;
end;
$$;

create trigger esme_pages_publication_guard
  before insert or update on esme_content_pages
  for each row execute function esme_assert_publication_write();

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
      ('pending_email_verification', 'pending_approval'),
      ('pending_email_verification', 'rejected'),
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
    if new.status = 'active' and not new.email_verified then
      raise exception 'ESME_EMAIL_NOT_VERIFIED: approval requires a verified address';
    end if;
  end if;
  return new;
end;
$$;

create trigger esme_profiles_status_guard
  before update on esme_profiles
  for each row execute function esme_assert_status_transition();

create or replace function esme_protect_primary_admin()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and esme_is_primary_admin(old.id) then
    raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin cannot be deleted';
  end if;
  if tg_op = 'UPDATE' and esme_is_primary_admin(old.id) then
    if new.status <> 'active' then
      raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin cannot be suspended';
    end if;
    if new.role <> 'super_admin' then
      raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin cannot be demoted';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger esme_profiles_primary_guard
  before update or delete on esme_profiles
  for each row execute function esme_protect_primary_admin();

/** Audit rows are append-only, even for a Super Admin. */
create or replace function esme_audit_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ESME_AUDIT_IMMUTABLE: audit records cannot be modified or removed';
end;
$$;

create trigger esme_audit_no_update
  before update on esme_audit_log
  for each row execute function esme_audit_is_append_only();

create trigger esme_audit_no_delete
  before delete on esme_audit_log
  for each row execute function esme_audit_is_append_only();

/**
 * A signed-up identity becomes a pending request, never an active member.
 * Role and status are forced here regardless of what the client submitted.
 */
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
    'member',                          -- public registration cannot choose a role
    'pending_email_verification',      -- approval happens later, by an authorized reviewer
    coalesce(new.email_confirmed_at is not null, false)
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

create trigger esme_on_auth_user_created
  after insert on auth.users
  for each row execute function esme_handle_new_auth_user();

/** Keep the queue and the profile in step as verification and decisions land. */
create or replace function esme_sync_registration_request()
returns trigger
language plpgsql
as $$
begin
  update esme_registration_requests r
     set email_verified = new.email_verified,
         status = new.status,
         decided_by = case when new.decided_at is not null then new.decided_by else r.decided_by end,
         decided_at = coalesce(new.decided_at, r.decided_at),
         rejection_reason = coalesce(new.rejection_reason, r.rejection_reason)
   where r.profile_id = new.id;
  return new;
end;
$$;

create trigger esme_profiles_sync_queue
  after update of status, email_verified on esme_profiles
  for each row execute function esme_sync_registration_request();

-- ================================================== read-side projection ====

/**
 * The identity the browser is allowed to know. Everything here is derived from
 * rows in this database; the client supplies only the session token.
 */
create or replace function esme_identity(p_user_id uuid)
returns table (
  id uuid,
  email text,
  username text,
  display_name text,
  role esme_role,
  status esme_account_status,
  email_verified boolean,
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
    p.email_verified,
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

-- ======================================================= admin operations ====

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
  if v_request.status not in ('pending_email_verification', 'pending_approval') then
    raise exception 'ESME_ALREADY_DECIDED: request % is %', p_request_id, v_request.status;
  end if;

  if esme_is_primary_admin(v_request.profile_id) then
    raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin is not in the approval queue';
  end if;

  if p_decision = 'approve' then
    if not v_request.email_verified then
      raise exception 'ESME_EMAIL_NOT_VERIFIED: verification must complete before approval';
    end if;
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

create or replace function esme_set_account_status(p_user_id uuid, p_status esme_account_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_target esme_profiles%rowtype;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if not esme_has_capability('users.suspend') then
    raise exception 'ESME_FORBIDDEN: this role cannot change account status';
  end if;
  select * into v_target from esme_profiles where id = p_user_id for update;
  if v_target.id is null then
    raise exception 'ESME_NOT_FOUND: profile';
  end if;
  if p_user_id = v_actor.id and p_status <> 'active' then
    raise exception 'ESME_SELF_LOCKOUT: you cannot lock your own account';
  end if;
  if esme_is_primary_admin(p_user_id) then
    raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin cannot be suspended';
  end if;

  update esme_profiles set status = p_status, decided_by = v_actor.id, decided_at = now()
    where id = p_user_id;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'ACCOUNT_STATUS_' || upper(p_status::text),
          'profile', p_user_id::text, v_target.email::text);
end;
$$;

/**
 * Role changes: the only write path for privilege. Mirrors validateRoleChange()
 * in src/domain/roles.ts — same rules, checked where they actually bind.
 */
create or replace function esme_assign_role(p_user_id uuid, p_role esme_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_target esme_profiles%rowtype;
  v_privileged boolean;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  select * into v_target from esme_profiles where id = p_user_id for update;
  if v_target.id is null then
    raise exception 'ESME_NOT_FOUND: profile';
  end if;

  if not esme_has_capability('users.role.assign') then
    raise exception 'ESME_FORBIDDEN: only a Super Admin may change roles';
  end if;
  if esme_is_primary_admin(p_user_id) and (p_role <> 'super_admin' or p_user_id <> v_actor.id) then
    raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin profile is read-only';
  end if;

  v_privileged := p_role in ('super_admin', 'director', 'head', 'moderator');
  if v_privileged and v_actor.role <> 'super_admin' then
    raise exception 'ESME_FORBIDDEN: only a Super Admin may grant a privileged role';
  end if;

  update esme_profiles set role = p_role where id = p_user_id;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'ROLE_ASSIGNED_' || upper(p_role::text),
          'profile', p_user_id::text, v_target.email::text);
end;
$$;

/** Awarding is a ledger write with an idempotency key, not an editable number. */
create or replace function esme_record_review(
  p_submission_id uuid,
  p_decision text,
  p_feedback text,
  p_awarded_points integer default null,
  p_idempotency_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission esme_submissions%rowtype;
  v_task esme_tasks%rowtype;
  v_actor esme_profiles%rowtype;
  v_points integer;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();

  select * into v_submission from esme_submissions where id = p_submission_id for update;
  if v_submission.id is null then
    raise exception 'ESME_NOT_FOUND: submission';
  end if;
  select * into v_task from esme_tasks where id = v_submission.task_id;

  if not esme_reaches_profile(v_submission.profile_id, 'submissions.review') then
    raise exception 'ESME_FORBIDDEN: you may not review this submission';
  end if;
  if v_submission.status = 'approved' then
    raise exception 'ESME_ALREADY_REVIEWED: points were already awarded for this submission';
  end if;

  v_points := case
    when p_decision = 'approved' then coalesce(p_awarded_points, v_submission.proposed_points, v_task.points)
    else 0
  end;

  update esme_submissions
     set status = p_decision,
         reviewer_feedback = p_feedback,
         reviewed_by = v_actor.id,
         reviewed_at = now(),
         awarded_points = v_points
   where id = p_submission_id;

  update esme_tasks set status = case p_decision
    when 'approved' then 'approved'::esme_task_status
    when 'rejected' then 'rejected'::esme_task_status
    else 'revision_requested'::esme_task_status
  end where id = v_task.id;

  if p_decision = 'approved' and v_points > 0 then
    insert into esme_score_ledger (
      profile_id, committee_id, task_id, submission_id, points, action_type, reason, recorded_by, idempotency_key
    ) values (
      v_submission.profile_id, v_task.committee_id, v_task.id, v_submission.id, v_points,
      'task_completion', 'Approved deliverable: ' || v_task.title, v_actor.id, p_idempotency_key
    )
    on conflict (idempotency_key) do nothing;
  end if;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'SUBMISSION_' || upper(p_decision),
          'submission', p_submission_id::text, format('%+d points', v_points));
end;
$$;

create or replace function esme_adjust_score(
  p_profile_id uuid,
  p_points integer,
  p_reason text,
  p_action esme_score_action default 'manual_adjustment',
  p_idempotency_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if not esme_has_capability('scores.adjust') then
    raise exception 'ESME_FORBIDDEN: only a Super Admin may adjust scores';
  end if;
  if not esme_reaches_profile(p_profile_id, 'scores.read') then
    raise exception 'ESME_FORBIDDEN: that member is outside your scope';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'ESME_VALIDATION: a score adjustment needs a written reason';
  end if;

  insert into esme_score_ledger (profile_id, committee_id, points, action_type, reason, recorded_by, idempotency_key)
  values (
    p_profile_id,
    (select committee_id from esme_profiles where id = p_profile_id),
    p_points, p_action, p_reason, v_actor.id, p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'SCORE_ADJUSTED', 'score',
          p_profile_id::text, format('%+d points — %s', p_points, p_reason));
end;
$$;

revoke all on function esme_decide_registration(uuid, esme_decision, text, uuid) from anon;
revoke all on function esme_set_account_status(uuid, esme_account_status) from anon;
revoke all on function esme_assign_role(uuid, esme_role) from anon;
revoke all on function esme_record_review(uuid, text, text, integer, text) from anon;
revoke all on function esme_adjust_score(uuid, integer, text, esme_score_action, text) from anon;

grant execute on function esme_decide_registration(uuid, esme_decision, text, uuid) to authenticated;
grant execute on function esme_set_account_status(uuid, esme_account_status) to authenticated;
grant execute on function esme_assign_role(uuid, esme_role) to authenticated;
grant execute on function esme_record_review(uuid, text, text, integer, text) to authenticated;
grant execute on function esme_adjust_score(uuid, integer, text, esme_score_action, text) to authenticated;

-- ================================================================== RLS ====

alter table esme_profiles enable row level security;
alter table esme_committees enable row level security;
alter table esme_committee_memberships enable row level security;
alter table esme_registration_requests enable row level security;
alter table esme_content_pages enable row level security;
alter table esme_content_revisions enable row level security;
alter table esme_settings enable row level security;
alter table esme_media enable row level security;
alter table esme_season_events enable row level security;
alter table esme_tasks enable row level security;
alter table esme_task_assignments enable row level security;
alter table esme_submissions enable row level security;
alter table esme_score_ledger enable row level security;
alter table esme_skill_matrix enable row level security;
alter table esme_kpi_targets enable row level security;
alter table esme_notifications enable row level security;
alter table esme_audit_log enable row level security;
alter table esme_registration_fields enable row level security;
alter table esme_role_capabilities enable row level security;

-- No anonymous traffic reads operational data. The public site reads published
-- content only, through the explicit policies below.

create policy esme_profiles_self on esme_profiles
  for select to authenticated
  using (id = esme_current_profile_id() or esme_reaches_profile(id, 'users.read'));

create policy esme_profiles_update on esme_profiles
  for update to authenticated
  using (
    id = esme_current_profile_id()
    -- A profile edit may not smuggle a role or status change: those columns are
    -- re-checked against the pre-update row.
    and role = esme_current_role()
    or esme_reaches_profile(id, 'users.update')
  )
  with check (
    esme_reaches_profile(id, 'users.update')
    or (
      id = esme_current_profile_id()
      and role = esme_current_role()
      and status = esme_current_status()
    )
  );

-- Creation and role/status changes are function-only. There is deliberately no
-- insert or unrestricted update policy on esme_profiles.

create policy esme_committees_read on esme_committees
  for select to authenticated, anon
  using (is_public or esme_has_capability('committees.read'));

create policy esme_committees_write on esme_committees
  for insert to authenticated
  with check (esme_has_capability('committees.write'));

create policy esme_committees_update on esme_committees
  for update to authenticated
  using (esme_reaches_committee(id, 'committees.write'))
  with check (esme_reaches_committee(id, 'committees.write'));

create policy esme_committees_archive on esme_committees
  for delete to authenticated
  using (esme_has_capability('committees.archive'));

create policy esme_memberships_read on esme_committee_memberships
  for select to authenticated
  using (esme_reaches_profile(profile_id, 'users.read') or esme_reaches_committee(committee_id, 'committees.read'));

create policy esme_memberships_write on esme_committee_memberships
  for all to authenticated
  using (esme_has_capability('committees.write'))
  with check (esme_has_capability('committees.write'));

create policy esme_queue_read on esme_registration_requests
  for select to authenticated
  using (esme_has_capability('registrations.read'));

-- The queue is written only by the signup trigger and the decision functions.

create policy esme_pages_public_read on esme_content_pages
  for select to anon, authenticated
  using (published);

create policy esme_pages_editor_read on esme_content_pages
  for select to authenticated
  using (esme_has_capability('cms.content.write'));

create policy esme_pages_write on esme_content_pages
  for insert to authenticated
  with check (esme_has_capability('cms.content.write'));

create policy esme_pages_update on esme_content_pages
  for update to authenticated
  using (esme_has_capability('cms.content.write'))
  -- Only the capability is checkable here. The rule that an editor may not flip `published` or
  -- rewrite publication metadata lives in esme_pages_publication_guard above, which can compare the
  -- row before and after; a policy sees only the after.
  with check (esme_has_capability('cms.content.write'));

create policy esme_pages_delete on esme_content_pages
  for delete to authenticated
  using (esme_has_capability('cms.settings.global'));

create policy esme_revisions_read on esme_content_revisions
  for select to authenticated
  using (esme_has_capability('cms.content.write'));

create policy esme_revisions_write on esme_content_revisions
  for insert to authenticated
  with check (esme_has_capability('cms.content.write'));

create policy esme_settings_global on esme_settings
  for all to authenticated
  using (esme_has_capability('cms.settings.global'))
  with check (esme_has_capability('cms.settings.global'));

create policy esme_media_read on esme_media
  for select to anon, authenticated
  using (is_public or esme_has_capability('cms.media.manage'));

create policy esme_media_write on esme_media
  for all to authenticated
  using (esme_has_capability('cms.media.manage'))
  with check (esme_has_capability('cms.media.manage'));

create policy esme_events_read on esme_season_events
  for select to anon, authenticated
  using (is_public or esme_has_capability('events.read'));

create policy esme_events_write on esme_season_events
  for all to authenticated
  using (esme_has_capability('events.write'))
  with check (esme_has_capability('events.write'));

create policy esme_tasks_read on esme_tasks
  for select to authenticated
  using (esme_reaches_committee(committee_id, 'tasks.read'));

create policy esme_tasks_write on esme_tasks
  for insert to authenticated
  with check (esme_reaches_committee(committee_id, 'tasks.write'));

create policy esme_tasks_update on esme_tasks
  for update to authenticated
  using (esme_reaches_committee(committee_id, 'tasks.write'))
  with check (esme_reaches_committee(committee_id, 'tasks.write'));

create policy esme_tasks_delete on esme_tasks
  for delete to authenticated
  using (esme_has_capability('tasks.delete'));

create policy esme_assignments_read on esme_task_assignments
  for select to authenticated
  using (
    exists (select 1 from esme_tasks t where t.id = task_id and esme_reaches_committee(t.committee_id, 'tasks.read'))
    or profile_id = esme_current_profile_id()
  );

create policy esme_assignments_write on esme_task_assignments
  for all to authenticated
  using (
    exists (select 1 from esme_tasks t where t.id = task_id and esme_reaches_committee(t.committee_id, 'tasks.assign'))
  )
  with check (
    exists (select 1 from esme_tasks t where t.id = task_id and esme_reaches_committee(t.committee_id, 'tasks.assign'))
  );

create policy esme_submissions_read on esme_submissions
  for select to authenticated
  using (profile_id = esme_current_profile_id() or esme_reaches_profile(profile_id, 'submissions.read'));

create policy esme_submissions_create on esme_submissions
  for insert to authenticated
  with check (
    profile_id = esme_current_profile_id()
    and esme_has_capability('submissions.create')
  );

create policy esme_submissions_update on esme_submissions
  for update to authenticated
  using (esme_reaches_profile(profile_id, 'submissions.review'))
  with check (esme_reaches_profile(profile_id, 'submissions.review'));

-- Ledger rows are inserted by functions; reads follow scores.read scope.
create policy esme_ledger_read on esme_score_ledger
  for select to authenticated
  using (esme_reaches_profile(profile_id, 'scores.read'));

create policy esme_ledger_write on esme_score_ledger
  for insert to authenticated
  with check (esme_has_capability('scores.adjust'));

create policy esme_skills_read on esme_skill_matrix
  for select to authenticated
  using (esme_reaches_profile(profile_id, 'skills.read'));

create policy esme_skills_write on esme_skill_matrix
  for all to authenticated
  using (esme_reaches_profile(profile_id, 'skills.manage'))
  with check (esme_reaches_profile(profile_id, 'skills.manage'));

create policy esme_kpi_read on esme_kpi_targets
  for select to authenticated
  using (esme_has_capability('events.read'));

create policy esme_kpi_write on esme_kpi_targets
  for all to authenticated
  using (esme_has_capability('analytics.configure'))
  with check (esme_has_capability('analytics.configure'));

create policy esme_notifications_own on esme_notifications
  for select to authenticated
  using (profile_id = esme_current_profile_id() or esme_has_capability('notifications.manage'));

create policy esme_notifications_write on esme_notifications
  for all to authenticated
  using (profile_id = esme_current_profile_id() or esme_has_capability('notifications.manage'))
  with check (profile_id = esme_current_profile_id() or esme_has_capability('notifications.manage'));

create policy esme_audit_read on esme_audit_log
  for select to authenticated
  using (esme_has_capability('audit.read'));

-- Audit has no insert/update/delete policy for authenticated users: the log is
-- written by the definer functions above.

create policy esme_fields_public_read on esme_registration_fields
  for select to anon, authenticated
  using (enabled);

create policy esme_fields_write on esme_registration_fields
  for all to authenticated
  using (esme_has_capability('cms.settings.global'))
  with check (esme_has_capability('cms.settings.global'));

-- The matrix itself is read-only to the app; only a migration may change it.
create policy esme_capabilities_read on esme_role_capabilities
  for select to authenticated
  using (esme_current_status() = 'active');

-- Views run with the caller's rights, so RLS above already applies.
grant select on esme_member_scores, esme_committee_rosters to authenticated;

commit;
