-- ESME CU ERP — task management: editing, archival and safe deletion
-- Apply after 0013_season_planner_management.sql.
--
-- What this changes
--   1. esme_tasks gains archived_at and archived_by. Archiving is the reversible retire path:
--      assignments, submissions and score-ledger rows keep pointing at the task, so the history
--      stays readable and the row can be restored.
--   2. esme_tasks_delete becomes committee-aware. It used to test esme_has_capability('tasks.delete')
--      alone (0002:954-956), while esme_tasks_update tested esme_reaches_committee(…, 'tasks.write').
--      Any future role granted the delete capability would therefore reach every committee's
--      tasks. The delete policy now uses the same reaches_committee shape as the update policy.
--   3. esme_guard_task_delete() refuses a hard delete once a submission or a ledger row refers
--      to the task. esme_submissions.task_id cascades and esme_score_ledger.task_id sets null
--      (0001:257, 0001:284): deleting such a row would either erase a deliverable or blank the
--      evidence attached to awarded points. The archive path exists for exactly this case.
--
-- What this deliberately does NOT change
--   * No row is deleted, moved or backfilled. Existing tasks keep archived_at null, which means
--     "live", so every dashboard, action queue and metric behaves as before.
--   * The capability matrix is untouched. Only super_admin holds tasks.delete (0002:28); director
--     and head write tasks in their own committee and still cannot delete them. Widening that is a
--     product decision, not a side effect of this file.
--   * The task, assignment and submission foreign keys are unchanged. The guard stops a cascade
--     from starting; it does not rewrite the constraint for a deliberate service-role cleanup.
--   * esme_tasks_read / write / update keep their definitions. No policy is dropped except the one
--     replaced below, and there is no data migration.
--   * Persistence is still NOT IMPLEMENTED: the dashboard store writes localStorage, as 0013's
--     operator notes record. This file changes what the database accepts, not what the browser
--     sends. Applying it does not, by itself, make the task screen read or write these columns.
--
-- Probes for staging (add to supabase/probes/authorization_probes.sql if they are wanted):
--   P35  as super_admin, delete an esme_tasks row with no submission and no ledger row -> succeeds.
--   P36  as super_admin, delete the same kind of row after one submission exists -> refused with
--        ESME_TASK_HAS_HISTORY; the submission still exists.
--   P37  as director, delete a task in own committee -> refused (no tasks.delete); update -> allowed.
--   P38  as member, update esme_tasks.title directly through PostgREST -> zero rows changed.

begin;

alter table esme_tasks
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references esme_profiles (id) on delete set null;

comment on column esme_tasks.archived_at is
  '0014: null means live. Dashboards, action queues and metrics exclude archived rows; the row itself stays for history.';

create index if not exists esme_tasks_live_idx
  on esme_tasks (committee_id, status)
  where archived_at is null;

-- Replace the capability-only delete policy with the same committee scope the update policy uses.
drop policy if exists esme_tasks_delete on esme_tasks;

create policy esme_tasks_delete on esme_tasks
  for delete to authenticated
  using (esme_reaches_committee(committee_id, 'tasks.delete'));

create or replace function esme_guard_task_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from esme_submissions where task_id = old.id) then
    raise exception 'ESME_TASK_HAS_HISTORY: this task has submitted work'
      using hint = 'Archive the task instead of deleting it; the deliverables stay attached.';
  end if;
  if exists (select 1 from esme_score_ledger where task_id = old.id) then
    raise exception 'ESME_TASK_HAS_HISTORY: this task is recorded in the score ledger'
      using hint = 'Archive the task instead of deleting it; the awarded points keep their evidence.';
  end if;
  return old;
end;
$$;

drop trigger if exists esme_tasks_guard_delete on esme_tasks;

create trigger esme_tasks_guard_delete
  before delete on esme_tasks
  for each row execute function esme_guard_task_delete();

commit;
