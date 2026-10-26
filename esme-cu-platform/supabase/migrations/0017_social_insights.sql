-- ESME CU ERP — social insight records written by a server-side Meta Graph sync
-- Apply after 0016_high_board_bonus_guard.sql.
--
-- What this changes
--   Two tables and their read policies. They hold what a scheduled Edge Function measured from
--   the Meta Graph API; they hold no credential, no fabricated figure and no placeholder row.
--
--   esme_social_sync_runs
--     One row per invocation. `status` is running, ok, blocked or error. A `blocked` run is the
--     record of a configuration that was missing, so the interface can say BLOCKED with the names
--     of the missing variables instead of showing a zero that looks like a measurement.
--
--   esme_social_posts
--     One row per published post, keyed by (platform, external_id) so a later sync updates the
--     same row instead of duplicating it. The metric columns are nullable on purpose: a null is
--     "the provider did not return this figure", while 0 is "the provider returned zero".
--     `audience` holds the age-bracket map the provider returned for the same window.
--
-- What this deliberately does NOT change
--   * No capability row is added or changed. Reading is granted to the content roles through the
--     existing `cms.content.write` capability, which the CMS already uses.
--   * No token column exists. META_GRAPH_TOKEN is an Edge Function secret; the browser never sees
--     it, and the fixture here proves the schema has nowhere to store it.
--   * Authenticated users cannot insert, update or delete either table. The sync runs with the
--     service role, which bypasses RLS; a hand-made REST call from a browser is refused.
--   * No cron entry is created by this file. The schedule is an operator step in supabase/README.md
--     because it needs the deployed function URL and its secret, neither of which exists here.

begin;

create table if not exists esme_social_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta_graph' check (provider = 'meta_graph'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'ok', 'blocked', 'error')),
  rows_written integer not null default 0 check (rows_written >= 0),
  -- Scrubbed by the function before it is written. It names a missing variable or a provider
  -- status; it must never carry the access token or a page-scoped credential.
  detail text not null default ''
);

create table if not exists esme_social_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'facebook' check (platform in ('facebook', 'instagram')),
  external_id text not null,
  title text not null,
  permalink text,
  published_at timestamptz,
  impressions bigint check (impressions is null or impressions >= 0),
  interactions bigint check (interactions is null or interactions >= 0),
  shares bigint check (shares is null or shares >= 0),
  reach bigint check (reach is null or reach >= 0),
  audience jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  sync_run_id uuid references esme_social_sync_runs (id) on delete set null,
  unique (platform, external_id)
);

create index if not exists esme_social_posts_published_idx on esme_social_posts (published_at desc);
create index if not exists esme_social_runs_started_idx on esme_social_sync_runs (started_at desc);

alter table esme_social_sync_runs enable row level security;
alter table esme_social_posts enable row level security;

-- The same audience as the Website CMS: the people who publish chapter content can read what the
-- chapter's own channels measured. No write policy is created for either table.
create policy esme_social_runs_read on esme_social_sync_runs
  for select to authenticated
  using (esme_has_capability('cms.content.write'));

create policy esme_social_posts_read on esme_social_posts
  for select to authenticated
  using (esme_has_capability('cms.content.write'));

comment on table esme_social_sync_runs is
  '0017: one row per Meta Graph sync attempt. Written by the service role only; blocked rows name '
  'the missing server-side variables.';
comment on table esme_social_posts is
  '0017: post-level measurement returned by the Meta Graph API. Null metric = not returned; 0 = '
  'returned zero. No credential is stored here.';

commit;

-- ============================== operator notes ====
--
-- Probes for staging (add to supabase/probes/authorization_probes.sql if they are wanted):
--   P47  as super_admin, select from esme_social_posts -> succeeds (zero rows until a sync writes).
--   P48  as high_board or moderator (cms.content.write), select from esme_social_posts -> succeeds.
--   P49  as member, select from esme_social_posts -> returns no rows.
--   P50  as any authenticated user, insert into esme_social_sync_runs -> refused; the service role
--        is the only writer.
--   P51  inspect information_schema.columns for esme_social_posts -> no column can hold a token.
--
-- The daily sync is documented in supabase/README.md ("Social insight sync"). It needs
-- META_PAGE_ID, META_GRAPH_TOKEN and META_SYNC_CRON_SECRET as Edge Function secrets. Until they
-- exist, the function records a blocked run and makes no call to graph.facebook.com.
