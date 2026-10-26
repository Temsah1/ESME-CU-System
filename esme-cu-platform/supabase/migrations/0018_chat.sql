-- ESME CU ERP — internal chat: committee channels and direct conversations
-- Apply after 0017_social_insights.sql.
--
-- What this creates
--   esme_chat_conversations  one row per channel or direct thread. A committee channel is unique
--                            per committee; a direct thread is unique per pair of profiles through
--                            `direct_key` (`least(id) || ':' || greatest(id)`).
--   esme_chat_members        who may read a thread, and when they last read it. `last_read_at`
--                            is the only source of an unread count: a count is derived, never stored.
--   esme_chat_messages       append-only message rows. A message is never edited or deleted here;
--                            a future moderation action would be a new row, not a silent rewrite.
--
-- Why the writes go through functions
--   A browser may SELECT only the threads it belongs to. INSERT/UPDATE/DELETE have no policy at
--   all, so a hand-made REST write is refused. `esme_send_chat_message`, `esme_mark_chat_read`,
--   `esme_start_direct_conversation` and `esme_ensure_committee_channels` are the only writers,
--   and each one proves membership with the session's own id before it acts.
--
-- Who can see whom
--   `esme_chat_contacts()` returns only active profiles the actor already reaches through
--   `users.read`, plus the actor's own committee peers. A member therefore cannot use chat to
--   enumerate the chapter: the contact list follows the same committee boundary as the directory.
--   A committee channel is opened only for a committee `esme_reaches_committee(…, 'tasks.read')`
--   admits — a member's own committee, or every committee for a role whose scope is `all`.
--
-- Realtime
--   `esme_chat_messages` is added to the `supabase_realtime` publication when that publication
--   exists. Realtime still evaluates the SELECT policy for each subscriber, so a client cannot
--   subscribe its way into a thread it cannot read.

begin;

create table if not exists esme_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('committee', 'direct')),
  title text not null default '',
  committee_id uuid references esme_committees (id) on delete cascade,
  direct_key text,
  created_by uuid references esme_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint esme_chat_conversation_shape check (
    (kind = 'committee' and committee_id is not null and direct_key is null)
    or (kind = 'direct' and committee_id is null and direct_key is not null)
  ),
  -- Direct rows carry a NULL committee and may repeat it; committee rows may not.
  constraint esme_chat_committee_unique unique (committee_id),
  constraint esme_chat_direct_key_unique unique (direct_key)
);

create table if not exists esme_chat_members (
  conversation_id uuid not null references esme_chat_conversations (id) on delete cascade,
  profile_id uuid not null references esme_profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);

create table if not exists esme_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references esme_chat_conversations (id) on delete cascade,
  sender_id uuid not null references esme_profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint esme_chat_message_len check (char_length(btrim(body)) between 1 and 4000)
);

create index if not exists esme_chat_members_profile_idx on esme_chat_members (profile_id);
create index if not exists esme_chat_messages_thread_idx on esme_chat_messages (conversation_id, created_at desc);
create index if not exists esme_chat_conversations_recent_idx on esme_chat_conversations (last_message_at desc);

alter table esme_chat_conversations enable row level security;
alter table esme_chat_members enable row level security;
alter table esme_chat_messages enable row level security;

-- ===================================================== read helpers ====
-- SECURITY DEFINER so a policy can answer "is this session a member" without granting the caller
-- a readable copy of the membership table for another thread.

create or replace function esme_chat_is_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select esme_current_status() = 'active'
    and esme_current_profile_id() is not null
    and exists (
      select 1
      from esme_chat_members m
      where m.conversation_id = p_conversation
        and m.profile_id = esme_current_profile_id()
    )
$$;

create or replace function esme_chat_assert_member(p_conversation uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not esme_chat_is_member(p_conversation) then
    raise exception 'ESME_FORBIDDEN: this conversation is not one your account belongs to';
  end if;
end;
$$;

-- ============================================================ policies ====
-- Reading is membership-scoped. There is deliberately no write policy: the RPCs below are the
-- only path that writes a row, and each one re-checks membership itself.

create policy esme_chat_conversations_read on esme_chat_conversations
  for select to authenticated
  using (esme_chat_is_member(id));

create policy esme_chat_members_read on esme_chat_members
  for select to authenticated
  using (esme_chat_is_member(conversation_id));

create policy esme_chat_messages_read on esme_chat_messages
  for select to authenticated
  using (esme_chat_is_member(conversation_id));

-- ================================================================ reads ====

/**
 * The people this actor may open a direct thread with.
 *
 * The first branch is the directory's own reach rule (`users.read`). The second is the committee
 * peer branch a member needs: a member holds no `users.read`, but a teammate is already visible
 * on their roster. Nobody else is enumerated.
 */
create or replace function esme_chat_contacts()
returns table (
  profile_id uuid,
  display_name text,
  role esme_role,
  committee_id uuid,
  committee_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.role, p.committee_id, c.name
  from esme_profiles p
  left join esme_committees c on c.id = p.committee_id
  where p.status = 'active'
    and p.id <> esme_current_profile_id()
    and esme_current_status() = 'active'
    and (
      esme_reaches_profile(p.id, 'users.read')
      or (
        esme_current_committee_id() is not null
        and p.committee_id = esme_current_committee_id()
      )
    )
  order by p.display_name
$$;

/**
 * The conversation list, ordered by its most recent activity. `unread_count` is computed from
 * messages after this member's `last_read_at` and never includes the member's own messages.
 * A direct thread's title is the other participant's name, so the same thread reads correctly
 * in both accounts without storing a second copy.
 */
create or replace function esme_chat_conversations_for_me()
returns table (
  id uuid,
  kind text,
  title text,
  committee_id uuid,
  created_at timestamptz,
  last_message_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  last_message_sender text,
  unread_count integer,
  member_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.kind,
    case
      when c.kind = 'direct' then coalesce(other.display_name, 'Direct message')
      else c.title
    end,
    c.committee_id,
    c.created_at,
    c.last_message_at,
    last_message.body,
    last_message.sender_id,
    sender.display_name,
    (
      select count(*)::integer
      from esme_chat_messages m
      where m.conversation_id = c.id
        and m.sender_id <> esme_current_profile_id()
        and (mine.last_read_at is null or m.created_at > mine.last_read_at)
    ),
    (select count(*)::integer from esme_chat_members mm where mm.conversation_id = c.id)
  from esme_chat_conversations c
  join esme_chat_members mine
    on mine.conversation_id = c.id and mine.profile_id = esme_current_profile_id()
  left join lateral (
    select m.body, m.sender_id
    from esme_chat_messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) last_message on true
  left join esme_profiles sender on sender.id = last_message.sender_id
  left join lateral (
    select p.display_name
    from esme_chat_members om
    join esme_profiles p on p.id = om.profile_id
    where om.conversation_id = c.id and om.profile_id <> mine.profile_id
    order by om.joined_at
    limit 1
  ) other on true
  where esme_current_status() = 'active'
  order by coalesce(c.last_message_at, c.created_at) desc
$$;

/**
 * One page of messages, newest first. `p_before` is the `created_at` of the oldest message the
 * caller already holds; the next request names it and receives older rows. A page shorter than
 * the limit is the end of the thread.
 */
create or replace function esme_chat_messages_page(
  p_conversation uuid,
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  sender_id uuid,
  sender_name text,
  sender_role esme_role,
  sender_avatar text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  perform esme_chat_assert_member(p_conversation);

  return query
  select m.id, m.body, m.created_at, m.sender_id, p.display_name, p.role, p.avatar_url
  from esme_chat_messages m
  join esme_profiles p on p.id = m.sender_id
  where m.conversation_id = p_conversation
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit v_limit;
end;
$$;

-- =============================================================== writes ====

/** Creates (or re-opens) the committee channels this actor is allowed to reach. */
create or replace function esme_ensure_committee_channels()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := esme_current_profile_id();
  v_committee record;
  v_conversation uuid;
  v_count integer := 0;
begin
  if v_me is null or esme_current_status() <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;

  for v_committee in
    select c.id, c.name, c.short_code
    from esme_committees c
    where c.status = 'active'
      and esme_reaches_committee(c.id, 'tasks.read')
    order by c.name
  loop
    insert into esme_chat_conversations (kind, title, committee_id, created_by)
    values (
      'committee',
      coalesce(nullif(btrim(v_committee.name), ''), v_committee.short_code),
      v_committee.id,
      v_me
    )
    on conflict (committee_id) do nothing;

    select c.id into v_conversation
    from esme_chat_conversations c
    where c.kind = 'committee' and c.committee_id = v_committee.id;

    insert into esme_chat_members (conversation_id, profile_id)
    select v_conversation, p.id
    from esme_profiles p
    where p.committee_id = v_committee.id and p.status = 'active'
    on conflict do nothing;

    -- A leader whose `tasks.read` reaches this committee is a member of its channel even when
    -- the committee is not their home committee.
    insert into esme_chat_members (conversation_id, profile_id)
    values (v_conversation, v_me)
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/** Opens the direct thread between the caller and one reachable profile. Idempotent. */
create or replace function esme_start_direct_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := esme_current_profile_id();
  v_other esme_profiles%rowtype;
  v_key text;
  v_conversation uuid;
  v_reachable boolean;
begin
  if v_me is null or esme_current_status() <> 'active' then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;

  if p_other is null or p_other = v_me then
    raise exception 'ESME_SELF_TARGET: choose another member to message';
  end if;

  select * into v_other from esme_profiles where id = p_other;
  if v_other.id is null then
    raise exception 'ESME_NOT_FOUND: that member is not in the directory';
  end if;
  if v_other.status <> 'active' then
    raise exception 'ESME_INACTIVE_ACCOUNT: that account is not active';
  end if;

  v_reachable := esme_reaches_profile(p_other, 'users.read')
    or (
      esme_current_committee_id() is not null
      and v_other.committee_id = esme_current_committee_id()
    );
  if not v_reachable then
    raise exception 'ESME_OUTSIDE_COMMITTEE: that member is outside the people your role can reach';
  end if;

  v_key := least(v_me, p_other)::text || ':' || greatest(v_me, p_other)::text;

  insert into esme_chat_conversations (kind, title, direct_key, created_by)
  values ('direct', '', v_key, v_me)
  on conflict (direct_key) do nothing;

  select c.id into v_conversation
  from esme_chat_conversations c
  where c.direct_key = v_key;

  insert into esme_chat_members (conversation_id, profile_id, last_read_at)
  values (v_conversation, v_me, now()), (v_conversation, p_other, null)
  on conflict do nothing;

  return v_conversation;
end;
$$;

/** Appends one message. The body is trimmed; the table's check constraint is the final gate. */
create or replace function esme_send_chat_message(p_conversation uuid, p_body text)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  sender_id uuid,
  sender_name text,
  sender_role esme_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := esme_current_profile_id();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform esme_chat_assert_member(p_conversation);

  if char_length(v_body) = 0 then
    raise exception 'ESME_BAD_MESSAGE: a message cannot be empty';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'ESME_BAD_MESSAGE: a message is limited to 4000 characters';
  end if;

  insert into esme_chat_messages (conversation_id, sender_id, body)
  values (p_conversation, v_me, v_body)
  returning esme_chat_messages.id into v_id;

  update esme_chat_conversations
     set last_message_at = now()
   where esme_chat_conversations.id = p_conversation;

  update esme_chat_members
     set last_read_at = now()
   where esme_chat_members.conversation_id = p_conversation
     and esme_chat_members.profile_id = v_me;

  return query
  select m.id, m.body, m.created_at, m.sender_id, p.display_name, p.role
  from esme_chat_messages m
  join esme_profiles p on p.id = m.sender_id
  where m.id = v_id;
end;
$$;

/** Marks everything currently in the thread as read up to now. */
create or replace function esme_mark_chat_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform esme_chat_assert_member(p_conversation);

  update esme_chat_members
     set last_read_at = now()
   where conversation_id = p_conversation
     and profile_id = esme_current_profile_id();
end;
$$;

comment on table esme_chat_conversations is
  '0018: committee channels and direct threads. Readable by members only; written through the RPCs.';
comment on table esme_chat_members is
  '0018: membership and last_read_at. Unread counts are derived from this timestamp, never stored.';
comment on table esme_chat_messages is
  '0018: append-only internal messages. No client write policy; esme_send_chat_message() is the path.';

-- A thread subscriber still needs its SELECT policy; adding the table only makes change events
-- available to Realtime. Re-run safe: the membership test avoids a duplicate-publication error.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'esme_chat_messages'
    ) then
      alter publication supabase_realtime add table esme_chat_messages;
    end if;
  end if;
end;
$$;

-- Tables are read-only to clients; the functions are the only write path.
revoke all on esme_chat_conversations, esme_chat_members, esme_chat_messages from anon, public;
grant select on esme_chat_conversations, esme_chat_members, esme_chat_messages to authenticated;

revoke all on function esme_chat_contacts() from anon, public;
revoke all on function esme_chat_conversations_for_me() from anon, public;
revoke all on function esme_chat_messages_page(uuid, timestamptz, integer) from anon, public;
revoke all on function esme_ensure_committee_channels() from anon, public;
revoke all on function esme_start_direct_conversation(uuid) from anon, public;
revoke all on function esme_send_chat_message(uuid, text) from anon, public;
revoke all on function esme_mark_chat_read(uuid) from anon, public;

grant execute on function esme_chat_contacts() to authenticated;
grant execute on function esme_chat_conversations_for_me() to authenticated;
grant execute on function esme_chat_messages_page(uuid, timestamptz, integer) to authenticated;
grant execute on function esme_ensure_committee_channels() to authenticated;
grant execute on function esme_start_direct_conversation(uuid) to authenticated;
grant execute on function esme_send_chat_message(uuid, text) to authenticated;
grant execute on function esme_mark_chat_read(uuid) to authenticated;

commit;

-- ============================== operator notes ====
--
-- Probes for staging (add to supabase/probes/authorization_probes.sql if they are wanted):
--   P52  as a member, select from esme_chat_conversations -> only threads they belong to.
--   P53  as a member, insert into esme_chat_messages -> refused; no write policy.
--   P54  as a member, call esme_send_chat_message(<another committee's thread>, 'x') -> ESME_FORBIDDEN.
--   P55  as a member, call esme_start_direct_conversation(<profile in another committee>) -> ESME_OUTSIDE_COMMITTEE.
--   P56  as a member, call esme_ensure_committee_channels() -> exactly the committees their tasks.read reaches.
--   P57  call esme_chat_messages_page(..., 30) twice, naming the oldest created_at as p_before -> no duplicate id.
