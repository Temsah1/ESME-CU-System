-- ESME CU ERP — the people who run the season plan can write it
-- Apply after 0012_self_service_registration.sql.
--
-- What this changes
--   Two rows in esme_role_capabilities. Nothing else.
--
--   The Season Planner screen and its RLS policy already exist and already work: esme_events_write
--   (0002:936-939) is a FOR ALL policy gated on the single capability events.write, so it covers
--   INSERT, UPDATE and DELETE together, and esme_has_capability() reads this table live. The reason
--   an IT Moderator or a High Board member could read the plan and not change it was never a missing
--   policy — it was that 0002 and 0006 gave them events.read and stopped. So this file adds the
--   capability, not a new gate.
--
-- What this deliberately does NOT change
--   * No policy is created, altered or dropped. The events row is the only write path into
--     esme_season_events, and it stays gated on the same capability check.
--   * events.write buys the season plan and nothing else. It is not cms.content.write, not
--     cms.content.publish, not cms.media.manage, not settings.manage, not users.role.assign and not
--     users.suspend. A High Board member who can move a milestone to 'Confirmed' still cannot publish
--     the website, read the audit trail of a role change they were not involved in, or grant anybody a
--     role. The matrix rows in 0002:97-103 and 0006:71-84 stay exactly as they are otherwise.
--   * Ordinary members and every other role keep what they had. 'member' gets no events.write here,
--     so a member reading the public plan still cannot change it — from the browser or from a
--     hand-made REST request, because the refusal is in the policy, not in the button.
--   * director keeps the committee-scoped events.write it already had (0002:78). This file does not
--     widen it to 'all'; a director plans their own committee's milestones.
--   * No backfill, no data movement. esme_season_events rows are untouched.

begin;

insert into esme_role_capabilities (role, capability, scope) values
  -- IT Moderator — runs the registration queue, the CMS and now the plan.
  ('moderator', 'events.write', 'all'),
  -- High Board — organization-wide view since 0006; the plan is organization-wide too.
  ('high_board', 'events.write', 'all')
-- Re-running this migration is a no-op rather than an error, and it cannot drift the scope: the row
-- is rewritten to exactly the value this file intends.
on conflict (role, capability) do update set scope = excluded.scope;

comment on column esme_role_capabilities.capability is
  '0013 added events.write for moderator and high_board. The capability is the whole authorization for '
  'the season plan: esme_events_write (0002) is a FOR ALL policy that checks nothing else, so this row '
  'also decides who may delete an event.';

commit;

-- ============================== operator notes ====
--
-- Deleting an event is now a real possibility for three more roles, and it is a hard delete.
--   esme_season_events has no inbound foreign key in any migration (0001:202-223 is the only
--   definition; esme_score_action merely carries an 'event_attendance' label at 0001:43, which is not
--   a reference). So DELETE from the planner cannot orphan a submission, a task or a ledger row the
--   way deleting a task can. What it does destroy is the record that a milestone was ever planned —
--   which is why the screen asks for confirmation, and why a finished season should be marked
--   'Completed' rather than removed.
--
-- Frontend state, which this file cannot fix.
--   The planner screen reads the browser's stored plan, not esme_season_events: no adapter method
--   anywhere in src/auth writes that table. Applying this migration therefore changes what the
--   database will accept from a direct REST call, and it changes what the dashboard's own capability
--   check reports, but it does not by itself make the dashboard persist to Supabase. Treating the two
--   as the same thing is how a chapter ends up believing its plan is shared when it is one laptop's
--   storage. The persistence gap is recorded as NOT IMPLEMENTED, not papered over.
--
-- Probes for staging (add to supabase/probes/authorization_probes.sql if you want them executed):
--   P31  as moderator, insert/update/delete esme_season_events -> all three succeed.
--   P32  as high_board, same three -> all three succeed.
--   P33  as member, same three -> all three refused by RLS with zero rows changed.
--   P34  as high_board, select from esme_settings and attempt esme_assign_role('moderator') ->
--        refused; this migration granted the plan, not the platform.
