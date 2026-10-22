/**
 * The boundary between a draft someone is typing and a page a visitor reads.
 *
 * Two guarantees matter here: a publish that is refused must leave the live document untouched, and
 * a publish that succeeds must be attributable — who, when, which fields. Neither may depend on a
 * clock or a random id, so every case hands both in and asserts on what came back.
 */
import { describe, expect, it } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../data/referenceContent';
import type { WebsiteContentConfig } from '../types';
import { validateContentDocument } from './cms';
import {
  MAX_CHANGE_PATHS,
  MAX_REVISIONS,
  changedPaths,
  documentsMatch,
  normalizeRevisionList,
  publishDraft,
  restoreRevision,
  summarizeChanges,
  unresolvedSlots,
  type ContentRevision,
  type PublishRequest,
} from './publishing';

const fresh = (): WebsiteContentConfig => structuredClone(REFERENCE_WEBSITE_CONTENT);
const actor = { id: 'usr_admin', name: 'Kareem Tamer' };

function request(draft: WebsiteContentConfig, overrides: Partial<PublishRequest> = {}): PublishRequest {
  return {
    draft,
    published: fresh(),
    revisions: [],
    actor,
    label: 'Autumn refresh',
    now: '2026-10-19T09:00:00.000Z',
    id: 'rev_first',
    ...overrides,
  };
}

function revisionOf(id: string, document: WebsiteContentConfig, savedAt: string): ContentRevision {
  return { id, savedAt, actorId: actor.id, actorName: actor.name, label: '', changes: [], document };
}

describe('the change list', () => {
  it('names the field that moved rather than the page around it', () => {
    const draft = fresh();
    draft.hero.headline = 'Registration is open until 30 November';
    expect(changedPaths(fresh(), draft)).toEqual(['hero.headline']);
  });

  it('reports a replaced subtree once, at the deepest point both documents still share', () => {
    const draft = fresh();
    draft.socials = [];
    expect(changedPaths(fresh(), draft)).toEqual(['socials']);
  });

  it('walks into a list when only one entry moved', () => {
    const before = fresh();
    const after = fresh();
    after.sections[1].visible = !after.sections[1].visible;
    expect(changedPaths(before, after)).toEqual(['sections[1].visible']);
  });

  it('says nothing changed when both documents hold the same page', () => {
    expect(changedPaths(fresh(), fresh())).toEqual([]);
    expect(documentsMatch(fresh(), fresh())).toBe(true);
  });

  it('keeps a long list short enough to fit one audit row', () => {
    const paths = Array.from({ length: MAX_CHANGE_PATHS + 5 }, (_, index) => `field${index}`);
    expect(summarizeChanges(paths)).toMatch(/, \+5 more$/);
    expect(summarizeChanges([])).toBe('No change');
    expect(summarizeChanges(['hero.headline'])).toBe('hero.headline');
  });
});

describe('publishing a draft', () => {
  it('promotes the page and files who published it under what changed', () => {
    const draft = fresh();
    draft.hero.headline = 'Now training the 2026 cohort';

    const outcome = publishDraft(request(draft));
    if (!outcome.ok) throw new Error(`publish refused: ${outcome.refusal}`);

    expect(outcome.published.hero.headline).toBe('Now training the 2026 cohort');
    expect(outcome.revision).toMatchObject({
      id: 'rev_first',
      savedAt: '2026-10-19T09:00:00.000Z',
      actorId: actor.id,
      actorName: actor.name,
      label: 'Autumn refresh',
      changes: ['hero.headline'],
    });
    expect(outcome.revisions[0].id).toBe('rev_first');
    expect(outcome.notes).toEqual([]);
  });

  it('writes nothing when the draft is the page already on the internet', () => {
    const outcome = publishDraft(request(fresh()));
    expect(outcome).toEqual({ ok: false, refusal: expect.stringMatching(/Nothing to publish/) });
  });

  it('refuses a draft that broke a content rule instead of publishing half of it', () => {
    const draft = fresh();
    draft.navigation = [{ id: 'nav_deal', label: 'Free course', href: 'javascript:alert(1)', visible: true }];

    const outcome = publishDraft(request(draft));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toMatch(/broke the content rules/);
  });

  it('refuses a body that is not a page document at all rather than shipping a blank site', () => {
    const outcome = publishDraft(request({ note: 'someone posted this into the wrong field' } as unknown as WebsiteContentConfig));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toMatch(/not a readable page document/);
  });

  it('refuses a publish it could not attribute or order', () => {
    const draft = fresh();
    draft.footer.copyright = '© 2027 ESME CU Chapter.';
    expect(publishDraft(request(draft, { actor: { id: '   ', name: 'Anonymous' } }))).toMatchObject({ ok: false });
    expect(publishDraft(request(draft, { id: '' }))).toMatchObject({ ok: false });
    expect(publishDraft(request(draft, { now: '' }))).toMatchObject({ ok: false });
  });

  it('trims the oldest publishes to the cap and says how many went', () => {
    const draft = fresh();
    draft.about.story = 'A shorter story than the one shipped.';
    const history = Array.from({ length: MAX_REVISIONS }, (_, index) =>
      revisionOf(`rev_old_${index}`, fresh(), `2025-01-0${(index % 9) + 1}T09:00:00.000Z`)
    );

    const outcome = publishDraft(request(draft, { revisions: history, id: 'rev_new' }));
    if (!outcome.ok) throw new Error(`publish refused: ${outcome.refusal}`);

    expect(outcome.revisions).toHaveLength(MAX_REVISIONS);
    expect(outcome.revisions[0].id).toBe('rev_new');
    expect(outcome.revisions.some((entry) => entry.id === 'rev_old_49')).toBe(false);
    expect(outcome.revisions.some((entry) => entry.id === 'rev_old_0')).toBe(true);
    expect(outcome.notes.join(' ')).toMatch(/oldest 1 publish\(es\) were dropped/);
  });
});

describe('rolling the live page back', () => {
  it('restores an earlier page as a new entry and keeps the history it overwrote', () => {
    const oldPage = fresh();
    oldPage.hero.headline = 'What the page said before';
    const live = fresh();
    live.hero.headline = 'What it says now';
    const history = [revisionOf('rev_live', live, '2026-10-19T09:00:00.000Z'), revisionOf('rev_old', oldPage, '2026-09-01T09:00:00.000Z')];

    const outcome = restoreRevision({
      revisions: history,
      published: live,
      revisionId: 'rev_old',
      actor,
      now: '2026-10-20T09:00:00.000Z',
      id: 'rev_rollback',
    });
    if (!outcome.ok) throw new Error(`restore refused: ${outcome.refusal}`);

    expect(outcome.published.hero.headline).toBe('What the page said before');
    expect(outcome.revisions).toHaveLength(3);
    expect(outcome.revisions.map((entry) => entry.id)).toEqual(['rev_rollback', 'rev_live', 'rev_old']);
    expect(outcome.revision.label).toMatch(/^Restored the 2026-09-01/);
    expect(outcome.notes.join(' ')).toMatch(/still listed in the history/);
  });

  it('refuses a revision id this device does not hold', () => {
    const live = fresh();
    const outcome = restoreRevision({
      revisions: [revisionOf('rev_live', live, '2026-10-19T09:00:00.000Z')],
      published: live,
      revisionId: 'rev_from_another_browser',
      actor,
      now: '2026-10-20T09:00:00.000Z',
      id: 'rev_rollback',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toMatch(/nothing to restore/);
  });

  it('refuses a rollback that would put the page exactly where it already is', () => {
    const live = fresh();
    const outcome = restoreRevision({
      revisions: [revisionOf('rev_live', live, '2026-10-19T09:00:00.000Z')],
      published: live,
      revisionId: 'rev_live',
      actor,
      now: '2026-10-20T09:00:00.000Z',
      id: 'rev_rollback',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal).toMatch(/Nothing to publish/);
  });
});

describe('history read back from storage', () => {
  it('keeps the rows it can render and drops the ones it cannot', () => {
    const stored = [
      { id: 'rev_a', savedAt: '2026-10-19T09:00:00.000Z', actorId: actor.id, actorName: actor.name, label: 'Autumn refresh', changes: ['hero.headline'], document: fresh() },
      { id: 'rev_b', savedAt: '2026-10-18T09:00:00.000Z', document: { note: 'not a page' } },
      { savedAt: '2026-10-17T09:00:00.000Z', document: fresh() },
      { id: 'rev_d', document: fresh() },
      'a string that was never a revision',
    ];

    const rows = normalizeRevisionList(stored);
    expect(rows.map((entry) => entry.id)).toEqual(['rev_a']);
    expect(rows[0].changes).toEqual(['hero.headline']);
    expect(normalizeRevisionList(undefined)).toEqual([]);
  });

  it('never reads back more history than the cap', () => {
    const rows = Array.from({ length: MAX_REVISIONS + 20 }, (_, index) => ({
      id: `rev_${index}`,
      savedAt: `2026-01-01T09:00:0${index % 9}.000Z`,
      document: fresh(),
    }));
    expect(normalizeRevisionList(rows)).toHaveLength(MAX_REVISIONS);
  });
});

describe('image slots against the library', () => {
  it('names the slots that point at a picture this device no longer holds', () => {
    const draft = fresh();
    draft.images['home.heroCard'] = { assetId: 'media_deleted' };
    draft.images['about.campus'] = { assetId: 'media_held' };

    expect(unresolvedSlots(draft, (id) => id === 'media_held')).toEqual(['home.heroCard']);
    expect(unresolvedSlots(draft, () => false)).toEqual(['home.heroCard', 'about.campus']);
    expect(unresolvedSlots(draft, () => true)).toEqual([]);
  });

  it('leaves a slot that only carries alt text alone', () => {
    const draft = fresh();
    draft.images['events.cover'] = { alt: 'Students at the information fair' };
    expect(unresolvedSlots(draft, () => false)).toEqual([]);
  });

  it('publishes a page whose shipped copy is clean', () => {
    expect(validateContentDocument(fresh())).toEqual({ doc: expect.any(Object), notes: [], recognized: true });
  });
});
