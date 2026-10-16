-- ESME CU ERP — REFERENCE CONTENT ONLY (development / first install)
--
-- What this file is: the official chapter identity a public site needs to render —
-- committee structure, the registration form schema, the 2026-2027 season plan and
-- the approved website copy.
--
-- What this file deliberately is NOT: a demo dataset. It inserts no people, no
-- accounts, no tasks, no submissions, no scores, no applications, no notifications
-- and no audit events. Operational tables stay empty and the ERP renders them as
-- empty states until real records exist.
--
-- Run manually, once, against a development or freshly provisioned project:
--   supabase db execute --file supabase/dev_seed_reference.sql   (or paste in the SQL editor)
-- It is never referenced by a migration, a build step or a poststart hook, so a
-- production boot cannot re-run it by accident.

begin;

-- ------------------------------------------------------------ committees ----
-- Names, sub-teams and objectives are official chapter structure. director_id and
-- head_id stay NULL: assignment happens through the ERP once real profiles exist.

insert into esme_committees (name, short_code, description, category, objectives, sub_teams, is_public) values
  ('Technical Committee', 'TE',
   'Engineering studies, materials research, inspection practice and technical deliverables for the chapter.',
   'technical',
   array['Deliver the technical programme of the season', 'Build member capability in materials and NDT practice'],
   array['Materials Science', 'Inspection & NDT', 'Engineering Software', 'Technical Research'],
   true),
  ('Media Committee', 'MC',
   'Photography, film, design output and the chapter visual record.',
   'media',
   array['Document chapter activities', 'Maintain the visual identity across outputs'],
   array['Photography', 'Film', 'Graphic Design'],
   true),
  ('Marketing Committee', 'MK',
   'Campaigns, outreach, partnerships and audience growth.',
   'marketing',
   array['Grow qualified reach', 'Support recruitment and event campaigns'],
   array['Campaigns', 'Content Strategy', 'Partnerships'],
   true),
  ('Design Committee', 'DS',
   'Product and experience design, layouts and templates across chapter materials.',
   'management',
   array['Provide reusable design systems for chapter output'],
   array['UX & Layout', 'Templates'],
   true)
on conflict (name) do nothing;

-- ------------------------------------------------- registration form schema ----

insert into esme_registration_fields (name, label, field_type, required, enabled, options, description, sort_order) values
  ('full_name', 'Full name', 'text', true, true, array[]::text[], 'As it appears in university records.', 1),
  ('university_email', 'University email', 'email', true, true, array[]::text[], 'Used for verification and chapter correspondence.', 2),
  ('student_id', 'Student ID', 'text', false, true, array[]::text[], null, 3),
  ('academic_year', 'Academic year', 'select', true, true,
   array['1', '2', '3', '4', '5'], null, 4),
  ('department', 'Department', 'select', true, true,
   array['Mechatronics', 'Biomedical', 'Electrical', 'Mechanical', 'Civil', 'Architecture', 'Other'], null, 5),
  ('phone', 'Phone', 'tel', true, true, array[]::text[], 'WhatsApp contact for the chapter.', 6),
  ('preferred_committee', 'Preferred committee', 'select', true, true,
   array['Technical Committee', 'Media Committee', 'Marketing Committee', 'Design Committee'], null, 7),
  ('second_committee_preference', 'Second choice committee', 'select', false, true,
   array['Technical Committee', 'Media Committee', 'Marketing Committee', 'Design Committee'], null, 8),
  ('technical_skills', 'Technical skills', 'textarea', true, true, array[]::text[],
   'Tools, languages or lab techniques you already use.', 9),
  ('previous_experience', 'Previous experience', 'textarea', false, true, array[]::text[], null, 10),
  ('motivation', 'Why ESME CU?', 'textarea', true, true, array[]::text[], null, 11),
  ('availability_hours', 'Weekly availability (hours)', 'select', true, true,
   array['0-3', '4-6', '7-10', '10+'], null, 12),
  ('agreed_to_policies', 'I accept the privacy policy and chapter terms', 'checkbox', true, true,
   array[]::text[], 'Required before the request enters the approval queue.', 13)
on conflict (name) do nothing;

-- --------------------------------------------------------- website content ----
-- Approved copy from the chapter's own material. Sections are unpublished by
-- default except the homepage, which the public site renders from here.

insert into esme_content_pages (slug, title, nav_label, section_key, body, nav_order, in_navigation, published) values
  ('/', 'ESME CU Student Chapter', null, 'home',
   jsonb_build_object(
     'hero', jsonb_build_object(
       'badge', 'ESME CU Student Chapter',
       'headline', 'Engineering knowledge, applied together.',
       'supportingMessage', 'A student chapter for mechatronics and systems engineering: technical studies, workshops, field campaigns and a scientific magazine run by students.',
       'ctaPrimary', 'Join the chapter',
       'ctaSecondary', 'See our season plan'
     ),
     'about', jsonb_build_object(
       'title', 'About ESME CU',
       'story', 'The Cairo University branch of the European Student Materials Engineering network brings students together around materials science, inspection practice and engineering software.',
       'purpose', 'Turn classroom theory into applied engineering through deliverables, review and mentorship.',
       'objectives', jsonb_build_array('Build practical engineering capability', 'Publish a scientific magazine', 'Run technical workshops and field campaigns'),
       'values', jsonb_build_array('Rigor', 'Collaboration', 'Knowledge sharing', 'Integrity')
     ),
     'vision2027', jsonb_build_object(
       'headline', 'Vision 2027',
       'quote', 'A chapter where every member can point to a deliverable they made.',
       'description', 'The 2026-2027 season concentrates on technical depth, an outside audience for the magazine, and reliable delivery.',
       'pillars', jsonb_build_array(
         jsonb_build_object('title', 'Technical depth', 'description', 'Materials and inspection competence, assessed and documented.', 'points', jsonb_build_array('Skill matrix per member', 'Reviewed deliverables')),
         jsonb_build_object('title', 'Knowledge transfer', 'description', 'The magazine and workshops carry chapter knowledge beyond the team.', 'points', jsonb_build_array('Editorial calendar', 'Workshop programme')),
         jsonb_build_object('title', 'Sustainable operations', 'description', 'Task flow, scoring and review that survive a change of board.', 'points', jsonb_build_array('Audited scoring', 'Committee handover notes'))
       )
     ),
     'contact', jsonb_build_object(
       'email', '', 'phone', '', 'website', '', 'socialHandle', '',
       'location', 'Cairo University, Giza, Egypt'
     )
   ),
   1, false, true),
  ('/join', 'Join ESME CU', 'Join', 'join',
   jsonb_build_object(
     'headline', 'Apply to the chapter',
     'supportingMessage', 'Applications are reviewed by the chapter board. Verified email addresses are approved or rejected from the registration queue.',
     'ctaPrimary', 'Submit an application'
   ),
   2, true, true),
  ('/events', 'Season plan', 'Season', 'events',
   jsonb_build_object('headline', '2026 - 2027 season', 'supportingMessage', 'Planned activities by quarter. Status shows preparation, not results.'),
   3, true, true),
  ('/committees', 'Committees', 'Committees', 'committees',
   jsonb_build_object('headline', 'How the chapter works', 'supportingMessage', 'Four committees, each with its own deliverables and review path.'),
   4, true, true)
on conflict (slug) do nothing;

-- --------------------------------------------------------- season plan ----
-- Planned work is recorded as Planned. No metric here is presented as achieved.

insert into esme_season_events (title, acronym, category, theme, date_or_quarter, status, target_metric, responsible_committee, description, is_public) values
  ('Materials Science Foundation Sessions', null, 'Professional Session', 'Core materials theory applied to chapter studies', 'Q1 2026-2027', 'Planned', '8 sessions delivered', 'Technical Committee', 'Weekly sessions building the shared technical base before the magazine cycle starts.', true),
  ('Engineering Software Workshop', 'ESW', 'Workshop', 'Simulation and scripting for materials studies', 'Q1 2026-2027', 'Planned', '25 attendees', 'Technical Committee', 'Hands-on workshop on the tooling used in chapter studies.', true),
  ('Scientific Magazine - Issue 1', 'MAG1', 'Magazine Issue', 'Student-authored materials engineering topics', 'Q2 2026-2027', 'Planned', '1 published issue', 'Media Committee', 'Editorial cycle: commissioning, review, layout and release.', true),
  ('Inspection & NDT Field Campaign', 'NDT1', 'Field Campaign', 'Non-destructive testing in practice', 'Q2 2026-2027', 'Planned', '1 site visit', 'Technical Committee', 'Site visit with a partner facility, arranged once a partner is confirmed.', true),
  ('Recruitment Drive', 'REC1', 'Major Event', 'Open the chapter to the next cohort', 'Q3 2026-2027', 'Planned', '60 applicants', 'Marketing Committee', 'Campain campaign, information session and the approval queue.', true),
  ('Scientific Magazine - Issue 2', 'MAG2', 'Magazine Issue', 'Second editorial cycle with wider authorship', 'Q4 2026-2027', 'Planned', '1 published issue', 'Media Committee', 'Second issue, carrying the mentorship model from the first.', true),
  ('Year Closing Technical Review', 'REV1', 'Professional Session', 'Season results and handover', 'Q4 2026-2027', 'Planned', '1 review document', 'Technical Committee', 'End-of-season review and handover notes for the next board.', true)
on conflict do nothing;

-- ---------------------------------------------------------------- KPI ----
-- Targets are configured values. `actual` is left NULL until someone records a
-- verified measurement through the ERP.

insert into esme_kpi_targets (season, metric, target) values
  ('2026-2027', 'Active members', 40),
  ('2026-2027', 'Tasks approved', 120),
  ('2026-2027', 'Workshops delivered', 6),
  ('2026-2027', 'Magazine issues published', 2),
  ('2026-2027', 'Applications received', 60)
on conflict (season, metric) do nothing;

-- Deliberately absent: esme_profiles, esme_committee_memberships, esme_tasks,
-- esme_task_assignments, esme_submissions, esme_score_ledger,
-- esme_registration_requests, esme_skill_matrix, esme_notifications,
-- esme_audit_log. Those hold real records or stay empty.

commit;
