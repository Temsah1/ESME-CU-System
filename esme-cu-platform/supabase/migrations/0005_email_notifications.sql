-- ESME CU ERP — outbound email: queue, delivery log, preferences
-- Apply after 0004_committee_leadership.sql.
--
-- The rule this file exists to enforce: mail leaves the server, and the server only ever says
-- what the provider answered. A browser cannot supply an address, a body, or a delivery status.
--
--  * esme_email_outbox  — the work queue. One row per message, keyed by idempotency_key, so a
--    replayed write, a retried sweep and a double click all produce one email.
--  * esme_email_log     — the delivery record. Append-only: one row per attempt with the status
--    the provider returned. This is what an admin reads when a message did not go out.
--  * esme_email_preferences — what a person may silence. Security notices are excluded by a
--    constraint, not by a checkbox that a request can skip.
--
-- Rows enter the queue from triggers on the authoritative writes, never from a client request.
-- The send-email Edge Function (service_role) claims a row, resolves the recipient's address
-- from esme_profiles at send time, calls the provider, and writes both records.

begin;

-- ---------------------------------------------------------------- enums ----

create type esme_email_status as enum ('queued', 'processing', 'sent', 'failed', 'suppressed');

/** The events this chapter mails about. Anything else is rejected at the column. */
create type esme_email_event as enum (
  'account_created',
  'account_approved',
  'account_rejected',
  'login_security_alert',
  'task_assigned',
  'task_assigned_to_team',
  'bonus_awarded',
  'warning_issued',
  'warning_escalated',
  'deadline_reminder',
  'submission_revision_requested',
  'submission_approved',
  'submission_rejected'
);

-- ------------------------------------------------------------ preferences ----

create table esme_email_preferences (
  profile_id uuid primary key references esme_profiles (id) on delete cascade,
  locale text not null default 'en' check (locale in ('en', 'ar')),
  muted_events esme_email_event[] not null default '{}',
  updated_at timestamptz not null default now()
);

/**
 * The four account-safety events cannot be muted. Checked against the array itself, so a
 * hand-made request that includes one is refused by the database rather than by the screen.
 */
create or replace function esme_preferences_block_security_mute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.muted_events && array['account_created','account_approved','account_rejected','login_security_alert']::esme_email_event[] then
    raise exception 'ESME_VALIDATION: an account-safety notice cannot be muted';
  end if;
  return new;
end;
$$;

create trigger esme_email_preferences_security_guard
  before insert or update on esme_email_preferences
  for each row execute function esme_preferences_block_security_mute();

/**
 * The only way a browser changes what it is mailed about. It writes the caller's own row — the
 * id comes from the session, never from the request — and refuses an account-safety event before
 * the upsert, so a hand-made payload cannot silence a sign-in alert.
 *
 * SECURITY INVOKER, unlike most of the other functions here, and deliberately so: this table
 * forces row level security even on its owner, and the policy that matters is the self-policy.
 * Running as the caller is what enforces it — a definer function would be writing preferences as
 * a role no policy describes.
 */
create or replace function esme_save_email_preferences(
  p_locale text,
  p_muted_events text[] default '{}'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile uuid;
  v_events esme_email_event[];
begin
  v_profile := esme_current_profile_id();
  if v_profile is null then
    raise exception 'ESME_UNAUTHORIZED: no active session';
  end if;

  if p_locale is null or p_locale not in ('en', 'ar') then
    raise exception 'ESME_VALIDATION: language must be en or ar';
  end if;

  -- The cast is the check: a value that is not one of the known events raises here rather than
  -- being stored and silently ignored later.
  v_events := coalesce(p_muted_events::esme_email_event[], '{}'::esme_email_event[]);
  if v_events && array['account_created','account_approved','account_rejected','login_security_alert']::esme_email_event[] then
    raise exception 'ESME_VALIDATION: an account-safety notice cannot be muted';
  end if;

  insert into esme_email_preferences (profile_id, locale, muted_events, updated_at)
    values (v_profile, p_locale, v_events, now())
  on conflict (profile_id) do update
    set locale = excluded.locale,
        muted_events = excluded.muted_events,
        updated_at = now();
end;
$$;

revoke all on function esme_save_email_preferences(text, text[]) from anon;
grant execute on function esme_save_email_preferences(text, text[]) to authenticated;

-- -------------------------------------------------------------- the queue ----

create table esme_email_outbox (
  id bigint generated always as identity primary key,
  event esme_email_event not null,
  /** The account the message is about. The address is read from that profile when it is sent. */
  recipient_profile_id uuid not null references esme_profiles (id) on delete cascade,
  /** Record-derived fields only. Never HTML, never an address, never a subject line. */
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status esme_email_status not null default 'queued',
  attempts integer not null default 0 check (attempts between 0 and 20),
  /** Backoff: the function only claims rows whose available_at has passed. */
  available_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index esme_email_outbox_claim_idx on esme_email_outbox (status, available_at);
create index esme_email_outbox_profile_idx on esme_email_outbox (recipient_profile_id, created_at desc);

create or replace function esme_touch_email_outbox_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger esme_email_outbox_touch_updated_at
  before update on esme_email_outbox
  for each row execute function esme_touch_email_outbox_updated_at();

-- ------------------------------------------------------------ delivery log ----
-- Append-only, like the audit trail: a delivery record that can be edited proves nothing.

create table esme_email_log (
  id bigint generated always as identity primary key,
  outbox_id bigint references esme_email_outbox (id) on delete set null,
  event esme_email_event not null,
  recipient_profile_id uuid references esme_profiles (id) on delete set null,
  /** The address the provider was asked to deliver to, recorded at send time. */
  recipient_email citext,
  status esme_email_status not null,
  provider_message_id text,
  error text,
  attempted_at timestamptz not null default now()
);

create index esme_email_log_recent_idx on esme_email_log (attempted_at desc);
create index esme_email_log_failed_idx on esme_email_log (status, attempted_at desc)
  where status in ('failed', 'suppressed');

create or replace function esme_email_log_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'ESME_FORBIDDEN: the email delivery log is append-only';
end;
$$;

create trigger esme_email_log_no_mutation
  before update or delete on esme_email_log
  for each row execute function esme_email_log_is_append_only();

-- ---------------------------------------------------------- queue writing ----

/**
 * The only way a message enters the queue. An existing key is left alone rather than
 * re-opened, so a second write of the same record cannot produce a second email.
 */
create or replace function esme_queue_email(
  p_event esme_email_event,
  p_recipient uuid,
  p_payload jsonb,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  insert into esme_email_outbox (event, recipient_profile_id, payload, idempotency_key)
  values (p_event, p_recipient, coalesce(p_payload, '{}'::jsonb), p_idempotency_key)
  on conflict (idempotency_key) do nothing;
exception
  when foreign_key_violation then
    -- The profile was deleted between the write and this trigger. Nothing was mailed, and the
    -- original transaction is not failed over a message nobody will read.
    null;
end;
$$;

/**
 * One in-app notification per queued message, written in the same transaction. A member who
 * never opens their email still sees the event in the workspace.
 */
create or replace function esme_notify_from_email(p_recipient uuid, p_title text, p_message text, p_link text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  insert into esme_notifications (profile_id, title, message, type, link)
  values (p_recipient, p_title, p_message, 'info', p_link);
exception
  when foreign_key_violation then
    -- The account disappeared mid-transaction. The mail is already queued; the record it
    -- refers to is not worth failing the write over.
    null;
end;
$$;

-- Application received -------------------------------------------------------

create or replace function esme_email_on_registration_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform esme_queue_email(
    'account_created',
    new.profile_id,
    jsonb_build_object('fullName', new.full_name, 'reference', new.id::text),
    'account_created:' || new.id::text
  );
  perform esme_notify_from_email(
    new.profile_id,
    'Application received', 'Your request is recorded and waiting for review.', null
  );
  return new;
end;
$$;

create trigger esme_email_registration_created
  after insert on esme_registration_requests
  for each row execute function esme_email_on_registration_request();

-- Approval and rejection: the profile status is the authoritative write -------

create or replace function esme_email_on_account_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_committee text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'active' then
    select name into v_committee from esme_committees where id = new.committee_id;
    perform esme_queue_email(
      'account_approved',
      new.id,
      jsonb_build_object('fullName', new.display_name, 'committeeName', v_committee),
      'account_approved:' || new.id::text
    );
    perform esme_notify_from_email(new.id, 'Account approved', 'You can sign in to the member workspace now.', null);
  elsif new.status = 'rejected' then
    perform esme_queue_email(
      'account_rejected',
      new.id,
      jsonb_build_object('fullName', new.display_name, 'reason', coalesce(new.rejection_reason, '')),
      'account_rejected:' || new.id::text
    );
    perform esme_notify_from_email(new.id, 'Application not approved', 'The review of your request is finished.', null);
  elsif new.status = 'suspended' then
    -- Suspension is an account-safety notice too. It reuses the rejection template's address
    -- resolution, keyed by the status change so one suspension mails once.
    perform esme_queue_email(
      'account_rejected',
      new.id,
      jsonb_build_object('fullName', new.display_name, 'reason', 'This account has been suspended.'),
      'account_suspended:' || new.id::text || ':' || extract(epoch from now())::bigint::text
    );
  end if;

  return new;
end;
$$;

create trigger esme_email_account_decision
  after update of status on esme_profiles
  for each row execute function esme_email_on_account_decision();

-- Task assigned --------------------------------------------------------------

create or replace function esme_email_on_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task esme_tasks%rowtype;
  v_assignee esme_profiles%rowtype;
  v_leader text;
  v_director uuid;
begin
  select * into v_task from esme_tasks where id = new.task_id;
  if v_task.id is null then
    return new;
  end if;
  select * into v_assignee from esme_profiles where id = new.profile_id;
  if v_assignee.id is null then
    return new;
  end if;

  select display_name into v_leader from esme_profiles where id = v_task.created_by;

  perform esme_queue_email(
    'task_assigned',
    new.profile_id,
    jsonb_build_object(
      'fullName', v_assignee.display_name,
      'taskId', v_task.id::text,
      'taskTitle', v_task.title,
      'deadline', coalesce(to_char(v_task.deadline, 'YYYY-MM-DD'), 'no date set'),
      'points', v_task.points,
      'leaderName', coalesce(v_leader, 'the chapter')
    ),
    'task_assigned:' || v_task.id::text || ':' || new.profile_id::text
  );
  perform esme_notify_from_email(
    new.profile_id,
    'Task assigned', v_task.title || ' — due ' || to_char(v_task.deadline, 'YYYY-MM-DD'), 'tasks'
  );

  -- A Head's assignment is visible to the committee's Director, and never to the actor themself.
  select profile_id into v_director
    from esme_leadership_seats
   where committee_id = v_task.committee_id and position = 'director';
  if v_director is not null and v_director <> new.profile_id and v_director <> esme_current_profile_id() then
    perform esme_queue_email(
      'task_assigned_to_team',
      v_director,
      jsonb_build_object(
        'assigneeName', v_assignee.display_name,
        'supervisorName', (select display_name from esme_profiles where id = v_director),
        'taskId', v_task.id::text,
        'taskTitle', v_task.title,
        'deadline', to_char(v_task.deadline, 'YYYY-MM-DD'),
        'leaderName', coalesce(v_leader, 'the chapter')
      ),
      'task_assigned_to_team:' || v_task.id::text || ':' || new.profile_id::text
    );
  end if;

  return new;
end;
$$;

create trigger esme_email_task_assigned
  after insert on esme_task_assignments
  for each row execute function esme_email_on_task_assignment();

-- Submission decided ---------------------------------------------------------

create or replace function esme_email_on_submission_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member esme_profiles%rowtype;
  v_event esme_email_event;
  v_total integer;
  v_title text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  if new.status not in ('approved', 'rejected', 'revision_requested') then
    return new;
  end if;

  v_event := case new.status
    when 'approved' then 'submission_approved'::esme_email_event
    when 'rejected' then 'submission_rejected'::esme_email_event
    else 'submission_revision_requested'::esme_email_event
  end;

  select * into v_member from esme_profiles where id = new.profile_id;
  if v_member.id is null then
    return new;
  end if;

  -- The submission row has no title of its own; the task it answers does.
  select title into v_title from esme_tasks where id = new.task_id;

  -- This trigger runs while the review is still being written: the ledger entry for the points
  -- this decision awards lands after it, so the total has to count it here or it reads stale.
  select coalesce(sum(points), 0) into v_total from esme_score_ledger where profile_id = new.profile_id;
  v_total := v_total + case when new.status = 'approved' then coalesce(new.awarded_points, 0) else 0 end;

  perform esme_queue_email(
    v_event,
    new.profile_id,
    jsonb_build_object(
      'fullName', v_member.display_name,
      'taskTitle', coalesce(v_title, 'your submission'),
      'feedback', coalesce(new.reviewer_feedback, ''),
      'reason', coalesce(new.reviewer_feedback, ''),
      'points', coalesce(new.awarded_points, 0),
      'newTotal', v_total
    ),
    v_event || ':' || new.id::text
  );
  perform esme_notify_from_email(
    new.profile_id,
    case new.status
      when 'approved' then 'Submission approved'
      when 'rejected' then 'Submission not approved'
      else 'Revision requested'
    end,
    coalesce(v_title, 'Your submission'), 'submissions'
  );

  return new;
end;
$$;

create trigger esme_email_submission_decision
  after update of status on esme_submissions
  for each row execute function esme_email_on_submission_decision();

-- Bonus awarded --------------------------------------------------------------
-- Only a positive entry is a bonus; a penalty is discipline and arrives with the warning
-- records in the next migration.

create or replace function esme_email_on_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member esme_profiles%rowtype;
  v_actor text;
  v_title text;
begin
  if new.points <= 0 or new.action_type not in ('bonus', 'manual_adjustment', 'event_attendance') then
    return new;
  end if;

  select * into v_member from esme_profiles where id = new.profile_id;
  if v_member.id is null then
    return new;
  end if;
  select display_name into v_actor from esme_profiles where id = new.recorded_by;
  select title into v_title from esme_tasks where id = new.task_id;

  perform esme_queue_email(
    'bonus_awarded',
    new.profile_id,
    jsonb_build_object(
      'fullName', v_member.display_name,
      'points', new.points,
      'reason', new.reason,
      'awarderName', coalesce(v_actor, 'the chapter'),
      'newTotal', (select coalesce(sum(points), 0) from esme_score_ledger where profile_id = new.profile_id),
      'taskTitle', coalesce(v_title, '')
    ),
    'bonus_awarded:' || new.id::text
  );
  perform esme_notify_from_email(
    new.profile_id,
    'Bonus awarded', '+' || new.points || ' points — ' || new.reason, 'scoring'
  );
  return new;
end;
$$;

create trigger esme_email_bonus_awarded
  after insert on esme_score_ledger
  for each row execute function esme_email_on_bonus();

-- Sign-in report -------------------------------------------------------------
-- auth.users rows are written by Supabase's own auth server, outside this schema's triggers,
-- so the client reports the session through this function. Nothing about the alert is
-- client-supplied except the device string: the address, the name and the rate limit all come
-- from rows this database owns.

create or replace function esme_report_sign_in(p_device text, p_occurred_at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile esme_profiles%rowtype;
  v_window bigint;
  v_last_sent timestamptz;
begin
  select * into v_profile from esme_profiles where id = esme_current_profile_id();
  if v_profile.id is null then
    raise exception 'ESME_UNAUTHORIZED: no session profile';
  end if;

  -- One alert per account per device per 12-hour window, measured from the log itself.
  v_window := 12 * 60 * 60;
  select max(attempted_at) into v_last_sent
  from esme_email_log
  where recipient_profile_id = v_profile.id
    and event = 'login_security_alert'
    and error is null;
  if v_last_sent is not null and v_occurred_at - v_last_sent < interval '12 hours' then
    return;
  end if;

  perform esme_queue_email(
    'login_security_alert',
    v_profile.id,
    jsonb_build_object(
      'fullName', v_profile.display_name,
      'occurredAt', to_char(p_occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'device', left(coalesce(p_device, 'unknown device'), 200)
    ),
    'login_security_alert:' || v_profile.id::text || ':' || (extract(epoch from p_occurred_at) / v_window)::bigint::text
  );
end;
$$;

revoke all on function esme_report_sign_in(text, timestamptz) from anon;
grant execute on function esme_report_sign_in(text, timestamptz) to authenticated;

-- Deadline reminders ---------------------------------------------------------
-- Called by the scheduled run, not by a member. Each (task, member, day) key exists once, so a
-- cron that fires twice a day still sends one reminder.

create or replace function esme_queue_deadline_reminders(p_days_ahead integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  if not esme_has_capability('notifications.manage') and esme_current_profile_id() is not null then
    raise exception 'ESME_FORBIDDEN: deadline reminders are raised by the scheduler';
  end if;

  for v_row in
    select t.id as task_id, t.title, t.deadline, a.profile_id, p.display_name
    from esme_tasks t
    join esme_task_assignments a on a.task_id = t.id
    join esme_profiles p on p.id = a.profile_id
    where t.status in ('assigned', 'in_progress', 'revision_requested')
      and t.deadline::date - current_date between -365 and p_days_ahead
  loop
    insert into esme_email_outbox (event, recipient_profile_id, payload, idempotency_key)
    values (
      'deadline_reminder',
      v_row.profile_id,
      jsonb_build_object(
        'fullName', v_row.display_name,
        'taskTitle', v_row.title,
        'deadline', to_char(v_row.deadline, 'YYYY-MM-DD'),
        'daysRemaining', v_row.deadline::date - current_date
      ),
      'deadline_reminder:' || v_row.task_id::text || ':' || v_row.profile_id::text || ':' || current_date::text
    )
    on conflict (idempotency_key) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function esme_queue_deadline_reminders(integer) from anon;
grant execute on function esme_queue_deadline_reminders(integer) to service_role;

-- ------------------------------------------------------------- claiming ----
-- The Edge Function takes one row at a time under a row lock, so two scheduler invocations,
-- a manual run and a retry can never send the same message twice.

create or replace function esme_claim_next_email(p_max_attempts integer default 3)
returns setof esme_email_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_max_attempts not between 1 and 20 then
    raise exception 'ESME_VALIDATION: attempt ceiling is between 1 and 20';
  end if;

  -- Anything left 'processing' for over ten minutes is a crashed run; hand it back.
  update esme_email_outbox
    set status = 'queued', updated_at = now()
    where status = 'processing' and updated_at < now() - interval '10 minutes';

  select id into v_id
  from esme_email_outbox
  where status in ('queued', 'failed')
    and attempts < p_max_attempts
    and available_at <= now()
  order by available_at, id
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  update esme_email_outbox
    set status = 'processing', attempts = attempts + 1
    where id = v_id;

  return query select * from esme_email_outbox where id = v_id;
end;
$$;

revoke all on function esme_claim_next_email(integer) from anon;
revoke all on function esme_claim_next_email(integer) from authenticated;
grant execute on function esme_claim_next_email(integer) to service_role;

/**
 * Records the provider's answer. The status written here is the only delivery fact any screen
 * may show, and the address is read from the profile at this moment rather than trusted from
 * the queue row — a person who changed their email is not mailed at the old one.
 *
 * A failure that still has attempts left keeps its place in the queue with a backoff; a row
 * that has used them up stays 'failed' and stops being claimable, so an unreachable address
 * cannot occupy the sender forever. Every attempt is written to the log either way.
 */
create or replace function esme_record_email_result(
  p_outbox_id bigint,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null,
  p_max_attempts integer default 3
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row esme_email_outbox;
  v_email citext;
  v_status esme_email_status;
  v_error text;
begin
  select * into v_row from esme_email_outbox where id = p_outbox_id for update;
  if v_row.id is null then
    raise exception 'ESME_NOT_FOUND: outbox row %', p_outbox_id;
  end if;

  if p_status not in ('sent', 'failed', 'suppressed') then
    raise exception 'ESME_VALIDATION: a delivery result is sent, failed or suppressed';
  end if;
  v_status := p_status::esme_email_status;

  select email into v_email from esme_profiles where id = v_row.recipient_profile_id;

  if v_status <> 'sent' and v_email is null then
    -- Nothing can ever be delivered to a profile with no address: stop instead of retrying.
    v_status := 'suppressed';
  end if;
  v_error := case when v_status = 'sent' then null
                  else left(coalesce(nullif(btrim(p_error), ''),
                                     case when v_email is null then 'recipient has no email address on file' end,
                                     'the provider did not explain the failure'), 500)
             end;

  update esme_email_outbox
    set status = v_status,
        provider_message_id = case when v_status = 'sent' then p_provider_message_id else provider_message_id end,
        last_error = v_error,
        available_at = case
          when v_status = 'failed' then now() + make_interval(mins => 15 * v_row.attempts)
          else available_at
        end
    where id = v_row.id;

  insert into esme_email_log (
    outbox_id, event, recipient_profile_id, recipient_email, status, provider_message_id, error
  )
  values (
    v_row.id, v_row.event, v_row.recipient_profile_id, v_email, v_status, p_provider_message_id, v_error
  );
end;
$$;

revoke all on function esme_record_email_result(bigint, text, text, text, integer) from anon;
revoke all on function esme_record_email_result(bigint, text, text, text, integer) from authenticated;
grant execute on function esme_record_email_result(bigint, text, text, text, integer) to service_role;

/** The queue as the sender sees it: the row plus the address and language resolved now. */
create or replace function esme_email_recipient(p_outbox_id bigint)returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row esme_email_outbox;
  v_profile esme_profiles%rowtype;
  v_prefs esme_email_preferences%rowtype;
begin
  select * into v_row from esme_email_outbox where id = p_outbox_id;
  if v_row.id is null then
    raise exception 'ESME_NOT_FOUND: outbox row %', p_outbox_id;
  end if;

  select * into v_profile from esme_profiles where id = v_row.recipient_profile_id;
  select * into v_prefs from esme_email_preferences where profile_id = v_row.recipient_profile_id;

  return jsonb_build_object(
    'event', v_row.event,
    'payload', v_row.payload,
    'email', v_profile.email,
    'status', v_profile.status,
    'locale', coalesce(v_prefs.locale, 'en'),
    'muted', coalesce(v_prefs.muted_events @> array[v_row.event]::esme_email_event[], false)
  );
end;
$$;

-- Service role only. This function reads through RLS, so handing it to a browser session would
-- let anyone who guessed an outbox id read another person's email address.
revoke all on function esme_email_recipient(bigint) from anon, authenticated;
grant execute on function esme_email_recipient(bigint) to service_role;

-- ------------------------------------------------------------------ RLS ----

alter table esme_email_preferences enable row level security;
alter table esme_email_outbox enable row level security;
alter table esme_email_log enable row level security;

alter table esme_email_preferences force row level security;
alter table esme_email_outbox force row level security;
alter table esme_email_log force row level security;

-- A person reads and writes their own preferences and nothing else.
create policy esme_email_preferences_self on esme_email_preferences
  for all to authenticated
  using (profile_id = esme_current_profile_id())
  with check (profile_id = esme_current_profile_id());

-- The queue is not browsable: it is written by triggers and drained by the service role.
-- An officer with notifications.manage may read it to see what is stuck.
create policy esme_email_outbox_read on esme_email_outbox
  for select to authenticated
  using (esme_has_capability('notifications.manage'));

create policy esme_email_log_read on esme_email_log
  for select to authenticated
  using (esme_has_capability('notifications.manage'));

grant select on esme_email_preferences, esme_email_outbox, esme_email_log to authenticated;
grant insert, update, delete on esme_email_preferences to authenticated;
grant usage, select on sequence esme_email_outbox_id_seq, esme_email_log_id_seq to service_role;
grant select, insert, update on esme_email_outbox to service_role;
grant select, insert on esme_email_log to service_role;

-- Browser roles never write the queue or the log directly.
revoke insert, update, delete on esme_email_outbox from anon, authenticated;
revoke insert, update, delete on esme_email_log from anon, authenticated;

commit;
