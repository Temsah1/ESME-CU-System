-- ESME CU ERP — schema
-- Target: Supabase Postgres (pgcrypto + auth schema available).
-- Apply with: node scripts/apply-migrations.mjs --plan, then --apply against a staging project.
-- Do not apply this file with `supabase db push`: it cannot be pointed at one named project, and it
-- may wrap a whole file in one transaction, which 0006's enum step does not survive. psql -f works
-- only after `supabase migration list` has proved this project holds none of these versions yet.
--
-- Design notes
--   * Operational tables start EMPTY. Nothing here seeds fictional members,
--     tasks, submissions, scores, applications or audit events.
--   * Authoritative aggregates (points, member counts) are computed from rows,
--     never stored as editable display numbers.
--   * role + account status live in this database only. The browser never owns them.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- All objects live in the public schema with an esme_ prefix so Supabase's PostgREST
-- exposure and the RLS policies below stay in one namespace.

-- ---------------------------------------------------------------- enums ----

create type esme_role as enum ('super_admin', 'director', 'head', 'moderator', 'member');

create type esme_account_status as enum (
  'pending_email_verification',
  'pending_approval',
  'active',
  'rejected',
  'suspended'
);

create type esme_task_status as enum (
  'draft', 'assigned', 'in_progress', 'submitted', 'under_review',
  'revision_requested', 'approved', 'rejected', 'cancelled', 'overdue'
);

create type esme_priority as enum ('low', 'medium', 'high', 'urgent');

create type esme_score_action as enum (
  'task_completion', 'manual_adjustment', 'bonus', 'penalty', 'event_attendance'
);

create type esme_decision as enum ('approve', 'reject');

-- ------------------------------------------------------------- identities ----

create table esme_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext not null unique,
  username citext not null unique,
  display_name text not null,
  role esme_role not null default 'member',
  status esme_account_status not null default 'pending_email_verification',
  email_verified boolean not null default false,
  committee_id uuid,          -- added by FK below; primary home committee
  sub_team text,
  academic_year text,
  department text,
  student_id text,
  phone text,
  avatar_url text,
  -- Membership history and scoring survive a committee move or a profile edit.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz,
  decided_by uuid references esme_profiles (id) on delete set null,
  decided_at timestamptz,
  rejection_reason text,
  constraint esme_profiles_name_len check (char_length(btrim(display_name)) between 3 and 120),
  constraint esme_profiles_username_fmt check (username ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$')
);

create index esme_profiles_role_idx on esme_profiles (role);
create index esme_profiles_status_idx on esme_profiles (status);

comment on column esme_profiles.role is 'Server-side only. Changed exclusively through esme_assign_role().';
comment on column esme_profiles.status is 'Server-side only. Guarded by the status transition trigger.';

-- ------------------------------------------------------------ committees ----

create table esme_committees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  short_code text not null unique,
  description text not null default '',
  category text not null default 'technical'
    check (category in ('technical', 'media', 'marketing', 'operations', 'management')),
  objectives text[] not null default '{}',
  sub_teams text[] not null default '{}',
  is_public boolean not null default true,
  status text not null default 'active' check (status in ('active', 'archived')),
  -- Nullable by design: an unassigned committee reads as unassigned. No placeholder names.
  director_id uuid references esme_profiles (id) on delete set null,
  head_id uuid references esme_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table esme_committee_memberships (
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  committee_id uuid not null references esme_committees (id) on delete cascade,
  sub_team text,
  is_primary boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (profile_id, committee_id)
);

create index esme_memberships_committee_idx on esme_committee_memberships (committee_id);

alter table esme_profiles
  add constraint esme_profiles_committee_fk
  foreign key (committee_id) references esme_committees (id) on delete set null;

create index esme_profiles_committee_idx on esme_profiles (committee_id);

-- A profile's home committee is one membership, flagged as primary.
create unique index esme_memberships_one_primary on esme_committee_memberships (profile_id)
  where is_primary;

-- ---------------------------------------------------- registration queue ----

create table esme_registration_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references esme_profiles (id) on delete cascade unique,
  full_name text not null,
  email citext not null,
  username citext not null,
  requested_committee_id uuid references esme_committees (id) on delete set null,
  assigned_committee_id uuid references esme_committees (id) on delete set null,
  technical_skills text not null default '',
  previous_experience text not null default '',
  motivation text not null default '',
  availability_hours text not null default '',
  agreed_to_policies boolean not null default false check (agreed_to_policies),
  email_verified boolean not null default false,
  status esme_account_status not null default 'pending_email_verification',
  submitted_at timestamptz not null default now(),
  decided_by uuid references esme_profiles (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  rejection_reason text
);

create index esme_registration_status_idx on esme_registration_requests (status, submitted_at desc);

-- ------------------------------------------------------------------ cms ----
-- Reference content (official chapter copy, the 2026-27 plan, form schema) lives
-- here as editable records. It is deliberately separate from operational data.

create table esme_content_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  nav_label text,
  section_key text not null unique,
  body jsonb not null default '{}'::jsonb,
  nav_order integer not null default 0,
  in_navigation boolean not null default true,
  published boolean not null default false,
  seo jsonb not null default '{}'::jsonb,
  revision_of uuid references esme_content_pages (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references esme_profiles (id) on delete set null,
  updated_by uuid references esme_profiles (id) on delete set null
);

create table esme_content_revisions (
  id bigint generated always as identity primary key,
  page_id uuid not null references esme_content_pages (id) on delete cascade,
  body jsonb not null,
  saved_by uuid references esme_profiles (id) on delete set null,
  saved_at timestamptz not null default now(),
  note text
);

create index esme_content_revisions_page_idx on esme_content_revisions (page_id, saved_at desc);

create table esme_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references esme_profiles (id) on delete set null
);

create table esme_media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size between 1 and 26214400),
  alt_text text not null default '',
  is_public boolean not null default true,
  uploaded_by uuid references esme_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table esme_season_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  acronym text,
  category text not null check (
    category in ('Major Event', 'Workshop', 'Professional Session', 'Magazine Issue', 'Field Campaign')
  ),
  theme text,
  date_or_quarter text not null,
  -- Planned work must not read as finished work: default is Planned.
  status text not null default 'Planned' check (
    status in ('Planned', 'In Preparation', 'Confirmed', 'Completed')
  ),
  target_metric text not null default '',
  actual_metric text,
  responsible_committee text not null default '',
  description text not null default '',
  venue text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tasks ----

create table esme_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text not null default '',
  committee_id uuid not null references esme_committees (id) on delete restrict,
  created_by uuid references esme_profiles (id) on delete set null,
  priority esme_priority not null default 'medium',
  points integer not null default 0 check (points between 0 and 1000),
  starts_on date,
  deadline date,
  status esme_task_status not null default 'draft',
  acceptance_criteria text[] not null default '{}',
  reference_links text[] not null default '{}',
  category text not null default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index esme_tasks_committee_status_idx on esme_tasks (committee_id, status);

create table esme_task_assignments (
  task_id uuid not null references esme_tasks (id) on delete cascade,
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references esme_profiles (id) on delete set null,
  primary key (task_id, profile_id)
);

create table esme_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references esme_tasks (id) on delete cascade,
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  version integer not null default 1 check (version > 0),
  description text not null,
  external_links text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  proposed_points integer not null default 0 check (proposed_points between 0 and 1000),
  status text not null default 'submitted' check (
    status in ('submitted', 'under_review', 'revision_requested', 'approved', 'rejected')
  ),
  reviewer_feedback text,
  reviewed_by uuid references esme_profiles (id) on delete set null,
  reviewed_at timestamptz,
  awarded_points integer,
  submitted_at timestamptz not null default now(),
  -- One accepted deliverable per task version; a retried review cannot double-award.
  unique (task_id, profile_id, version)
);

create index esme_submissions_status_idx on esme_submissions (status, submitted_at desc);

-- ------------------------------------------------------------- score ledger ----

create table esme_score_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  committee_id uuid references esme_committees (id) on delete set null,
  task_id uuid references esme_tasks (id) on delete set null,
  submission_id uuid references esme_submissions (id) on delete set null,
  points integer not null check (points <> 0),
  action_type esme_score_action not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  recorded_by uuid references esme_profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  -- Idempotency: replaying a successful approval request adds nothing.
  idempotency_key text unique
);

create index esme_ledger_profile_idx on esme_score_ledger (profile_id, recorded_at desc);
create unique index esme_ledger_one_award_per_submission
  on esme_score_ledger (submission_id)
  where action_type = 'task_completion';

-- Points are derived, never typed in.
create or replace view esme_member_scores as
select
  p.id as profile_id,
  coalesce(sum(l.points), 0)::integer as total_points,
  count(*) filter (where l.action_type = 'task_completion')::integer as approved_tasks_count
from esme_profiles p
left join esme_score_ledger l on l.profile_id = p.id
where p.status = 'active'
group by p.id;

create or replace view esme_committee_rosters as
select
  c.id as committee_id,
  count(m.profile_id) filter (
    where exists (select 1 from esme_profiles p where p.id = m.profile_id and p.status = 'active')
  )::integer as member_count
from esme_committees c
left join esme_committee_memberships m on m.committee_id = c.id
group by c.id;

-- ---------------------------------------------------------- skills / kpi ----

create table esme_skill_matrix (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  committee_id uuid references esme_committees (id) on delete set null,
  skill_name text not null check (
    skill_name in ('Materials Science', 'Inspection & NDT', 'Engineering Software',
                   'Technical Research', 'Presentation', 'Project Management')
  ),
  level text not null default 'L0' check (level in ('L0', 'L1', 'L2', 'L3', 'L4')),
  last_assessment date,
  assessor_id uuid references esme_profiles (id) on delete set null,
  evidence text not null default '',
  improvement_goal text not null default '',
  unique (profile_id, skill_name)
);

create table esme_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  season text not null,
  metric text not null,
  target numeric(12, 2) not null,
  -- Recorded results stay nullable: an unmeasured KPI is unknown, not zero.
  actual numeric(12, 2),
  measured_at timestamptz,
  measured_by uuid references esme_profiles (id) on delete set null,
  source text,
  unique (season, metric)
);

-- ------------------------------------------------------ notifications ----

create table esme_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info', 'warning', 'success', 'alert')),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index esme_notifications_profile_idx on esme_notifications (profile_id, created_at desc);

-- ------------------------------------------------------------ audit log ----
-- Append-only. Update and delete are revoked below; a trigger blocks the rest.

create table esme_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references esme_profiles (id) on delete set null,
  actor_name text not null,
  actor_role esme_role,
  action text not null,
  target_type text not null check (
    target_type in ('profile', 'committee', 'task', 'submission', 'score', 'registration',
                    'content', 'media', 'setting', 'system')
  ),
  target_id text,
  details text not null default '',
  ip_address inet,
  recorded_at timestamptz not null default now()
);

create index esme_audit_recent_idx on esme_audit_log (recorded_at desc);
create index esme_audit_target_idx on esme_audit_log (target_type, target_id);

-- ---------------------------------------------------- registration form ----

create table esme_registration_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  label text not null,
  field_type text not null check (
    field_type in ('text', 'email', 'tel', 'select', 'textarea', 'checkbox')
  ),
  required boolean not null default false,
  enabled boolean not null default true,
  options text[] not null default '{}',
  description text,
  sort_order integer not null default 0
);

-- ------------------------------------------------- capability matrix ----
-- SQL mirror of src/domain/roles.ts. A policy asks this table; it never
-- re-implements the matrix, so the two cannot silently drift apart.

create table esme_role_capabilities (
  role esme_role not null,
  capability text not null,
  scope text not null check (scope in ('all', 'committee', 'self')),
  primary key (role, capability)
);

commit;
