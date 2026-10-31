-- ESME CU ERP — committee leadership becomes a membership relation
-- Apply after 0019_status_grants_access.sql.
--
-- 0004 modelled leadership as one seat per (committee, position): the primary key of
-- esme_leadership_seats was (committee_id, position), and a unique index on profile_id
-- said one person could lead only one committee. That shape makes "two Heads" or "four
-- Directors" impossible: the second appointment overwrites the first, and the database
-- refuses it even if the interface tried.
--
-- This migration replaces the seat model with a membership model:
--   * one row per (committee, position, profile) assignment,
--   * no ceiling on the number of rows for a committee or a position,
--   * a composite primary key, so the same person cannot hold the same role twice in one
--     committee while still being allowed to hold another role or another committee,
--   * all writes through SECURITY DEFINER functions that re-check the actor, the committee
--     scope, the target account and the optimistic stamp,
--   * esme_committees.director_id / head_id are dropped after their every value has been
--     backfilled into the ledger, because a single column is the fixed-count limit itself.
--
-- Existing assignments are preserved. 0004 already copied both columns into the ledger;
-- the backfill below is intentionally idempotent, so a project that applied 0004 to data
-- written afterwards still lands every valid row. Invalid references cannot exist because
-- 0001 declared both columns as foreign keys, but the migration reports orphans it finds
-- (a hand-edited schema, a restored dump) instead of deleting them.
--
-- Nothing here touches esme_profiles.role. Holding a seat never grants a capability.

begin;

-- ======================================================= compatibility ====
-- 0005 reads esme_leadership_seats to notify a committee's Director. That lookup used
-- SELECT ... INTO with no LIMIT, which raises TOO_MANY_ROWS as soon as a committee has two
-- Directors. Replace it with a loop before the relation starts returning several rows.

create or replace function esme_email_on_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task esme_tasks%rowtype;
  v_assignee esme_profiles%rowtype;
  v_leader text;
  v_director uuid;
begin
  select * into v_task from esme_tasks where id = new.task_id;
  if v_task.id is null then
    return new;
  end if;
  select * into v_assignee from esme_profiles where id = new.profile_id;
  if v_assignee.id is null then
    return new;
  end if;

  select display_name into v_leader from esme_profiles where id = v_task.created_by;

  perform esme_queue_email(
    'task_assigned',
    new.profile_id,
    jsonb_build_object(
      'fullName', v_assignee.display_name,
      'taskId', v_task.id::text,
      'taskTitle', v_task.title,
      'deadline', coalesce(to_char(v_task.deadline, 'YYYY-MM-DD'), 'no date set'),
      'points', v_task.points,
      'leaderName', coalesce(v_leader, 'the chapter')
    ),
    'task_assigned:' || v_task.id::text || ':' || new.profile_id::text
  );
  perform esme_notify_from_email(
    new.profile_id,
    'Task assigned', v_task.title || ' — due ' || to_char(v_task.deadline, 'YYYY-MM-DD'), 'tasks'
  );

  -- Every Director of the committee hears about a team assignment, never the actor or the
  -- assignee. The key carries the Director id: with several Directors, a key that named only
  -- the task and assignee would let the outbox's unique key swallow all but the first message.
  for v_director in
    select profile_id
      from esme_leadership_seats
     where committee_id = v_task.committee_id and position = 'director'
  loop
    if v_director <> new.profile_id and v_director <> esme_current_profile_id() then
      perform esme_queue_email(
        'task_assigned_to_team',
        v_director,
        jsonb_build_object(
          'assigneeName', v_assignee.display_name,
          'supervisorName', (select display_name from esme_profiles where id = v_director),
          'taskId', v_task.id::text,
          'taskTitle', v_task.title,
          'deadline', to_char(v_task.deadline, 'YYYY-MM-DD'),
          'leaderName', coalesce(v_leader, 'the chapter')
        ),
        'task_assigned_to_team:' || v_task.id::text || ':' || new.profile_id::text || ':' || v_director::text
      );
    end if;
  end loop;

  return new;
end;
$$;

-- ================================================= single-seat machinery ====
-- The trigger wrote the ledger from the two columns, and the channel guard refused any
-- update that touched them. Both exist to protect a shape that is being retired.

drop trigger if exists esme_committees_ledger on esme_committees;
drop function if exists esme_sync_leadership_seats();

drop trigger if exists esme_committees_seat_channel on esme_committees;
drop function if exists esme_assert_seat_channel();

alter table esme_committees
  drop constraint if exists esme_committees_one_person_two_seats;

-- ================================================== relationship shape ====

-- 0004's primary key allowed one row per committee and position. Replace it with the
-- assignment identity. The drop of the unique (profile_id) index is the removal of
-- "one person, one leadership post in the whole chapter".
alter table esme_leadership_seats
  drop constraint if exists esme_leadership_seats_pkey;
alter table esme_leadership_seats
  drop constraint if exists esme_leadership_seats_one_person;
alter table esme_leadership_seats
  add constraint esme_leadership_seats_pkey
  primary key (committee_id, position, profile_id);

create index if not exists esme_leadership_seats_profile_idx
  on esme_leadership_seats (profile_id);
create index if not exists esme_leadership_seats_position_idx
  on esme_leadership_seats (committee_id, position);

comment on table esme_leadership_seats is
  'One row per committee leadership assignment. Any number of Heads or Directors per committee. Clients read it; writes go through esme_add_committee_assignments() and esme_remove_committee_assignment() only.';
comment on column esme_leadership_seats.position is
  'Assignment role: head or director. A profile may hold both positions in one committee, and may be assigned to several committees.';

-- ============================================== preserve existing data ====

-- 0004 performed this copy when it created the ledger. Repeating it is harmless and covers
-- a seat written to the old columns after 0004 ran under a build that still used them.
insert into esme_leadership_seats (committee_id, position, profile_id)
  select id, 'director', director_id
    from esme_committees
   where director_id is not null
  on conflict (committee_id, position, profile_id) do nothing;

insert into esme_leadership_seats (committee_id, position, profile_id)
  select id, 'head', head_id
    from esme_committees
   where head_id is not null
  on conflict (committee_id, position, profile_id) do nothing;

-- Report rather than repair. A foreign key makes an orphan impossible on a healthy schema;
-- a restored dump or a hand-edited column can still produce one, and the operator needs the
-- name of the row before deciding what the person should be.
do $$
declare
  v_orphan_directors bigint;
  v_orphan_heads bigint;
  v_assignments bigint;
begin
  select count(*) into v_orphan_directors
    from esme_committees c
   where c.director_id is not null
     and not exists (select 1 from esme_profiles p where p.id = c.director_id);
  select count(*) into v_orphan_heads
    from esme_committees c
   where c.head_id is not null
     and not exists (select 1 from esme_profiles p where p.id = c.head_id);
  select count(*) into v_assignments from esme_leadership_seats;

  if v_orphan_directors > 0 then
    raise warning 'ESME_ASSIGNMENT_RECONCILE: % committee(s) name a director_id with no profile; the row is being retired and the orphan is not copied', v_orphan_directors;
  end if;
  if v_orphan_heads > 0 then
    raise warning 'ESME_ASSIGNMENT_RECONCILE: % committee(s) name a head_id with no profile; the row is being retired and the orphan is not copied', v_orphan_heads;
  end if;
  raise notice 'ESME_ASSIGNMENT_MIGRATION: % valid leadership assignment(s) now live in esme_leadership_seats', v_assignments;
end;
$$;

-- The columns disappear only after every valid value has a ledger row. A single column is
-- exactly the one-Head/one-Director limit this change removes.
alter table esme_committees drop column if exists director_id;
alter table esme_committees drop column if exists head_id;

-- ==================================================== write functions ====
-- The old single-seat entry point is gone. Keeping it would leave a function whose whole
-- contract is "replace the one seat", which is the limit in API form.

drop function if exists esme_assign_leader(uuid, text, uuid, timestamptz);

/**
 * Add one or more accounts to one committee position in a single transaction.
 *
 * The actor is resolved from the session (never from the request), the committee scope is
 * checked with committees.write, the target accounts must exist and be active, and the
 * optimistic timestamp is compared under a row lock. Any duplicate — in the request or
 * already stored — aborts the whole call, so a partially applied multi-select cannot leave
 * the committee in a state nobody can reconstruct from the UI.
 */
create or replace function esme_add_committee_assignments(
  p_committee_id uuid,
  p_position text,
  p_profile_ids uuid[],
  p_expected_updated_at timestamptz default null
)
returns setof esme_leadership_seats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_committee esme_committees%rowtype;
  v_target esme_profiles%rowtype;
  v_position text;
  v_id uuid;
  v_name text;
  v_seat esme_leadership_seats%rowtype;
begin
  v_position := lower(btrim(coalesce(p_position, '')));
  if v_position not in ('director', 'head') then
    raise exception 'ESME_INVALID_POSITION: %',
      case when v_position = '' then '(blank)' else v_position end
      using hint = 'A committee assignment is either director or head.';
  end if;

  if p_profile_ids is null or cardinality(p_profile_ids) = 0 then
    raise exception 'ESME_INVALID_ASSIGNMENT: choose at least one account';
  end if;
  if exists (select 1 from unnest(p_profile_ids) id where id is null) then
    raise exception 'ESME_INVALID_ASSIGNMENT: an assignment needs a profile id';
  end if;
  if (select count(*) from unnest(p_profile_ids) id)
     <> (select count(distinct id) from unnest(p_profile_ids) id) then
    raise exception 'ESME_DUPLICATE_ASSIGNMENT: the same account was selected twice';
  end if;

  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;
  if not esme_reaches_committee(p_committee_id, 'committees.write') then
    raise exception 'ESME_FORBIDDEN: your role does not allow you to change this committee''s leadership';
  end if;

  select * into v_committee from esme_committees where id = p_committee_id for update;
  if not found then
    raise exception 'ESME_NOT_FOUND: committee';
  end if;
  if p_expected_updated_at is not null and v_committee.updated_at <> p_expected_updated_at then
    raise exception 'ESME_STALE_WRITE: % was changed elsewhere while this form was open', v_committee.name;
  end if;

  -- Validate every target before writing any of them.
  foreach v_id in array p_profile_ids loop
    select * into v_target from esme_profiles where id = v_id for share;
    if not found then
      raise exception 'ESME_NOT_FOUND: profile';
    end if;
    if v_target.status <> 'active' then
      raise exception 'ESME_INACTIVE_ACCOUNT: % is % and cannot hold a seat',
        v_target.display_name, v_target.status;
    end if;
    if exists (
      select 1 from esme_leadership_seats s
       where s.committee_id = p_committee_id
         and s.position = v_position
         and s.profile_id = v_id
    ) then
      raise exception 'ESME_DUPLICATE_ASSIGNMENT: % already holds the % seat of %',
        v_target.display_name,
        case when v_position = 'director' then 'Director' else 'Head' end,
        v_committee.name;
    end if;
  end loop;

  foreach v_id in array p_profile_ids loop
    insert into esme_leadership_seats (committee_id, position, profile_id)
      values (p_committee_id, v_position, v_id)
      returning * into v_seat;

    select display_name into v_name from esme_profiles where id = v_id;

    insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
    values (
      v_actor.id, v_actor.display_name, v_actor.role,
      'LEADER_ASSIGNED_' || upper(v_position),
      'committee', p_committee_id::text,
      v_committee.name || ': ' || v_name
    );

    return next v_seat;
  end loop;

  update esme_committees set updated_at = now() where id = p_committee_id;
  return;
end;
$$;

/**
 * Remove exactly one assignment. A missing row is reported as not found, never as success:
 * a caller that asked to remove an assignment it no longer holds has stale state, and the
 * other assignments on the committee must be left untouched.
 */
create or replace function esme_remove_committee_assignment(
  p_committee_id uuid,
  p_position text,
  p_profile_id uuid,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_committee esme_committees%rowtype;
  v_removed esme_leadership_seats%rowtype;
  v_name text;
  v_position text;
begin
  v_position := lower(btrim(coalesce(p_position, '')));
  if v_position not in ('director', 'head') then
    raise exception 'ESME_INVALID_POSITION: %',
      case when v_position = '' then '(blank)' else v_position end
      using hint = 'A committee assignment is either director or head.';
  end if;

  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;
  if not esme_reaches_committee(p_committee_id, 'committees.write') then
    raise exception 'ESME_FORBIDDEN: your role does not allow you to change this committee''s leadership';
  end if;

  select * into v_committee from esme_committees where id = p_committee_id for update;
  if not found then
    raise exception 'ESME_NOT_FOUND: committee';
  end if;
  if p_expected_updated_at is not null and v_committee.updated_at <> p_expected_updated_at then
    raise exception 'ESME_STALE_WRITE: % was changed elsewhere while this form was open', v_committee.name;
  end if;

  delete from esme_leadership_seats
   where committee_id = p_committee_id
     and position = v_position
     and profile_id = p_profile_id
  returning * into v_removed;
  if not found then
    raise exception 'ESME_NOT_FOUND: assignment';
  end if;

  select display_name into v_name from esme_profiles where id = p_profile_id;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_actor.id, v_actor.display_name, v_actor.role,
    'LEADER_REMOVED_' || upper(v_position),
    'committee', p_committee_id::text,
    v_committee.name || ': ' || coalesce(v_name, p_profile_id::text)
  );

  update esme_committees set updated_at = now() where id = p_committee_id;
end;
$$;

/**
 * Roster move, restated without the old "reassign the seat first" rule. Assignments are
 * independent rows now: moving a person's home committee no longer orphans a leadership
 * seat, because the seat is not derived from that column. The move still obeys the actor's
 * users.update reach and the active-account rule.
 */
create or replace function esme_set_account_committee(
  p_profile_id uuid,
  p_committee_id uuid default null,
  p_sub_team text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_target esme_profiles%rowtype;
  v_committee esme_committees%rowtype;
  v_team text;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;

  select * into v_target from esme_profiles where id = p_profile_id for update;
  if not found then
    raise exception 'ESME_NOT_FOUND: profile';
  end if;
  if not esme_reaches_profile(p_profile_id, 'users.update') then
    raise exception 'ESME_FORBIDDEN: your role does not allow you to move this account';
  end if;

  if p_committee_id is not null then
    select * into v_committee from esme_committees where id = p_committee_id;
    if not found then
      raise exception 'ESME_NOT_FOUND: committee';
    end if;
    if v_target.status <> 'active' then
      raise exception 'ESME_INACTIVE_ACCOUNT: % is % and only an active account is given a committee home',
        v_target.display_name, v_target.status;
    end if;
  end if;

  v_team := case when p_committee_id is null then null
                 else nullif(btrim(coalesce(p_sub_team, '')), '') end;

  update esme_profiles set committee_id = p_committee_id, sub_team = v_team
    where id = p_profile_id;

  delete from esme_committee_memberships where profile_id = p_profile_id;
  if p_committee_id is not null then
    insert into esme_committee_memberships (profile_id, committee_id, sub_team, is_primary)
      values (p_profile_id, p_committee_id, v_team, true);
  end if;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_actor.id, v_actor.display_name, v_actor.role,
    case when p_committee_id is null then 'COMMITTEE_ROSTER_RELEASED' else 'COMMITTEE_ROSTER_MOVED' end,
    'profile', p_profile_id::text,
    v_target.display_name || ' -> ' || coalesce(v_committee.name, 'no committee')
  );
end;
$$;

-- ====================================================== grants / RLS ====

revoke all on function esme_add_committee_assignments(uuid, text, uuid[], timestamptz) from public, anon;
revoke all on function esme_remove_committee_assignment(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function esme_add_committee_assignments(uuid, text, uuid[], timestamptz) to authenticated;
grant execute on function esme_remove_committee_assignment(uuid, text, uuid, timestamptz) to authenticated;

-- Reads already follow the 0004 policy. Writes deliberately have no INSERT/UPDATE/DELETE
-- policy: a client cannot invent or erase an assignment with a hand-made REST request, and
-- the definer functions above re-decide capability, scope and target validity themselves.
grant select on esme_leadership_seats to authenticated;

comment on function esme_add_committee_assignments(uuid, text, uuid[], timestamptz) is
  'Only write path that adds leadership assignments. No per-committee or per-person maximum.';
comment on function esme_remove_committee_assignment(uuid, text, uuid, timestamptz) is
  'Only write path that removes one leadership assignment; unrelated assignments are untouched.';

commit;
