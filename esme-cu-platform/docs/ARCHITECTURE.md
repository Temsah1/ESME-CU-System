# Architecture

One Vite + React application serves two surfaces: the public chapter website and the
signed-in ERP at `/dashboard`. There is no separate API service in this repository — the
browser talks to an `AuthAdapter` and, for everything else, to the store described below.

## Layers

| Layer | Location | Rule it follows |
| --- | --- | --- |
| Presentation | `src/components/**` | Renders state from the store. Never decides authority on its own. |
| Motion | `src/motion/**` | One animation library (`motion/react`), tokens and variants in one place, `reducedMotion="user"`. |
| Application | `src/context/AppContext.tsx` | The only writer of operational state; every mutation passes a capability guard first. |
| Domain | `src/domain/**` | Pure TypeScript. No React, no storage, no network. All rules live here so they can be tested and mirrored in SQL. |
| Identity | `src/auth/**` | `AuthAdapter` interface with two implementations; sessions and accounts come from it, never from local guesses. |
| Persistence | `src/storage/**`, `supabase/migrations/**` | Versioned browser storage today; Postgres + RLS is the target, and the SQL mirrors the domain rules. |

Dependencies point downward: components → context → domain, and auth → domain. The domain
layer imports nothing from React or from storage, which is why its tests need no DOM.

## Request flow for a committee write

1. A control in `CommitteeManagement.tsx` calls a context function (`addCommittee`,
   `updateCommittee`, `assignLeader`, `archiveCommittee`).
2. The context derives the actor from the **signed-in identity**
   (`committeeActor()`), never from a form field, then calls `guard(capability, target)`.
   A missing capability throws `CapabilityError`.
3. The draft is normalised and validated by `src/domain/committees.ts`
   (`normalizeDraft` → `validateCommitteeDraft`), which returns **field-keyed** issues so the
   form can point at the offending input.
4. Leadership writes pass `validateLeadershipAssignment`, and every write passes
   `isStaleWrite`, which compares the `updatedAt` stamp the form loaded with the stored row.
5. On success the row is replaced in state, a `useEffect` writes it to
   `ESME_CU_STATE_V2_committees`, and `logAction` appends an audit line.

The same five steps are mirrored in
[`supabase/migrations/0004_committee_leadership.sql`](../supabase/migrations/0004_committee_leadership.sql):
a normalisation trigger, a seat-channel trigger, and two SECURITY DEFINER functions.
See [DATABASE_AND_MIGRATIONS.md](DATABASE_AND_MIGRATIONS.md).

## Request flow for a reward write

The second flow is different in kind, because as of 2026-10-22 a reward entry is decided by the
provider rather than by this browser. It is the pattern every later server-owned collection follows.

1. The form in `RewardsAndDiscipline.tsx` calls `awardBonus({ …, idempotencyKey })` and **awaits** it.
2. The store runs `validateRewardAction()` first, in the order the SQL uses (capability → matrix role
   list → reach → self → primary admin → rank → reason/evidence → caps → escalation), so an officer
   gets the rule in the wording the form already shows. A refusal here never reaches the provider.
3. `rewardWriter()` resolves the adapter. No adapter means no session and therefore no actor, so this
   throws `provider_unavailable` rather than keeping a record locally that nobody signed.
4. The adapter calls the RPC — `esme_award_bonus()`, `esme_issue_warning()`,
   `esme_reverse_reward_entry()` or `esme_acknowledge_warning()` — and nothing else.
   `esme_reward_entries` revokes insert/update/delete from `authenticated` and
   `esme_assert_reward_channel()` refuses a direct write, so the RPC is the only channel.
5. `if (!result.ok) throw new RewardRefusedError(...)`. A `PGRST202` becomes `schema_missing` naming
   `0006_rewards_discipline.sql`, which is the honest answer for a project whose schema is empty.
6. **Only then** does the store mirror: the entry keeps the provider's id, instant, roles, points,
   status and idempotency key; the two display names come from this workspace's directory; then the
   `ledg_<entry id>` score row, the new total, the audit line, the notification and the queued mail.

The consequence is the point: a server refusal leaves nothing behind in any of the seven places a
naive client would have written. `src/context/rewardProvider.test.tsx` asserts exactly that — with a
**stubbed** provider, which proves the client obeys it and does not prove Postgres agrees.

## Identity vs. seat

A person has exactly one **account role** (`super_admin | director | head | moderator |
member`, `src/types/index.ts`) and, independently, zero or one **committee leadership
seat**. Seats are stored as references only:

```
esme_committees.director_id → esme_profiles.id
esme_committees.head_id     → esme_profiles.id
```

No table copies a leader's name. `leaderAccount()` resolves the id against the directory at
render time, so renaming an account updates every screen at once and a departing leader
cannot leave a name behind. When a seat references an id that the directory does not hold,
`unresolvedLeaders()` surfaces it as a broken reference rather than silently clearing it.

## Data sources today vs. in production

`AppContext` reads and writes browser storage for almost every collection
([src/context/AppContext.tsx:505-524](../src/context/AppContext.tsx)).
The collections that start empty (members' activity, tasks, submissions, scores,
applications, notifications, audit) are device-local until a backend is connected: they are
**not** shared between browsers and are **not** a server-side record. This is stated plainly
rather than glossed over — see
[DATABASE_AND_MIGRATIONS.md](DATABASE_AND_MIGRATIONS.md) for the migration path and its A–E
ownership table.

Two exceptions, both going the same way: authentication (identity, role, status and capability
checks go through the adapter, and a production build with no provider configured refuses to sign in
at all — [src/auth/index.ts](../src/auth/index.ts)), and the **reward ledger's writes**, which since
2026-10-22 are decided by the four RPCs through `AuthAdapter` before the local mirror is touched.
Its reads and the policy row are still device-local, which is the honest mixed state described in
the flow above rather than a finished integration.

## Dashboard surfaces

`DashboardRoutes.tsx` keeps one table, `VIEW_REQUIREMENTS`, mapping every view id to the
capability that opens it, so the navigation and the renderer can never disagree.
`RequireCapability` guards the render; hiding the nav entry is a convenience, not the control.

## Known gaps

- No live backend is configured in this repository; see the honest limitations in
  [DATABASE_AND_MIGRATIONS.md](DATABASE_AND_MIGRATIONS.md).
- The `it` role requested for the IT Operations Center does not exist yet — today IT
  operations sit under `moderator`. See [AUTHORIZATION.md](AUTHORIZATION.md).
- Media is referenced by URL/asset path only; there is no upload pipeline yet.
