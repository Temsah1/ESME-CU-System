-- ESME CU ERP — the High Board runs the chapter's public content
-- Apply after 0014_task_management.sql.
--
-- What this changes
--   Four rows in esme_role_capabilities, all for high_board:
--     cms.content.write     open the Website CMS and draft page copy
--     cms.content.publish   put a reviewed draft live
--     cms.media.manage      upload, replace and retire library assets
--     cms.settings.global   save the global site document those screens edit
--
--   Why settings.global is in the list: the CMS screen's save path (AppContext.updateWebsiteContent)
--   is guarded by cms.settings.global, not by content.write. Granting only content.write would open
--   the screen and refuse every save — a visible page that cannot do its job. This is a CMS-scoped
--   capability, not settings.manage, and it does not reach any platform setting.
--
--   events.write for the Season Planner already belongs to moderator and high_board (0013), so the
--   "CMS / media / events" set is complete after this file. There is no timetable screen or table in
--   this build; nothing is invented here for one.
--
-- What this deliberately does NOT change
--   * No policy is created, altered or dropped. The CMS, media and settings policies already check
--     these capability names (0002), so one matrix row is the whole change.
--   * high_board still cannot assign roles, suspend accounts, read platform settings, manage
--     integrations or run backups. The 0006 rows for those stay absent.
--   * director and head keep the committee-scoped cms.content.write they already had (0002:78-95).
--     That is existing delegation of page copy inside their own committee; this file neither widens
--     it to 'all' nor revokes it. They still cannot publish.
--   * No content row is touched. Media assets and esme_content_pages are untouched.
--   * Browser persistence is still NOT IMPLEMENTED for the CMS: the store writes localStorage, as
--     0013's operator notes record. This file changes what the database accepts from a direct REST
--     call; it does not make the Website CMS read or write esme_content_pages.

begin;

insert into esme_role_capabilities (role, capability, scope) values
  ('high_board', 'cms.content.write', 'all'),
  ('high_board', 'cms.content.publish', 'all'),
  ('high_board', 'cms.media.manage', 'all'),
  ('high_board', 'cms.settings.global', 'all')
on conflict (role, capability) do update set scope = excluded.scope;

comment on column esme_role_capabilities.capability is
  '0015 added the cms.* suite for high_board. The CMS, media and settings policies already gate on '
  'these names, so no policy changed. Committee leads keep their existing committee-scoped content write.';

commit;

-- ============================== operator notes ====
--
-- Probes for staging (add to supabase/probes/authorization_probes.sql if they are wanted):
--   P39  as high_board, update esme_content_pages.title and publish it -> both succeed.
--   P40  as high_board, insert/delete an esme_media_assets row -> succeeds.
--   P41  as high_board, call esme_assign_role(...) or update esme_settings -> refused.
--   P42  as head, publish an esme_content_pages row -> refused (content.write only, committee-scoped).
