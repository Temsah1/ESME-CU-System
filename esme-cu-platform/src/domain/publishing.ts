import type { WebsiteContentConfig } from '../types';
import { validateContentDocument } from './cms';

/**
 * Draft, live page, and the history between them.
 *
 * The CMS edits a draft; the public page renders the published document. Keeping the two apart is
 * what makes "preview before publishing" and "roll back" mean anything, and it is the reason a
 * refused publish leaves the live page exactly as it was. Nothing here reads a clock or invents an
 * id — the caller supplies both, so a retry cannot quietly produce a second revision.
 */

export type ContentRevision = {
  id: string;
  savedAt: string;
  actorId: string;
  actorName: string;
  label: string;
  /** The field paths this publish changed, as the page reads them. */
  changes: string[];
  document: WebsiteContentConfig;
};

/** How far the history goes back. The cap is reported when it trims, never applied in silence. */
export const MAX_REVISIONS = 50;

/** What a change list shows before it collapses into a count. */
export const MAX_CHANGE_PATHS = 40;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The paths where two documents disagree. A subtree that differs in more than one leaf is reported
 * once, at the deepest point still common to both, because an operator reads "hero" far better than
 * six lines about headline, supporting message and button.
 */
export function changedPaths(before: unknown, after: unknown, path = ''): string[] {
  if (before === after) return [];
  const bothObjects = isPlainObject(before) && isPlainObject(after);
  const bothArrays = Array.isArray(before) && Array.isArray(after);
  if (!bothObjects && !bothArrays) return [path === '' ? 'the whole document' : path];

  if (bothArrays) {
    const left = before as unknown[];
    const right = after as unknown[];
    if (left.length !== right.length) return [path === '' ? 'the whole document' : path];
    return left.flatMap((entry, index) => changedPaths(entry, right[index], `${path}[${index}]`));
  }

  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].sort().flatMap((key) => changedPaths(left[key], right[key], path === '' ? key : `${path}.${key}`));
}

export function documentsMatch(before: WebsiteContentConfig, after: WebsiteContentConfig): boolean {
  return changedPaths(before, after).length === 0;
}

/** The change list an operator reads, kept short enough to fit a row. */
export function summarizeChanges(paths: string[]): string {
  if (paths.length === 0) return 'No change';
  const shown = paths.slice(0, MAX_CHANGE_PATHS).join(', ');
  return paths.length > MAX_CHANGE_PATHS ? `${shown}, +${paths.length - MAX_CHANGE_PATHS} more` : shown;
}

export type PublishActor = { id: string; name: string };

export type PublishRequest = {
  draft: WebsiteContentConfig;
  published: WebsiteContentConfig;
  revisions: ContentRevision[];
  actor: PublishActor;
  /** The label the operator gives this publish; empty is allowed and reported as an unlabelled entry. */
  label: string;
  /** Supplied by the caller: this layer never reads a clock. */
  now: string;
  id: string;
};

export type PublishOutcome =
  | { ok: true; published: WebsiteContentConfig; revisions: ContentRevision[]; revision: ContentRevision; notes: string[] }
  | { ok: false; refusal: string };

/**
 * Promotes the draft to the live page. The draft is validated on the way, so a document hand-made
 * to skip the editor is held to the same rules as one typed into the form.
 */
export function publishDraft(request: PublishRequest): PublishOutcome {
  if (request.actor.id.trim() === '') return { ok: false, refusal: 'A publish must name the account that made it.' };
  if (request.id.trim() === '') return { ok: false, refusal: 'This publish was given no revision id, so it could not be recorded.' };
  if (request.now.trim() === '') return { ok: false, refusal: 'This publish was given no timestamp, so history could not order it.' };

  const { doc, notes, recognized } = validateContentDocument(request.draft);
  if (!recognized) {
    return { ok: false, refusal: 'The draft is not a readable page document, so the live page was left exactly as it is.' };
  }
  if (notes.length > 0) {
    return { ok: false, refusal: `Publish refused: ${notes.length} field(s) broke the content rules. ${notes.join(' ')}` };
  }
  if (documentsMatch(request.published, doc)) {
    return { ok: false, refusal: 'Nothing to publish — the draft matches the live page.' };
  }

  const revision: ContentRevision = {
    id: request.id,
    savedAt: request.now,
    actorId: request.actor.id,
    actorName: request.actor.name,
    label: request.label.trim(),
    changes: changedPaths(request.published, doc),
    document: doc,
  };

  const history = [revision, ...request.revisions];
  const trimmed = history.length > MAX_REVISIONS;
  return {
    ok: true,
    published: doc,
    revisions: trimmed ? history.slice(0, MAX_REVISIONS) : history,
    revision,
    notes: trimmed
      ? [`The history is kept to ${MAX_REVISIONS} entries, so the oldest ${history.length - MAX_REVISIONS} publish(es) were dropped.`]
      : [],
  };
}

export type RestoreRequest = {
  revisions: ContentRevision[];
  published: WebsiteContentConfig;
  revisionId: string;
  actor: PublishActor;
  now: string;
  id: string;
};

/**
 * Rolls the live page back to an earlier revision. The rollback is recorded as a new entry rather
 * than deleting the history that followed it — the same rule the reward ledger applies to a
 * correction, and the reason "who published what, when" stays answerable after a restore.
 */
export function restoreRevision(request: RestoreRequest): PublishOutcome {
  const target = request.revisions.find((revision) => revision.id === request.revisionId);
  if (!target) return { ok: false, refusal: 'That revision is not in this device history, so there is nothing to restore.' };

  const published = publishDraft({
    draft: target.document,
    published: request.published,
    revisions: request.revisions,
    actor: request.actor,
    label: `Restored the ${target.savedAt} publish${target.label === '' ? '' : ` (${target.label})`}`,
    now: request.now,
    id: request.id,
  });
  if (!published.ok) return published;
  return {
    ...published,
    notes: [`Restored from revision ${target.id}. ${target.savedAt} is still listed in the history.`, ...published.notes],
  };
}

/** A history row read back from storage; anything unreadable is dropped rather than half-trusted. */
export function normalizeRevisionRow(value: unknown): ContentRevision | null {
  if (!isPlainObject(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const savedAt = typeof value.savedAt === 'string' ? value.savedAt.trim() : '';
  if (id === '' || savedAt === '') return null;
  const upgrade = validateContentDocument(value.document);
  if (!upgrade.recognized) return null;
  const changes = Array.isArray(value.changes) ? value.changes.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_CHANGE_PATHS) : [];
  return {
    id,
    savedAt,
    actorId: typeof value.actorId === 'string' ? value.actorId : '',
    actorName: typeof value.actorName === 'string' ? value.actorName : '',
    label: typeof value.label === 'string' ? value.label.slice(0, 200) : '',
    changes,
    document: upgrade.doc,
  };
}

export function normalizeRevisionList(value: unknown): ContentRevision[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeRevisionRow).filter((row): row is ContentRevision => row !== null).slice(0, MAX_REVISIONS);
}

/**
 * Whether a slot names a picture the library can answer with. Publish is not refused for this: the
 * page falls back to the asset shipped with the build, and the note tells the operator which blocks
 * will show that fallback before anyone visits and wonders.
 */
export function unresolvedSlots(doc: WebsiteContentConfig, hasAsset: (assetId: string) => boolean): string[] {
  return Object.entries(doc.images ?? {})
    .filter(([, slot]) => typeof slot?.assetId === 'string' && slot.assetId !== '' && !hasAsset(slot.assetId))
    .map(([slotId]) => slotId);
}
