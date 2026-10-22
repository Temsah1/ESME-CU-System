# Testing

```bash
npm test           # vitest run — 48 files, 728 tests
npm run test:watch
```

Last full run on this branch:

| Command | Result |
| --- | --- |
| `npx tsc -b --force` | exit 0, no errors |
| `npx oxlint .` | **13 warnings, 0 errors** — 147 files, 116 rules, exit 0 (pre-existing React-hooks/style notices; none in `WebsiteCMS.tsx`, `MediaLibrary.tsx`, `RegistrationPortal.tsx`, `ModeratorTools.tsx` or `cms/*`) |
| `npx vitest run` | **48 files passed, 728 tests passed** (36.52s on the finished 0011 tree after the v6-stamp repair, exit 0; the same tree ran 50.63s at 727 before the repair and 35.65s at 728 after it, and the 0010 tree ran 30.05s at 667 — the spread is machine load, not the suite) |
| `npx vitest run scripts/` | 36 / 36 (the two operator CLIs, with `spawn` and `fetch` stubbed) |
| `npm run build` | succeeded (837ms on the finished tree, 884ms on the repair pass before these documentation edits; exit 0); only the pre-existing chunk-size notices (exceljs 929.48 kB, DashboardRoutes 864.44 kB, index 645.83 kB). CI's credential scan, run locally against this `dist/`: **0 matches** |
| CI's bundle scan, run locally | `grep -rEo 'sb_secret_[A-Za-z0-9_-]{8,}\|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}' dist/` → **no match** (exit 1). The publishable key *is* inlined into `dist/assets/index-*.js` when `.env.local` carries it, which is expected for a `VITE_` variable and is not what this scan looks for |

`CommitteeManagement.test.tsx > creates a committee with vacant seats…` twice reported
`Test timed out in 5000ms` in a full run while passing in isolation (3.2–3.5s for that case,
~10s for the file). It now carries an explicit 20s suite budget, and `ModeratorTools.test.tsx`
carries 25s per suite with `asyncUtilTimeout` raised to 12s. That was still not enough: on this
audit's final run `RewardsAndDiscipline`, `TaskCommandCenter` and `WebsiteCMS` each lost one case at
the 5s default while passing in isolation, so the run-wide budget is now stated once, as
`testTimeout: 15_000` in `vite.config.ts` — see the timing note at the bottom of this file. With
those stated, the latest full run is green rather than "green apart from a flake", and the same tree
has now been run green twice.

## What each file covers

| File | Tests | Subject |
| --- | --- | --- |
| `src/domain/committees.test.ts` | 26 | Seat eligibility, draft validation, roster moves, stale writes, row normalisation, leadership history |
| `src/domain/directory.test.ts` | 6 | Provider-vs-workspace merge rules; identity always wins, local-only rows kept and reported |
| `src/domain/registration.test.ts` | 20 | **What the chapter asks for, as rules rather than as a form**: the applicant who answers every academic question is accepted and a required one left blank is not; an academic answer outside the options offered is refused; someone who is not on a committee is accepted and asked no committee at all, while a member must name the committee they belong to and a committee nobody publishes is refused; the same committee named twice (first and second preference) is refused; **High Board is accepted as a committee and still makes the applicant a plain pending member** with no office and no capability; the membership question has exactly two answers and an answer outside them is refused on the trusted side too, even with no schema handed to the validator; a `no` that still carries a committee drops it; the choices offered are the published list in the published order, one row per id, with archived and unpublished committees excluded and a committee already present under another spelling recognised; and an account this build never asked still registers with no schema supplied, keeps the identity rules it already had, and only stops validating a row the schema explicitly switched off |
| `src/domain/domain.test.ts` | 31 | Capability matrix, scopes, privilege-escalation guards, account-state machine (four states, `isDecidable` only on `pending_approval`, stored rows repaired off the retired verification stage), registration rules including the short signup with no committee and no questionnaire answers, the submission burst throttle, and the two 0010 rules mirrored in the domain: every role label except `member` counts as privileged, and no account may be its own privilege gate |
| `src/domain/decisions.test.ts` | 17 | Registration decisions and their guards |
| `src/domain/workflow.test.ts` | 20 | Submission/delivery state machine, revision rounds, rubric |
| `src/domain/actions.test.ts` | 16 | Action-centre queue derivation |
| `src/domain/metrics.test.ts` | 26 | Score ledger, appeals, KPI derivations |
| `src/domain/reports.test.ts` | 37 | Report builder dataset |
| `src/domain/development.test.ts` | 24 | Skill matrix / development records |
| `src/domain/seasons.test.ts` | 28 | Seasons, objectives, key results |
| `src/domain/audit.test.ts` | 7 | Audit entry shape and append-only expectations |
| `src/domain/email.test.ts` | 11 | Address normalisation, idempotency keys, mute rules with the security carve-out, bilingual rendering, `safeUrl`, login-alert window |
| `src/domain/emailTemplates.server.test.ts` | 7 | **Template drift**: the copy bundled for the Edge Function must render all 13 events in both languages byte-for-byte like the client copy, and the migration's enum list, the sender's required-fields table and the event union must agree |
| `src/email/queue.test.ts` | 12 | Device queue: one request per key, invalid addresses, muted vs security events, per-recipient locale, receipts written from what the sender answered, no resend of a delivered message, attempt cap |
| `src/context/emailTriggers.test.tsx` | 7 | Each record change in the app produces the email request the event calls for — including that one approval decision queues exactly one `account_approved` message, a replayed write is refused as a duplicate, and a second decision on a decided application throws |
| `src/domain/rewards.test.ts` | 29 | Bonus/warning rule order: capability, matrix role lists, reach, self, primary admin, rank, head sub-team, director committee, reason, evidence URL, caps, escalation window, reversals |
| `src/context/rewards.test.tsx` | 13 | The store as the server stand-in: `awardBonus` writes entry + ledger row together, a refused call writes nothing, batched writes do not lose an entry, withdrawal is excluded from escalation |
| `src/auth/rewardProvider.test.ts` | 7 | **The Supabase reward calls, against a stubbed provider — not a PostgreSQL session.** `createClient` is mocked, so what is proved is the wire shape and nothing else: `esme_award_bonus` receives exactly `p_target/p_points/p_reason/p_evidence_url/p_idempotency_key`, the returned row is mapped column-for-column into a receipt (including `actor_role` and the deferred `reversed_by_entry_id`), a raised `ESME_OVER_ACTION_CAP` becomes a refusal carrying the lower-cased code, `PGRST202` becomes `schema_missing` **naming 0006_rewards_discipline.sql** rather than reading as a rejected password, a null row is a failure and not an empty success, reversal sends only `p_entry`/`p_reason` so a caller cannot steer what gets corrected, acknowledgement sends `p_entry`, and a `sb_secret_` value in the public slot rejects before any request is made (`rpc` asserted never called) |
| `src/context/rewardProvider.test.tsx` | 6 | **What the store does with a provider's answer** (the adapter resolved through `resolveAdapter()` is the real development adapter with the reward calls spied): a refusal leaves no entry, no ledger row, no stored cache, no point movement, no audit line, no notification and no queued mail, and the caller's `await` rejects; a warning the provider will not stamp stays unacknowledged in state **and** in storage; the row the provider filed is the row the app keeps — its id, its ISO instant, its roles — while the two display names come from the directory and the session; a replayed submit is collapsed onto the entry the idempotency key already names and the provider is asked once; an original is flipped to `reversed` only after the reversing row is filed, and a refusal there leaves the bonus active, the totals intact and no penalty row; and a Member is refused by the store before the provider is reached, then refused again by the adapter when called directly, which is why the client check is a courtesy and not the control |
| `src/components/dashboard/DashboardShell.test.tsx` | 8 | **The workspace frame as a surface**: which screens the rail and palette offer for the actor's capabilities (a member sees none of the privileged screens), the breadcrumb prints the nav label and not the internal view id, Ctrl+K filters and jumps, a narrow viewport trades the rail for a drawer that still reaches every screen, a notification marks itself read in storage and opens the record it names |
| `src/components/dashboard/DashboardHome.test.tsx` | 5 | **The role-aware home**: the chapter home for a privileged actor, a committee home for a Head, a member home that lists only rows naming that account, a season progress card that reports "no milestone written yet" instead of a fabricated percentage, and a member's bonus read back from a stored ledger entry |
| `src/components/dashboard/DataTable.test.tsx` | 13 | **The table primitive**: the footer names the slice actually shown, paging walks to the last page and stops, search covers the fields the caller declares, a filtered-empty list says "nothing matches" instead of "no rows", one column sort cycles ascending → descending → off, a list that shrinks below the current page falls back to a page that exists, an action fires immediately, a destructive one waits for the dialog, per-row `hidden`/`disabled` rules are honoured, and below the breakpoint every row is a card that keeps its column labels |
| `src/components/dashboard/MemberManagement.test.tsx` | 12 | **The directory through that primitive**: one row per account the session can reach, the signed-in administrator's own row offers no removal, refusing the confirmation leaves the profile in storage, accepting it drops it there, search narrows the real rows, a member session gets no provisioning control and no row actions, and a narrow screen renders the same accounts as cards |
| `src/components/dashboard/TaskCommandCenter.test.tsx` | 6 | **The delivery list through that primitive**: one row per stored task, reviewer decisions appear only on the row whose state is waiting for one, a recorded decision reaches `revision_requested` in storage, a self-service cancellation is confirmed before it leaves the pipeline and does not disturb the other row, sorting orders by the point values actually stored, and the same tasks become cards on a narrow screen |
| `src/components/dashboard/RegistrationManager.test.tsx` | 12 | **Recruitment as three audiences**: a decision-maker lists the applicants the provider actually holds, a rejection is refused while the reason is empty and reaches storage with that reason once typed, an approval files the committee the reviewer picked in the same write, a decided applicant leaves the reopen control inert, a reader without decision power gets the queue but no Accept/Reject/Waitlist at all, a committee-scoped reader never sees another committee's applicant, the schema builder is read-only without the CMS settings capability, and an account with no read capability gets a refusal even though this browser cached a queue. `window.prompt` is spied on and asserted never called. The three cases the academic answers brought: the review card keeps what an applicant **asked for** apart from the seat a reviewer assigns, an applicant who answered the membership question `no` is shown as a non-member with no committee named, and the queue still narrows to one committee for a committee-scoped reader |
| `src/components/dashboard/SettingsAndBackups.test.tsx` | 3 | **The cache reset**: the confirmation lives in the page (`window.confirm` spied and never called), refusing it leaves the cached custom committee in storage, accepting it replaces the cache with the reference set, and a member session both sees no reset control and gets a `backups.manage` refusal from the store when the write is called directly |
| `src/components/dashboard/RewardsAndDiscipline.test.tsx` | 8 | **The screen as a rendered surface**: empty state, a bonus recorded and read back from storage, the eligibility verdict per account, a cap refused before anything is written, the escalation warning shown before the third warning, a reversal that takes the points back, the permission matrix refusing a ceiling it cannot honour |
| `src/domain/testAccounts.test.ts` | 15 | **The seeded fixtures as rules, before any adapter runs**: one account per role a reviewer needs, each shipping a password the registration policy itself accepts and a role the capability matrix knows; identity matching is exact (an account that merely shares `@esme.test` is never a tester); the gate allows the development vault, refuses a production build until `VITE_ALLOW_TEST_ACCOUNTS` is switched on, and refuses the real provider from a browser whichever way the toggle is set; a plan against a populated vault says *repaired* rather than adding a second row, and refuses to take over an email or username a real account already holds — including the case where one account holds both fixture values; seating prefers the reference committee id, falls back to the short code ignoring case, and reports **no seat** instead of inventing a committee the workspace does not have |
| `supabase/migrations/migrationIntegrity.test.ts` | 18 | **Static check of the SQL that cannot be executed here**: every `new./old.` column in a trigger belongs to the table that fires it, every `esme_*` relation and function referenced exists, the delivery-status enum declares all five states, and 0008's inlined `VALUES` table lists exactly the identities `src/domain/testAccounts.ts` defines (the SQL repeats them because a set-returning `esme_` function reads as a missing relation). Four more hold the authorization shape: no policy expression may name `old` or `new` — a trigger-only record reference, and Postgres refuses to parse the file rather than skip the policy — so the publication rule's cross-row check must live in a guard that sees both row versions; `esme_pages_update` must therefore speak only of `cms.content.write`, while `esme_assert_publication_write()` compares `published`, `published_at` and `published_by` and fires `before insert or update`; an `alter type … add value` must sit outside the transaction block that first consumes the label; and every role in `ALL_ROLES` must appear in the `esme_role` enum, in `create type` or in a later `add value`. Two more pin 0009: `esme_assert_privilege_channel()` must be bound to `esme_profiles`, begin with the `esme_called_directly()` exemption, compare both `role` and `status` against their previous values and still leave `esme_assign_role()` able to set a role and `esme_profiles_update` able to accept an ordinary self-edit; and exactly the three aggregate views must be `security_invoker`, granted to `authenticated` (the base-table reads that option requires) and revoked from `anon`. One more pins 0010: `esme_assign_role()` must refuse `p_user_id = v_actor.id` with `ESME_SELF_ROLE_CHANGE` *before* the update, define the privileged test as `p_role <> 'member'` rather than any `p_role in (…)` list, keep `esme_is_primary_admin()` and `set role = p_role` intact, and write an audit detail carrying both role values — the same shape `esme_set_account_status()` must keep for the status. Five more pin 0011: the approval queue must declare every column the form now answers (`student_id`, `academic_year`, `department`, `phone`, `committee_membership`, `second_committee_preference_id`) and constrain the membership answer to `yes`/`no` or NULL; the restated signup trigger must resolve a committee reference through `esme_committee_reference()` and contain **no** `::uuid` cast at all — the helper casts only when the value is already uuid-shaped and is forbidden from raising, because a raise inside that trigger aborts the signup; the trigger must keep an application an application, hardcoding `member` and `pending_approval`, never reading `meta ->> 'role'`, never writing `assigned_committee_id`, nulling both committee columns when the answer is `no`, and leaving `esme_decide_registration()` alone; the year and department options in the migration **and** in `dev_seed_reference.sql` must equal the arrays `src/data/referenceContent.ts` ships, with High Board inserted behind a `where not exists` spelling guard; and nothing in the file may `drop` or `delete`, with every new text column nullable. It caught `esme_submissions.task_title`, an invented `esme_leadership_seats.director_profile_id`, a `from esme_role_rank()` phrase in a 0006 comment that read as a missing relation, and the `OLD.published` reference that made 0002 unapplyable. Each invariant was proved non-vacuous by running the same parser over the committed pre-fix SQL, which flags `esme_pages_update`. It proves nothing about behaviour — only that the files are not internally inconsistent |
| `src/auth/auth.test.ts` | 46 | Bootstrap, registration, status gating, capability enforcement inside the adapter, duplicate handling, lockout, provider resolution, email preferences through the adapter, the same request refused twice, a vault row repaired off the retired verification stage, a burst of submissions refused before anything is written, two provider-configuration cases (a configured-looking provider that cannot work from a browser is refused with a message that never quotes the value — a `/rest/v1/` path suffix, a non-URL, a `sb_secret_` key, a legacy service-role JWT — and the misconfiguration surfaces as `AuthMisconfiguredError` rather than reading as a rejected password, with the rejected client promise not memoized), and the ten seeded-test-account cases: one account per role seated and signed in with its own fixture password, a seed that lands `active` rather than in the approval queue, a fixture this device edited away reported as repaired, a refusal to take over a real account's identity, deletion that names only the three testers, the live session dropped when it holds one of them, the production gate, seating without inventing a committee, `users.create` required whichever session asks, and no seeding of the real provider from a browser. Four came with the academic answers, run through both adapters: they are stored with the request and still there after the decision, a `yes` that names no committee is refused with no form to catch it first, a second preference naming the same committee twice is refused, and the request an earlier build sent — carrying no academic answers at all — still registers |
| `src/storage/migrations.test.ts` | 35 | v1 → v2 → v3 → v4 → v5 → v6 cache migration, preserved keys, dropped keys, the website document rewrite that keeps the operator's copy while carrying in the header links, footer copy, sections and slots the old shape had no field for, and the questionnaire rewrite that switches off the fields the short signup stopped asking, stops requiring the committee question it still shows, and leaves a row this device set some other way untouched — plus the case that pins `REFERENCE_FORM_FIELDS` against the table the rewrite applies, the two cases that pin the V1 sweep to a device that never had it (a stray `ESME_CU_STATE_V1_*` key on a v4 device must neither overwrite the current cache nor be reported as deleted), and the v6 upgrade of a cache that predates the academic signup: the two academic questions go back and the membership question lands where the portal shows it, an academic setting this device already made is kept rather than overwritten, a second load offers the questions again without adding them twice, the shipped reference schema is pinned against the table the migration applies, High Board is offered to a device whose committee list nobody edited, a list that already carries High Board under another id gets no duplicate, a committee list the chapter curated is left to its curator, and a browser holding neither cache is left alone. The last case is the one a real browser walk-through found: a device that recorded the v6 stamp from an earlier build of this version kept the streamlined questionnaire forever, because the whole run was gated behind that stamp — so the two repair steps now re-run on every load, the test asserts the sweep itself stays gated (`report.ran` false, nothing removed), that the repaired rows are answered both ways, and that the load *after* the repair changes nothing and notes neither "academic question" nor "High Board" |
| `src/storage/xlsx.test.ts` | 5 | Safe workbook export |
| `src/components/dashboard/CommitteeManagement.test.tsx` | 7 | **Committee CMS as a rendered surface** |
| `src/context/operationalCache.test.tsx` | 2 | Operational collections survive a remount |
| `src/domain/cms.test.ts` | 25 | **The content document**: which addresses the page may follow (`#frag`, same-site path, canonicalised http(s)) and which it refuses (`javascript:`, `data:`, `//host`, `\`), a value that is not a page document reported rather than published as blanks, unsafe nav and footer links dropped with a note, unknown and repeated section keys dropped, a section the document forgot appended **visible** so content cannot be hidden by omission, oversized text clipped, a social handle with no confirmed profile kept as a handle, markup stored as plain text, image slots kept without inventing an asset, `slotsUsingAsset`/`assetUsage` for delete protection, `resolveImage` falling back to the bundled asset, and the upgrade of an older cached copy: every sentence kept character for character, the navigation and footer the old shape had no field for filled from the document the build ships, a navigation the operator *did* empty left empty, and the reference copy unchanged when upgraded twice |
| `src/domain/media.test.ts` | 24 | **The media library as rules**: a file is accepted for the bytes it carries and not the name it was given (a renamed HTML document is refused, a `.png` holding a JPEG is refused), SVG never enters because it can carry scripts, size/extension/empty/thumbnail caps each report their own reason, an alt text or an explicit "decorative" is required, a row read back from storage is dropped when its source is `javascript:`, `//host` or a backslash path and never trusts a claimed mime, usage reporting names both the slots and a path written into the copy, a delete is refused for the protected logo / a bundled asset / a slot that still points at it, and a replace-in-place keeps the id so no slot is orphaned while a refusal writes nothing |
| `src/domain/publishing.test.ts` | 19 | **Draft → live page → history**: which field paths a publish actually moved (a replaced subtree reported once, one list entry reported at `sections[1].visible`), a publish refused for an unreadable or rule-breaking draft leaving the live document untouched, "nothing to publish" when draft equals live, a publish with no actor/id/timestamp refused, the 50-entry cap trimming the oldest and naming how many went, a rollback filed as a **new** entry that keeps the history it overwrote, an unknown revision id refused, and history rows read back from storage with the unreadable ones dropped |
| `src/context/websiteContent.test.tsx` | 13 | **Draft and live page through the store**: a partial edit keeps the copy, sections and slots it did not touch; a hand-made `javascript:` nav link is dropped before storage and named in the audit line (and a poisoned cache entry can never be published, because the draft never holds it); an edit moves the draft and not the page; a publish moves the page, files a revision naming actor/label/changed paths and writes the audit row; an empty publish is refused without filing a revision; discard resets the draft and touches nothing live; a rollback restores an earlier page and leaves three history entries; the live page and its history read back after remount; and an account without `cms.content.publish` — a member, and a **Head that holds `cms.content.write`** — both throws and changes nothing in storage |
| `src/context/privilegeEscalation.test.tsx` | 17 | **The escalation scenarios as calls, not as screenshots** — the ten cases the 2026-10-22 review asked for, run against the two layers that answer in this environment (the dev vault, which is the simulated server, and the store, which is what the dashboard calls). A member raising themselves, a member raising a peer, a Head and a Director granting themselves IT Moderator / High Board, an IT session asking for a grant the matrix does not give it, a Super Admin grant that must **work** and audit actor + target + both roles, the same administrator refused on its own row, the adapter called directly with no UI in the way, a peer activation by an ordinary member, `role`/`status`/score totals smuggled through a profile edit that is still allowed to change the name, a committee-scoped member refused an ordinary field on another committee's row, a registration body carrying `role`, an approval that must not promote, a draft save and a publish refused from the wrong capabilities, a permitted editor changing text and placing a picture, a publish that names a missing asset instead of inventing one, a stored profile claiming `super_admin` to a session the vault holds as `member`, and a suspended account presenting a live session key. **Every refusal is asserted twice: that it refused, and that nothing moved.** Three of its guards were then deleted one at a time — the self-role rule in `roles.ts`, the protected-field strip in `updateUser`, the status re-read in the adapter's session restore — and each deletion failed exactly the case that should catch it, which is what makes the green run evidence rather than decoration. What it cannot prove is Postgres: the SQL side is `migrationIntegrity.test.ts` plus probes P15–P21 on a staging project |
| `src/App.reducedMotion.test.tsx` | 4 | **A visitor who asked the operating system for less motion still gets a working site**: the navigation reaches the workspace and the application form, the form returns to the public page, and the archived-period year tabs still switch — the animation is what is removed, not the interaction |
| `src/components/RegistrationPortal.test.tsx` | 15 | **The signup as an applicant meets it**: the page asks for an identity, the two academic questions, the membership question and the agreement — and none of the nine questionnaire fields, which stay in the schema rather than on the form; its only committee choices are the published ones, High Board included, with an archived or off-homepage committee never offered and a real "no preference" available; answering `yes` opens "which committee are you in" and answering `no` closes it again, and a committee named before the applicant changed their mind is dropped from what gets filed; nothing is invented — an application carries what the applicant was asked, none of the "Sophomore"/"Metallurgical & Materials Engineering" the portal used to prefill; a schema row switched back on reappears on the page and records what was typed into it, while the membership question disappears when the committee row is switched off; and validation is **one pass over every rejected field**, each message attached to the control it belongs to and cleared only by answering that control — including a `yes` with no committee named and an unchecked agreement on a schema that stopped requiring the field |
| `src/components/PublicWebsite.test.tsx` | 8 | **The public page reading the published document**: the hero headline and supporting message on the live page render instead of the ones shipped with the build, an unpublished draft never reaches the page (and a block the draft switched off is still there), the contact location and social handle come from the document, an image slot draws the uploaded picture with the slot's caption while a slot naming a missing asset falls back to the bundled one, the header prints the visible links and a switched-off block is not in the DOM at all, the footer carries the blurb/copyright/links the document holds, `sharing` writes `document.title` and the description/og tags, and reading the page does not rewrite either document |
| `src/components/dashboard/WebsiteCMS.test.tsx` | 7 | **The editor as a surface**: keystrokes are not a save (the live page keeps its words until Save, and Publish is disabled with the reason printed), a saved draft published from the form moves the live document, files one revision with the typed label, the actor's name and `hero.headline`, and the History tab lists it as the live entry; Discard throws the draft away without touching the page; a `javascript:` address is named in the notes while still being typed and is absent from both documents afterwards; switching a block off changes the draft first and the page only on publish; an image slot picks a library asset by id and releasing it returns the bundled file while keeping the alt text; and a Head — which holds `cms.content.write` but neither `cms.settings.global` nor `cms.content.publish` — gets the whole editor inside a disabled fieldset, no Save, no Publish and a status line that names the capability it lacks |
| `src/components/dashboard/ModeratorTools.test.tsx` | 5 | **Test-account seeding as a surface**: the card lists three rows as `not seeded`, one click writes all three fixtures to `ESME_CU_DEV_AUTH_V1` with `provisioned: 'test-fixture'`, and the report names what was created; a committee the workspace holds prints its name while one it does not prints as unseated instead of an id; the delete confirmation names the three addresses, backing out writes nothing, accepting removes exactly them and leaves the primary admin and the earlier applicant in the vault; and a member session sees no seed or delete control **and** gets a refusal from the store that names `users.create` when the action is called directly. `window.confirm` is spied on and asserted never called |
| `scripts/seed-test-accounts.test.mjs` | 15 | **The operator CLI, and the drift guard the SQL cannot carry**: `FIXTURES` still names the same three accounts, in the same order, as `TEST_ACCOUNT_FIXTURES`; the gate refuses unless `VITE_ALLOW_TEST_ACCOUNTS` is the literal `true` and the declared environment is development or staging; a password is checked by the same rules the app applies — supplied or generated, with the required character classes not positional; without `--apply` it prints the SQL-editor statements and makes no request; `--apply` arms then seeds over RPC in order, and never prints the service-role key — not in a line, not in an exception — including the production-refusal path, where the key is asserted absent before any fetch; a database refusal (`ESME_SEED_CLOSED`) is reported rather than presented as a successful seed, and `--apply` without a key that can open identities exits 2 |
| `scripts/apply-migrations.test.mjs` | 21 | **The staging runner's own rules, with a fake psql.** Order comes from the numeric prefix, not the whole filename, and a `9_draft.sql` or `notes.md` never enters the sequence. The gate refuses Production by name, refuses an undeclared environment, refuses `--apply` without a connection string or without `--confirm-project`, and refuses a reference that does not match the host in the URL — while a plan run needs none of those. `parseDbUrl` names the dashboard's `[YOUR-PASSWORD]` placeholder, a non-`postgres:` URL, and a string with no password, and splits a real one into the `PG*` variables so **the credential never sits in argv**. Every printed line is checked for the password: the plan, the evidence row (which escapes a `|` so failing output cannot forge a table row), and the scrub of a URL that psql echoes back. A plan asserts `spawn` was never called; an apply asserts the files ran in order, that a file returning 3 stops the run before 0006, that its message is kept, and that a missing `psql` is named rather than retried. These prove the tool behaves. **They do not prove the SQL is valid Postgres** — only a project that accepted it can |
| `src/components/dashboard/MediaLibrary.test.tsx` | 10 | **The media library as a surface**: a chosen file is not filed until it is described — the row reaches `ESME_CU_STATE_V2_mediaAssets` only after the dialog answers, carrying the sniffed kind, the bytes the browser reported, the measured pixels, the `blob:` source and `deviceOnly`, with an audit line beside it; a PDF renamed to `.png` is refused *while the dialog is open* and nothing is written; a picture switched to "decoration" is accepted with no description; a replace keeps the id the slots name and swaps only what is behind it; search narrows by name and description and prints what it could not find; the filters separate bundled assets, uploads, and what only this device holds; a card names the slot that still uses it and its delete is refused with no confirm control; an unused upload deletes and is written to the trail; the official logo can be neither deleted nor replaced; and a Head — no `cms.media.manage` — gets a disabled grid |

## The committee integration test

`CommitteeManagement.test.tsx` mounts the real `AppProvider`, the real local development
adapter and the real `CommitteeManagement` component, then drives the actual controls with
`@testing-library/user-event` and reads the results out of `ESME_CU_STATE_V2_committees` —
including after `cleanup()` plus a **second mount**, which is what proves a write is persisted
rather than merely held in a component.

It covers the seven reported failures:

1. Both seats render as `Unassigned` while no account holds them.
2. Every stored field edits, saves, and is read back from storage by a remounted page.
3. An unusable acronym is refused with a field-level message and the stored row is
   byte-identical afterwards.
4. A Director is seated from the directory, the panel shows the account behind the seat, and the
   account's role is still `member` in the stored profile.
5. A person who already leads another committee is shown as blocked, the button is disabled, and
   nothing is written.
6. Clearing a seat leaves the committee vacant — no stale name anywhere.
7. A new committee is created with both seats vacant, the form reopens empty, and a taken acronym
   is refused without a second row being written.

## The dashboard as a rendered surface

`DashboardShell.test.tsx` and `DashboardHome.test.tsx` mount the real `AppProvider` and the real
local development adapter, so the screens they assert on are chosen by the capability model, not
by a list written in the component. Signing an approved applicant in and re-rendering is what
proves a member loses `Members Directory`, `IT Moderator Tools` and `Settings & Backups` — a
nav entry disappearing there is the model at work, and a nav entry that should have disappeared
but did not fails the test.

`DataTable.tsx` is the one list shape those screens share: search, the caller's filters, column
sorting, paging, per-row actions with a confirmation on the destructive ones, and cards instead of
a table below the desktop breakpoint. It authorizes nothing — the rows it is handed are the rows
the caller is allowed to see — and `MemberManagement.test.tsx` and `TaskCommandCenter.test.tsx`
are the proof that the two real directories go through it rather than alongside it: they assert on
`ESME_CU_STATE_V2_userProfiles` and `ESME_CU_STATE_V2_tasks` after a confirmation, and on the
actions a member session or a task state does **not** get.

`RegistrationManager.test.tsx` and `SettingsAndBackups.test.tsx` cover the other half of the same
rule: what a screen prints when the capability is missing. The recruitment queue is now read-gated
(`registrations.read`), so a member session that has a cached queue in `ESME_CU_STATE_V2_applications`
still gets a refusal and no applicant name, and a committee-scoped reader is narrowed where the list
is produced — the local adapter applies the same committee filter its RLS counterpart declares, so a
Director's queue never contains another committee's applicant. Decisions moved out of the browser
chrome: the rejection reason is a field inside a dialog, and the file asserts `window.prompt` and
`window.confirm` were never called rather than asserting that a dialog looked right. The cache reset
is guarded in the store (`backups.manage`), and the test calls `resetLocalCache()` from a component
with the screen's controls deliberately out of the way, which is what proves a hidden button was not
the authorization.

These files need three jsdom substitutes declared up front: `window.matchMedia` (jsdom reports no
media queries, so the breakpoint the rail trades for a drawer, and the table for cards, has to be
stated), and `Element.prototype.scrollIntoView`, `Element.prototype.scrollTo` and a synchronous
`IntersectionObserver` (framer-motion's `useInView` never fires otherwise, which is what
`AnimatedNumber startOnView` waits on). Because `requestAnimationFrame` fires nothing in jsdom, an
exit animation never completes: tests assert on what a refusal left behind, not on the dialog
vanishing. Two screens can be open at once on this branch (an applicant profile and the decision
dialog), and because a closed shell stays mounted mid-exit here, `RegistrationManager.test.tsx`
picks a dialog by the text it holds instead of by its index.

## Nothing on these screens may be invented

Two tests exist specifically to catch fabricated operational data rather than a broken control:
the chapter home asserts that a season with no milestones reports `No milestone is written in the
season planner yet` and prints no year the workspace never recorded, and the member home asserts
that an account with no ledger row reads `No score entry names you yet` instead of `0`. The
corresponding source change is in `AppContext.tsx`: `seasonEvents` now initialises from an empty
collection, and the milestones transcribed from the vision document arrive only through
`loadReferenceSeasonPlan()`, which is capability-guarded, deduplicated by title, audited, and
offered from the planner only while it is empty. The same rule covers the skill-coverage headline
(`SkillMatrix.tsx` prints the key result that a person wrote, or says nobody wrote one) and the
public calendar (`PublicWebsite.tsx` counts the planner rows in that browser).

For a manual pass, start from a clean workspace: a browser that already holds rows from an earlier
build will show those rows, and a browser with no `ESME_CU_DEV_*` vault shows the primary-admin
bootstrap form rather than a login.

## What the suite does **not** prove

Stated plainly, because "green tests" is not the same as "verified in production":

- **No SQL has been executed.** `supabase/migrations/*.sql` — including
  `0004_committee_leadership.sql`, `0005_email_notifications.sql`,
  `0006_rewards_discipline.sql`, `0008_seed_test_accounts.sql` and
  `0009_security_hardening.sql` and
  `0010_privilege_hardening.sql` — has never been parsed by
  Postgres or exercised against RLS. This environment has no `psql`, no Docker and no Supabase
  CLI. The functions, triggers and policies are authored and reviewed only; the static
  consistency test above is a partial substitute, not a run. That covers the test-account
  seeding too: `esme_seed_test_accounts()` and `esme_remove_test_accounts()` are guarded by the
  same two checks the local path is (declared environment, one-shot armed window) and by
  `service_role`-only grants, but no project has ever run them, so the password hashing, the
  queue-row insert through the signup trigger, the repair-not-takeover branch and the
  reward-ledger deletion refusal are unproven against real Postgres. The one-line `accepted_policies`
  fix in `0003_bootstrap_admin.sql` is in the same position — reasoned from the trigger and the
  `check (agreed_to_policies)` constraint, never observed. Neither is `esme_assert_publication_write()`,
  the guard that replaced the invalid `OLD.published` reference in 0002: the static test proves the
  policy no longer names a trigger-only record and that the guard compares all three publication
  columns, but that Postgres parses the file, that the trigger fires on a client `insert` as well as
  an `update`, and that a `cms.content.publish` session still gets through has to be read off the
  `supabase/README.md` checklist on a real project.
- **The operator CLI has never talked to a deployment.** `scripts/seed-test-accounts.mjs` is
  tested against a stubbed `fetchImpl`, so what is proven is the gate, the password rules, the
  statements it prints, the order of the RPC calls and that the service-role key never reaches
  stdout or an error message. That `POST /rest/v1/rpc/esme_arm_test_account_seed` is accepted by
  a real project is not. The same applies to `scripts/apply-migrations.mjs`: it has printed plans on
  this machine and never opened a connection, so the `psql` invocations it records are untested
  against a real server.
- **`supabase/probes/authorization_probes.sql` has never been run.** It is written for a session that
  can `set local role`, and every block rolls back. Until a staging project executes it, the PASS/FAIL
  notices it would print are a design — the reasoning behind each expectation is in the file's
  comments, and the reward channel, ledger-freeze, capability, idempotency and publication-guard
  behaviours remain **static review only**.
- **The reward writes go to the provider, but every provider in these tests is a stub.** Four calls —
  `esme_award_bonus()`, `esme_issue_warning()`, `esme_reverse_reward_entry()`,
  `esme_acknowledge_warning()` — are now on the request path: `src/auth/rewardProvider.test.ts`
  drives the adapter with a mocked `createClient`, and `src/context/rewardProvider.test.tsx` drives
  the store with a spied adapter. So what is proved is the wire shape, the receipt mapping, the
  failure vocabulary and the store's refusal to mirror a rejection. What is **not** proved by any of
  it: that Postgres accepts the SQL, that `esme_assert_reward_channel()` fires, that the unique
  idempotency column is what rejects a replay, that a cap is enforced inside the transaction, or that
  the escalation triggers queue a row. `migrationIntegrity.test.ts` reads the files; only a staging
  run can answer the rest. Reward **reads** are still the device cache, and `esme_update_reward_policy()`
  is still not called from the client — see the A–E table in
  [DATABASE_AND_MIGRATIONS.md](DATABASE_AND_MIGRATIONS.md).
- **No live provider sign-in.** `supabaseAdapter` has never completed a real session; the tests
  run against the development adapter. That includes `readEmailPreferences()` /
  `saveEmailPreferences()`: the local path is tested, the Supabase path is not.
- **The reward RPCs are called by the client, but never by a real database.** The four write calls
  above reach a stubbed provider in every test here; `esme_update_reward_policy()` is still not on the
  request path at all, and the ledger is still *read* from the device cache rather than from
  `esme_reward_entries`. The five 0006 functions have therefore never answered a request from anyone.
- **Email delivery, password reset and OAuth are untested.** `supabase/functions/send-email` has
  never executed in Deno and no provider has accepted a message, so no test here shows a mail in
  anyone's inbox. What is proven is the wording (both copies render identically), the queue
  rules, and the shape of the request the sender would make.
- **Dashboard screens were driven in a real browser, but not by pointer input.** The automation tab
  in this environment is a detached surface: pointer actions return
  `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (viewport=0x0, visible=false, attached=false)`, and a hidden
  tab fires zero `requestAnimationFrame` callbacks, so `AnimatePresence mode="wait"` never finishes a
  transition under pointer-driven interaction. What **was** done is a scripted pass in the real dev
  browser at `http://localhost:5199/` — primary-admin bootstrap, sign-in, opening the Website CMS,
  switching a block off, choosing a media asset for an image slot through the picker, filtering the
  picker by search, saving, publishing with a label, and reading the published document back out of
  the live page (the block gone from the DOM, the slot drawing the chosen file, one revision listed
  with the actor's name) — with the controls activated by script rather than by a pointer. The
  animations, focus rings and layout at other viewports were therefore **not** visually inspected;
  the jsdom integration tests are the evidence for the screens, not a substitute for looking at them.
  Run `npm run dev` locally to do that pass.
- **A returning device's cache was upgraded in the browser, and that is how one bug was found.** The
  CMS walkthrough ran on a browser holding a pre-CMS cached document, which upgraded into a page with
  no header links and an empty footer — the loss then appeared in the editor as seven of the
  operator's own unpublished fields. `upgradeContentDocument` now fills the groups the old shape had
  no field for from the document the build ships, and the same browser was used to confirm the
  restored navigation (10 header links, footer copy back) before its content keys were cleared.
  Covered since by `src/domain/cms.test.ts` and the v3 → v4 case in `src/storage/migrations.test.ts`.
  The v4 → v5 rewrite of the questionnaire schema **has** now been run by a returning device in the
  real browser, and it found two defects the storage tests had missed. The dev tab at
  `http://localhost:5199/` had been stamped `v5` while still holding the pre-upgrade 13-field schema,
  because Vite hot-reloaded the module mid-edit-sequence; with the ESME keys snapshotted to
  `sessionStorage`, the version key put back to `v4` and `runStorageMigrations()` imported and called
  directly, it returned `{ ran: true, toVersion: 'v5', removedKeys: [], carriedKeys: [] }` and rewrote
  the 10 stale rows — and `websiteContent`, `publishedContent` and `committees` came back
  byte-identical, which is the proof that nobody's data moved.
  1. **A v4 device was told its V1 cache had been deleted.** The sweep branch ran on any device that
     was not already v5, so a browser that had never held a V1 key still pushed the note, and — worse
     — a stray `ESME_CU_STATE_V1_*` key could overwrite a current v2 cache. The branch is now gated on
     the recorded major version (`alreadyPastV2`) and the note names a real count of removed keys.
  2. **The committee question was reported as switched off.** It still renders, it only stopped being
     required, so one note described two different changes and told the operator the wrong thing about
     one of them. `upgradeRegistrationFieldSchema` now returns `switchedOff` and `madeOptional`
     separately and the migration writes two notes.
  Both are pinned by `src/storage/migrations.test.ts`. What is still only tested, not watched: the
  "keeps a setting the operator made" branch — the real cache held rows at the shipped defaults, so
  every row on that device took the rewrite path.
- **The signup form was not looked at in a browser after the short-form change.** `RegistrationPortal`
  was edited in its markup — every schema-driven control gained an `htmlFor`/`id` pair, the committee
  question gained a "no preference" option, and nine fields stopped rendering at all. The jsdom tests
  drive the real form through `user-event` and read the stored application, and the labels are now
  attached so a screen reader has something to announce; what nobody has checked is how the short
  form *looks* — the grid leaves nine holes were always empty-shaped, and the new optional select is
  untested against a real keyboard at a narrow width.
- **The Media Library screen was not reached in a real browser.** The dev tab this environment drives
  now holds the chapter's own primary-admin account, and the only way past that login is to wipe the
  `ESME_CU_DEV_AUTH_V1` vault — somebody's data, not a test fixture — so the scripted pass stopped at
  the public site. It is also still true that a hidden tab never advances the page transition, so no
  amount of scripting reaches a dashboard view from a cold public-site render here. What the screen
  does have: the jsdom tests above, which render the real component against the real store and the
  real storage keys, and a production build in which the nav id, the label and the `cms.media.manage`
  gate are present in the `DashboardRoutes` chunk. What it does **not** have: an inspection of its
  animations, focus rings, dialog centreing or card grid at 320 / 640 / 1024 / 1440. That pass is
  owed. What the real browser did confirm is the absence of a regression: the public site still
  renders after the nav, `WebsiteCMS` and `ImagesPanel` edits with no console error.
- **The Test-accounts card has not been driven in a real browser, and the seeded accounts have
  not been used to sign in there.** `ModeratorTools.test.tsx` performs the whole cycle against the
  real vault — seed, read the report, delete, and sign-in refusal without the capability — and
  `auth.test.ts` signs each fixture in with its own password. What nobody has watched is the card
  itself rendering at a narrow width, and whether the three testers behave in the dashboard exactly
  like a human account of the same role. Run `npm run dev`, seed from
  *IT Moderator Tools* in a development build with `VITE_ALLOW_TEST_ACCOUNTS=true`, then sign in as
  `test.head@esme.test` and `test.member@esme.test`.
- **`jsdom` has no `Blob.prototype.arrayBuffer`, and the upload path was rewritten for it.** Reading
  the first bytes with `file.slice(0, 16).arrayBuffer()` looked like the tidy API and is silently
  unavailable in the test environment, so the byte signature was never read and no dialog opened.
  `readHead` now goes through `FileReader.readAsArrayBuffer`, which every target browser and jsdom
  both implement — the same code path the tests exercise and the browser runs.
- **`v2` devDeps added for this**: `jsdom`, `@testing-library/react`,
  `@testing-library/user-event`, `@testing-library/dom` — test-only, no runtime dependency, and no
  separate vitest config file was needed because the DOM tests opt in per file with
  `// @vitest-environment jsdom`. The one test setting that does exist is the `test.env` block in
  `vite.config.ts`, which pins `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` empty. Without it a
  developer who has filled in a real project gets a red run for an unrelated reason: Vite loads
  `.env.local` for tests too, so every store and screen test resolves the real provider first and
  then waits on a network call — more than 40 cases across the store and screen suites failed that
  way before the pin was added, and the whole suite passes with it.

## Conventions

- Domain tests are pure — no DOM, no mocks of the rules under test.
- A test asserts on **storage or the returned row**, not on a toast, because a success message is
  not evidence that anything was saved.
- For anything the provider decides (the reward writes since 2026-10-22), the assertion is on the
  **provider's answer and the refusal path**, with a stubbed adapter — a screen test that only reads
  back browser storage would pass even if the RPC call were deleted. `src/context/rewardProvider.test.tsx`
  exists for that reason; the older `src/context/rewards.test.tsx` cases still prove the rules the
  SQL mirrors.
- Refusal tests assert that nothing changed (`JSON.stringify(stored())` before and after), so a
  validation that reports a problem but still writes is caught.
- Timing: PBKDF2 with 210,000 iterations makes `auth.test.ts` and the jsdom suites slow (~10–12s
  each). That is expected, not a hang. `vitest` starts one worker per file (42 on this machine),
  so a case that measures 3.2s alone can exceed the 5s default under that contention. Three suites
  were caught that way on the same tree minutes apart — `RewardsAndDiscipline`,
  `TaskCommandCenter` and `WebsiteCMS`, each at 5.9–6.1s on one case — after `CommitteeManagement`
  and `ModeratorTools` had been given individual budgets, which is why the fix moved from per-suite
  to global: `testTimeout: 15_000` in `vite.config.ts`. No assertion, wait, or `asyncUtilTimeout`
  changed — a missing control still fails in 1000ms, and a genuine hang still fails, just at 15s
  rather than 5s. The two explicit per-suite budgets (`CommitteeManagement.test.tsx` 20s,
  `ModeratorTools.test.tsx` 25s with `asyncUtilTimeout: 12_000`) stay, because they derive several
  hashes per case. `isolate: false` would make the whole run faster — not changed, because per-file
  isolation is what keeps one suite's `localStorage` out of another's.
