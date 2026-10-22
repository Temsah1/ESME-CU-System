-- ESME CU ERP — security hardening: privilege columns and view privileges
-- Apply after 0008_seed_test_accounts.sql.
--
-- This migration exists because the 2026-10-22 line-by-line review found two authorization controls
-- that did not hold. Neither was patched in place: 0002 and 0001 stay exactly as they are, and the
-- rules below are the forward fix. See PROJECT_MASTER_GUIDE.md §2 "Confirmed now (2026-10-22
-- database gate)" findings 1 and 2 for the evidence.
--
--   Finding 1 (Critical) — self-service role escalation.
--     esme_profiles_update (0002:833-849) checks `esme_reaches_profile(id, 'users.update')` in its
--     WITH CHECK. A Head or Director holds users.update with `committee` scope, and that scope
--     includes the caller's own row, so the branch accepts *any* new column values for a reachable
--     profile — including `role = 'super_admin'` and `status = 'active'`. 0004's channel guards
--     freeze esme_committees.director_id/head_id and esme_profiles.committee_id, never role or
--     status, and no trigger did. A hand-made PATCH to PostgREST therefore granted privilege without
--     ever calling esme_assign_role(). A Head could also have activated a pending peer directly,
--     bypassing the registrations.decide capability that esme_decide_registration() enforces.
--
--   Finding 2 (High) — three granted views read as their owner, not as the caller.
--     esme_member_scores, esme_committee_rosters and esme_member_reward_records are ordinary views,
--     so Postgres evaluates them with the view owner's rights: the RLS policies on esme_profiles,
--     esme_score_ledger, esme_committee_memberships and esme_reward_entries were never consulted for
--     anybody selecting through them. `security_invoker` appeared nowhere in 0001-0008 while 0002:1047
--     claimed the opposite in a comment. Supabase's default privileges also grant SELECT on new
--     public relations to `anon`, which would have made the leaderboard anonymous.
--
-- What this file does NOT claim
--   Nothing here has been executed. There is no PostgreSQL in the authoring environment, so the
--   correctness of the trigger ordering, of `security_invoker` on the staging server version, and of
--   the base-table grants is settled by supabase/probes/authorization_probes.sql P15–P19 on a real
--   staging project — not by this file's own prose.
--   A `security_invoker` view is only as narrow as the policies underneath it: changing the option
--   without SELECT on the base relations makes the view *raise*, and a raised permission error is not
--   a filtered result. Both halves are handled below and probed by P16 (raises vs filters), P18 (a
--   Member seeing another member's reward row) and P19 (a view's count matching the scope it claims).

begin;

-- ===================================== 1. privilege columns are RPC-only ====

/**
 * The rule the 0002 policy could not express. A policy sees only the row about to be stored, so
 * "role and status did not move" needs both versions — exactly why the publication rule became a
 * trigger in 0002 and why the seat columns became one in 0004.
 *
 * esme_called_directly() (0004:159) is true only when the statement came straight from an API role:
 * inside a SECURITY DEFINER function current_user is the owner while session_user stays the JWT's
 * role, so esme_assign_role(), esme_decide_registration(), esme_set_account_status(), the 0003
 * bootstrap and the 0008 seed all keep working, and no browser request can.
 *
 * Ordinary profile edits are preserved deliberately: display_name, avatar_url, phone, department,
 * academic_year, sub_team and the rest still go through esme_profiles_update unchanged. Only the two
 * privilege columns change behaviour here.
 */
create or replace function esme_assert_privilege_channel()
returns trigger
language plpgsql
as $$
begin
  if not esme_called_directly() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'member' then
      raise exception 'ESME_ROLE_FUNCTION_ONLY: a new profile is a member; esme_assign_role() grants anything else';
    end if;
    if new.status is distinct from 'pending_approval' then
      raise exception 'ESME_STATUS_FUNCTION_ONLY: a new profile enters the queue; esme_decide_registration() activates it';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'ESME_ROLE_FUNCTION_ONLY: esme_profiles.role moves through esme_assign_role() only'
      using hint = 'A Super Admin grants roles from the account directory; that call is checked against users.role.assign.';
  end if;
  if new.status is distinct from old.status then
    raise exception 'ESME_STATUS_FUNCTION_ONLY: esme_profiles.status moves through esme_set_account_status() or esme_decide_registration() only'
      using hint = 'Activation is a registration decision, not a column a committee editor can set.';
  end if;

  return new;
end;
$$;

create trigger esme_profiles_privilege_channel
  before insert or update on esme_profiles
  for each row execute function esme_assert_privilege_channel();

comment on column esme_profiles.role is
  'Server-side only. 0002 documented esme_assign_role() as the only path; 0009 made that a trigger, so '
  'a direct write to this column is refused for an API role and still allowed inside the definer functions.';
comment on column esme_profiles.status is
  'Server-side only. Guarded by the status transition trigger (0002, rewritten by 0007) and, from 0009, '
  'by the privilege channel guard that refuses a direct status write altogether.';

-- ================================================== 2. views run as the caller ====

-- The option makes every base-table access inside the view use the *caller*'s privileges and RLS
-- policies, so the scopes in 0002 and 0006 are what answer: a Member reads its own aggregate, a
-- Head or Director their committee, an officer with `all` scope the chapter. Requires PostgreSQL 15+
-- and SELECT on the base relations, which is why the grants below are part of this fix rather than an
-- assumption about the project's defaults.
alter view esme_member_scores set (security_invoker = true);
alter view esme_committee_rosters set (security_invoker = true);
alter view esme_member_reward_records set (security_invoker = true);

-- Explicit, narrow base-table reads for the callers these views are granted to. Every one of these
-- tables already has RLS enabled and a for-select policy written for `authenticated`; granting here
-- only stops a project with tightened default privileges from seeing a permission error where it
-- should see a filtered row. No DML is granted: writes stay RPC-only.
grant select on esme_profiles, esme_score_ledger to authenticated;
grant select on esme_committees, esme_committee_memberships to authenticated;
grant select on esme_reward_entries to authenticated;

-- The default grants Supabase installs for `anon` and `public` are wider than this schema's policies
-- intend. Anonymous traffic may read published content, public committees, public events, public
-- media and enabled registration fields — the explicit `to anon` policies in 0002 — and nothing else.
-- Revoking the aggregate views closes the widest gap: none of the three should ever have been
-- anonymous-readable.
revoke all on esme_member_scores from anon, public;
revoke all on esme_committee_rosters from anon, public;
revoke all on esme_member_reward_records from anon, public;

-- Re-state the intended grants so the file is readable on its own: authenticated keeps select, anon
-- keeps nothing. (These are the 0002/0006 grants; repeating them is idempotent.)
grant select on esme_member_scores, esme_committee_rosters to authenticated;
grant select on esme_member_reward_records to authenticated;

-- Other relations the public site is not meant to browse through PostgREST, same reasoning as above.
-- Tables with an explicit `to anon` policy keep working; those policies live in 0002 and are not
-- touched here — this only removes the default privilege that bypassed them.
revoke all on esme_score_ledger, esme_reward_entries from anon, public;
revoke all on esme_committee_memberships, esme_leadership_seats from anon, public;
revoke all on esme_audit_log, esme_email_outbox, esme_email_log from anon, public;
revoke all on esme_registration_requests, esme_role_capabilities from anon, public;

comment on view esme_member_scores is
  'Derived points per active member. security_invoker since 0009: reads are filtered by the scores.read '
  'and users.read scopes on the base tables, not by the view owner''s rights.';
comment on view esme_committee_rosters is
  'Active member counts per committee. security_invoker since 0009; anon holds no SELECT.';
comment on view esme_member_reward_records is
  'Bonus totals and active warning counts. security_invoker since 0009, so the rewards.read scope in '
  '0006 is what decides visibility.';

commit;

-- After applying, in a staging project with at least two active members:
--   P15 (a Head writing esme_profiles.role directly) must now print PASS — refused with
--        ESME_ROLE_FUNCTION_ONLY.
--   P16 (a Member counting esme_member_scores) must now print PASS, and its row count must equal the
--        member's own reachable profiles rather than every active one.
--   A Member calling `select * from esme_member_reward_records` through REST must see its own row only —
--        that is P18, and it counts rows the caller is not supposed to see, so a non-zero answer is a
--        FAIL rather than an empty result.
--   P19 compares `select count(*) from esme_committee_rosters` against the committees a
--        `committees.read` scope reaches. Equal means the view now answers with the policies; a larger
--        count means it is still executing as its owner.
-- If P16 raises `permission denied for table esme_profiles`, the base-table grants above were not
-- applied — that is a failed migration, not a passing probe.
