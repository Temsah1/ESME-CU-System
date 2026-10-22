-- ESME CU ERP — bonus points and warning ledger, with the permission matrix
-- Apply after 0005_email_notifications.sql.
--
-- What this migration owns
--   * the high_board role, so an org-wide officer exists in the database and not only in the UI
--   * esme_reward_entries: an append-only ledger of bonuses and warnings, one row per decision
--   * esme_reward_policy: the matrix (who may act, how much, when it escalates)
--   * esme_award_bonus / esme_issue_warning / esme_reverse_reward_entry /
--     esme_acknowledge_warning / esme_update_reward_policy — the only writes a browser may make
--
-- Design notes
--   * src/domain/rewards.ts mirrors these rules for the offline development store and for tests.
--     Where the two disagree, this file wins: it runs inside the database session, so a forged
--     role or scope in a request body cannot reach it.
--   * The check order below is the order in validateRewardAction, because the message an officer
--     sees has to name the rule that actually answered first.
--   * A correction is a second row that points at the first. Nothing here rewrites a reason,
--     a number, or a timestamp that was already filed.
--   * Bonus points also write esme_score_ledger, so the leaderboard, the member total and the
--     report builder keep reading one source of points. 0005 already turns that ledger row into
--     the bonus_awarded email and notification; this file does not queue a second one.
--   * No migration in this repository has been executed — there is no Postgres in this
--     environment. See supabase/README.md; supabase/migrations/migrationIntegrity.test.ts is the
--     static substitute that proves relations, columns and function names line up.

-- ===================================================== the high_board role ====
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that consumes the new label,
-- and this file seeds capability rows for it, so it runs on its own before the transaction opens.
--
-- The label is appended last, which makes its position in esme_role meaningless as an ordering.
-- Seniority is read through esme_role_rank() below, never through < or > on the enum itself.

alter type esme_role add value if not exists 'high_board';

begin;

/**
 * ROLE_RANK in src/domain/roles.ts, in SQL. Actions travel downwards and never sideways,
 * with one exception the product already grants: a Super Admin may act on another Super Admin.
 */
create or replace function esme_role_rank(p_role esme_role)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'super_admin' then 100
    when 'high_board' then 80
    when 'moderator' then 70
    when 'director' then 50
    when 'head' then 40
    else 10
  end
$$;

-- ------------------------------------------------------------- enums ----

create type esme_reward_kind as enum ('bonus', 'warning');

create type esme_warning_severity as enum ('notice', 'formal', 'final');

create type esme_reward_status as enum ('active', 'reversed');

-- ================================================ capability matrix seed ====
-- The rewards capabilities, plus the role that 0002 could not have known about.
-- A moderator runs the registration queue and the CMS; discipline is not theirs, so they get no
-- rewards row at all — the absence is the policy.

insert into esme_role_capabilities (role, capability, scope) values
  -- high_board — organization-wide view and organization-wide discipline
  ('high_board', 'users.read', 'all'),
  ('high_board', 'registrations.read', 'all'),
  ('high_board', 'committees.read', 'all'),
  ('high_board', 'tasks.read', 'all'),
  ('high_board', 'submissions.read', 'all'),
  ('high_board', 'submissions.review', 'all'),
  ('high_board', 'scores.read', 'all'),
  ('high_board', 'events.read', 'all'),
  ('high_board', 'skills.read', 'all'),
  ('high_board', 'analytics.configure', 'all'),
  ('high_board', 'notifications.manage', 'all'),
  ('high_board', 'audit.read', 'all'),
  ('high_board', 'rewards.read', 'all'),
  ('high_board', 'rewards.write', 'all'),
  -- super_admin
  ('super_admin', 'rewards.read', 'all'),
  ('super_admin', 'rewards.write', 'all'),
  ('super_admin', 'rewards.configure', 'all'),
  -- director and head — their own committee only
  ('director', 'rewards.read', 'committee'),
  ('director', 'rewards.write', 'committee'),
  ('head', 'rewards.read', 'committee'),
  ('head', 'rewards.write', 'committee'),
  -- member — reads their own record, awards and issues nothing
  ('member', 'rewards.read', 'self')
on conflict (role, capability) do nothing;

-- ======================================================= the reward ledger ====
-- Every column that describes the decision is frozen by a trigger below. The two that may move
-- are the status a reversal sets, and the acknowledgement a member files.

create table esme_reward_entries (
  id uuid primary key default gen_random_uuid(),
  kind esme_reward_kind not null,

  -- The actor is read from the session inside the function, never from the request body.
  actor_id uuid not null references esme_profiles (id) on delete restrict,
  actor_role esme_role not null,

  -- Restrict, not cascade: an account that disappears would otherwise take the record of what was
  -- decided about it with it. Accounts are suspended for that reason, never deleted.
  target_id uuid not null references esme_profiles (id) on delete restrict,
  -- Frozen so a later promotion does not rewrite who was disciplined at the time.
  target_role_at_time esme_role not null,
  committee_id uuid references esme_committees (id) on delete set null,

  -- A bonus is a movement; a warning is accountability and always carries zero.
  points integer not null,
  severity esme_warning_severity,

  reason text not null check (char_length(btrim(reason)) between 3 and 400),
  evidence_url text check (
    evidence_url is null or (char_length(evidence_url) <= 300 and evidence_url ~* '^https?://')
  ),

  issued_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references esme_profiles (id) on delete set null,

  status esme_reward_status not null default 'active',
  /** Set on the reversing row (what it undoes) and on the reversed row (what undid it). */
  reversed_by_entry_id uuid references esme_reward_entries (id) on delete restrict,

  /**
   * The paired point movement, so a bonus and its ledger row cannot drift apart. It shares the
   * entry's id — the same pairing the client store uses — and the check is deferred so the entry
   * can be written first: if its idempotency key collides with a committed entry, no points move.
   */
  score_ledger_id uuid references esme_score_ledger (id) on delete set null
    deferrable initially deferred,

  idempotency_key text not null unique,

  check (reversed_by_entry_id is null or reversed_by_entry_id <> id),
  check (
    (kind = 'bonus' and severity is null and points <> 0)
    or (kind = 'warning' and severity is not null and points = 0)
  ),
  -- An acknowledgement belongs to the entry it reads, not to whoever asks.
  check (acknowledged_by is null or acknowledged_by = target_id),
  check (acknowledged_at is null or kind = 'warning')
);

create index esme_reward_target_idx on esme_reward_entries (target_id, issued_at desc);
create index esme_reward_actor_idx on esme_reward_entries (actor_id, issued_at desc);
create index esme_reward_committee_idx on esme_reward_entries (committee_id, issued_at desc);
create index esme_reward_active_idx on esme_reward_entries (target_id, kind, issued_at desc)
  where status = 'active';

-- ------------------------------------------------------- the policy row ----
-- One row, for the whole chapter. Its checks are validatePolicyEdit: a control whose limits are
-- impossible to honour is not a control.

create table esme_reward_policy (
  id smallint primary key default 1 check (id = 1),
  can_award_bonus esme_role[] not null default '{head,director,high_board,super_admin}',
  can_issue_warning esme_role[] not null default '{head,director,high_board,super_admin}',
  max_bonus_points_per_action integer not null default 25
    check (max_bonus_points_per_action between 1 and 500),
  max_bonus_points_per_member_per_period integer not null default 100
    check (max_bonus_points_per_member_per_period >= 1),
  period_days integer not null default 90 check (period_days between 7 and 365),
  escalate_warnings_after integer not null default 3
    check (escalate_warnings_after between 1 and 10),
  notify_roles_on_escalation esme_role[] not null default '{director,high_board}',
  updated_at timestamptz not null default now(),
  updated_by uuid references esme_profiles (id) on delete set null,

  check (array_length(can_award_bonus, 1) is not null),
  check (array_length(notify_roles_on_escalation, 1) is not null),
  check (max_bonus_points_per_member_per_period >= max_bonus_points_per_action),
  check (max_bonus_points_per_member_per_period >= 3 * max_bonus_points_per_action),
  check (period_days >= 30 or escalate_warnings_after <= 2)
);

insert into esme_reward_policy (id) values (1) on conflict (id) do nothing;

/**
 * Points are summed, warnings are counted. Nothing on this view is stored as an editable number,
 * so the leaderboard and an officer's screen cannot disagree.
 */
create or replace view esme_member_reward_records as
select
  p.id as profile_id,
  p.display_name,
  p.role,
  p.committee_id,
  coalesce((
    select sum(e.points) from esme_reward_entries e
     where e.target_id = p.id and e.kind = 'bonus' and e.status = 'active'
  ), 0) as bonus_points,
  coalesce((
    select count(*) from esme_reward_entries e
     where e.target_id = p.id and e.kind = 'warning' and e.status = 'active'
       and e.reversed_by_entry_id is null
  ), 0) as active_warnings,
  coalesce((
    select count(*) from esme_reward_entries e
     where e.target_id = p.id and e.kind = 'bonus' and e.status = 'active'
  ), 0) as bonus_entries,
  (
    select max(e.issued_at) from esme_reward_entries e
     where e.target_id = p.id and e.kind = 'warning' and e.status = 'active'
       and e.reversed_by_entry_id is null
  ) as last_warning_at
from esme_profiles p;

-- ================================================ immutability guards ====
-- The browser may not write this table at all; esme_award_bonus() and friends are the only path,
-- and they run as their owner, so esme_called_directly() is false inside them.

create or replace function esme_assert_reward_channel()
returns trigger
language plpgsql
as $$
begin
  if not esme_called_directly() then
    return coalesce(new, old);
  end if;
  raise exception 'ESME_REWARD_FUNCTION_ONLY: bonuses and warnings are recorded through esme_award_bonus(), esme_issue_warning(), esme_reverse_reward_entry() or esme_acknowledge_warning()'
    using hint = 'A direct insert would skip the scope, rank and cap checks the ledger exists to enforce.';
end;
$$;

create trigger esme_reward_entries_channel
  before insert or update or delete on esme_reward_entries
  for each row execute function esme_assert_reward_channel();

/**
 * Even a definer function may not restate history. Whatever the caller intended, the columns that
 * describe the decision itself have to survive unchanged, and a row already reversed stays reversed.
 */
create or replace function esme_assert_reward_entry_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.actor_id is distinct from old.actor_id
     or new.actor_role is distinct from old.actor_role
     or new.target_id is distinct from old.target_id
     or new.target_role_at_time is distinct from old.target_role_at_time
     or new.committee_id is distinct from old.committee_id
     or new.points is distinct from old.points
     or new.severity is distinct from old.severity
     or new.reason is distinct from old.reason
     or new.evidence_url is distinct from old.evidence_url
     or new.issued_at is distinct from old.issued_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.score_ledger_id is distinct from old.score_ledger_id then
    raise exception 'ESME_REWARD_IMMUTABLE: entry % keeps the number, reason and timestamp it was filed with', old.id;
  end if;

  if old.status = 'reversed' and new.status is distinct from old.status then
    raise exception 'ESME_ALREADY_REVERSED: entry % has already been reversed', old.id;
  end if;

  -- The only legal pair: active -> reversed, naming the entry that did it.
  if new.status = 'reversed' and old.status = 'active' then
    if new.reversed_by_entry_id is null then
      raise exception 'ESME_REWARD_REVERSAL_POINTER: a reversal has to name the entry reversing it';
    end if;
    return new;
  end if;

  if new.reversed_by_entry_id is distinct from old.reversed_by_entry_id then
    raise exception 'ESME_REWARD_IMMUTABLE: entry % already has its reversal pointer set', old.id;
  end if;

  -- Acknowledgement: the member's own receipt, written once, on a warning that still stands.
  if new.acknowledged_at is distinct from old.acknowledged_at then
    if old.acknowledged_at is not null then
      raise exception 'ESME_ALREADY_ACKNOWLEDGED: warning % was read on %', old.id, old.acknowledged_at;
    end if;
    if old.kind <> 'warning' then
      raise exception 'ESME_NOT_A_WARNING: only a recorded warning can be acknowledged';
    end if;
    if old.status <> 'active' then
      raise exception 'ESME_ALREADY_REVERSED: warning % was withdrawn, so there is nothing to acknowledge', old.id;
    end if;
    if new.acknowledged_by is distinct from old.target_id then
      raise exception 'ESME_FORBIDDEN: only the member the warning is about acknowledges it';
    end if;
  end if;

  return new;
end;
$$;

create trigger esme_reward_entries_frozen
  before update on esme_reward_entries
  for each row execute function esme_assert_reward_entry_frozen();

/** One row per chapter, and only an officer with rewards.configure may move it — through the RPC. */
create or replace function esme_assert_policy_channel()
returns trigger
language plpgsql
as $$
begin
  if not esme_called_directly() then
    return coalesce(new, old);
  end if;
  raise exception 'ESME_POLICY_FUNCTION_ONLY: the permission matrix changes through esme_update_reward_policy()';
end;
$$;

create trigger esme_reward_policy_channel
  before insert or update or delete on esme_reward_policy
  for each row execute function esme_assert_policy_channel();

-- ==================================================== the shared gate ====
-- The target half of validateRewardAction, in one place so awarding, warning and correcting cannot
-- drift apart. Returns the target row so the caller does not read the profile twice.
--
-- The caller checks the capability and the matrix role list first, because that is the order the
-- rules are written in: a role with no write capability is refused before its target is examined.

create or replace function esme_assert_reward_target(
  p_target uuid,
  p_action text
)
returns esme_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_target esme_profiles%rowtype;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;

  if not esme_has_capability('rewards.write') then
    raise exception 'ESME_FORBIDDEN: % may not record bonuses or warnings', initcap(v_actor.role::text);
  end if;

  -- Reach first, exactly as the TypeScript gate orders it: a Head or Director cannot name a target
  -- outside their committee even before the rest of the rules are read.
  if not esme_reaches_profile(p_target, 'rewards.write') then
    raise exception 'ESME_FORBIDDEN: this action is outside the committees you can act on';
  end if;

  select * into v_target from esme_profiles where id = p_target;
  if v_target.id is null then
    raise exception 'ESME_NOT_FOUND: that member is not in the directory, so nothing can be recorded against them';
  end if;

  if v_target.id = v_actor.id then
    raise exception 'ESME_SELF_TARGET: nobody can % a bonus or a warning against themselves', p_action;
  end if;

  if esme_is_primary_admin(v_target.id) then
    raise exception 'ESME_PROTECTED: the primary Super Admin account is not a target for rewards or discipline';
  end if;

  if v_target.status <> 'active' then
    raise exception 'ESME_INACTIVE_ACCOUNT: % is % and this entry would point at nobody',
      v_target.display_name, v_target.status;
  end if;

  if esme_role_rank(v_target.role) >= esme_role_rank(v_actor.role)
     and not (v_actor.role = 'super_admin' and v_target.role = 'super_admin') then
    raise exception 'ESME_ABOVE_RANK: % is a % — actions only travel downwards',
      v_target.display_name, initcap(v_target.role::text);
  end if;

  -- Committee reach is not team reach: a Head leads one sub-team of the committee.
  if v_actor.role = 'head' and v_actor.sub_team is not null
     and v_target.sub_team is distinct from v_actor.sub_team then
    raise exception 'ESME_OUTSIDE_TEAM: a Team Head acts inside %; % sits in %',
      coalesce(v_actor.sub_team, 'their team'), v_target.display_name,
      coalesce(v_target.sub_team, 'no sub-team');
  end if;

  if v_actor.role = 'director' and v_target.committee_id is distinct from v_actor.committee_id then
    raise exception 'ESME_OUTSIDE_COMMITTEE: a Committee Director acts inside their own committee';
  end if;

  return v_target;
end;
$$;

/** The shape both kinds share: a written reason, and an http(s) link if one is offered. */
create or replace function esme_assert_reward_reason(p_reason text, p_evidence_url text)
returns text
language plpgsql
immutable
as $$
declare
  v_reason text;
begin
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'ESME_NO_REASON: a record without a reason is not a record — write why it was given';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'ESME_INVALID_REASON: spell the reason out — at least three characters';
  end if;
  if char_length(v_reason) > 400 then
    raise exception 'ESME_INVALID_REASON: keep the reason to 400 characters';
  end if;
  if nullif(btrim(coalesce(p_evidence_url, '')), '') is not null
     and (char_length(btrim(p_evidence_url)) > 300
          or btrim(p_evidence_url) !~* '^https?://') then
    raise exception 'ESME_INVALID_EVIDENCE: evidence has to be a short http(s) link';
  end if;
  return v_reason;
end;
$$;

-- ========================================================= award a bonus ====
-- Two rows, one decision: the ledger entry that explains it and the point movement that counts it.
-- A replayed request with the same key returns the entry that already exists and adds nothing.

create or replace function esme_award_bonus(
  p_target uuid,
  p_points integer,
  p_reason text,
  p_evidence_url text default null,
  p_idempotency_key text default null
)
returns esme_reward_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_actor esme_profiles%rowtype;
  v_target esme_profiles%rowtype;
  v_policy esme_reward_policy%rowtype;
  v_existing esme_reward_entries%rowtype;
  v_replay esme_reward_entries%rowtype;
  v_period_bonus integer;
  v_period_count integer;
  v_entry_id uuid;
  v_reason text;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if not esme_has_capability('rewards.write') then
    raise exception 'ESME_FORBIDDEN: % may not record bonuses or warnings', initcap(v_actor.role::text);
  end if;

  select * into v_policy from esme_reward_policy where id = 1;
  if not v_policy.can_award_bonus @> array[v_actor.role] then
    raise exception 'ESME_POLICY_DISABLED: the permission matrix does not let a % record a bonus',
      initcap(v_actor.role::text)
      using hint = 'A Super Admin changes that in the permission matrix.';
  end if;

  v_target := esme_assert_reward_target(p_target, 'award');
  v_reason := esme_assert_reward_reason(p_reason, p_evidence_url);

  if p_points is null or p_points < 1 then
    raise exception 'ESME_BAD_POINTS: a bonus is a whole number of points above zero';
  end if;
  if p_points > v_policy.max_bonus_points_per_action then
    raise exception 'ESME_OVER_ACTION_CAP: the limit is % points per action',
      v_policy.max_bonus_points_per_action;
  end if;

  select coalesce(sum(points), 0), count(*)
    into v_period_bonus, v_period_count
    from esme_reward_entries
   where target_id = p_target
     and kind = 'bonus'
     and status = 'active'
     and issued_at >= now() - make_interval(days => v_policy.period_days);

  if v_period_bonus + p_points > v_policy.max_bonus_points_per_member_per_period then
    raise exception 'ESME_OVER_PERIOD_CAP: % already has % bonus points in this % day window; the ceiling is %',
      v_target.display_name, v_period_bonus, v_policy.period_days,
      v_policy.max_bonus_points_per_member_per_period;
  end if;

  v_key := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''),
                    'bonus:' || esme_current_profile_id()::text || ':' || p_target::text || ':' ||
                    to_char(now(), 'US'));

  select * into v_replay from esme_reward_entries where idempotency_key = v_key;
  if v_replay.id is not null then
    return v_replay;
  end if;

  v_entry_id := gen_random_uuid();

  -- The entry is written first, so a request that loses a race on the key aborts before any point
  -- moves. esme_email_on_bonus in 0005 turns the ledger row into the bonus_awarded mail and the
  -- in-app notification; nothing is queued twice here.
  insert into esme_reward_entries
    (id, kind, actor_id, actor_role, target_id, target_role_at_time, committee_id,
     points, reason, evidence_url, idempotency_key, score_ledger_id)
  values
    (v_entry_id, 'bonus', v_actor.id, v_actor.role, v_target.id, v_target.role, v_target.committee_id,
     p_points, v_reason, nullif(btrim(coalesce(p_evidence_url, '')), ''), v_key, v_entry_id)
  returning * into v_existing;

  insert into esme_score_ledger (id, profile_id, committee_id, points, action_type, reason, recorded_by, idempotency_key)
  values (v_entry_id, p_target, v_target.committee_id, p_points, 'bonus', v_reason, v_actor.id, 'reward:' || v_key);

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'BONUS_AWARDED', 'reward',
          v_existing.id::text,
          '+' || p_points || ' points for ' || v_target.display_name || ' — ' || v_reason);

  if v_period_count >= 5 then
    insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
    values (v_actor.id, v_actor.display_name, v_actor.role, 'BONUS_FREQUENCY_REVIEW', 'reward',
            v_existing.id::text,
            v_target.display_name || ' has received ' || (v_period_count + 1) ||
            ' bonuses in ' || v_policy.period_days || ' days');
  end if;

  return v_existing;
end;
$$;

-- ======================================================== issue a warning ====

create or replace function esme_issue_warning(
  p_target uuid,
  p_severity esme_warning_severity,
  p_reason text,
  p_evidence_url text default null,
  p_idempotency_key text default null
)
returns esme_reward_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_actor esme_profiles%rowtype;
  v_target esme_profiles%rowtype;
  v_policy esme_reward_policy%rowtype;
  v_entry esme_reward_entries%rowtype;
  v_replay esme_reward_entries%rowtype;
  v_reason text;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if not esme_has_capability('rewards.write') then
    raise exception 'ESME_FORBIDDEN: % may not record bonuses or warnings', initcap(v_actor.role::text);
  end if;

  select * into v_policy from esme_reward_policy where id = 1;
  if not v_policy.can_issue_warning @> array[v_actor.role] then
    raise exception 'ESME_POLICY_DISABLED: the permission matrix does not let a % record a warning',
      initcap(v_actor.role::text);
  end if;

  v_target := esme_assert_reward_target(p_target, 'issue');
  v_reason := esme_assert_reward_reason(p_reason, p_evidence_url);

  if p_severity is null then
    raise exception 'ESME_BAD_SEVERITY: choose a severity — notice, formal or final';
  end if;

  v_key := coalesce(nullif(btrim(coalesce(p_idempotency_key, '')), ''),
                    'warning:' || esme_current_profile_id()::text || ':' || p_target::text || ':' ||
                    to_char(now(), 'US'));

  select * into v_replay from esme_reward_entries where idempotency_key = v_key;
  if v_replay.id is not null then
    return v_replay;
  end if;

  -- Discipline moves no points, so nothing touches esme_score_ledger. The trigger below turns this
  -- row into the warning_issued mail.
  insert into esme_reward_entries
    (kind, actor_id, actor_role, target_id, target_role_at_time, committee_id,
     points, severity, reason, evidence_url, idempotency_key)
  values
    ('warning', v_actor.id, v_actor.role, v_target.id, v_target.role, v_target.committee_id,
     0, p_severity, v_reason, nullif(btrim(coalesce(p_evidence_url, '')), ''), v_key)
  returning * into v_entry;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'WARNING_ISSUED', 'reward',
          v_entry.id::text,
          upper(p_severity::text) || ' warning — ' || v_reason || ' (entry ' || v_entry.id::text || ')');

  return v_entry;
end;
$$;

-- --------------------------------------------- warning mail and escalation ----
-- Triggers rather than inline calls, so a row written by any path — including a repair run by the
-- service role — still announces itself.

create or replace function esme_email_on_warning_issued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member esme_profiles%rowtype;
  v_issuer text;
begin
  if new.kind <> 'warning' or new.reversed_by_entry_id is not null then
    return new;
  end if;

  select * into v_member from esme_profiles where id = new.target_id;
  if v_member.id is null then
    return new;
  end if;
  select display_name into v_issuer from esme_profiles where id = new.actor_id;

  perform esme_queue_email(
    'warning_issued',
    new.target_id,
    jsonb_build_object(
      'fullName', v_member.display_name,
      'severity', new.severity,
      'reason', new.reason,
      'issuerName', coalesce(v_issuer, 'the chapter'),
      'evidenceUrl', new.evidence_url
    ),
    'warning_issued:' || new.id::text
  );
  perform esme_notify_from_email(
    new.target_id,
    'Warning recorded',
    'A ' || new.severity || ' warning was recorded: ' || new.reason,
    'rewards'
  );
  return new;
end;
$$;

create trigger esme_email_warning_issued
  after insert on esme_reward_entries
  for each row execute function esme_email_on_warning_issued();

/**
 * Past the threshold, the matrix's notify roles hear it. A withdrawal is a correction rather than
 * another warning, so rows that point at an entry they undo are not counted.
 */
create or replace function esme_email_on_warning_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy esme_reward_policy%rowtype;
  v_member esme_profiles%rowtype;
  v_officer record;
  v_count integer;
begin
  if new.kind <> 'warning' or new.reversed_by_entry_id is not null then
    return new;
  end if;

  select * into v_policy from esme_reward_policy where id = 1;
  select * into v_member from esme_profiles where id = new.target_id;
  if v_member.id is null then
    return new;
  end if;

  select count(*) into v_count
    from esme_reward_entries e
   where e.target_id = new.target_id
     and e.kind = 'warning'
     and e.status = 'active'
     and e.reversed_by_entry_id is null
     and e.issued_at >= now() - make_interval(days => v_policy.period_days);

  if v_count < v_policy.escalate_warnings_after then
    return new;
  end if;

  for v_officer in
    select p.id, p.display_name
      from esme_profiles p
     where p.status = 'active'
       and p.role = any (v_policy.notify_roles_on_escalation)
       and p.id <> new.target_id
       and (p.role <> 'director' or p.committee_id = new.committee_id)
     order by p.display_name
  loop
    perform esme_queue_email(
      'warning_escalated',
      v_officer.id,
      jsonb_build_object(
        'recipientName', v_officer.display_name,
        'memberName', v_member.display_name,
        'count', v_count,
        'windowDays', v_policy.period_days
      ),
      'warning_escalated:' || new.id::text || ':' || v_officer.id::text
    );
    insert into esme_notifications (profile_id, title, message, type, link)
    values (v_officer.id, 'Warning escalation',
            v_member.display_name || ' now has ' || v_count ||
            ' active warnings in ' || v_policy.period_days || ' days.', 'alert', 'rewards');
  end loop;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (new.actor_id,
          (select display_name from esme_profiles where id = new.actor_id),
          new.actor_role,
          'WARNING_ESCALATED', 'reward', new.id::text,
          v_member.display_name || ' reached ' || v_count || ' warnings in ' ||
          v_policy.period_days || ' days');

  return new;
end;
$$;

create trigger esme_email_warning_escalation
  after insert on esme_reward_entries
  for each row execute function esme_email_on_warning_escalation();

-- ========================================================== reverse an entry ====
-- The answer to a wrong entry is a new one. The original keeps every word and number and gains a
-- pointer, so the trail reads forwards instead of being edited backwards.

create or replace function esme_reverse_reward_entry(
  p_entry uuid,
  p_reason text
)
returns esme_reward_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_original esme_reward_entries%rowtype;
  v_reversal esme_reward_entries%rowtype;
  v_reason text;
  v_ledger uuid;
begin
  select * into v_original from esme_reward_entries where id = p_entry for update;
  if not found then
    raise exception 'ESME_NOT_FOUND: that entry does not exist, so it cannot be reversed';
  end if;
  if v_original.status = 'reversed' then
    raise exception 'ESME_ALREADY_REVERSED: that entry has already been reversed';
  end if;

  -- Correcting an entry is the same authority as writing one, over the same member.
  v_actor := esme_assert_reward_target(v_original.target_id, 'reverse');
  v_reason := esme_assert_reward_reason(p_reason, null);

  if v_original.kind = 'bonus' then
    insert into esme_score_ledger
      (profile_id, committee_id, points, action_type, reason, recorded_by, idempotency_key)
    values
      (v_original.target_id, v_original.committee_id, -v_original.points, 'penalty',
       'Reversal of ' || v_original.id::text || ': ' || v_reason, v_actor.id,
       'reversal:' || v_original.id::text)
    returning id into v_ledger;

    insert into esme_reward_entries
      (kind, actor_id, actor_role, target_id, target_role_at_time, committee_id,
       points, reason, evidence_url, idempotency_key, reversed_by_entry_id, score_ledger_id)
    values
      ('bonus', v_actor.id, v_actor.role, v_original.target_id, v_original.target_role_at_time,
       v_original.committee_id, -v_original.points, v_reason, null,
       'reverse:' || v_original.id::text || ':' || v_actor.id::text, v_original.id, v_ledger)
    returning * into v_reversal;
  else
    insert into esme_reward_entries
      (kind, actor_id, actor_role, target_id, target_role_at_time, committee_id,
       points, severity, reason, evidence_url, idempotency_key, reversed_by_entry_id)
    values
      ('warning', v_actor.id, v_actor.role, v_original.target_id, v_original.target_role_at_time,
       v_original.committee_id, 0, v_original.severity, v_reason, null,
       'reverse:' || v_original.id::text || ':' || v_actor.id::text, v_original.id)
    returning * into v_reversal;
  end if;

  update esme_reward_entries
     set status = 'reversed', reversed_by_entry_id = v_reversal.id
   where id = v_original.id;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'REWARD_ENTRY_REVERSED', 'reward',
          v_original.id::text, v_reason || ' (reversal ' || v_reversal.id::text || ')');

  return v_reversal;
end;
$$;

-- ======================================================= acknowledge a warning ====
-- Receipt, not appeal. It records that the member read the entry and changes nothing about it.

create or replace function esme_acknowledge_warning(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry esme_reward_entries%rowtype;
begin
  select * into v_entry from esme_reward_entries where id = p_entry for update;
  if not found or v_entry.kind <> 'warning' then
    raise exception 'ESME_NOT_A_WARNING: only a recorded warning can be acknowledged';
  end if;
  if v_entry.target_id <> esme_current_profile_id() then
    raise exception 'ESME_FORBIDDEN: only the member the warning is about can acknowledge it';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'ESME_ALREADY_REVERSED: that warning was withdrawn, so there is nothing to acknowledge';
  end if;
  if v_entry.acknowledged_at is not null then
    return;
  end if;

  update esme_reward_entries
     set acknowledged_at = now(), acknowledged_by = esme_current_profile_id()
   where id = p_entry;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_entry.target_id,
          (select display_name from esme_profiles where id = v_entry.target_id),
          v_entry.target_role_at_time,
          'WARNING_ACKNOWLEDGED', 'reward', p_entry::text,
          'The member confirmed they read warning ' || p_entry::text);
end;
$$;

-- ======================================================= the permission matrix ====
-- Only Super Admin holds rewards.configure, and the limits are the ones validatePolicyEdit checks.

create or replace function esme_update_reward_policy(
  p_can_award_bonus esme_role[],
  p_can_issue_warning esme_role[],
  p_max_bonus_points_per_action integer,
  p_max_bonus_points_per_member_per_period integer,
  p_period_days integer,
  p_escalate_warnings_after integer,
  p_notify_roles_on_escalation esme_role[]
)
returns esme_reward_policy
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor esme_profiles%rowtype;
  v_result esme_reward_policy%rowtype;
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  if v_actor.id is null or v_actor.status <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;
  if not esme_has_capability('rewards.configure') then
    raise exception 'ESME_FORBIDDEN: this account may not change the permission matrix';
  end if;

  if p_can_award_bonus is null or array_length(p_can_award_bonus, 1) is null then
    raise exception 'ESME_INVALID_POLICY: at least one role has to be able to award a bonus';
  end if;
  if p_notify_roles_on_escalation is null or array_length(p_notify_roles_on_escalation, 1) is null then
    raise exception 'ESME_INVALID_POLICY: escalation has to tell somebody';
  end if;
  if p_max_bonus_points_per_action is null
     or p_max_bonus_points_per_action < 1 or p_max_bonus_points_per_action > 500 then
    raise exception 'ESME_INVALID_POLICY: the per-action cap must be a whole number between 1 and 500';
  end if;
  if p_max_bonus_points_per_member_per_period is null
     or p_max_bonus_points_per_member_per_period < 1 then
    raise exception 'ESME_INVALID_POLICY: the period ceiling must be a whole number of points';
  end if;
  if p_max_bonus_points_per_member_per_period < 3 * p_max_bonus_points_per_action then
    raise exception 'ESME_INVALID_POLICY: at % points per % days, three ordinary bonuses of % points would not fit',
      p_max_bonus_points_per_member_per_period, p_period_days, p_max_bonus_points_per_action;
  end if;
  if p_period_days is null or p_period_days < 7 or p_period_days > 365 then
    raise exception 'ESME_INVALID_POLICY: the rolling window has to be between 7 and 365 days';
  end if;
  if p_escalate_warnings_after is null
     or p_escalate_warnings_after < 1 or p_escalate_warnings_after > 10 then
    raise exception 'ESME_INVALID_POLICY: escalate between 1 and 10 warnings';
  end if;
  if p_period_days < 30 and p_escalate_warnings_after > 2 then
    raise exception 'ESME_INVALID_POLICY: a window shorter than a month cannot reasonably wait for three warnings';
  end if;
  -- A role with no capability row cannot act however the matrix is drawn; this keeps the two honest.
  if exists (
    select 1 from unnest(p_can_award_bonus) r
     where not exists (
       select 1 from esme_role_capabilities rc
        where rc.role = r::esme_role and rc.capability = 'rewards.write'
     )
  ) then
    raise exception 'ESME_INVALID_POLICY: % has no rewards.write capability, so the matrix cannot grant it a bonus',
      (select r::text from unnest(p_can_award_bonus) r
        where not exists (
          select 1 from esme_role_capabilities rc
           where rc.role = r::esme_role and rc.capability = 'rewards.write'
        ) limit 1);
  end if;

  update esme_reward_policy
     set can_award_bonus = p_can_award_bonus,
         can_issue_warning = p_can_issue_warning,
         max_bonus_points_per_action = p_max_bonus_points_per_action,
         max_bonus_points_per_member_per_period = p_max_bonus_points_per_member_per_period,
         period_days = p_period_days,
         escalate_warnings_after = p_escalate_warnings_after,
         notify_roles_on_escalation = p_notify_roles_on_escalation,
         updated_at = now(),
         updated_by = v_actor.id
   where id = 1
  returning * into v_result;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'REWARD_POLICY_UPDATED', 'reward_policy',
          '1',
          'bonus cap ' || v_result.max_bonus_points_per_action ||
          ', period ' || v_result.period_days || 'd, escalate after ' ||
          v_result.escalate_warnings_after ||
          '; applies to entries written after this one, never to entries already filed');

  return v_result;
end;
$$;

-- ==================================================== audit vocabulary ====
-- An officer correcting a bonus is not a score edit by a reviewer; the trail says what it was.

alter table esme_audit_log drop constraint esme_audit_log_target_type_check;
alter table esme_audit_log add constraint esme_audit_log_target_type_check check (
  target_type in ('profile', 'committee', 'task', 'submission', 'score', 'registration',
                  'content', 'media', 'setting', 'system', 'reward', 'reward_policy')
);

-- ================================================================== RLS ====

alter table esme_reward_entries enable row level security;
alter table esme_reward_policy enable row level security;

-- An officer reads what their scope reaches; a member always reads their own record, and an actor
-- always reads what they filed. Nothing more is visible, and no browser role writes the table.
create policy esme_reward_read on esme_reward_entries
  for select to authenticated
  using (
    esme_reaches_profile(target_id, 'rewards.read')
    or target_id = esme_current_profile_id()
    or actor_id = esme_current_profile_id()
  );

create policy esme_reward_policy_read on esme_reward_policy
  for select to authenticated
  using (esme_has_capability('rewards.read'));

grant select on esme_member_reward_records to authenticated;
grant select on esme_reward_entries, esme_reward_policy to authenticated;

revoke insert, update, delete on esme_reward_entries from anon, authenticated;
revoke insert, update, delete on esme_reward_policy from anon, authenticated;

revoke all on function esme_assert_reward_target(uuid, text) from anon;
revoke all on function esme_assert_reward_reason(text, text) from anon;
revoke all on function esme_award_bonus(uuid, integer, text, text, text) from anon;
revoke all on function esme_issue_warning(uuid, esme_warning_severity, text, text, text) from anon;
revoke all on function esme_reverse_reward_entry(uuid, text) from anon;
revoke all on function esme_acknowledge_warning(uuid) from anon;
revoke all on function esme_update_reward_policy(esme_role[], esme_role[], integer, integer, integer, integer, esme_role[]) from anon;

grant execute on function esme_award_bonus(uuid, integer, text, text, text) to authenticated;
grant execute on function esme_issue_warning(uuid, esme_warning_severity, text, text, text) to authenticated;
grant execute on function esme_reverse_reward_entry(uuid, text) to authenticated;
grant execute on function esme_acknowledge_warning(uuid) to authenticated;
grant execute on function esme_update_reward_policy(esme_role[], esme_role[], integer, integer, integer, integer, esme_role[]) to authenticated;

commit;
