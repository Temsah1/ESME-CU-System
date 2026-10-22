# CMS guide

What an operator can change without touching source, which capability each control needs, and
what is **not** yet manageable from the dashboard.

## Surfaces that write content

| Surface | What it edits | Capability to open | Capability to write | Where it goes |
| --- | --- | --- | --- | --- |
| **Website Content** (`website_cms`) | The whole public page document: hero, about, vision and contact copy, block visibility, header and footer links, socials, share-card text, image slots, and the publish / roll back controls | `cms.content.write` | `cms.settings.global` to write, `cms.content.publish` to publish | `ESME_CU_STATE_V2_websiteContent`, plus `publishedContent` and `contentRevisions` on publish |
| **Media Library** (`media_library`) | Upload, describe, search, replace and delete the pictures the image slots can point at; shows which slot uses each file | `cms.media.manage` | `cms.media.manage` | `ESME_CU_STATE_V2_mediaAssets` |
| **Registration Form** (inside `applications`) | The applicant questionnaire: field labels, options, required flags, order. Ships with the short signup on — Full Name, University Email, an optional committee preference and the agreement — every other field present but switched off | `registrations.read` | `cms.settings.global` | `ESME_CU_STATE_V2_formFields` |
| **Committees** (`committees`) | Name, acronym, description/scope, category, objectives, sub-teams, public listing, leadership seats, roster | `committees.read` | `committees.write` / `committees.archive` | `ESME_CU_STATE_V2_committees` |
| **Season Planner** (`season_planner`) | Milestones: title, dates, owner committee, status | `events.read` | `events.write` | `ESME_CU_STATE_V2_seasonEvents` |
| **Settings & Backups** (`settings`) | Theme, local cache reset, JSON export/import of this device's data | `settings.manage` | per action | storage keys above |

The website surface writes one **content document** (`documentVersion: 2`), not four loose groups.
Besides the text it now carries `sections` (which blocks the page publishes, in which order),
`navigation` and `footer.links`, `socials`, `sharing` (the title and description a pasted link
shows), and `images` — one slot per image the page can draw. [`src/domain/cms.ts`](../src/domain/cms.ts)
owns that shape, the validation rules and the slot list; the store calls it on every write, so a
request that skips the editor is held to the same rules as the form. The editor exposes all of it;
the files a slot can name are managed on the separate [media library screen](#the-media-library-screen).

Every write above also appends an audit line through `logAction`, so the trail records who
changed what, not just that the page re-rendered.

## Draft, save, publish

Saving a content change writes the **draft** (`ESME_CU_STATE_V2_websiteContent`) and reports that:
*"Draft saved in this browser."* Publishing is a separate action with a separate capability.

| Action | Store method | Capability | What it writes |
| --- | --- | --- | --- |
| Edit the copy | `updateWebsiteContent` | `cms.settings.global` | the draft only |
| Publish | `publishWebsiteContent(label)` | `cms.content.publish` | the live document + one revision row |
| Roll back | `restoreContentRevision(id)` | `cms.content.publish` | the live document + a new revision row |
| Discard | `discardWebsiteDraft` | `cms.settings.global` | the draft, reset to the live document |

The rules the store enforces, all of them in [`src/domain/publishing.ts`](../src/domain/publishing.ts):

- **A refused publish changes nothing.** The draft is validated before it is promoted, so a document
  that breaks a content rule — or is not a page document at all — leaves the live page exactly as it
  was. Publishing what already matches the live page is refused instead of filing an empty revision.
- **Every publish is attributable.** A revision row holds the actor id and name, the instant, the
  label the operator typed and the field paths that moved (`hero.headline`, not "the page changed").
  A roll back is filed as a **new** entry and names the revision it came from; the history it
  overwrote stays listed, so "who published what, when" remains answerable after a restore.
- **History is capped at 50 and says so.** `MAX_REVISIONS` trims from the oldest end and the publish
  returns a note naming how many were dropped, rather than quietly losing rows.
- **A slot that names a missing picture is reported, not refused.** `unresolvedSlots` lists the slots
  that will fall back to the asset shipped with the build, and the audit line carries that list.
- **The clock and the id come from the caller.** The domain layer reads no `Date.now()`, so a retry
  cannot invent a second revision on its own.

One thing this does **not** mean. There is still no publishing channel to the internet — the live
document is this browser's storage, and the site has no deploy to make, so publishing changes what
this device serves, not what a visitor elsewhere sees until a bundle is shipped by whatever channel
the chapter picks. The editor states this in its own header rather than letting "Publish live page"
imply a deploy.

## The editor screen

`WebsiteCMS.tsx` (nav id `website_cms`, opened from the sidebar or the "Edit Website" quick action)
holds one local draft and nine tabs: Hero, About, Vision, Contact, Share card, Blocks, Links,
Images and History. Panels live in [`src/components/dashboard/cms/`](../src/components/dashboard/cms)
— `CopyPanels.tsx`, `StructurePanels.tsx`, `ImagesPanel.tsx`, `HistoryPanel.tsx` over the shared
controls in `fields.tsx`.

- **Typing is not saving.** The draft lives in the screen until Save writes it through
  `updateWebsiteContent`, so a half-typed sentence never counts as a published change.
- **Publish is gated on a save**, with the reason printed next to the disabled control: publish
  promotes what is stored, and the store reads the draft it holds, not the keystrokes in this form.
- **The validator runs while you type.** `validateContentDocument` is called on the live draft, so a
  link the page will not follow is named before the save, and Save reports how many fields it
  adjusted rather than silently rewriting them.
- **The whole form is a disabled `<fieldset>` without `cms.settings.global`**, and the header states
  which capability is missing. A Head can write the copy; only `cms.content.publish` publishes.
- **Blocks are switches over `sections[].visible`, and the Images tab is a picker over
  `FIXED_IMAGE_SLOTS`** — each slot shows what it points at, lets the alt and caption be written on
  the slot, and can be released back to the asset shipped with the build (which keeps the words and
  moves only the picture).
- **History shows the live page, the revision it came from, and every entry since**, with restore
  disabled for a role that cannot publish. "Open the live page" leaves the editor without pretending
  to be a preview of unsaved work.

## The media library screen

`MediaLibrary.tsx` (nav id `media_library`, group "Public Channels & Content") is where the files a
slot can name are filed. Opening it needs `cms.media.manage`, which Super Admin and the IT Moderator
hold; a Director or Head still chooses among what the library answers with inside the Images tab, and
that tab prints a link to this screen only for a role that can actually upload.

- **The file is read, not trusted.** The first sixteen bytes are sniffed for a PNG / JPEG / WebP / GIF
  signature and must agree with the type the browser was told, so a PDF renamed to `.png` is refused
  in words ("Rename is not a conversion") before any row exists. Over 5 MB is refused, and an SVG is
  refused outright because it can carry scripts — the logo stays a bundled asset.
- **Nothing is filed until the picture is described.** The dialog requires a description or the
  "it is decoration" switch, prints the rule it is applying as you type, and keeps Add disabled until
  the upload passes `validateUpload`. The browser's measured pixel size is stored when it will decode
  the file; when it will not, the row simply carries no dimensions.
- **A row describes a file; it is not the file.** Uploads are stored with a `blob:` address and marked
  `deviceOnly`, because no asset store is connected. Reload the tab and the row stays while the bytes
  do not, so the card says "these bytes did not survive a reload" instead of showing a broken image.
- **Every card prints who uses it** — `usageOf` over both the live document and the draft, so a
  Director's unpublished choice blocks a deletion that would only be discovered at the next publish.
- **Delete answers with a reason, in a modal, never `window.confirm`.** `decideDelete` allows it only
  for a library row no slot points at; the protected logo, an asset that ships with the build, and an
  in-use picture each name the rule that stopped it and offer no confirm button.
- **Replace keeps the id.** Slots name an asset by id, so swapping the bytes under one row moves the
  picture everywhere it is used and orphans nothing; the previous `blob:` address is released.
- Search covers name, description, caption and type; the filters separate bundled assets, uploads, and
  what only this device holds. All three store methods are guarded by `cms.media.manage`, and each
  appends a line to the audit trail. Without the capability the grid renders read-only and the
  provider refuses the call regardless of what the screen shows.

## What the public page reads

[`src/components/PublicWebsite.tsx`](../src/components/PublicWebsite.tsx) takes its copy from
`publishedContent` and never looks at the draft, so an unfinished edit cannot reach a visitor. From
the live document it takes:

- the hero, about, vision and contact copy, the counters and the socials an operator listed;
- `navigation` — the header and the mobile menu print exactly the links that are visible, and a link
  pointing at a block that is switched off is dropped too;
- `sections[].visible` — a block switched off is **not rendered**, not hidden with CSS, so its copy
  does not sit in the page source;
- `footer.blurb`, `footer.copyright` and `footer.links`;
- `images` — each slot resolves through `resolveImage` against the bundled assets plus this device's
  library, and falls back to the shipped asset when the slot names a picture that is not here;
- `sharing.title` / `sharing.description` / the `sharing.ogImage` slot, written into `document.title`
  and the `description` / `og:title` / `og:description` / `og:image` tags while the page is mounted.

One limit worth stating: `sections[].order` is stored, validated and published, but the page still
draws its blocks in source order. Reordering the JSX would mean restructuring the component, and it
is recorded below as unfinished rather than implied.

## Server-side content model (authored, not yet wired)

`0001_schema.sql` already defines the tables a real CMS needs:

- `esme_content_pages` + `esme_content_revisions` — page bodies with saved history,
- `esme_settings` — global key/value site settings,
- `esme_media` — the media inventory,
- `esme_registration_fields` — the questionnaire schema.

None of these tables is what the screens write to. Content editing and the media library live in the
store above — the library screen files rows into this browser, not into `esme_media` — and migrating
them is the first item in [DATABASE_AND_MIGRATIONS.md](DATABASE_AND_MIGRATIONS.md).

## What cannot be managed from the CMS yet

Recording these as gaps rather than implying coverage:

1. **Asset store.** The library screen exists, but it stores descriptions of files, not the files: an
   upload's bytes live behind a `blob:` address in the tab that picked them, so `deviceOnly` rows are
   invisible to every other browser and nothing is shared with a colleague's machine. The screen states
   this on each row rather than implying an upload went anywhere. `esme_media` is the table a real
   provider would fill; until then the library also has no way to edit a description after filing
   (replacing the file re-describes it) and no crop beyond the `focal` field the domain carries.
2. **Deploy channel.** Publishing changes the document this browser serves. Nothing pushes the built
   bundle anywhere, so "published" is not "live on the internet", and the editor says so in its own
   header rather than implying a deploy.
3. **Section order.** The Blocks tab switches blocks and keeps the stored `order` in step with what
   the page actually draws, but the page renders its blocks in source order; there is deliberately
   no drag handle for a sequence the page ignores.
4. **Redirects, announcement banners.** Still source constants.
5. **Arabic / bilingual content.** `WebsiteContentConfig` holds one English string per field;
   there is no second language column, and the dashboard assistant (Part 5 of the pending
   spec) has no content to read yet.

## Safety rules that apply to CMS writes

- **No HTML/JS injection.** Content fields are plain strings rendered as React text nodes;
  nothing in the CMS path calls `dangerouslySetInnerHTML`, and the server draft trigger stores
  text and arrays, not markup to interpret. If rich text is introduced, it must arrive as a
  structured document and be sanitised before storage — that work is not done yet.
- **Links are validated, not repaired.** `safeContentHref` accepts a fragment, a same-site path or
  an absolute http(s) URL and refuses everything else — `javascript:`, `data:`, a protocol-relative
  `//host`, a backslash path. A refused link is dropped from the document and named in the audit
  line, never rewritten into something the operator did not write.
- **Nothing is hidden by omission.** A section the document does not mention is published visible.
  Switching a block off is an explicit `visible: false`, so a truncated import cannot silently
  remove part of the public page. The same reasoning covers an upgrade: a cache written before the
  CMS had no field for `navigation`, `footer`, `socials` or `images`, and `upgradeContentDocument`
  fills those from the document the build ships — otherwise a returning device would lose its header
  links and footer copy, and the CMS would then present the loss as the operator's own unpublished
  edit. A group the cache does carry is left exactly as it is: `navigation: []` is a decision.
- **Authorization is checked in the store, not only in the form.** `guard()` throws before a
  mutation runs, so a request that skips the interface is refused the same way.
- **The ESME logo is protected.** It is a bundled asset and is not exposed to replacement or
  deletion from any content surface (`PROTECTED_ASSETS` in `src/domain/cms.ts` lists it, and no
  image slot offers it).
- **Stale writes are refused.** Content surfaces re-read from the store after saving, and
  committee edits additionally compare the `updatedAt` stamp.

## Adding a new managed field

1. Add it to the type in [`src/types/index.ts`](../src/types/index.ts) and to the reference
   default in [`src/data/referenceContent.ts`](../src/data/referenceContent.ts).
2. If the shape changes for stored rows, add a rewrite step in
   [`src/storage/migrations.ts`](../src/storage/migrations.ts) and bump `TARGET_VERSION` —
   returning visitors keep their data instead of repopulating from a new constant.
   **If the version has already shipped, do not rely on the bump.** `runStorageMigrations()`
   returns early when the stamp matches, so a step gated behind the sweep never reaches a device
   that recorded this version from an in-progress build — which is exactly how a browser kept the
   streamlined questionnaire with no academic questions and no High Board. Either bump to a version
   no build has ever stamped, or make the step idempotent and run it on a matching stamp too, the
   way `upgradeAcademicSignup` and `offerHighBoard` do: write only when a row actually changes, and
   refuse to touch a row the device set itself.
3. Read/write it through `AppContext` with a `guard()`; never let a component write storage
   directly.
4. Add the control to the matching surface, keep the label wording consistent with
   `WebsiteCMS.tsx`, and cover the round-trip (save → read back from storage → remount) in the
   committee-style integration test.
