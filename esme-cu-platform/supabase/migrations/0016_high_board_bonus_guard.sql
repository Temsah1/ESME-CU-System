-- ESME CU ERP — no bonus points are awarded to a High Board seat
-- Apply after 0015_high_board_content.sql.
--
-- What this changes
--   One guard trigger on esme_reward_entries. A bonus whose frozen target role is high_board is
--   refused with ESME_HIGH_BOARD_TARGET. Warnings are unaffected: the rule is about recognition
--   money, not about accountability, and discipline still travels downwards by rank (0006:377).
--
--   esme_award_bonus() already refuses anyone at or above the actor's rank, so only a Super Admin
--   (rank 100) could reach a High Board member (rank 80). That is exactly the gap this closes:
--   the rule is absolute, including between peers, so a board seat cannot become a favour.
--
--   The frontend's validateRewardAction() applies the same rule before the RPC is called, and
--   mayOfferReward() hides the inline button. Both are convenience: this trigger is the decision
--   and covers a hand-made REST call or a future writer that forgets the rule.
--
-- What this deliberately does NOT change
--   * esme_award_bonus(), esme_issue_warning() and their policies are untouched. No capability
--     row changes, no existing reward entry is edited or removed.
--   * A legacy bonus already filed against a High Board member stays readable; the guard fires on
--     insert, not on select, and a reversal is still an append that names the original.
--   * A High Board member may still receive a warning from a Super Admin, and may still award
--     bonuses downwards to members, directors and heads as 0006 allows.

begin;

create or replace function esme_guard_high_board_bonus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'bonus' and new.target_role_at_time = 'high_board' then
    raise exception 'ESME_HIGH_BOARD_TARGET: bonus points are not awarded to a High Board seat'
      using hint = 'Recognise the contribution through the board record; the rule applies to every role, including Super Admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists esme_reward_entries_high_board_guard on esme_reward_entries;

create trigger esme_reward_entries_high_board_guard
  before insert on esme_reward_entries
  for each row execute function esme_guard_high_board_bonus();

commit;

-- ============================== operator notes ====
--
-- Probes for staging (add to supabase/probes/authorization_probes.sql if they are wanted):
--   P43  as super_admin, esme_award_bonus(<high_board profile>, 10, ...) -> refused ESME_HIGH_BOARD_TARGET.
--   P44  as super_admin, esme_award_bonus(<member profile>, 10, ...) -> succeeds.
--   P45  as super_admin, esme_issue_warning(<high_board profile>, 'notice', ...) -> succeeds.
--   P46  a direct insert into esme_reward_entries with kind='bonus', target_role_at_time='high_board'
--        -> refused before the immutability trigger even runs.
