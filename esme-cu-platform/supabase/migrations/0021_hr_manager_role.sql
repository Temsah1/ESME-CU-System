-- ============================================================ 0021: the HR Manager role
-- Adds one role label and its capability rows. No existing role moves, no policy changes, no
-- table changes: every statement below is additive, which is what lets the workspace keep
-- behaving exactly as it did for the six roles 0001 through 0020 already define.
--
-- SQL mirror of `hr_manager` in src/domain/roles.ts. migrationIntegrity.test.ts proves the two
-- declare the same roles and the same capability names, so a matrix row cannot be added in one
-- place and forgotten in the other.
--
-- WHAT THIS ROLE IS: the chapter's people operations — recruiting, the registration queue, the
-- directory, placement into committees, and reading anyone's record. WHAT IT IS NOT: finance,
-- the website, settings, backups, the audit trail, or the ability to create another officer.
--   * No `users.role.assign`: an HR Manager cannot grant or revoke roles, including their own.
--   * No `users.delete`: they deactivate with `users.suspend`; a hard delete stays a Super Admin act.
--   * No `cms.*`, `audit.read`, `settings.manage`, `integrations.manage`, `backups.manage`.
--   * Read-only on other people's work: `tasks.read`, `submissions.read`, `scores.read` and
--     `events.read` at `all`, with no matching write, review or assign grant.
--   * `committees.write` at `all` is the staffing capability: it is the only existing grant that
--     lets a roster move be recorded, and it travels with `committees.read`. Leadership seats still
--     move through the RPC in 0004, which re-reads this matrix inside the transaction.
--
-- NO MIGRATION IN THIS REPOSITORY HAS BEEN EXECUTED — there is no Postgres in this environment.
-- See supabase/README.md. supabase/migrations/migrationIntegrity.test.ts is the static substitute.

-- ===================================================== the hr_manager label ====
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction that consumes the new label, and the
-- statement below seeds capability rows for it, so this line runs on its own before the
-- transaction opens. Exactly the shape 0006 used for `high_board`.
--
-- The label is appended last, which keeps its position in esme_role meaningless as an ordering.
-- Seniority is read through esme_role_rank(), never through < or > on the enum itself.

alter type esme_role add value if not exists 'hr_manager';

begin;

/**
 * ROLE_RANK in src/domain/roles.ts, in SQL. HR Manager sits at 60: below the board and the IT
 * Moderator, above a Committee Director, so "actions only travel downwards" lets them recognise a
 * Director or a Member and refuses anything aimed at the board. Same rule as 0006, one label added.
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
    when 'hr_manager' then 60
    when 'director' then 50
    when 'head' then 40
    else 10
  end
$$;

-- ================================================ capability matrix seed ====
-- Only hr_manager rows. `on conflict do nothing` keeps this re-runnable; not one row for another
-- role is touched, which is the proof that existing permissions did not move.

insert into esme_role_capabilities (role, capability, scope) values
  -- The directory: read the chapter, seat someone, correct a record, deactivate. Not delete.
  ('hr_manager', 'users.read', 'all'),
  ('hr_manager', 'users.create', 'all'),
  ('hr_manager', 'users.update', 'all'),
  ('hr_manager', 'users.suspend', 'all'),
  -- Recruitment: the queue is read and decided, which is how an application becomes a member.
  ('hr_manager', 'registrations.read', 'all'),
  ('hr_manager', 'registrations.decide', 'all'),
  -- Placement: see the structure, move people inside it. Archiving a committee stays above them.
  ('hr_manager', 'committees.read', 'all'),
  ('hr_manager', 'committees.write', 'all'),
  -- Chapter-wide reading of other people's work, with no write, review or assign alongside it.
  ('hr_manager', 'tasks.read', 'all'),
  ('hr_manager', 'submissions.read', 'all'),
  ('hr_manager', 'scores.read', 'all'),
  ('hr_manager', 'events.read', 'all'),
  ('hr_manager', 'skills.read', 'all'),
  -- Reporting on people, and the announcements that go with it.
  ('hr_manager', 'analytics.configure', 'all'),
  ('hr_manager', 'notifications.manage', 'all'),
  -- Recognition is people operations; discipline (rewards.configure) and reversal are not.
  ('hr_manager', 'rewards.read', 'all'),
  ('hr_manager', 'rewards.write', 'all')
on conflict (role, capability) do nothing;

commit;

-- =============================================================== what to probe ====
-- P-numbers continue the list in supabase/probes/. Run these against a real database before
-- calling this migration applied:
--   P71 as hr_manager, select from esme_profiles                       -> succeeds (users.read at all)
--   P72 as hr_manager, esme_assign_role(<id>, 'hr_manager')            -> refused, no users.role.assign
--   P73 as hr_manager, delete from esme_profiles where id = <member>   -> refused, no users.delete
--   P74 as hr_manager, esme_set_account_status(<member>, 'suspended')  -> succeeds (users.suspend at all)
--   P75 as hr_manager, select from esme_audit_log                      -> refused, no audit.read
--   P76 as hr_manager, select from esme_content_pages                    -> refused, no cms capability
--   P77 as hr_manager, esme_award_bonus(<head>, 10, 'reason', null, k) -> succeeds, rank 60 beats 40
--   P78 as hr_manager, esme_award_bonus(<high_board>, 10, ...)         -> ESME_ABOVE_RANK
--   P79 as hr_manager, esme_update_reward_policy(...)                  -> refused, no rewards.configure
--   P80 as super_admin, esme_assign_role(<id>, 'hr_manager')           -> succeeds
--   P81 as director, esme_assign_role(<id>, 'hr_manager')              -> ESME_FORBIDDEN: 0010 treats every
--        label except `member` as privileged, so a newly added role is protected the moment it exists.
