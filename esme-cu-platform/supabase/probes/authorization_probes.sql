-- Authorization probes for supabase/migrations — authored, reviewed, and NOT executed anywhere yet.
--
-- Every block runs inside a transaction that ends in `rollback`, so the file changes nothing that
-- survives the run. Each probe prints exactly one notice: `PASS …` when the database behaved the way
-- the migration intends, `FAIL …` when it did not, `SKIP …` when the project has no row to probe.
-- A probe that raises instead of printing means a guard is missing, not that the probe is wrong.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --no-psqlrc \
--     -v head_id=<uuid> -v member_id=<uuid> -v alien_id=<uuid> -v page_id=<uuid> \
--     -f supabase/probes/authorization_probes.sql
--
-- The four -v values are required: an unset identifier makes `:'head_id'::uuid` raise, and that is a
-- mistake in the command, not a missing guard.
--
-- Run it from a session that may `set local role` (the dashboard SQL editor, `postgres`, or
-- `supabase_admin`). `select current_user` at the top prints which one you are in; if it is
-- `authenticated` or `anon`, the probes are running as the wrong principal and prove nothing.
-- If a guard seems to be the obstacle, fix the session — never loosen a policy to make a probe pass.
--
-- Fill the four identifiers first, from rows that already exist in this project:
--   :head_id     an active Head's auth uid
--   :member_id   an active Member in that Head's committee
--   :alien_id    an active Member in a DIFFERENT committee
--   :page_id     a row in esme_content_pages
-- Find them with:
--   select id, display_name, role, status, committee_id from esme_profiles order by role, display_name;
--   select id, slug, published from esme_content_pages order by nav_order;
-- If a role is missing, seed the three test accounts first (scripts/seed-test-accounts.mjs). The
-- rows these probes write are rolled back; the identities you seed are not.

\set ON_ERROR_STOP on

begin;
do $p$
begin
  raise notice 'P00 identity: current_user=%, auth.role=%',
    current_user, coalesce(auth.role(), 'no jwt in this session');
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P01  The reward ledger is not client-writable. 0006 revokes DML from
--      `authenticated` AND installs esme_assert_reward_channel() as a BEFORE
--      trigger, so either layer alone would still refuse. Both must.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
begin
  insert into esme_reward_entries
    (kind, actor_id, actor_role, target_id, target_role_at_time, points, reason, idempotency_key)
    values ('bonus', auth.uid(), 'head', auth.uid(), 'head', 10,
            'a browser tried to pay itself', 'probe:P01');
  raise notice 'P01 FAIL: a direct insert into esme_reward_entries was accepted';
exception when insufficient_privilege then
  raise notice 'P01 PASS: direct insert refused by privileges (%)', sqlerrm;
when raise_exception then
  raise notice 'P01 PASS: direct insert refused by the channel guard (%)', sqlerrm;
when others then
  raise notice 'P01 FAIL: refused, but with an unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P02  A filed entry cannot be edited away — the history is the accountability.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
declare v_id uuid;
begin
  select id into v_id from esme_reward_entries limit 1;
  if v_id is null then
    raise notice 'P02 SKIP: no reward row exists to edit — file one through esme_award_bonus() first';
    return;
  end if;
  update esme_reward_entries set reason = 'rewritten after the fact' where id = v_id;
  raise notice 'P02 FAIL: a filed reward entry was edited';
exception when insufficient_privilege then
  raise notice 'P02 PASS: reward entry frozen by privileges';
when raise_exception then
  raise notice 'P02 PASS: reward entry frozen by the trigger (%)', sqlerrm;
when others then
  raise notice 'P02 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P03  A Member holds no rewards.write, so the RPC must refuse the call. This
--      is the probe that answers "can an unauthorized user write?" with
--      something other than a client-side promise.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
begin
  perform esme_award_bonus(:'head_id'::uuid, 10, 'Ran the workshop', null, 'probe:P03');
  raise notice 'P03 FAIL: a Member recorded a bonus';
exception when raise_exception then
  if sqlerrm ilike '%ESME%' then
    raise notice 'P03 PASS: refused by a declared rule (%)', sqlerrm;
  else
    raise notice 'P03 FAIL: refused by something other than a declared rule (%)', sqlerrm;
  end if;
when insufficient_privilege then
  raise notice 'P03 PASS: refused by EXECUTE privileges — the function is not callable at all';
when others then
  raise notice 'P03 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P04  A Head cannot reach outside their own committee.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
begin
  perform esme_award_bonus(:'alien_id'::uuid, 10, 'Cross-committee write', null, 'probe:P04');
  raise notice 'P04 FAIL: a Head awarded points to another committee''s member';
exception when raise_exception then
  raise notice 'P04 PASS: out-of-reach target refused (%)', sqlerrm;
when others then
  raise notice 'P04 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P05  One idempotency key, offered twice: the second call must add no row.
--      This is the database-side answer to a double-clicked submit, and the
--      reason the client-side key check is a courtesy rather than the control.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
declare v_before int; v_after int; v_target uuid;
begin
  select id into v_target from esme_profiles
   where role = 'member' and status = 'active'
     and committee_id = (select committee_id from esme_profiles where id = auth.uid())
   limit 1;
  if v_target is null then
    raise notice 'P05 SKIP: no active member in this Head''s committee to pay';
    return;
  end if;
  select count(*) into v_before from esme_reward_entries;
  perform esme_award_bonus(v_target, 5, 'Set up the venue', null, 'probe:P05');
  perform esme_award_bonus(v_target, 5, 'Set up the venue', null, 'probe:P05');
  select count(*) into v_after from esme_reward_entries;
  if v_after = v_before + 1 then
    raise notice 'P05 PASS: the replayed key filed one row, not two';
  else
    raise notice 'P05 FAIL: the replay produced % new rows', v_after - v_before;
  end if;
exception when others then
  raise notice 'P05 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P06  A correcting entry needs a reason. An anonymous reversal is how a ledger
--      quietly stops meaning anything.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
declare v_id uuid;
begin
  select id into v_id from esme_reward_entries where kind = 'bonus' and status = 'active' limit 1;
  if v_id is null then
    raise notice 'P06 SKIP: no active bonus row to reverse';
    return;
  end if;
  perform esme_reverse_reward_entry(v_id, '   ');
  raise notice 'P06 FAIL: an entry was reversed with no reason';
exception when raise_exception then
  raise notice 'P06 PASS: blank reason refused (%)', sqlerrm;
when others then
  raise notice 'P06 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P07  Leadership is an RPC decision, not a column a client can write.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_rows int;
begin
  update esme_committees set head_id = auth.uid() where head_id is not null;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise notice 'P07 FAIL: a Member overwrote % leadership seat(s) directly', v_rows;
  else
    -- RLS filters before it refuses, so zero rows is the policy doing its job by invisibility
    -- rather than by privilege. Say which one happened instead of rounding it up to a pass.
    raise notice 'P07 note: the statement was permitted but matched no seat RLS made visible';
  end if;
exception when insufficient_privilege then
  raise notice 'P07 PASS: seat column refused by privileges';
when raise_exception then
  raise notice 'P07 PASS: seat column refused by the seat guard (%)', sqlerrm;
when others then
  raise notice 'P07 note: refused or nothing matched (%: %)', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P08  The audit trail is append-only, including for an officer.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
begin
  delete from esme_audit_log;
  raise notice 'P08 FAIL: an authenticated session deleted audit rows';
exception when insufficient_privilege then
  raise notice 'P08 PASS: audit delete refused by privileges';
when raise_exception then
  raise notice 'P08 PASS: audit delete refused by the freeze trigger (%)', sqlerrm;
when others then
  raise notice 'P08 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P09  Publication is a guarded column, not a policy that trusts the client.
--      A writer who can edit copy must not be able to publish it by writing the
--      timestamp themselves.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_rows int;
begin
  update esme_content_pages set published_at = now() where id = :'page_id'::uuid;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    raise notice 'P09 FAIL: a writer published a page by touching the timestamp';
  else
    raise notice 'P09 note: permitted but :page_id was not visible to this role — the guard was not reached';
  end if;
exception when raise_exception then
  raise notice 'P09 PASS: publication guard fired (%)', sqlerrm;
when insufficient_privilege then
  raise notice 'P09 PASS: no column privilege on published_at';
when others then
  raise notice 'P09 note: refused or nothing matched (%: %)', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P10  The same guard must not be a lockout: the ordinary content edit that
--      esme_pages_update allows has to still land. P09 without P10 is how a
--      fix turns into an outage.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_rows int;
begin
  update esme_content_pages set body = body where id = :'page_id'::uuid;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    raise notice 'P10 PASS: a writer''s ordinary content edit still lands (guard is not a lockout)';
  else
    raise notice 'P10 FAIL: the statement ran but matched % rows for :page_id', v_rows;
  end if;
exception when others then
  raise notice 'P10 FAIL: an ordinary content edit was refused (%: %)', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P11  A suspended account holding an unexpired token gets nothing. The status
--      is read from the row on every call, so the JWT is not the authority.
-- ---------------------------------------------------------------------------
begin;
-- Suspended by the operator session, before the role switch, because an authenticated
-- principal has no UPDATE on esme_profiles and that is a different probe.
update esme_profiles set status = 'suspended' where id = :'member_id'::uuid;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_status text; v_can boolean;
begin
  select status::text into v_status from esme_profiles where id = auth.uid();
  v_can := esme_has_capability('rewards.write');
  if v_status = 'suspended' and coalesce(v_can, false) is not true then
    raise notice 'P11 PASS: suspension is read from the row, not the token';
  else
    raise notice 'P11 FAIL: status=% but rewards.write=%', v_status, v_can;
  end if;
exception when others then
  raise notice 'P11 SKIP: this session could not suspend the probe account (%: %)', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P12  anon reads nothing about the chapter.
-- ---------------------------------------------------------------------------
begin;
set local role anon;
do $p$
declare n int;
begin
  select count(*) into n from esme_profiles;
  if n = 0 then
    raise notice 'P12 PASS: anon sees no profile rows';
  else
    raise notice 'P12 FAIL: anon read % profile rows', n;
  end if;
exception when insufficient_privilege then
  raise notice 'P12 PASS: anon has no SELECT on esme_profiles';
when others then
  raise notice 'P12 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P13  An application cannot be filed from outside a session, and a role can
--      never be supplied by a browser: esme_registration_requests has no role
--      column at all, and 0002's insert policy requires an authenticated uid
--      matching the row's profile_id.
-- ---------------------------------------------------------------------------
begin;
set local role anon;
do $p$
begin
  insert into esme_registration_requests (profile_id, full_name, email, username, agreed_to_policies)
    values (gen_random_uuid(), 'Probe Person', 'probe.role@example.invalid', 'probe_role', true);
  raise notice 'P13 FAIL: anon filed an application';
exception when insufficient_privilege then
  raise notice 'P13 PASS: anon cannot insert into esme_registration_requests';
when raise_exception then
  raise notice 'P13 PASS: refused by a declared rule (%)', sqlerrm;
when others then
  raise notice 'P13 note: refused with %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P14  The matrix is what refuses, not a hard-coded rank list: switch a role's
--      capability off in the row and the RPC changes its answer.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
declare v_can boolean;
begin
  select esme_has_capability('rewards.write') into v_can;
  raise notice 'P14 note: this Head''s rewards.write=% — compare with esme_role_capabilities, and with what the UI matrix shows for the same role', v_can;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P15  Privilege cannot be granted by a table write. esme_assign_role() is the
--      only documented path for esme_profiles.role, and 0004's channel guards
--      cover committee_id but not role. This probe therefore tests the RLS
--      policy alone: a Head holds users.update with committee scope, which
--      reaches its own row, so the question is whether WITH CHECK freezes the
--      role column on that path.
--      The RLS policy therefore has to refuse it on its own. Before 0009 it did not — the privileged
--      branch of WITH CHECK tested reachability only — so this block is the regression probe for
--      finding 1. EXPECTED RESULT with 0009 applied: PASS, refused by
--      ESME_ROLE_FUNCTION_ONLY. A FAIL here means 0009 is missing or only partially applied.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'head_id', 'role', 'authenticated')::text;
do $p$
declare v_before esme_role;
begin
  select role into v_before from esme_profiles where id = auth.uid();
  if v_before is null then
    raise notice 'P15 SKIP: :head_id is not a readable profile — check the identifier';
    return;
  end if;
  update esme_profiles set role = 'super_admin' where id = auth.uid();
  select role into v_before from esme_profiles where id = auth.uid();
  if v_before = 'super_admin' then
    raise notice 'P15 FAIL: a Head promoted itself by writing esme_profiles.role directly';
  else
    raise notice 'P15 FAIL: the update was accepted and left the role unchanged — the write path is unclear';
  end if;
exception when insufficient_privilege then
  raise notice 'P15 PASS: the policy refused a direct role write (%)', sqlerrm;
when raise_exception then
  raise notice 'P15 PASS: refused by a declared rule (%)', sqlerrm;
when others then
  raise notice 'P15 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P16  A granted view is not a second, unfiltered door into the same rows.
--      esme_member_scores and esme_committee_rosters are plain views, so
--      Postgres reads their base tables as the view owner; no migration in
--      this repository sets security_invoker. The probe compares what the view
--      returns with what the same session may see through esme_profiles, where
--      the users.read / scores.read scope does apply.
--      EXPECTED RESULT with 0009 applied: PASS, and the two counts agree. Before 0009 this FAILS on
--      any project with more than one active member, because no migration set security_invoker and
--      the view read every profile as its owner. If it raises `permission denied for table
--      esme_profiles` instead, 0009's base-table grants did not land — report that as a failed
--      migration, not as a passing probe.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_view bigint; v_table bigint;
begin
  select count(*) into v_table from esme_profiles where status = 'active';
  if v_table < 2 then
    raise notice 'P16 SKIP: this project has % active profile(s); the comparison needs at least two', v_table;
    return;
  end if;
  select count(*) into v_view from esme_member_scores;
  if v_view > v_table then
    raise notice 'P16 FAIL: esme_member_scores returned % of % active profiles — the view bypasses RLS for this Member', v_view, v_table;
  else
    raise notice 'P16 PASS: esme_member_scores is filtered to the caller''s scope (% rows)', v_view;
  end if;
exception when insufficient_privilege then
  raise notice 'P16 FAIL: esme_member_scores raised permission denied — security_invoker is on but 0009''s SELECT grant on the base tables did not land (%)', sqlerrm;
when undefined_table then
  raise notice 'P16 FAIL: esme_member_scores does not exist — 0001 was not applied';
when others then
  raise notice 'P16 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P17  The email queue is still reachable from inside its own definer
--      functions. 0005 grants no INSERT policy on esme_email_outbox and turns
--      FORCE ROW LEVEL SECURITY on for that table (0005:784-786), which is the
--      only table in this schema that forces it. Whether esme_queue_email() —
--      SECURITY DEFINER, executed as the view/table owner — can still insert
--      depends on attributes of the owning role that only a real project can
--      show. This runs as the session principal, not as authenticated, because
--      that is the path the triggers and the Edge Function take.
--      EXPECTED RESULT: PASS. A FAIL means every decision email and reminder
--      silently stops queueing, and nothing in the browser would report it.
-- ---------------------------------------------------------------------------
begin;
do $p$
declare v_before bigint; v_after bigint; v_key text;
begin
  select count(*) into v_before from esme_email_outbox;
  v_key := 'probe:P17:' || gen_random_uuid()::text;
  perform esme_queue_email('deadline_reminder', :'member_id', '{}'::jsonb, v_key);
  select count(*) into v_after from esme_email_outbox where idempotency_key = v_key;
  if v_after = 1 then
    raise notice 'P17 PASS: esme_queue_email() inserted through FORCE ROW LEVEL SECURITY';
  else
    raise notice 'P17 FAIL: esme_queue_email() reported success but queued no row (owner=%)', current_user;
  end if;
exception when insufficient_privilege then
  raise notice 'P17 FAIL: FORCE ROW LEVEL SECURITY refused the definer insert — no email will ever queue (%)', sqlerrm;
when raise_exception then
  raise notice 'P17 note: refused by a declared rule (%)', sqlerrm;
when others then
  raise notice 'P17 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P18  The reward view is no wider than the reward table it reads.
--      esme_member_reward_records aggregates every profile, so before 0009 a
--      Member selecting it saw the whole chapter's bonus totals and active
--      warning counts. With security_invoker the rows come from esme_profiles
--      and esme_reward_entries under the caller's own policies, so a Member
--      must see exactly one row: their own.
--      EXPECTED RESULT with 0009 applied: PASS.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_rows bigint; v_foreign bigint;
begin
  select count(*) into v_rows from esme_member_reward_records;
  select count(*) into v_foreign from esme_member_reward_records where profile_id <> auth.uid();
  if v_foreign > 0 then
    raise notice 'P18 FAIL: esme_member_reward_records returned % row(s) about other members', v_foreign;
  elsif v_rows = 0 then
    raise notice 'P18 note: the view returned no row for this Member at all — check that the profile is active and readable';
  else
    raise notice 'P18 PASS: the reward view returned only the caller''s own row (% of %)', v_rows, v_rows;
  end if;
exception when insufficient_privilege then
  raise notice 'P18 FAIL: permission denied reading the view''s base tables — 0009 grants did not land (%)', sqlerrm;
when undefined_table then
  raise notice 'P18 FAIL: esme_member_reward_records does not exist — 0006 was not applied';
when others then
  raise notice 'P18 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P19  Visibility parity, the other direction: a narrowing that hides rows the
--      capability model grants is a defect too. Every role — including Member —
--      holds committees.read with `all` scope, so esme_committee_rosters must
--      still answer with one row per readable committee after 0009 turned the
--      view into the caller's own read.
--      EXPECTED RESULT: PASS, with the two counts equal.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = json_build_object('sub', :'member_id', 'role', 'authenticated')::text;
do $p$
declare v_view bigint; v_scope bigint;
begin
  select count(*) into v_scope from esme_committees c
   where esme_reaches_committee(c.id, 'committees.read');
  if v_scope = 0 then
    raise notice 'P19 SKIP: this project has no committee this Member can read';
    return;
  end if;
  select count(*) into v_view from esme_committee_rosters;
  if v_view = v_scope then
    raise notice 'P19 PASS: esme_committee_rosters still returns all % readable committee(s)', v_scope;
  else
    raise notice 'P19 FAIL: the view returned % rows where the capability model allows %', v_view, v_scope;
  end if;
exception when insufficient_privilege then
  raise notice 'P19 FAIL: permission denied — 0009''s SELECT grants on esme_committees or its memberships did not land (%)', sqlerrm;
when others then
  raise notice 'P19 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P20  0010 — nobody is their own privilege gate. esme_assign_role() (0002) checked
--      the caller's capability and never compared the target with the caller, so an
--      account holding users.role.assign could move its own role: today that is a
--      Super Admin locking themselves out by demotion, and the moment IT is granted
--      the capability it becomes self-promotion. esme_set_account_status() already
--      had ESME_SELF_LOCKOUT, which is why this is a gap rather than a decision.
--      The Super Admin is found by this block rather than passed in with -v, because
--      the probe needs a session that IS that account, not merely a row about it.
--      EXPECTED RESULT with 0010 applied: PASS, refused by ESME_SELF_ROLE_CHANGE, and
--      the role still super_admin afterwards — the second half is the point. A refusal
--      that left the row half-written would be worse than no guard at all.
-- ---------------------------------------------------------------------------
begin;
do $p$
declare v_admin uuid; v_after esme_role;
begin
  -- Read as this session's owner: an `authenticated` session with no jwt yet cannot see the
  -- directory, and looking for the administrator is not the part under test.
  select id into v_admin from esme_profiles where role = 'super_admin' order by id limit 1;
  if v_admin is null then
    raise notice 'P20 SKIP: this project has no Super Admin profile — 0003 bootstrap not run?';
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  begin
    perform esme_assign_role(v_admin, 'moderator');
    select role into v_after from esme_profiles where id = v_admin;
    if v_after = 'moderator' then
      raise notice 'P20 FAIL: a Super Admin changed its own role to %', v_after;
    else
      raise notice 'P20 FAIL: esme_assign_role() returned success and left the role at % — the refusal never ran', v_after;
    end if;
  exception when raise_exception then
    if sqlerrm like '%ESME_SELF_ROLE_CHANGE%' then
      select role into v_after from esme_profiles where id = v_admin;
      if v_after = 'super_admin' then
        raise notice 'P20 PASS: self-targeted role change refused and the role unchanged (%)', sqlerrm;
      else
        raise notice 'P20 FAIL: refused with an error, yet the role moved to %', v_after;
      end if;
    else
      raise notice 'P20 FAIL: refused for the wrong reason: %', sqlerrm;
    end if;
  when others then
    raise notice 'P20 FAIL: unexpected code %: %', sqlstate, sqlerrm;
  end;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P21  0010 — an authorized role change still works, and its audit row says what
--      changed. 0002 selected the target `for update`, then stored only the new role
--      and the email, discarding v_target.role — so the trail could not answer "from
--      what to what", which is the half that makes a privilege record evidence.
--      This grants a role to :member_id as the Super Admin and reads the audit line
--      back. The grant is real and is rolled back with the transaction, exactly like
--      every other block in this file.
--      EXPECTED RESULT with 0010 applied: PASS, details containing ` -> moderator`.
--      A details field holding only the email means 0002's version of the function is
--      still installed — the migration did not replace it.
-- ---------------------------------------------------------------------------
begin;
do $p$
declare v_admin uuid; v_details text; v_role esme_role;
begin
  select id into v_admin from esme_profiles where role = 'super_admin' order by id limit 1;
  if v_admin is null then
    raise notice 'P21 SKIP: this project has no Super Admin to make an authorized grant';
    return;
  end if;
  if to_regclass('esme_audit_log') is null then
    raise notice 'P21 SKIP: esme_audit_log does not exist — 0001 was not applied';
    return;
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  perform esme_assign_role(:'member_id'::uuid, 'moderator');
  select role into v_role from esme_profiles where id = :'member_id'::uuid;
  select details into v_details from esme_audit_log
   where target_id = :'member_id'::text and action = 'ROLE_ASSIGNED_MODERATOR'
   order by recorded_at desc limit 1;

  if v_role <> 'moderator' then
    raise notice 'P21 FAIL: the authorized grant did not apply (role is %)', v_role;
  elsif v_details is null then
    raise notice 'P21 FAIL: the role moved but no audit row was written for it';
  elsif v_details like '% -> moderator' then
    raise notice 'P21 PASS: audit line carries both roles (%)', v_details;
  else
    raise notice 'P21 FAIL: audit line names only the outcome — 0002''s function is still installed (%)', v_details;
  end if;
exception when insufficient_privilege then
  raise notice 'P21 FAIL: the Super Admin could not write the profile or read the trail it is granted (%); check the esme_audit_read policy', sqlerrm;
when raise_exception then
  raise notice 'P21 FAIL: the authorized grant was refused: %', sqlerrm;
when others then
  raise notice 'P21 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P22  0011 — a signup's academic answers survive the trigger, and a committee the
--      applicant disowned does not. This is the first probe in the file that writes
--      through the signup path rather than around it: it inserts a row into auth.users
--      with the metadata src/auth/supabaseAdapter.ts:330-358 actually sends, and reads
--      the queue row the trigger produced. 0007's body would raise here on the
--      `comm_…` committee id — invalid input syntax for type uuid, inside a BEFORE
--      INSERT trigger, which aborts the signup and loses the account. 0011 resolves the
--      reference instead. The two auth.users rows are deleted before the rollback, so a
--      session that commits by mistake still leaves nothing behind.
--      Run as the database owner (postgres / supabase_admin): an `authenticated` session
--      cannot insert into auth.users, and that is a session problem, not a missing guard.
--      EXPECTED RESULT with 0011 applied: PASS twice — the first applicant carries
--      'yes' + a resolved High Board + the year and department on both rows, the second
--      answers 'no' while metadata still names a committee and the queue keeps neither.
--      assigned_committee_id must be NULL in both: an application is not an assignment.
-- ---------------------------------------------------------------------------
begin;
do $p$
declare
  v_yes uuid := gen_random_uuid();
  v_no uuid := gen_random_uuid();
  v_hb uuid;
  v_missing integer;
  v_request esme_registration_requests%rowtype;
  v_profile esme_profiles%rowtype;
begin
  select count(*) into v_missing
  from information_schema.columns
  where table_name = 'esme_registration_requests'
    and column_name in ('student_id','academic_year','department','phone','committee_membership',
                        'second_committee_preference_id');
  if v_missing < 6 then
    raise notice 'P22 SKIP: the queue is missing % of the 0011 columns — migration not applied', 6 - v_missing;
    return;
  end if;

  select id into v_hb from esme_committees
   where lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) = 'highboard' limit 1;
  if v_hb is null then
    raise notice 'P22 SKIP: this project has no High Board committee — 0011 section 4 and the reference seed are both absent';
    return;
  end if;

  -- Applicant one: answers yes, and names the committee with this app's own device-side id.
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_yes, 'authenticated', 'authenticated', 'probe-0011-yes@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1', now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Applicant', 'username', 'probe_0011_yes',
            'committee_id', 'comm_high_board', 'committee_membership', 'yes',
            'academic_year', 'Junior', 'department', 'Mechanical Design & Production',
            'student_id', '2026-0000', 'phone', '+20 10 0000 0000',
            'accepted_policies', 'true', 'second_committee_preference_id', ''));

  select * into v_request from esme_registration_requests where profile_id = v_yes;
  select * into v_profile from esme_profiles where id = v_yes;

  if v_request.id is null then
    raise notice 'P22 FAIL: the signup trigger produced no queue row for the probe account';
  elsif v_request.requested_committee_id is distinct from v_hb then
    raise notice 'P22 FAIL: committee_id "comm_high_board" resolved to % — expected the High Board row',
      coalesce(v_request.requested_committee_id::text, 'NULL');
  elsif v_request.committee_membership is distinct from 'yes'
     or v_request.academic_year is distinct from 'Junior'
     or v_request.department is distinct from 'Mechanical Design & Production' then
    raise notice 'P22 FAIL: the academic answers did not reach the queue (%, %, %)',
      coalesce(v_request.committee_membership, 'NULL'), coalesce(v_request.academic_year, 'NULL'),
      coalesce(v_request.department, 'NULL');
  elsif v_request.assigned_committee_id is not null then
    raise notice 'P22 FAIL: a new application arrived already assigned to %', v_request.assigned_committee_id;
  elsif v_profile.academic_year is distinct from 'Junior' or v_profile.department is distinct from 'Mechanical Design & Production' then
    raise notice 'P22 FAIL: the profile did not carry the answers the queue kept';
  else
    -- Applicant two: the browser still held a committee selection after they answered no.
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data)
    values (v_no, 'authenticated', 'authenticated', 'probe-0011-no@example.invalid',
            '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1', now(),
            jsonb_build_object('provider', 'email'),
            jsonb_build_object('full_name', 'Probe Refusal', 'username', 'probe_0011_no',
              'committee_id', 'comm_high_board', 'committee_membership', 'no',
              'academic_year', 'Freshman', 'department', 'Other',
              'accepted_policies', 'true'));

    select * into v_request from esme_registration_requests where profile_id = v_no;
    if v_request.committee_membership is distinct from 'no' then
      raise notice 'P22 FAIL: a "no" was stored as %', coalesce(v_request.committee_membership, 'NULL');
    elsif v_request.requested_committee_id is not null or v_request.second_committee_preference_id is not null then
      raise notice 'P22 FAIL: an applicant who said no still names a committee (%)',
        v_request.requested_committee_id;
    else
      raise notice 'P22 PASS: answers kept, a disowned committee cleared, nothing assigned';
    end if;
  end if;

  delete from auth.users where id in (v_yes, v_no);
exception when insufficient_privilege then
  raise notice 'P22 SKIP: this session may not write auth.users (%) — run it as the database owner', sqlerrm;
when others then
  raise notice 'P22 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P23  0011 — naming High Board on an application is not an application for office.
--      The chapter has TWO things called High Board: the `high_board` ROLE, added to
--      esme_role by 0006 and carrying real read authority, and the COMMITTEE this
--      migration seeds. Only the second one is selectable on the signup form, and this
--      probe is the behavioural proof that choosing it changes nothing about the account:
--      one committee row (a duplicate under another spelling would be a data defect an
--      approval could then assign to), no leadership seats written, and the applicant's
--      own identity response still reading role=member with capabilities='{}' while the
--      request sits pending. esme_assign_role() is never called by the signup path; if
--      this ever reports a capability, something has wired the committee to the matrix.
--      EXPECTED RESULT with 0011 applied: PASS, with the seat and duplicate counts at 0.
-- ---------------------------------------------------------------------------
begin;
do $p$
declare
  v_uid uuid := gen_random_uuid();
  v_hb uuid;
  v_duplicates integer;
  v_seats integer;
  v_role esme_role;
  v_caps text[];
begin
  select count(*) into v_duplicates from esme_committees
   where lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) in ('highboard', 'thehighboard');
  if v_duplicates = 0 then
    raise notice 'P23 SKIP: no High Board committee in this project — 0011 section 4 not applied';
    return;
  end if;
  if v_duplicates > 1 then
    raise notice 'P23 FAIL: % rows spell High Board — the guard did not stop a duplicate', v_duplicates;
    return;
  end if;

  select id into v_hb from esme_committees
   where lower(regexp_replace(name, '[^[:alnum:]]', '', 'g')) = 'highboard' limit 1;

  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_uid, 'authenticated', 'authenticated', 'probe-0011-hb@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1', now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Officer', 'username', 'probe_0011_hb',
            'committee_id', v_hb::text, 'committee_membership', 'yes',
            'academic_year', 'Senior II', 'department', 'Civil Engineering',
            'accepted_policies', 'true'));

  select count(*) into v_seats from esme_committees
   where id = v_hb and (director_id is not null or head_id is not null);

  -- Ask as the applicant: this is the response the client actually receives, so a capability
  -- leaked through the committee would be visible here rather than only in the matrix.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select role, capabilities into v_role, v_caps from esme_identity(v_uid);

  if v_seats > 0 then
    raise notice 'P23 FAIL: seeding High Board also filled a leadership seat on it';
  elsif v_role is null then
    raise notice 'P23 FAIL: esme_identity() returned no row for the account the trigger just created';
  elsif v_role <> 'member' or coalesce(array_length(v_caps, 1), 0) > 0 then
    raise notice 'P23 FAIL: a signup that named High Board holds role % and % capability(s)',
      v_role, coalesce(array_length(v_caps, 1), 0);
  else
    raise notice 'P23 PASS: one committee row, no seats, still a pending member with no capabilities';
  end if;

  execute 'reset role';
  delete from auth.users where id = v_uid;
exception when insufficient_privilege then
  raise notice 'P23 SKIP: this session may not write auth.users (%) — run it as the database owner', sqlerrm;
when others then
  raise notice 'P23 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- ---------------------------------------------------------------------------
-- P47..P52  0019_status_grants_access.sql — directory status versus entry.
--
-- Why the numbering jumps. P24-P46 are the blocks 0012 through 0017 promise in their
-- operator notes (P25-P29, P30-P34, P35-P38, P39-P42, P43-P46). Those migrations were
-- written without the probes being appended to this file, so the numbers are reserved by
-- them and are still to be authored — a gap in this repository, not in 0019. These five
-- keep their promised numbers so the migration file points at rows that exist.
--
-- Each block builds its own account inside the transaction and rolls back. Nothing here
-- touches the identities a real project holds.
-- ---------------------------------------------------------------------------

-- P47  A 'pending_approval' member is admitted, and admitted as a member.
--      0019 changes *when a grant is honoured*, so this is the whole requirement in one
--      probe: the entry rule true for the legacy status, the member's own grants live,
--      and every privileged grant still closed. If any of the last four lines reports a
--      capability, the matrix was widened rather than the gate moved — that is a
--      privilege escalation, not a policy change.
--      EXPECTED RESULT with 0019 applied: PASS, caps>0 and all four privileged reads false.
begin;
do $p$
declare
  v_uid uuid := gen_random_uuid();
  v_caps text[];
  v_entry boolean;
  v_tasks boolean;
  v_users boolean;
  v_decide boolean;
  v_audit boolean;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_uid, 'authenticated', 'authenticated', 'probe-0019-pending@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1', now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Pending', 'username', 'probe_0019_p'));

  -- The 0012 trigger has already made this account active, which is the normal case and not
  -- the one under test. active -> pending_approval is not a transition any status trigger
  -- allows — it must not be, or a reviewer could demote a member into a queue — so the legacy
  -- row is written directly as the database owner, the way a project migrated before 0012
  -- would already hold it.
  delete from esme_profiles where id = v_uid;
  insert into esme_profiles (id, email, username, display_name, role, status, email_verified)
  values (v_uid, 'probe-0019-pending@example.invalid', 'probe_0019_p', 'Probe Pending',
          'member', 'pending_approval', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select esme_status_grants_access(status), esme_has_capability('tasks.read'),
         esme_has_capability('users.read'), esme_has_capability('registrations.decide'),
         esme_has_capability('audit.read')
    into v_entry, v_tasks, v_users, v_decide, v_audit
  from esme_profiles where id = v_uid;

  select capabilities into v_caps from esme_identity(v_uid);

  if not v_entry then
    raise notice 'P47 FAIL: esme_status_grants_access(pending_approval) is false — 0019 not applied';
  elsif not v_tasks then
    raise notice 'P47 FAIL: an admitted member cannot reach tasks.read, so it enters an empty workspace';
  elsif v_users or v_decide or v_audit then
    raise notice 'P47 FAIL: the pending status carried a privileged grant (users %/decide %/audit %)',
      v_users, v_decide, v_audit;
  elsif coalesce(array_length(v_caps, 1), 0) = 0 then
    raise notice 'P47 FAIL: esme_identity() still answers an empty capability array for this status';
  else
    raise notice 'P47 PASS: admitted as a member with % capability(s) and no privileged grant',
      array_length(v_caps, 1);
  end if;

  execute 'reset role';
  delete from auth.users where id = v_uid;
exception when insufficient_privilege then
  raise notice 'P47 SKIP: this session may not write auth.users (%) — run it as the database owner', sqlerrm;
when others then
  raise notice 'P47 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- P48  Being admitted is not being entrusted. The same pending member attempts two officer
--      decisions. 0019 leaves esme_decide_registration (0007:159) and esme_assign_leader
--      (0004:264) demanding an active actor, so a never-reviewed account can read its own
--      tasks but cannot place anybody, change a status, or grant a role. Both refusals must
--      be ESME_UNAUTHORIZED from the actor check — a different SQL error means the call
--      travelled past the gate and failed on the data, which is the wrong reason.
--      EXPECTED RESULT: PASS, both reporting ESME_UNAUTHORIZED.
begin;
do $p$
declare
  v_uid uuid := gen_random_uuid();
  v_leader text;
  v_decide text;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_uid, 'authenticated', 'authenticated', 'probe-0019-officer@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1', now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Officer', 'username', 'probe_0019_o'));
  delete from esme_profiles where id = v_uid;
  -- A moderator at pending_approval: the matrix grants registrations.decide, so only the
  -- actor's own status check can be what refuses. This is the case the residual covers.
  insert into esme_profiles (id, email, username, display_name, role, status, email_verified)
  values (v_uid, 'probe-0019-officer@example.invalid', 'probe_0019_o', 'Probe Officer',
          'moderator', 'pending_approval', true);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  begin
    perform esme_decide_registration(gen_random_uuid(), 'approve', null, null);
    v_decide := 'ACCEPTED';
  exception when raise_exception then v_decide := sqlerrm;
  end;

  begin
    perform esme_assign_leader('comm_te', 'head', v_uid);
    v_leader := 'ACCEPTED';
  exception when raise_exception then v_leader := sqlerrm;
  end;

  execute 'reset role';
  delete from auth.users where id = v_uid;

  if v_decide = 'ACCEPTED' or v_leader = 'ACCEPTED' then
    raise notice 'P48 FAIL: an unreviewed account performed an officer action';
  elsif v_decide not like '%ESME_UNAUTHORIZED%' or v_leader not like '%ESME_UNAUTHORIZED%' then
    raise notice 'P48 FAIL: refused for the wrong reason — decide said %, leader said %', v_decide, v_leader;
  else
    raise notice 'P48 PASS: both officer paths still require an active actor';
  end if;
exception when insufficient_privilege then
  raise notice 'P48 SKIP: this session may not write auth.users (%) — run it as the database owner', sqlerrm;
when others then
  raise notice 'P48 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- P49  The two sanctions still mean what they say. A 'rejected' and a 'suspended' row must
--      answer false from the entry helper, return no capabilities from esme_identity(), and
--      be refused by a capability-scoped read. If either sanction opens, 0019 has replaced an
--      approval gate with no gate at all.
--      EXPECTED RESULT: PASS, both sanctions closed on all three checks.
begin;
do $p$
declare
  v_uid uuid := gen_random_uuid();
  v_rejected_entry boolean;
  v_suspended_entry boolean;
  v_rejected_caps text[];
  v_suspended_caps text[];
  v_rejected_read boolean;
  v_suspended_read boolean;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_uid, 'authenticated', 'authenticated', 'probe-0019-sanction@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1', now(),
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Sanction', 'username', 'probe_0019_s'));

  -- rejected
  delete from esme_profiles where id = v_uid;
  insert into esme_profiles (id, email, username, display_name, role, status, email_verified)
  values (v_uid, 'probe-0019-sanction@example.invalid', 'probe_0019_s', 'Probe Sanction',
          'member', 'rejected', true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select esme_status_grants_access(status), esme_has_capability('tasks.read')
    into v_rejected_entry, v_rejected_read
  from esme_profiles where id = v_uid;
  select capabilities into v_rejected_caps from esme_identity(v_uid);
  execute 'reset role';

  -- suspended
  delete from esme_profiles where id = v_uid;
  insert into esme_profiles (id, email, username, display_name, role, status, email_verified)
  values (v_uid, 'probe-0019-sanction@example.invalid', 'probe_0019_s2', 'Probe Sanction',
          'member', 'suspended', true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select esme_status_grants_access(status), esme_has_capability('tasks.read')
    into v_suspended_entry, v_suspended_read
  from esme_profiles where id = v_uid;
  select capabilities into v_suspended_caps from esme_identity(v_uid);
  execute 'reset role';

  delete from auth.users where id = v_uid;

  if v_rejected_entry or v_suspended_entry then
    raise notice 'P49 FAIL: the entry helper admitted a sanction (rejected %, suspended %)',
      v_rejected_entry, v_suspended_entry;
  elsif coalesce(array_length(v_rejected_caps, 1), 0) > 0 or coalesce(array_length(v_suspended_caps, 1), 0) > 0 then
    raise notice 'P49 FAIL: esme_identity() granted capabilities to a sanctioned account';
  elsif v_rejected_read or v_suspended_read then
    raise notice 'P49 FAIL: a sanction still reached a capability-scoped read';
  else
    raise notice 'P49 PASS: rejected and suspended are refused on the helper, the identity and RLS';
  end if;
exception when insufficient_privilege then
  raise notice 'P49 SKIP: this session may not write auth.users (%) — run it as the database owner', sqlerrm;
when others then
  raise notice 'P49 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- P50  esme_ensure_own_profile() has no argument to forge and no session to borrow.
--      Anonymous gets ESME_NO_SESSION rather than a row; a session whose profile already
--      exists is answered true and changes nothing at all — same updated_at, no second audit
--      line. That second half is what makes the client safe to call it on every retry.
--      EXPECTED RESULT: PASS with both halves green.
begin;
do $p$
declare
  v_before timestamptz;
  v_after timestamptz;
  v_audit integer;
  v_result boolean;
  v_anon text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"role":"anon"}'::text, true);
  begin
    perform esme_ensure_own_profile();
    v_anon := 'ACCEPTED';
  exception when raise_exception then v_anon := sqlerrm;
  end;
  execute 'reset role';

  if v_anon = 'ACCEPTED' or v_anon not like '%ESME_NO_SESSION%' then
    raise notice 'P50 FAIL: a call with no auth.uid() answered %', v_anon;
    return;
  end if;

  if not exists (select 1 from esme_profiles where id = :'member_id'::uuid) then
    raise notice 'P50 SKIP: :member_id has no profile row to recover';
    return;
  end if;

  select updated_at into v_before from esme_profiles where id = :'member_id'::uuid;
  select count(*) into v_audit from esme_audit_log where action = 'PROFILE_RECOVERED';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', :'member_id', 'role', 'authenticated')::text, true);
  v_result := esme_ensure_own_profile();
  execute 'reset role';

  select updated_at into v_after from esme_profiles where id = :'member_id'::uuid;

  if not v_result then
    raise notice 'P50 FAIL: an existing profile was reported as not recovered';
  elsif v_before is distinct from v_after then
    raise notice 'P50 FAIL: recovery overwrote a row that already existed (updated_at moved)';
  else
    select count(*) into v_audit from esme_audit_log where action = 'PROFILE_RECOVERED';
    raise notice 'P50 PASS: no session refused, existing profile untouched (% audit rows total)', v_audit;
  end if;
exception when others then
  raise notice 'P50 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- P51  The recovery writes the row signup should have written, and nothing more: role
--      'member' as a constant, status 'active', committee_id NULL, and the caller's own id —
--      never another account's. The username branch matters because esme_profiles_username_fmt
--      and the UNIQUE column are exactly what made the signup trigger abort in the first
--      place; a recovery that raises is the same defect wearing a different hat.
--      EXPECTED RESULT: PASS, with the handle reported as whatever the dedupe settled on.
begin;
do $p$
declare
  v_uid uuid := gen_random_uuid();
  v_row record;
begin
  insert into auth.users (id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_uid, 'authenticated', 'authenticated', 'probe-0019-recovery@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1',
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Recovered', 'username', 'Bad Name'));

  -- A handle with a space and an empty display name: both would have aborted 0011's trigger.
  delete from esme_profiles where id = v_uid;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform esme_ensure_own_profile();
  -- Called twice: the client retries when a read fails, so the second call must be a no-op.
  perform esme_ensure_own_profile();
  execute 'reset role';

  select * into v_row from esme_profiles where id = v_uid;

  if v_row.id is null then
    raise notice 'P51 FAIL: recovery created no profile for a session with no profile';
  elsif v_row.role <> 'member' then
    raise notice 'P51 FAIL: recovery wrote role % — the caller cannot name a role', v_row.role;
  elsif v_row.status <> 'active' then
    raise notice 'P51 FAIL: recovery wrote status %', v_row.status;
  elsif v_row.committee_id is not null then
    raise notice 'P51 FAIL: recovery recorded a committee nobody decided';
  elsif v_row.username !~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}$' then
    raise notice 'P51 FAIL: recovered handle % breaks esme_profiles_username_fmt', v_row.username;
  elsif (select count(*) from esme_profiles where id = v_uid) <> 1 then
    raise notice 'P51 FAIL: the second call created a second row';
  elsif (select count(*) from esme_audit_log where action = 'PROFILE_RECOVERED' and target_id = v_uid::text) <> 1 then
    raise notice 'P51 FAIL: a retried recovery filed more than one audit line';
  else
    raise notice 'P51 PASS: member/active/no committee, handle %, one row, one audit line', v_row.username;
  end if;

  delete from auth.users where id = v_uid;
exception when insufficient_privilege then
  raise notice 'P51 SKIP: this session may not write auth.users (%) — run it as the database owner', sqlerrm;
when others then
  raise notice 'P51 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- P52  Recovery is not a second door into the table. A direct REST insert into esme_profiles
--      must still be refused — the table has no INSERT policy, which is what 0009 and 0012 both
--      rely on — and one account calling the definer function must create only its own row.
--      EXPECTED RESULT: PASS, direct insert refused and no foreign row created.
begin;
do $p$
declare
  v_uid uuid := gen_random_uuid();
  v_direct text;
  v_foreign integer;
begin
  insert into auth.users (id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data)
  values (v_uid, 'authenticated', 'authenticated', 'probe-0019-channel@example.invalid',
          '$2a$10$probeRowNotARealHashNotARealHashNotARealHashNotA1',
          jsonb_build_object('provider', 'email'),
          jsonb_build_object('full_name', 'Probe Channel', 'username', 'probe_0019_c'));
  delete from esme_profiles where id = v_uid;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  begin
    insert into esme_profiles (id, email, username, display_name, role, status)
    values (:'alien_id'::uuid, 'probe-0019-forger@example.invalid', 'probe_0019_forger',
            'Probe Forger', 'super_admin', 'active');
    v_direct := 'ACCEPTED';
  exception when others then
    -- RLS answers 42501 (no INSERT policy), the 0009 channel guard answers a raised exception;
    -- either refusal is a pass, only an accepted write is not.
    v_direct := 'REFUSED: ' || sqlerrm;
  end;

  perform esme_ensure_own_profile();
  execute 'reset role';

  select count(*) into v_foreign from esme_profiles
   where id = :'alien_id'::uuid or username = 'probe_0019_forger';

  delete from auth.users where id = v_uid;

  if v_direct = 'ACCEPTED' then
    raise notice 'P52 FAIL: a direct insert into esme_profiles was accepted from authenticated';
  elsif v_foreign > 0 then
    raise notice 'P52 FAIL: an account created or left a row that is not its own';
  else
    raise notice 'P52 PASS: direct write refused (%), recovery wrote only its own row', v_direct;
  end if;
exception when others then
  raise notice 'P52 FAIL: unexpected code %: %', sqlstate, sqlerrm;
end
$p$;
rollback;

-- What this file cannot prove.
--   These probes exercise the database layer only. The PostgREST surface is a different one: a
--   function revoked from anon answers 401/404, a missing function answers PGRST202, and a raised
--   ESME_* arrives as an error body the adapter maps (src/auth/supabaseAdapter.ts,
--   rewardFailureOf). Those belong to the browser smoke test in PROJECT_MASTER_GUIDE.md §13 step 9.
--   Record both, and never let one stand in for the other.
select 'probes finished — copy each PASS/FAIL/SKIP line into the evidence table' as status;
