# DISCOVERY — front-end overhaul, ESME CU platform

Phase 0 notes for the animated UI rebuild + HR Manager role. Written before any presentation
change, against `ba2698f`, so the baseline numbers below are the thing later phases must not
regress. Everything here is read from the repo, not from the brief; where the brief describes a
module that does not exist, it is listed as skipped rather than invented.

## 1. Stack, as installed

| Concern | What the repo uses | Where |
| --- | --- | --- |
| Framework | React 19.2 + TypeScript 6, strict | `esme-cu-platform/package.json` |
| Build | Vite 8 (rolldown), `tsc -b && vite build` | `vite.config.ts` |
| Routing | **No router.** One `useState<DashboardView>` in `App.tsx:56` swaps workspace screens; the public site scrolls between `<section id>` anchors | `src/App.tsx`, `src/components/dashboard/DashboardRoutes.tsx` |
| State | One `AppProvider` context (~2.4k lines) over a versioned browser store, plus `AuthProvider` for identity | `src/context/AppContext.tsx`, `src/storage/migrations.ts` |
| Data/provider | Supabase (`@supabase/supabase-js`), with a `local-dev` adapter that is compiled out of production builds | `src/auth/index.ts:14` |
| Styling | Tailwind v4 via `@tailwindcss/vite`, one global stylesheet, `clsx` + `tailwind-merge` | `src/index.css`, `src/lib/utils.ts` |
| UI library | **None.** Every screen writes its own markup — there is no `components/ui` layer | see §4 |
| Icons | `lucide-react` (one family, 16/20/24) | throughout |
| Charts | `recharts` 3 | `src/components/dashboard/KPIAnalytics.tsx` and peers |
| Tables | In-house `DataTable` | `src/components/dashboard/DataTable.tsx` |
| Motion | `motion` (Framer) + `gsap` 3.12.5 + `lenis` + `three` (WebGL hero on the public site) | `src/motion/`, `src/lib/motion/` |
| Tests | Vitest 5 + jsdom + Testing Library; 61 files / 908 tests at baseline | `src/**/*.test.*` |
| Lint | oxlint (no eslint, no stylelint) | `.oxlintrc.json` |
| i18n / RTL | **None in the UI.** `en`/`ar` exists only as an *email* locale (`EmailPreferences.locale`) | `src/domain/email.ts`, `NotificationsAndEmail.tsx` |
| E2E | **None installed** — no Playwright/Cypress config anywhere in the repo | — |

## 2. The palette (the only colors any phase may use)

Declared once, in `src/index.css:9` (`:root`) and `src/index.css:25` (`.dark`):

| Token | Value | Read as |
| --- | --- | --- |
| `--esme-navy` | `#123B60` | brand/trust: surfaces, headings, active nav |
| `--esme-navy-dark` | `#0A2239` | pressed/hover on navy |
| `--esme-navy-light` | `#1D5485` | secondary blue |
| `--esme-orange` | `#F59A16` | accent: focus ring, key numbers, active icon |
| `--esme-orange-dark` | `#D47F0A` | emphasis end of the ribbon gradient |
| `--esme-orange-light` | `#FFAF38` | highlight end (top of the ribbon) |
| `--esme-ivory` | `#FDFBF7` | warm light surface |
| `--esme-slate` | `#1E293B` | ink on light |
| `--esme-page` | `#F8FAFC` → `#020617` in dark | page background |
| `--esme-ink` | `#0F172A` → `#E2E8F0` in dark | body text |
| `--esme-scroll-track/-thumb/-thumb-hover` | `#F1F5F9`/`#CBD5E1`/`#94A3B8` (dark: `#0F172A`/`#334155`/`#475569`) | scrollbars |

Also in use, from Tailwind's own scale rather than the ESME file: `slate-*` neutrals (borders,
muted text, dark surfaces), plus `emerald-600`, `purple-600`, `rose-*`, `amber-*` in role chips and
status text. Any phase that touches one of those must map it to an ESME token or a neutral, not add
a new hue. `<meta name="theme-color">` is `#123B60`.

**Fonts already loaded** (`index.html`, Google Fonts, `display=swap`): Inter Tight 400–800 (UI),
Newsreader 400–600 (serif accents, `.font-serif-accent`), IBM Plex Mono 400–600
(`.font-numbers`, tabular). No new family may be added.

**Logo assets** — never recolored, cropped or redrawn: `/branding/esme_logo.png` (sidebar, favicon,
apple-touch-icon), `esme_logo_official_hd.png` at repo root. Brand reading matches the brief: navy
rounded geometric wordmark, amber→red-orange glossy ribbon through the letters.

## 3. Surfaces

- **Public site** (`src/components/PublicWebsite.tsx`, ~1.6k lines): sections `home`, `journey`,
  `how-it-works`, `about`, `vision`, `history`, `appreciation`, `process`, `committees`, `events`,
  `magazine`, `insights`, `contact`.
- **Auth screens**: `LoginScreen.tsx` (full-screen, animated), `RegistrationPortal.tsx` (join form),
  `AuthPendingScreen.tsx`, `LoginModal.tsx`.
- **Workspace**: 22 views, one list in `src/components/dashboard/nav.ts`, grouped as Core Command (8),
  Organization & People (3), Operations & Execution (4), Public Channels & Content (3),
  System & Governance (4). `DashboardShell.tsx` renders rail + drawer + topbar; `DashboardRoutes.tsx`
  wraps each view in `RequireCapability`; lazy-loaded as one chunk.
- **Shared pieces that exist today**: `DataTable`, `EmptyState`, `ThemeToggle`, `CommandPalette`,
  `ModalShell`/`DrawerShell`, `Toast`, `Reveal`, `AnimatedNumber`, `WordReveal`, `MagneticButton`,
  `AccessDenied` (in `src/auth/guards.tsx`).
- **No shared**: buttons, inputs, selects, badges, tabs, stat tiles, skeletons, pagination, page
  header. Each screen re-styles its own — this is the bulk of the rebuild.

## 4. Baseline measurements (`ba2698f`, nothing changed yet)

| Check | Result |
| --- | --- |
| `npm run lint` | pass, 0 warnings |
| `npx tsc -b --force` | pass |
| `npm test` | **61 files / 908 tests passed**, 67.6s |
| `npm run build` | pass in ~1s, 3068 modules |
| JS gzip (all chunks) | ≈ 985 kB total; entry `index-*.js` 214.6 kB, `DashboardRoutes` 226.4 kB, `exceljs.min` 256.4 kB, `three.module` 168.1 kB (lazy), `gsap` 27.2 kB, `ScrollTrigger` 17.1 kB, `lenis` 3.5 kB |
| CSS gzip | 22.0 kB (`index-*.css`) + 2.9 kB in lazy chunks |
| Raw color literals in `src` | **704 occurrences / 90 distinct values**; top: `#F59A16` ×233, `#123B60` ×224, `#D47F0A` ×31, `#0A2239` ×31. Worst files: `PublicWebsite.tsx` 149, `SkillMatrix.tsx` 32, `RegistrationPortal.tsx` 27, `TaskCommandCenter.tsx` 23 |
| Inline `style={{ }}` in TSX | 15 |
| Off-palette hues introduced ad hoc | `#8900ff`, `#00c2ff`, `#ff5a1f`, `#f5b64f`, `#eee6ff`, `#171310`, `#0f0e11` (mostly `PublicWebsite.tsx` dark sections) |
| Known flake | `src/App.noApprovalFlow.test.tsx` failed in one full-suite run under parallel load (24.5s), passes in isolation (15.9s). Timing, not logic. |
| Lighthouse / device matrix | not run at baseline; recorded during the QA phase with the dev server + local-dev adapter |

## 5. Where authority lives (so nothing is guessed later)

- Matrix: `src/domain/roles.ts` — `MATRIX[role][capability] = scope`, read by `scopeFor`,
  `hasCapability`, `capabilitiesFor`, `canActOn`, `canReadProfile`, `validateRoleChange`.
- Session: `src/auth/AuthProvider.tsx`; UI guard `src/auth/guards.tsx` (`RequireCapability`);
  sidebar/palette/breadcrumb all read `nav.ts`, so a capability change moves all four at once.
- Server mirror: `esme_role_capabilities` seeded in migrations 0002/0006/0013/0015 (+ 0021 for
  HR Manager), read by `esme_has_capability()` / `esme_capability_scope()` /
  `esme_reaches_profile()` in `0002_functions_rls.sql`. `migrationIntegrity.test.ts` proves both
  sides declare the same roles; `domain.test.ts` proves privileged = every label but `member`.
- Roles at baseline: `super_admin`, `high_board`, `moderator`, `director`, `head`, `member`.

## 6. Brief items with no module behind them — skipped, not invented

The HR brief lists recruiting-interview scheduling, interview notes/scores, attendance capture,
onboarding/offboarding checklists, review cycles, certificates and "finance/budget/sponsorship"
modules. **None of these exist as data or screens**: the only matches for those words in `src` are
marketing copy on the public site and comments in motion CSS. Per the non-negotiables, they are
skipped; the role is expressed through the modules that do exist — directory, registration queue,
committees, tasks/submissions/scores (read), season events (read), skills (read), analytics,
notifications and the reward ledger. There is also no offline detection, no density setting, no
autosave, no rich-text editor and no calendar/Kanban component, so the matching brief clauses do
not apply.

## 7. Test checklist the QA phase must walk (from README + docs)

1. Sign in / sign out per role, including HR Manager; bootstrap path with no privileged account.
2. Public site: every section renders, join form submits, CMS-published content appears.
3. Registration: self-service signup → queue → approve with committee → session; reject with reason.
4. Members Directory: search, filter, sort, create, edit, deactivate, role change, reward a bonus.
5. Committees: create/edit/archive, appoint and remove Directors/Heads, roster moves, optimistic
   `expectedUpdatedAt` conflict path.
6. Tasks: create/assign/edit/delete, deadline states, submission → review → revision → approve.
7. Season Planner: create/edit/delete events, milestones, planner permissions per role.
8. Rewards: bonus caps, warning escalation, reversal, acknowledgement, policy edit and its guards.
9. KPI & Analytics, Decision Center, Report Builder export (xlsx), Skill Matrix, Scoring
   transparency, Media Library upload/delete, Website CMS edit/publish, Meta insights, Chat,
   Notifications & email preferences, Audit trail, Settings & backups, Moderator diagnostics.
10. Permission matrix: for each role, allowed screens work and forbidden ones are blocked in the
    rail **and** refused by the provider.
11. Responsive: 360 / 390 / 414 / 768 / 1024 / 1440, no horizontal scroll, drawer, sticky bars.
12. Reduced motion + lite mode; keyboard-only walkthrough; contrast on the existing tokens.
13. `npm run lint`, `npx tsc -b`, `npm test`, `npm run build` all green after every phase.
