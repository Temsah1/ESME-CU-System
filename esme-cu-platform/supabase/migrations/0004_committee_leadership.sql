-- ESME CU ERP — committee leadership and roster writes, enforced in the database
-- Apply after 0003_bootstrap_admin.sql.
--
-- src/domain/committees.ts holds the same rules for the interface and the tests; this file
-- holds them where a request that skips the interface still has to answer to them.
-- Where the two disagree, this file wins, because it runs inside the database session.
--
-- Four things are decided here and nowhere else:
--   * what a committee row may say about itself (draft guard),
--   * who may move a leadership seat, and over whom (esme_assign_leader),
--   * who may move a person between committees (esme_set_account_committee),
--   * that one person answers for one committee (seat ledger).
-- A seat never touches esme_profiles.role. Privileges come from the capability matrix in
-- 0002, so appointing a Head cannot make that person a Super Admin or an administrator.
--
-- This migration validates existing rows. If production already breaks a rule — one person
-- in two committees, a duplicate acronym — the constraint or the backfill fails and names the
-- row. Nothing here corrects data quietly, and nothing here deletes it.

begin;

-- ========================================================= seat ledger ====

/**
 * The same fact as a row per seat, so "who leads what" is one indexed query and
 * one-person-one-seat is a constraint rather than a convention.
 * Written only by the trigger below, which follows the two seat columns.
 */
create table esme_leadership_seats (
  committee_id uuid not null references esme_committees (id) on delete cascade,
  position text not null check (position in ('director', 'head')),
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (committee_id, position)
);

create index esme_leadership_seats_profile_idx on esme_leadership_seats (profile_id);

-- Current rows become the ledger's starting point, then the constraint is added, so an
-- existing double appointment surfaces as a unique-index failure instead of being resolved.
insert into esme_leadership_seats (committee_id, position, profile_id)
  select id, 'director', director_id from esme_committees where director_id is not null
  union all
  select id, 'head', head_id from esme_committees where head_id is not null;

alter table esme_leadership_seats
  add constraint esme_leadership_seats_one_person unique (profile_id);

create or replace function esme_sync_leadership_seats()
returns trigger
language plpgsql
as $$
declare
  v_position text;
  v_seat uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    for v_position in select unnest(array['director', 'head']) loop
      v_seat := case when v_position = 'director' then new.director_id else new.head_id end;
      delete from esme_leadership_seats
        where committee_id = new.id and position = v_position;
      if v_seat is not null then
        insert into esme_leadership_seats (committee_id, position, profile_id)
          values (new.id, v_position, v_seat);
      end if;
    end loop;
    return new;
  end if;

  delete from esme_leadership_seats where committee_id = old.id;
  return old;
end;
$$;

create trigger esme_committees_ledger
  after insert or update or delete on esme_committees
  for each row execute function esme_sync_leadership_seats();

-- ======================================================= row integrity ====

/** One person cannot hold both seats of one committee, however the row was written. */
alter table esme_committees
  add constraint esme_committees_one_person_two_seats
  check (director_id is null or head_id is null or director_id <> head_id);

/**
 * Draft guard — the database copy of normalizeDraft() + validateCommitteeDraft().
 * Trims and uppercases on the way in, then refuses what the form would have refused, so a
 * hand-made request lands the same row as a click or does not land at all.
 * Limits come from LIMITS in src/domain/committees.ts.
 */
create or replace function esme_normalize_committee_draft()
returns trigger
language plpgsql
as $$
declare
  v_clash esme_committees%rowtype;
begin
  new.name := btrim(new.name);
  new.short_code := upper(btrim(new.short_code));
  new.description := btrim(new.description);
  new.objectives := coalesce(
    array(select trim(v) from unnest(new.objectives) v where btrim(v) <> ''), '{}');
  new.sub_teams := coalesce(
    array(select trim(v) from unnest(new.sub_teams) v where btrim(v) <> ''), '{}');

  if char_length(new.name) = 0 then
    raise exception 'ESME_COMMITTEE_INVALID: a committee needs a name';
  end if;
  if char_length(new.name) > 80 then
    raise exception 'ESME_COMMITTEE_INVALID: keep the name to 80 characters';
  end if;
  if new.short_code !~ '^[A-Z0-9][A-Z0-9&.+/ -]{1,7}$' then
    raise exception 'ESME_COMMITTEE_INVALID: the acronym is 2-8 characters of letters, digits and & . + / space';
  end if;
  if char_length(new.description) = 0 then
    raise exception 'ESME_COMMITTEE_INVALID: write what this committee is accountable for';
  end if;
  if char_length(new.description) > 600 then
    raise exception 'ESME_COMMITTEE_INVALID: keep the description to 600 characters';
  end if;
  if array_length(new.objectives, 1) > 12 then
    raise exception 'ESME_COMMITTEE_INVALID: 12 objectives maximum';
  end if;
  if array_length(new.sub_teams, 1) > 12 then
    raise exception 'ESME_COMMITTEE_INVALID: 12 sub-teams maximum';
  end if;
  if exists (select 1 from unnest(new.sub_teams) v where char_length(v) > 60) then
    raise exception 'ESME_COMMITTEE_INVALID: keep each sub-team name to 60 characters';
  end if;

  -- Two committees cannot share one identity. The row being edited excludes itself.
  select * into v_clash
    from esme_committees
   where id is distinct from new.id
     and (lower(name) = lower(new.name) or short_code = new.short_code)
   limit 1;
  if found then
    raise exception 'ESME_COMMITTEE_INVALID: % already uses that %',
      v_clash.short_code,
      case when lower(v_clash.name) = lower(new.name) then 'name' else 'acronym' end;
  end if;

  return new;
end;
$$;

create trigger esme_committees_draft
  before insert or update on esme_committees
  for each row execute function esme_normalize_committee_draft();

/**
 * True when the statement came straight from an API role instead of from a SECURITY DEFINER
 * function. Inside a definer function current_user is the owner while session_user stays the
 * role the JSON Web Token selected, so the two can only be equal on a direct call, and a
 * caller cannot make current_user anything other than what the token grants.
 * Service-role and SQL-editor sessions are maintenance, not a user request, so they pass.
 */
create or replace function esme_called_directly()
returns boolean
language sql
stable
as $$
  select session_user in ('authenticated', 'anon') and current_user = session_user
$$;

/**
 * Seat channel: the two leadership columns move through esme_assign_leader() only, so the
 * eligibility checks cannot be stepped around by an update that writes the id directly.
 */
create or replace function esme_assert_seat_channel()
returns trigger
language plpgsql
as $$
begin
  if not esme_called_directly() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and (new.director_id is not null or new.head_id is not null) then
    raise exception 'ESME_SEAT_FUNCTION_ONLY: a committee is created with vacant seats';
  end if;
  if tg_op = 'UPDATE'
     and (new.director_id is distinct from old.director_id
          or new.head_id is distinct from old.head_id) then
    raise exception 'ESME_SEAT_FUNCTION_ONLY: leadership moves through esme_assign_leader()'
      using hint = 'Save the row without the two seat columns, then appoint from the leadership panel.';
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'ESME_IDENTITY_IMMUTABLE: a committee id cannot be rewritten';
  end if;

  return new;
end;
$$;

create trigger esme_committees_seat_channel
  before insert or update on esme_committees
  for each row execute function esme_assert_seat_channel();

/**
 * Home channel: a person's committee is set by a roster move or a registration approval,
 * never by a profile edit that happens to carry the column.
 */
create or replace function esme_assert_home_channel()
returns trigger
language plpgsql
as $$
begin
  if not esme_called_directly() then return new; end if;
  if new.committee_id is distinct from old.committee_id then
    raise exception 'ESME_ROSTER_FUNCTION_ONLY: membership moves through esme_set_account_committee()';
  end if;
  return new;
end;
$$;

create trigger esme_profiles_home_channel
  before update on esme_profiles
  for each row execute function esme_assert_home_channel();

-- ============================================= leadership assignment ====

/**
 * Appoint, replace or clear one seat of one committee.
 *
 * Checked here, in this order, against locked rows: the actor reaches the committee, the
 * committee exists, the row is not the version the form was opened on, the account exists and
 * is active, holds no other seat in this committee, and leads no other committee. Then the
 * seat is written and the updated row comes back, so the caller compares timestamps instead
 * of trusting a local copy of the name.
 *
 * p_profile_id NULL clears the seat. An unassigned committee reads as unassigned.
 * esme_profiles.role is deliberately not part of this write.
 */
create or replace function esme_assign_leader(
  p_committee_id uuid,
  p_position text,
  p_profile_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns esme_committees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_committee esme_committees%rowtype;
  v_target esme_profiles%rowtype;
  v_rival uuid;
  v_other esme_committees%rowtype;
  v_result esme_committees%rowtype;
  v_position text;
begin
  v_position := lower(btrim(coalesce(p_position, '')));
  if v_position not in ('director', 'head') then
    raise exception 'ESME_INVALID_POSITION: %',
      case when v_position = '' then '(blank)' else v_position end
      using hint = 'A leadership seat is either director or head.';
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

  if p_profile_id is not null then
    select * into v_target from esme_profiles where id = p_profile_id for share;
    if not found then
      raise exception 'ESME_NOT_FOUND: profile';
    end if;
    if v_target.status <> 'active' then
      raise exception 'ESME_INACTIVE_ACCOUNT: % is % and cannot hold a seat',
        v_target.display_name, v_target.status;
    end if;

    v_rival := case when v_position = 'director' then v_committee.head_id
                    else v_committee.director_id end;
    if v_rival = p_profile_id then
      raise exception 'ESME_DOUBLE_SEAT: % already holds the % seat of %',
        v_target.display_name,
        case when v_position = 'director' then 'head' else 'director' end,
        v_committee.name;
    end if;

    -- Lock the committee that already claims this person before deciding about it.
    select * into v_other
      from esme_committees
     where id <> p_committee_id
       and (director_id = p_profile_id or head_id = p_profile_id)
     order by name
     limit 1
     for update;
    if found then
      raise exception 'ESME_ALREADY_LEADS: % is % of %, so two committees would claim one accountable person',
        v_target.display_name,
        case when v_other.director_id = p_profile_id then 'Director' else 'Head' end,
        v_other.name;
    end if;
  end if;

  if v_position = 'director' then
    update esme_committees set director_id = p_profile_id
      where id = p_committee_id returning * into v_result;
  else
    update esme_committees set head_id = p_profile_id
      where id = p_committee_id returning * into v_result;
  end if;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_actor.id, v_actor.display_name, v_actor.role,
    case when p_profile_id is null then 'LEADER_CLEARED_' else 'LEADER_ASSIGNED_' end || upper(v_position),
    'committee', p_committee_id::text,
    v_result.name || ': ' || case when v_target.id is null then 'seat vacated'
      else v_target.display_name || ' <' || v_target.email::text || '>' end
  );

  return v_result;
end;
$$;

-- ==================================================== roster membership ====

/**
 * Give an account a committee home, or take it away (p_committee_id NULL).
 *
 * Mirrors validateRosterMove(): reach the account, the committee exists, only an active
 * account is housed, and nobody is moved out while a seat still names them. The membership
 * rows follow the home committee so esme_committee_rosters stays truthful instead of drifting.
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
  v_seat esme_committees%rowtype;
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

  -- Releasing to no committee refuses any seat; moving houses refuses a seat held elsewhere.
  select * into v_seat
    from esme_committees
   where (director_id = p_profile_id or head_id = p_profile_id)
     and (p_committee_id is null or id <> p_committee_id)
   order by name
   limit 1
   for update;
  if found then
    raise exception 'ESME_HOLDS_SEAT: % is % of %, so reassign the seat before the move',
      v_target.display_name,
      case when v_seat.director_id = p_profile_id then 'Director' else 'Head' end,
      v_seat.name;
  end if;

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

/** Who holds which seat, for the integrity report and the leadership panels. */
create or replace function esme_leadership_map()
returns table (committee_id uuid, position text, profile_id uuid, display_name text, account_status esme_account_status)
language sql
stable
security definer
set search_path = public
as $$
  select s.committee_id, s.position, s.profile_id, p.display_name, p.status
  from esme_leadership_seats s
  join esme_profiles p on p.id = s.profile_id
  where esme_has_capability('committees.read');
$$;

-- ================================================================== RLS ====

alter table esme_leadership_seats enable row level security;

create policy esme_leadership_seats_read on esme_leadership_seats
  for select to authenticated
  using (esme_reaches_committee(committee_id, 'committees.read'));

-- Deliberately no insert, update or delete policy: the ledger is maintained by the trigger
-- above, so a client cannot invent or erase a seat even with a hand-made request.

-- ================================================================ grants ====

grant execute on function esme_assign_leader(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function esme_set_account_committee(uuid, uuid, text) to authenticated;
grant execute on function esme_leadership_map() to authenticated;
grant select on esme_leadership_seats to authenticated;

comment on function esme_assign_leader(uuid, text, uuid, timestamptz) is
  'Only write path for esme_committees.director_id / head_id. Never touches esme_profiles.role.';
comment on function esme_set_account_committee(uuid, uuid, text) is
  'Only write path for esme_profiles.committee_id outside registration approval.';
comment on table esme_leadership_seats is
  'Derived from the two seat columns by trigger. Clients read it, never write it.';

commit;
