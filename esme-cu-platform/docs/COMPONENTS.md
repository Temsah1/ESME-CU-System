# Component kit

`src/components/ui` is the set of parts every view is built from. It exists because the same panel was
written out longhand in twenty-two places, each with its own radius, its own shadow step and its own
idea of when a label is required — and because the accessibility wiring that a screen tends to skip
(label ↔ control, `aria-invalid`, `role="alert"`, `aria-current`) has to be somewhere it can be
written once and tested.

Colours come from [`TOKENS.md`](./TOKENS.md). Nothing here holds a hex value, and `tokens.test.ts`
fails a build that adds one.

| File | Exports | Why it is a component and not a div |
| --- | --- | --- |
| `Button.tsx` | `Button`, `IconButton` | One primary action per screen, five variants, 44px touch target at `md`, `loading` keeps the button's own width instead of swapping in a new element, `href` renders an anchor. |
| `Field.tsx` | `Input`, `SearchInput`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `FormField` | Generates the id once, points the label at it, and makes the hint or the error reachable through `aria-describedby`. Checkbox/Radio/Switch are real inputs with a painted sibling, so the keyboard, the value and the announcement come from the browser. |
| `Surface.tsx` | `Card`, `Badge`, `PageHeader`, `StatTile`, `Alert`, `Skeleton`, `ProgressBar` | Landmarks and roles: a `Card` can be a named region, `Alert` decides between `status` and `alert`, `ProgressBar` exposes `aria-valuenow`, `Skeleton` is `aria-hidden` because it is decoration. |
| `Navigation.tsx` | `Tabs`, `Pagination`, `Tooltip` | `Tabs` is a tablist with roving tabindex and arrow keys; `Pagination` is a nav with `aria-current="page"`; `Tooltip` clones its trigger so `aria-describedby` lands on the element the user actually tabs into. |
| `Spinner.tsx` | `Spinner` | `role="status"` when it carries a label, silent when the control already announces the wait (`label=""`). |

Import from the barrel: `import { Button, Card, Input, Tabs } from '../components/ui'`.

## Rules a screen follows

- **A control is never unlabelled.** `label` for the visible one, `srLabel` when the design wants no
  text above the field. `IconButton` requires `aria-label` in its types, so the unnamed pencil button
  cannot compile.
- **An error replaces its hint**, it does not join it. `aria-describedby` points at whichever one a
  user needs to hear; two paragraphs on one field is a form talking over itself.
- **A badge is a word, not a colour.** Status tint carries the glance and the text carries the meaning,
  which is also why tinted badges are typed with `text-ink` rather than with their own hue: a 15% wash
  plus same-hue text sits around 2:1 and fails AA at badge size.
- **Focus is drawn where it can be seen.** The checkbox's ring is painted on the sibling box, not on
  the `sr-only` input, because an element clipped to one pixel cannot show a ring.
- **Motion is enter-only in tabs.** An exit animation keeps the previous panel mounted, so the tab a
  screen reader just announced would point at content on its way out.
- **Reduced motion is inherited**, not re-declared: the global block in `tokens.css` flattens
  transitions and animations, and the kit adds `motion-reduce:*` where an element would otherwise
  still slide or pulse.

## What is deliberately not here

There is no `Modal` in the kit: [`src/motion/ModalShell.tsx`](../src/motion/ModalShell.tsx) already
owns focus trapping, scroll lock and the exit animation, and a second implementation would be a second
set of bugs. There is no `Table`: the views have genuinely different column sets, and the shared part
of a table is the cell typography, which is a token question. `EmptyState` stays in
`src/components` because it already states the reason a collection is empty, which is the part worth
keeping.

## Tests

[`src/components/ui/ui.test.tsx`](../src/components/ui/ui.test.tsx) — 30 cases, all of them about the
contract rather than the look: which element a label resolves to, whether an error is announced and
named, whether one Tab press leaves the tab row, whether the tooltip is reachable from the keyboard,
whether a pagination control that is not offered can still be clicked.

```
npx vitest run src/components/ui
```
