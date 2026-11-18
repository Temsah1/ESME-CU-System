# Design tokens

Colour, spacing, type, radius, elevation, motion timing and layout constants have one home each.
A screen binds to a name; it does not write down a value.

That is enforced, not advised. [`src/styles/tokens.test.ts`](../src/styles/tokens.test.ts) fails the
build if a colour literal appears anywhere in `src/` except the two token files, if the token layer
declares a colour the chapter did not already render, or if the JS palette holds a value the CSS
layer does not.

## The three tiers

| Tier | Where | Named as | Use it when |
| --- | --- | --- | --- |
| Primitive | `:root` in [`src/styles/tokens.css`](../src/styles/tokens.css) | `--esme-navy`, `--esme-slate-400`, `--esme-ember-1000` | You need the exact brand value, and the thing you are painting *is* that colour (a scene, a chart series, a print sheet). |
| Semantic | `:root` + `.dark` in the same file | `--app-surface`, `--app-text-muted`, `--app-border-strong` | You are describing a role in the interface. This is the tier that flips between light and dark. |
| Utility | `@theme inline` in the same file | `bg-surface`, `text-ink-muted`, `border-border-strong`, `rounded-card`, `shadow-raised` | You are writing Tailwind classes, which is almost always. |

`@theme inline` rather than `@theme`: the utilities must emit `var(--app-surface)` itself. A plain
`@theme` would bake the resolved colour in at build time and the dark switch would stop working.

## Rules

1. **No colour literal in a screen.** `bg-[#123B60]` becomes `bg-brand`. The test says so.
2. **No new colour without a decision.** Every value in the layer was hoisted from a screen that
   already rendered it, and `PRE_EXISTING_COLORS` in the test is that snapshot. Adding a hue means
   editing that list in the same commit, so the choice is visible in review rather than buried in a
   stylesheet.
3. **Brand fills are theme-invariant; brand *text* is not.** `bg-brand` is `#123b60` in light and
   dark — the chapter's identity does not shift with the time of day. `text-brand` is navy on paper
   and orange on slate, because navy type on a dark surface is the one thing a brand must not ask a
   reader to do.
4. **Tailwind's own palette is a token reference, not a literal.** `text-slate-400`, `bg-emerald-600`
   and friends are already named values from a shared scale, so they pass the hygiene test. Prefer a
   semantic alias when you are describing a role (`text-ink-muted`) and keep the raw scale when you
   genuinely want that step of it.
5. **Charts, mail and print read the JS half.** See below.

## The JS half — [`src/theme/palette.ts`](../src/theme/palette.ts)

Three kinds of colour cannot live in CSS: SVG fills passed to Recharts as strings, WebGL/GSAP scene
colours, and the inline styles an HTML email or a printable report must carry (mail clients and print
pipelines strip custom properties). They import `PALETTE`, `CHART_SERIES`, `CHART_CHROME`.

`CHART_SERIES` is the one categorical ramp for every chart in the product: navy, orange, green,
indigo, pink, violet. A screen does not pick its own six.

The test asserts every `PALETTE` value also appears as a primitive in `tokens.css`, so the two halves
cannot drift into two palettes.

### The mail copy

`supabase/functions/_shared/email.ts` is a deliberate duplicate of `src/domain/email.ts`: a deployable
Edge Function bundle can only import from inside `supabase/functions/`. It restates the mail chrome as
literals. Two things keep that honest — `emailTemplates.server.test.ts` renders every event through
both modules and compares the output byte by byte, and the token test refuses any colour in that file
that `PALETTE` does not already own.

## Motion tokens

`--transition-duration-*` and `--ease-*` in `tokens.css` mirror `durations` and `easings` in
[`src/motion/tokens.ts`](../src/motion/tokens.ts). CSS transitions and JS animations are the same
system, and the test fails if one side changes timing without the other.

The names are not a style choice: `duration-micro` is a Tailwind utility only while the token behind
it is declared as `--transition-duration-micro`, because that is the namespace the generator looks in.
A shorter `--duration-micro` is a valid custom property that produces no class at all, and nothing but
that test notices — so it asserts the namespace, not only the value.

Full motion guidance — what moves, what must not, reduced-motion behaviour — lives with the source
in [`src/motion/`](../src/motion/) (primitives) and [`src/lib/motion/`](../src/lib/motion/) (scenes).

## Sizing and spacing

- Radius: `rounded-control` (0.5rem), `rounded-card` (1rem), `rounded-sheet` (1.5rem), `rounded-pill`.
- Elevation: `shadow-card`, `shadow-raised`, `shadow-overlay`, each aliasing a Tailwind shadow rather
  than inventing one.
- Type: `text-micro`, `text-caption`, `text-label`, `text-body`, `text-lead`, `text-title`,
  `text-headline`, `text-display` — each with its own line height, so a heading never needs a
  separate `leading-*`.
- Layout: `--layout-header` (4rem), `--layout-rail` (16rem), `--layout-rail-collapsed` (5rem),
  `--layout-prose`, `--layout-wide`.
- Spacing keeps Tailwind's 0.25rem unit. It is already a scale; a second one would only create
  arguments about which to use.

## Adding a colour

1. Is it already in the layer? Search `tokens.css` first — the ramp is wider than it looks.
2. If it is a new *role*, add a semantic alias pointing at an existing primitive. No new hex.
3. If the chapter genuinely needs a new hue, add the primitive to `tokens.css`, mirror it in
   `palette.ts` if JS needs it, and add it to `PRE_EXISTING_COLORS` in the same commit with a line in
   the PR describing who asked for it.
