-- ESME CU ERP — the academic answers a signup carries, and the committee it names
-- Apply after 0010_privilege_hardening.sql.
--
-- Forward-only and additive: six columns on the approval queue, one reference committee row, one
-- helper function, a refreshed registration-form schema, and one new version of
-- esme_handle_new_auth_user(). Nothing is dropped, no existing row is rewritten, and no policy is
-- widened. A request submitted before this file reads its academic answers as NULL, which every
-- reader in the app renders as "Not recorded" rather than as a value nobody chose.
--
-- Why the queue needs the columns
--   The signup form now asks where the student studies (Department / القسم), which year they are in
--   (Academic Year / السنة الدراسية — year of study, not graduation year) and whether they already
--   belong to a committee (هل أنت عضو في أي كوميت؟), plus an optional Student ID and Phone when an
--   operator switches those rows on. src/auth/supabaseAdapter.ts:330 already sends all six answers
--   as signup metadata; 0007's trigger read six keys and threw these away, so a reviewer looking at
--   a Sup-backed queue saw an identity with an empty questionnaire.
--
-- Why the trigger had to be rewritten rather than extended
--   0007:120 files the committee as `nullif(meta ->> 'committee_id', '')::uuid`. That cast is a
--   landmine: this app's committee list is identified by its own stable ids (`comm_te`,
--   `comm_high_board`), and a uuid cast of one raises `invalid input syntax for type uuid`.
--   esme_handle_new_auth_user() is a BEFORE INSERT trigger on auth.users, so the raise does not
--   merely lose the committee — it aborts the signup and the auth user never exists. The new body
--   resolves the reference through esme_committee_reference() below, which returns NULL for a
--   committee it cannot place instead of raising. Fail-safe is the correct shape here because a
--   queue row with no committee named is readable and correctable by a reviewer, while a refused
--   registration is invisible to everyone.
--
-- What the membership answer does
--   `committee_membership` stores 'yes' or 'no' and nothing else. 'no' clears both committee
--   references on the way in, which is the database half of resolveCommitteeAnswer()
--   (src/domain/registration.ts): an applicant who says they are not on a committee cannot leave a
--   stale selection attached to the request, so the reviewer is never shown a committee the
--   applicant disowned. Any other value — an earlier build's submission, a client that sent
--   something unexpected — is recorded as NULL, meaning the question was never asked.
--
-- Requested and assigned stay separate, as they were
--   `requested_committee_id` and the new `second_committee_preference_id` are what the applicant
--   wrote. `assigned_committee_id` is still only ever written by esme_decide_registration()
--   (0007:200-206), which this file does not touch, and that function still sets the profile's
--   committee from the reviewer's pick, falling back to the request. Asking for a committee is not
--   getting it.
--
-- High Board is a committee, and that is the whole of it
--   esme_role has carried a `high_board` label since 0006 — a role with real read authority. The row
--   inserted below is an `esme_committees` record with the same-ish name and nothing else: it
--   appoints nobody to anything. The signup trigger still hardcodes `role = 'member'` and
--   `status = 'pending_approval'`, so an applicant who selects High Board, or whose committee is
--   resolved to it, ends up exactly where every other applicant ends up. The guard in section 4
--   refuses a duplicate if a chapter already lists that body under another spelling or short code.
--
-- What this file does NOT claim
--   Nothing here has been executed. There is no PostgreSQL in the authoring environment, so the
--   columns, the constraint, the resolution function and the new trigger body are reviewed and
--   statically tested (supabase/migrations/migrationIntegrity.test.ts) but unverified against a real
--   server. supabase/probes/authorization_probes.sql P22–P23 are the behavioural proof: P22 drives a
--   signup with the new metadata through the trigger and reads the queue row back, P23 shows that
--   naming High Board leaves the account a `member` with no capabilities. Both run inside
--   `begin; … rollback;` and must be run on a named staging project, never against Production.

begin;

-- =============================================== 1. the answers the queue keeps ====

alter table esme_registration_requests
  add column if not exists student_id text,
  add column if not exists academic_year text,
  add column if not exists department text,
  add column if not exists phone text,
  add column if not exists committee_membership text,
  add column if not exists second_committee_preference_id uuid
    references esme_committees (id) on delete set null;

-- NULL is a real state here: the question did not exist for a request filed before this file.
-- A default of '' would make "not asked" and "asked and answered with nothing" the same row.
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so the guard is the exception handler: a project
-- that has already applied this file reads the same rule it wrote, rather than aborting the rerun.
do $$
begin
  alter table esme_registration_requests
    add constraint esme_registration_membership_values
    check (committee_membership is null or committee_membership in ('yes', 'no'));
exception when duplicate_table then
  raise notice '0011: esme_registration_membership_values is already on esme_registration_requests — left alone';
end
$$;

comment on column esme_registration_requests.committee_membership is
  'The answer to "are you a member of a committee?" as stored: yes, no, or NULL when the signup that '
  'filed this request never asked. Applicant-declared, not verified, and not an assignment.';
comment on column esme_registration_requests.department is
  'Year-of-study programme as the applicant wrote it. Applicant-declared; a reviewer may correct the '
  'profile after approval, and nothing in RLS reads it.';
comment on column esme_registration_requests.academic_year is
  'Year of study (Freshman … Postgraduate), not a graduation year. The two are different questions and '
  'this column only ever holds the first.';
comment on column esme_registration_requests.second_committee_preference_id is
  'A requested alternative. Never applied to esme_profiles: an assignment goes through '
  'esme_decide_registration() and lands in assigned_committee_id.';

-- Only the second preference earns an index: reviewers filter the queue by what was asked for, and
-- this is the column 0001 did not have.
create index if not exists esme_registration_second_preference_idx
  on esme_registration_requests (second_committee_preference_id)
  where second_committee_preference_id is not null;

-- ============================================= 2. a committee reference, resolved ====

/**
 * Turn whatever the signup carried into a committee id, or into nothing.
 *
 * Three shapes arrive here and all three are legitimate: a uuid from a client whose committee list
 * was read out of esme_committees, a committee name or short code, and this app's own device-side
 * ids (`comm_te`, `comm_high_board`), which are stable identifiers for the chapter's committees and
 * carry no meaning to Postgres. Matching is on squeezed text — lower-cased, with everything outside
 * [a-z0-9] removed — so `T&E`, `t e` and `technical` all find the row they mean.
 *
 * It never raises. The uuid arm is guarded by a CASE, so a non-uuid string is compared as text
 * rather than cast; an unresolvable value returns NULL, which the caller stores as "no committee
 * named". That is the point: this function runs inside the signup trigger, and an exception here
 * would delete the auth user with it.
 */
create or replace function esme_committee_reference(p_reference text)
returns uuid
language sql
stable
set search_path = public
as $$
  with given as (
    select
      lower(btrim(coalesce(p_reference, ''))) as raw,
      lower(regexp_replace(lower(btrim(coalesce(p_reference, ''))), '[^[:alnum:]]', '', 'g')) as squeezed,
      upper(btrim(coalesce(p_reference, '')))
        ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' as is_uuid
  ),
  shaped as (
    select g.raw, g.squeezed, g.is_uuid,
           regexp_replace(g.squeezed, '^comm', '') as suffix
    from given g
  )
  select c.id
  from shaped s
  join esme_committees c on (
       c.id = case when s.is_uuid then s.raw::uuid else null end
    or (s.squeezed <> '' and s.squeezed = lower(regexp_replace(c.name, '[^[:alnum:]]', '', 'g')))
    or (s.squeezed <> '' and s.squeezed = lower(regexp_replace(c.short_code, '[^[:alnum:]]', '', 'g')))
    or (s.suffix <> '' and s.suffix = lower(regexp_replace(c.short_code, '[^[:alnum:]]', '', 'g')))
    or (s.suffix <> '' and s.suffix = lower(regexp_replace(split_part(c.name, ' ', 1), '[^[:alnum:]]', '', 'g')))
  )
  order by c.name
  limit 1;
$$;

comment on function esme_committee_reference(text) is
  'Resolves signup metadata to an esme_committees id, or to NULL. Fail-safe by design: it is called '
  'from the signup trigger, where a raise would abort registration itself. Ambiguity is settled by '
  'committee name, so the same input always reaches the same row.';

revoke all on function esme_committee_reference(text) from anon, public;
grant execute on function esme_committee_reference(text) to authenticated, service_role;

-- ==================================== 3. signup, with everything it now carries ====

/**
 * Replaces 0007's version. Everything that file established is kept: a submission enters the queue
 * as pending_approval with no email click behind it, the role is always 'member' regardless of what
 * the metadata asked for, and the audit line is written. Added: the six academic answers, the safe
 * committee resolution, and the 'no' clearing both preferences.
 *
 * The academic answers are copied onto esme_profiles as well as into the queue, because the profile
 * has had those four columns since 0001 and the member workspace reads them from there. They are
 * the applicant's own claim about themselves, recorded against a pending account, and nothing in the
 * authorization path consults them. role and status are still written only as 'member' /
 * 'pending_approval', which is what 0009's esme_assert_privilege_channel() enforces on INSERT.
 *
 * `nullif(btrim(...), '')` on username and full_name is not decoration: coalesce() only answers a
 * missing key, and this client sends an empty string when a field is switched off. An empty username
 * breaks esme_profiles_username_fmt and an empty display name breaks esme_profiles_name_len — both
 * inside the trigger, both fatal to the signup. Now they fall back to the email the same way a
 * missing key does.
 */
create or replace function esme_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_membership text := lower(btrim(coalesce(meta ->> 'committee_membership', '')));
  v_requested uuid;
  v_second uuid;
  v_profile esme_profiles%rowtype;
begin
  -- Only 'yes' and 'no' are answers. Anything else is the question having never been asked, and it
  -- must reach the queue as NULL rather than trip esme_registration_membership_values.
  if v_membership not in ('yes', 'no') then
    v_membership := null;
  end if;

  v_requested := esme_committee_reference(meta ->> 'committee_id');
  v_second := esme_committee_reference(meta ->> 'second_committee_preference_id');

  -- src/domain/registration.ts resolveCommitteeAnswer(), on the trusted side this time.
  if v_membership = 'no' then
    v_requested := null;
    v_second := null;
  end if;

  insert into esme_profiles (
    id, email, username, display_name, role, status, email_verified,
    student_id, academic_year, department, phone
  ) values (
    new.id,
    lower(new.email),
    lower(coalesce(nullif(btrim(coalesce(meta ->> 'username', '')), ''), split_part(new.email, '@', 1))),
    coalesce(nullif(btrim(coalesce(meta ->> 'full_name', '')), ''), initcap(split_part(new.email, '@', 1))),
    'member',                     -- public registration cannot choose a role, High Board included
    'pending_approval',           -- reviewable the moment it exists
    (new.email_confirmed_at is not null),  -- mirrored, never a gate
    nullif(btrim(coalesce(meta ->> 'student_id', '')), ''),
    nullif(btrim(coalesce(meta ->> 'academic_year', '')), ''),
    nullif(btrim(coalesce(meta ->> 'department', '')), ''),
    nullif(btrim(coalesce(meta ->> 'phone', '')), '')
  )
  returning * into v_profile;

  insert into esme_registration_requests (
    profile_id, full_name, email, username,
    requested_committee_id, second_committee_preference_id,
    student_id, academic_year, department, phone, committee_membership,
    technical_skills, previous_experience, motivation, availability_hours,
    agreed_to_policies, email_verified, status
  ) values (
    v_profile.id, v_profile.display_name, v_profile.email, v_profile.username,
    v_requested, v_second,
    v_profile.student_id, v_profile.academic_year, v_profile.department, v_profile.phone,
    v_membership,
    coalesce(meta ->> 'technical_skills', ''),
    coalesce(meta ->> 'previous_experience', ''),
    coalesce(meta ->> 'motivation', ''),
    coalesce(meta ->> 'availability_hours', ''),
    coalesce((meta ->> 'accepted_policies')::boolean, false),
    v_profile.email_verified,
    v_profile.status
  );

  insert into esme_audit_log (actor_id, actor_name, actor_role, action, target_type, target_id, details)
  values (
    v_profile.id, v_profile.display_name, 'member', 'REGISTRATION_SUBMITTED',
    'registration', v_profile.id::text, 'New registration entered the approval queue'
  );

  return new;
end;
$$;

comment on function esme_handle_new_auth_user() is
  '0011 version: keeps 0007''s no-verification lifecycle and forced member/pending_approval role, adds '
  'the academic answers, and resolves a committee reference without ever raising inside the trigger.';

-- ================================================= 4. High Board as a committee ====

-- The chapter-wide body, recorded as the committee it is. The description is not decoration: this
-- row is selectable on the same form that once had no such option, and the sentence is what makes it
-- clear to a reader that naming it appoints nothing.
--
-- The guard checks both spellings squeezed the way esme_committee_reference() squeezes them, so an
-- existing "High board", "HIGH-BOARD" or "HB" row stops the insert rather than creating the second
-- committee a duplicate would guarantee.
insert into esme_committees (name, short_code, description, category, objectives, sub_teams, is_public, status)
select
  'High Board',
  'HB',
  'The chapter-wide body its officers sit on. Naming it on an application records where the applicant thinks they belong; it appoints nobody and grants no office, no administrative access and no role.',
  'management',
  array['Hold the chapter-wide direction the committee objectives serve',
         'Keep the continuity of decisions across seasons'],
  array[]::text[],
  true,
  'active'
where not exists (
  select 1
  from esme_committees
  where lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) in ('highboard', 'thehighboard')
     or lower(regexp_replace(short_code, '[^[:alnum:]]', '', 'g')) = 'hb'
);

-- =================================== 5. the registration schema an operator edits ====

-- esme_registration_fields is the editable mirror of the signup's question list. The portal builds its
-- committee choices from the committee records, not from these option arrays, so the arrays are
-- reference text — but an operator reading the schema table should still see the questions this
-- build actually asks, with the options it offers.
--
-- Every statement here is guarded on the value the previous seed shipped, so a chapter that already
-- renamed a row, reordered it, or switched it off keeps its own version. This is the same rule the
-- browser-side storage migration follows (src/storage/migrations.ts).

update esme_registration_fields
   set label = 'Academic Year / السنة الدراسية',
       options = array['Freshman', 'Sophomore', 'Junior', 'Senior I', 'Senior II', 'Postgraduate'],
       required = true,
       enabled = true
 where name = 'academic_year'
   and options = array['1', '2', '3', '4', '5'];

update esme_registration_fields
   set label = 'Department / القسم',
       options = array['Metallurgical & Materials Engineering', 'Mechanical Design & Production',
                       'Mechanical Power Engineering', 'Chemical Engineering', 'Civil Engineering',
                       'Aerospace Engineering', 'Other'],
       required = true,
       enabled = true
 where name = 'department'
   and options = array['Mechatronics', 'Biomedical', 'Electrical', 'Mechanical', 'Civil', 'Architecture', 'Other'];

-- The membership question sits immediately before the committee it controls.
update esme_registration_fields
   set sort_order = sort_order + 1
 where sort_order >= 7
   and not exists (select 1 from esme_registration_fields where name = 'committee_membership');

insert into esme_registration_fields (name, label, field_type, required, enabled, options, description, sort_order)
values
  ('committee_membership', 'Are you a member of a committee? / هل أنت عضو في أي كوميت؟', 'select',
   true, true, array['yes', 'no'],
   'Answer no and the committee question below is not asked. Applicant-declared.', 7)
on conflict (name) do nothing;

-- The committee options this table lists by name gain the body added in section 4.
update esme_registration_fields
   set options = options || 'High Board'
 where name in ('preferred_committee', 'second_committee_preference')
   and not ('High Board' = any (options));

-- ------------------------------------------------------------------------ end ----
commit;

-- After applying, on a staging project only:
--   1. register through the real portal with a department, a year, "Yes" and High Board; read the
--      queue row back and confirm requested_committee_id names the High Board row,
--      committee_membership = 'yes', assigned_committee_id is NULL, and the profile role is still
--      'member' with no capabilities.
--   2. register again answering "No" after selecting a committee in the browser; the queue row must
--      carry committee_membership = 'no' with both committee columns NULL.
--   3. run P22 and P23 in supabase/probes/authorization_probes.sql and copy each PASS/FAIL/SKIP line
--      into the evidence table.
-- The app reads these columns as optional (src/auth/supabaseAdapter.ts:426-433), so a project that
-- has not applied this file keeps its existing queue behaviour and shows nothing for the new answers
-- rather than failing.
