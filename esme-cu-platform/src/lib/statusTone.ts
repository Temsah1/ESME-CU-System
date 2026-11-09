/**
 * One colour treatment for every status an officer scans, in one place.
 *
 * The pairs are chosen for contrast at badge size, not for hue familiarity: a wash carries the
 * status at a glance and the ink on top of it is always the readable member of the pair — dark on
 * light, pale on dark — because a 15% wash plus text of the same hue lands near 2:1 and fails AA in
 * both themes. `warning` is the one hue with no readable ink of its own, so it borrows `text-ink`.
 *
 * Callers pass the raw domain string; nothing here knows what a status means, only how it reads.
 */
const TONES = {
  success: 'bg-success/15 text-success-ink border-success/30',
  info: 'bg-info/15 text-info border-info/30',
  warning: 'bg-warning/15 text-ink border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  neutral: 'bg-surface-muted text-ink-muted border-border-strong',
} as const;

type Tone = keyof typeof TONES;

const BY_STATUS: Record<string, Tone> = {
  active: 'success',
  approved: 'success',
  achieved: 'success',
  accepted: 'success',
  sent: 'success',
  delivered: 'success',
  completed: 'success',
  confirmed: 'success',
  bonus: 'success',
  pending_approval: 'info',
  pending: 'info',
  submitted: 'info',
  under_review: 'info',
  on_track: 'info',
  queued: 'info',
  assigned: 'info',
  in_progress: 'info',
  open: 'info',
  planned: 'info',
  in_preparation: 'info',
  planning: 'info',
  medium: 'info',
  at_risk: 'warning',
  revision_requested: 'warning',
  warning: 'warning',
  rejected: 'danger',
  refused: 'danger',
  denied: 'danger',
  failed: 'danger',
  overdue: 'danger',
  behind: 'danger',
  urgent: 'danger',
  high: 'danger',
  suspended: 'neutral',
  reversed: 'neutral',
  archived: 'neutral',
  cancelled: 'neutral',
  draft: 'neutral',
  suppressed: 'neutral',
  not_measurable: 'neutral',
  no_key_results: 'neutral',
  before_start: 'neutral',
  dropped: 'neutral',
  closed: 'neutral',
  waitlisted: 'neutral',
  low: 'neutral',
};

/** Domain strings arrive in three casings ('In Preparation', 'on_track', 'active'); fold them all. */
const key = (status: string) => status.trim().toLowerCase().replace(/\s+/g, '_');

export const statusTone = (status: string): string => TONES[BY_STATUS[key(status)] ?? 'neutral'];