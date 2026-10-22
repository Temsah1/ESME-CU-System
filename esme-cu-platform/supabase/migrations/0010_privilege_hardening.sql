-- ESME CU ERP — privilege hardening: who may change a role, and what the trail says about it
-- Apply after 0009_security_hardening.sql.
--
-- 0009 closed the two findings from the 2026-10-22 database gate — a direct write to
-- esme_profiles.role and three views that read as their owner. This file continues down the same
-- path and closes three more differences between what the role-change rules claim and what the
-- server actually enforces. Nothing here widens anyone's permissions; every change below either
-- refuses something 0002 allowed or records something 0002 threw away.
--
--   Finding 7 (Medium now, Critical the moment IT gets the capability) — an account could change
--     its own role. esme_assign_role() (0002:646-681) checks the caller holds users.role.assign and
--     never compares p_user_id with the caller. esme_set_account_status() (0002:608) does exactly
--     that for status, with ESME_SELF_LOCKOUT, so the asymmetry is a gap rather than a decision.
--     Today only super_admin holds users.role.assign, so the reachable case is a Super Admin
--     demoting their own account and losing the only path back — a lockout. The brief's policy is
--     that IT administrators may also change roles; the moment that grant lands, this same line
--     becomes self-promotion, and 0002's audit insert would record it as a routine grant.
--
--   Finding 8 (Low today, same dependency) — the privileged-role list in SQL is stale.
--     0002:669 reads `p_role in ('super_admin','director','head','moderator')`. `high_board` is not
--     in that list because it did not exist until 0006 added the enum label, and the file was never
--     revisited. PRIVILEGED_ROLES in src/domain/roles.ts:65 lists five roles including high_board.
--     So the "same rules, checked where they actually bind" claim at 0002:643-645 is not true for
--     High Board: a grantee below Super Admin could hand out a chapter-wide read role while the
--     identical call for IT Moderator is refused. The fix below does not maintain a list at all.
--
--   Finding 9 (Auditability) — the audit line did not say what changed. Both functions select the
--     target row `for update` and then store only the new value and the target's email:
--     v_target.role and v_target.status are read and discarded. An operator reviewing the trail
--     after the fact can see which role an account holds now, and cannot see which role it held
--     before, which is the half of a privilege record that makes it evidence.
--
-- What this file does NOT claim
--   Nothing here has been executed. There is no PostgreSQL in the authoring environment. The rules
--   below are settled by supabase/probes/authorization_probes.sql P20 and P21 on a real staging
--   project — P20 attempts a self-targeted role change and P21 reads the audit row a legitimate
--   grant leaves behind. Until somebody watches this refuse an actual request, it is a hypothesis
--   with a passing static test, not a verified control.
--   A refusal inside a SECURITY DEFINER function still cannot be audited: the raise aborts the
--   transaction and the insert with it, so denied attempts land in the browser-side trail
--   (src/context/AppContext.tsx) and in the simulated server's journal
--   (src/auth/localDevAdapter.ts), not in esme_audit_log. Recording a refusal in the database needs
--   a separate, autonomous write path, which this schema does not have. That is a documented
--   limitation, not an oversight to paper over with a trigger.

begin;

-- ===================================== 1. nobody is their own privilege gate ====

/**
 * The rule that was missing, in the order the other checks already use: capability first, because
 * "your role does not grant this" is the answer a member needs and the cheapest one to compute;
 * the self-check second, so the message stays specific for an account that does hold the
 * capability. Mirrored in validateRoleChange() in src/domain/roles.ts, which refuses a self-target
 * for every role including super_admin.
 *
 * esme_is_primary_admin() and esme_has_capability() are unchanged, so 0003's bootstrap and 0008's
 * seed are unaffected: neither calls this function. 0009's esme_assert_privilege_channel() still
 * lets this UPDATE through, because inside a SECURITY DEFINER function esme_called_directly() is
 * false and the privilege columns stay RPC-only.
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
begin
  select * into v_actor from esme_profiles where id = esme_current_profile_id();
  select * into v_target from esme_profiles where id = p_user_id for update;
  if v_target.id is null then
    raise exception 'ESME_NOT_FOUND: profile';
  end if;

  if not esme_has_capability('users.role.assign') then
    raise exception 'ESME_FORBIDDEN: only a Super Admin may change roles';
  end if;
  if p_user_id = v_actor.id then
    raise exception 'ESME_SELF_ROLE_CHANGE: an account cannot raise or lower its own role'
      using hint = 'Ask a second Super Admin. A privilege that a caller can grant itself is not a privilege the '
                   'enforcement layer ever decided.';
  end if;
  -- Read together with the check above, this makes the primary Super Admin's role unchangeable: that
  -- account cannot move it itself, and nobody else may touch it. validateRoleChange() reaches the
  -- same result through its two primary-admin rules, so the two paths agree on the outcome rather
  -- than only on the wording.
  if esme_is_primary_admin(p_user_id) then
    raise exception 'ESME_PROTECTED_ACCOUNT: the primary Super Admin profile is read-only';
  end if;

  -- Every label except `member` is privileged, so a role added by a future migration is covered the
  -- day it exists instead of waiting for somebody to remember this line — which is how high_board
  -- came to be missing from 0002's list. Read together with the check above: a non-Super-Admin
  -- grantee may still demote to member, and may never hand out rank.
  if p_role <> 'member' and v_actor.role <> 'super_admin' then
    raise exception 'ESME_FORBIDDEN: only a Super Admin may grant a privileged role';
  end if;

  update esme_profiles set role = p_role where id = p_user_id;

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (v_actor.id, v_actor.display_name, v_actor.role, 'ROLE_ASSIGNED_' || upper(p_role::text),
          'profile', p_user_id::text,
          v_target.email::text || ': ' || v_target.role::text || ' -> ' || p_role::text);
end;
$$;

-- ============================================ 2. status keeps its own history ====

/**
 * Same treatment for the other privilege column. esme_set_account_status() already refused a
 * self-lockout; this version adds what 0002 threw away — the status the account held beforehand —
 * so a suspension, a reactivation and a decision all leave a before/after pair in the trail. The
 * rules themselves are unchanged: no caller may widen this function's permissions, and
 * ESME_SELF_LOCKOUT and ESME_PROTECTED_ACCOUNT keep their exact meanings.
 */
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
          'profile', p_user_id::text,
          v_target.email::text || ': ' || v_target.status::text || ' -> ' || p_status::text);
end;
$$;

comment on function esme_assign_role(uuid, esme_role) is
  'The only path that moves esme_profiles.role (0002, rules restated by 0010). Refuses a self-targeted '
  'change, refuses any privileged grant from below Super Admin where privileged means every role label '
  'except member, keeps the primary Super Admin read-only, and audits the previous role next to the new one.';
comment on function esme_set_account_status(uuid, esme_account_status) is
  'The path that moves esme_profiles.status outside a registration decision. Unchanged rules; 0010 adds '
  'the previous status to the audit line.';
comment on table esme_audit_log is
  'Append-only (0002 refuses UPDATE and DELETE). For a privilege row, actor_id and target_id name the '
  'accounts, action names the outcome the caller asked for, and details carries the previous value and '
  'the new one. A refusal never reaches this table: the raise that blocks it aborts its own transaction.';

commit;

-- After applying, in a staging project with at least one Super Admin and one other active member:
--   P20 (a Super Admin calling esme_assign_role on its own profile) must print PASS — refused with
--        ESME_SELF_ROLE_CHANGE — and the account's role must still be super_admin afterwards, which is
--        the part that matters: a refusal that half-wrote the row would be worse than no guard.
--   P21 (a Super Admin granting a role to somebody else) must print PASS and its audit line must name
--        both roles, e.g. `... : member -> moderator`. A line with only the new value means 0010 did
--        not replace the function — 0002's version is still the one in the project.
-- Neither probe needs a new psql variable: they find the Super Admin profile themselves and skip,
-- saying so, when the project has none.
