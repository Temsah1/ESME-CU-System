# Committee management

Where committees are created, edited, staffed and archived. The surface is
[`src/components/dashboard/CommitteeManagement.tsx`](../src/components/dashboard/CommitteeManagement.tsx);
every rule it enforces is defined once in
[`src/domain/committees.ts`](../src/domain/committees.ts) and mirrored in SQL by
[`0004_committee_leadership.sql`](../supabase/migrations/0004_committee_leadership.sql).

## What "fully editable" means here

Create and Edit cover every stored field of a committee row:

| Field | Rule |
| --- | --- |
| Committee name | 1–80 characters after trimming. Case-insensitively unique across committees. |
| Acronym (`shortCode`) | 2–8 characters: letters, digits and `& . + /` space. Uppercased on save. Unique. |
| Description and scope | 1–600 characters. |
| Category | `technical`, `media`, `marketing`, `operations`, `management`. |
| Status | `active` or `archived` (archiving is a separate, capability-guarded action). |
| Objectives | Up to 12 lines, 60 characters each. |
| Sub-teams | Up to 12 lines, 60 characters each. |
| Public listing (`isPublic`) | A checkbox; controls whether the committee appears on the public site. |

`id`, `memberCount`, `directorId` and `headId` are **not** part of the form. A committee edit
cannot move a seat, change an id, or invent a member count; seats move only through the
leadership panel, and the count is derived from the roster.

Validation returns field-keyed issues, so the form marks the input that failed instead of
showing one generic message. A rejected save writes nothing: the stored row is byte-identical
before and after, which is asserted in
[`CommitteeManagement.test.tsx`](../src/components/dashboard/CommitteeManagement.test.tsx).

## Leadership: Director and Head

Each committee has exactly two seats, opened from **Leadership & history** on the card.

- **The seat is a reference, not a name.** `directorId` / `headId` point at account ids; the
  displayed name is resolved from the directory at render time (`leaderAccount()`). Renaming an
  account updates the committee card, the leadership panel and the roster at once.
- **Assignment never changes a role.** Seating someone as Head does not touch
  `esme_profiles.role`. The panel states this under each holder: *"Holds this seat by committee
  record only. Their <role> access is unchanged."*
- **A seat grants no privilege.** No capability is derived from holding a seat; authority comes
  only from the account role in the capability matrix.

### The account selector

`AccountSearch.tsx` is a searchable list fed by `adapter.listAccounts()` — the accounts the
signed-in actor is permitted to see (RLS in production, the session's capabilities in
development). It is not a free-text name field, and typing a name cannot create an account.

Each candidate is judged by `validateLeadershipAssignment()` before the button is enabled:

| Verdict | Reason shown |
| --- | --- |
| Blocked | the account id is not in the directory; the account is not `active`; the person already holds the other seat of this committee; the person already leads another committee; the actor has no `committees.write` reach to this committee. |
| Allowed, with a warning | the person is eligible but their home committee is a different one — "Appointing them does not move their membership; transfer it from the members directory if the seat should also move them." |
| Allowed | "Eligible — appointing changes this seat only, never the account's role." |

The "one person, two seats" and "one leader, two committees" rules are the chapter's existing
organizational rules, so they are enforced; no additional single-committee restriction is
imposed on ordinary members.

### Replacing and clearing

- **Replace** reopens the selector and overwrites the seat in one write.
- **Clear seat** sets the id to undefined; the card then reads `Unassigned` and the panel reads
  *"Vacant — nobody is accountable for this seat."* Nothing is deleted from the directory.
- Every assign and clear appends an audit line:
  `Committee Leadership Assigned|Cleared — <Position> of <Committee>: <previous> → <new>`.

### Broken references

If a seat points at an id the directory does not return, the UI does **not** quietly drop it.
`unresolvedLeaders()` renders "Seat holds an unresolvable account id" plus a card-level warning
telling the operator to open leadership and correct it. Migration `0004` behaves the same way:
it validates existing rows and reports, never rewrites silently.

## Roster

`RosterPanel.tsx` lists members whose home committee is this one, split into active and
not-yet-active. Moving a member between committees is `validateRosterMove()` — the same rules
the server-side `esme_set_account_committee()` applies — and is guarded by `users.update`
with a committee scope, not by `committees.write`.

## Deletion of a person

`removeUser()` releases the seats that person holds (`releasedSeats()` →
`releaseLeadership()`) before removing the profile, and logs it. The committee keeps its
history and its member count; only the two id references are cleared. A name is never edited
to "clean up" a departure, because there is no cached name to clean.

## Archive

Archiving sets `status: 'archived'` and needs `committees.archive` (Super Admin only). The row,
its objectives, sub-teams and both seats are retained — an archived committee is history, and
history names its office-holders.

## Concurrency

Every edit form loads the row's `updatedAt` stamp and sends it back. `isStaleWrite()` compares
it against the stored row; a mismatch is refused with a message naming the committee, and the
operator re-reads before saving. This prevents a cached draft from overwriting someone else's
change.

## Where this data lives today

Committee rows persist to `ESME_CU_STATE_V2_committees` in browser storage — the write path is
real, reload-safe and covered by tests, but it is **device-local** until
`0004_committee_leadership.sql` is applied to a project and the context is pointed at it.
See [DATABASE_AND_MIGRATIONS.md](DATABASE_AND_MIGRATIONS.md).
