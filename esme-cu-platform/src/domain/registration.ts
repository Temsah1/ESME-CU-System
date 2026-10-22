import { PUBLIC_REGISTRATION_ROLE, type Capability } from './roles';
import type { AccountStatus } from './accountState';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export type PasswordCheck = { id: string; label: string; passed: boolean };

export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, passed: password.length >= PASSWORD_MIN_LENGTH },
    { id: 'max', label: `No more than ${PASSWORD_MAX_LENGTH} characters`, passed: password.length <= PASSWORD_MAX_LENGTH },
    { id: 'lower', label: 'One lowercase letter', passed: /[a-z]/.test(password) },
    { id: 'upper', label: 'One uppercase letter', passed: /[A-Z]/.test(password) },
    { id: 'digit', label: 'One number', passed: /\d/.test(password) },
    { id: 'symbol', label: 'One symbol', passed: /[^A-Za-z0-9]/.test(password) },
  ];
}

/** Common leaks and identity-derived guesses are rejected before length checks run. */
const BLOCKED_SECRETS = [
  'esme2026', 'esme2027', 'esmecairo', 'esmecu', 'password', 'passw0rd', 'qwertyuiop',
  'letmein', 'welcome1', 'chapter2026', 'student1', '1234567890',
];

export function validatePassword(password: string): string[] {
  const failures = passwordChecks(password).filter((c) => !c.passed).map((c) => c.label);
  const lowered = password.toLowerCase();
  if (BLOCKED_SECRETS.some((s) => lowered.includes(s))) {
    failures.push('Not based on a common or chapter-related word');
  }
  return failures;
}

export function isPasswordAcceptable(password: string): boolean {
  return validatePassword(password).length === 0;
}

export type RegistrationInput = {
  fullName: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  committeeId?: string;
  acceptedPolicies: boolean;
  studentId?: string;
  academicYear?: string;
  department?: string;
  phone?: string;
  /** Whether the applicant already belongs to a committee. Drives the committee question below. */
  committeeMembership?: string;
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
};

export type CommitteeMembershipAnswer = 'yes' | 'no';

/** The two answers the membership question accepts, and the non-member value it must leave behind. */
export const COMMITTEE_MEMBERSHIP_VALUES: readonly CommitteeMembershipAnswer[] = ['yes', 'no'];

export function isCommitteeMembershipAnswer(value: unknown): value is CommitteeMembershipAnswer {
  return value === 'yes' || value === 'no';
}

/**
 * A stale committee must never survive a "no". An applicant who picked a committee, then said they
 * do not belong to one, is recorded as a non-member — the committee selector is what the answer
 * controls, not the other way round.
 */
export function resolveCommitteeAnswer(
  membership: string | undefined,
  committeeId: string | undefined
): string | undefined {
  if (membership !== 'no') return committeeId;
  return committeeId ? undefined : committeeId;
}

/**
 * A field row as validation needs to see it. `options` is what the form actually offered, so a
 * committee list built from live data validates the same way a fixed list does.
 */
export type RegistrationFieldSpec = {
  name: string;
  required: boolean;
  enabled: boolean;
  options?: string[];
};

/** The form renders by control name and validates by input key; three of them differ. */
const INPUT_KEY_BY_CONTROL: Record<string, keyof RegistrationInput> = {
  universityEmail: 'email',
  agreedToPolicies: 'acceptedPolicies',
  preferredCommitteeId: 'committeeId',
};

export function inputKeyForControl(name: string): keyof RegistrationInput {
  return INPUT_KEY_BY_CONTROL[name] ?? (name as keyof RegistrationInput);
}

const REQUIRED_MESSAGE: Record<string, string> = {
  department: 'Choose your department.',
  academicYear: 'Choose your academic year.',
  committeeMembership: 'Tell us whether you already belong to a committee.',
  preferredCommitteeId: 'Choose the committee you belong to.',
};

/**
 * Validation that must also run server-side. Returning a field-keyed map keeps the
 * error messages safe to show: nothing here reveals whether an email already exists.
 *
 * `fields` is the schema the form rendered from. Passing it makes required-ness the schema's
 * decision rather than a second hard-coded list, and validates each answer against the options
 * that were really offered — so an operator who turns a question off, or renames a committee,
 * changes the rules without a code change. Without it, only the rules the answers carry by
 * themselves run, which is what the provider-side call gets.
 */
export function validateRegistration(
  input: RegistrationInput,
  fields?: RegistrationFieldSpec[]
): Partial<Record<keyof RegistrationInput, string>> {
  const errors: Partial<Record<keyof RegistrationInput, string>> = {};

  if (input.fullName.trim().length < 3) errors.fullName = 'Enter your full name as it appears in chapter records.';
  if (!EMAIL_PATTERN.test(normalizeEmail(input.email))) errors.email = 'Enter a valid email address.';
  if (!USERNAME_PATTERN.test(normalizeUsername(input.username))) {
    errors.username = 'Use 3–30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.';
  }

  const passwordFailures = validatePassword(input.password);
  if (passwordFailures.length > 0) errors.password = `Password needs: ${passwordFailures.join(', ').toLowerCase()}.`;
  if (input.confirmPassword !== input.password) errors.confirmPassword = 'Passwords do not match.';

  if (!input.acceptedPolicies) errors.acceptedPolicies = 'Accept the privacy policy and terms to continue.';

  // A row is only skipped when the schema explicitly switched it off: a spec that leaves the flag
  // out must not silently stop being validated.
  const asked = new Map(
    (fields ?? []).filter((f) => f.enabled !== false).map((f) => [f.name, f] as const)
  );

  for (const field of asked.values()) {
    const key = inputKeyForControl(field.name);
    const answer = input[key];
    const empty = typeof answer === 'boolean' ? !answer : !(typeof answer === 'string' && answer.trim() !== '');
    if (field.required && empty) {
      errors[key] = REQUIRED_MESSAGE[field.name] ?? 'Answer this question.';
      continue;
    }
    if (!empty && field.options && field.options.length > 0 && typeof answer === 'string' && !field.options.includes(answer)) {
      errors[key] = 'Choose one of the options offered.';
    }
  }

  if (input.committeeMembership !== undefined && !isCommitteeMembershipAnswer(input.committeeMembership)) {
    errors.committeeMembership = 'Answer yes or no.';
  }

  // The requirement travels with the answer, so it holds on the trusted side too: someone who says
  // they belong to a committee has to say which one. With the committee row switched off, or with
  // nothing open to choose, there is no selector to answer with and the rule cannot apply.
  if (isCommitteeMembershipAnswer(input.committeeMembership) && input.committeeMembership === 'yes') {
    const committeeRow = asked.get('preferredCommitteeId');
    const canAsk = !fields || ((committeeRow?.options?.length ?? 0) > 0) || !asked.size;
    if (!input.committeeId && canAsk) errors.committeeId = REQUIRED_MESSAGE.preferredCommitteeId;
  }

  // One committee, one seat. A second preference naming the same committee is not a second choice.
  if (
    input.committeeId &&
    input.secondCommitteePreferenceId &&
    input.committeeId === input.secondCommitteePreferenceId
  ) {
    errors.secondCommitteePreferenceId = 'Choose a different committee as the second preference.';
  }

  return errors;
}

export function hasRegistrationErrors(
  errors: Partial<Record<keyof RegistrationInput, string>>
): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Duplicate detection lives here so both adapters share one rule. The caller passes
 * a predicate because the source of truth is the provider or database, never the browser.
 */
export function findDuplicateIdentity(
  email: string,
  username: string,
  exists: (field: 'email' | 'username', value: string) => boolean | Promise<boolean>
): 'email' | 'username' | null {
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  if (exists('email', normalizedEmail) === true) return 'email';
  if (exists('username', normalizedUsername) === true) return 'username';
  return null;
}

/** Deliberately vague so a failed attempt cannot confirm that an account exists. */
export const DUPLICATE_IDENTITY_MESSAGE =
  'Please review the details you entered. If this account already exists, use the login page or reset your password.';

/**
 * Nobody proves they own the address at signup any more, so the queue is protected by refusing
 * repeat submissions instead of by waiting for a click. One device or one address may file a
 * handful of requests per window; beyond that the request is refused before anything is written.
 */
export const SUBMISSION_WINDOW_MINUTES = 15;
export const MAX_SUBMISSIONS_PER_WINDOW = 5;

export function submissionThrottleBlocked(
  priorSubmissions: string[],
  now: string,
  limit = MAX_SUBMISSIONS_PER_WINDOW,
  windowMinutes = SUBMISSION_WINDOW_MINUTES
): boolean {
  const then = new Date(now).getTime() - windowMinutes * 60_000;
  if (!Number.isFinite(then)) return false;
  return (
    priorSubmissions.filter((stamp) => {
      const at = new Date(stamp).getTime();
      return Number.isFinite(at) && at > then;
    }).length >= limit
  );
}

export type PendingRegistration = {
  role: typeof PUBLIC_REGISTRATION_ROLE;
  status: Extract<AccountStatus, 'pending_approval'>;
  capabilities: Capability[];
};

/**
 * What public registration actually produces. A pending applicant holds no
 * capabilities — approval is what activates the `member` account.
 */
export function createPendingRegistration(): PendingRegistration {
  return {
    role: PUBLIC_REGISTRATION_ROLE,
    status: 'pending_approval',
    capabilities: [],
  };
}

/**
 * What the streamlined signup retired, keyed by the field name the questionnaire answers use.
 *
 * `from` is what the schema shipped for that field before this change, and `to` is what it ships
 * now. A device that stored the schema keeps its own decision: a row this browser had already set
 * some other way — an operator who switched Student ID off months ago, or one who made the
 * committee question mandatory — is left exactly as it was, because the migration is allowed to
 * correct what the build shipped, not to overwrite a choice somebody made.
 */
export const STREAMLINED_SIGNUP_FIELDS: Record<
  string,
  { from: { required: boolean; enabled: boolean }; to: { required: boolean; enabled: boolean } }
> = {
  studentId: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
  academicYear: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
  department: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
  phone: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
  preferredCommitteeId: { from: { required: true, enabled: true }, to: { required: false, enabled: true } },
  secondCommitteePreferenceId: { from: { required: false, enabled: true }, to: { required: false, enabled: false } },
  technicalSkills: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
  previousExperience: { from: { required: false, enabled: true }, to: { required: false, enabled: false } },
  motivation: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
  availabilityHours: { from: { required: true, enabled: true }, to: { required: false, enabled: false } },
};

export function upgradeRegistrationFieldSchema(rows: unknown[]): {
  rows: unknown[];
  switchedOff: string[];
  madeOptional: string[];
  kept: string[];
} {
  const switchedOff: string[] = [];
  const madeOptional: string[] = [];
  const kept: string[] = [];

  const next = rows.map((row) => {
    if (typeof row !== 'object' || row === null) return row;
    const field = row as { name?: unknown; required?: unknown; enabled?: unknown };
    if (typeof field.name !== 'string') return row;
    const change = STREAMLINED_SIGNUP_FIELDS[field.name];
    if (!change) return row;

    const at = { required: field.required === true, enabled: field.enabled === true };
    if (at.required === change.to.required && at.enabled === change.to.enabled) return row;
    if (at.required !== change.from.required || at.enabled !== change.from.enabled) {
      kept.push(field.name);
      return row;
    }

    // A field the form no longer shows and a field it still shows without demanding an answer are
    // different changes, and the operator is told about them differently.
    (change.to.enabled ? madeOptional : switchedOff).push(field.name);
    return { ...field, required: change.to.required, enabled: change.to.enabled };
  });

  return { rows: next, switchedOff, madeOptional, kept };
}

/**
 * What the academic questions put back on a device that last saw the streamlined signup.
 *
 * Same discipline as `STREAMLINED_SIGNUP_FIELDS`: `from` is what that build shipped, so only a row
 * still sitting there gets changed. An operator who had already switched Academic Year back on, or
 * who left Department off on purpose, keeps their own setting.
 */
export const ACADEMIC_SIGNUP_FIELDS: Record<
  string,
  { from: { required: boolean; enabled: boolean }; to: { required: boolean; enabled: boolean } }
> = {
  academicYear: { from: { required: false, enabled: false }, to: { required: true, enabled: true } },
  department: { from: { required: false, enabled: false }, to: { required: true, enabled: true } },
};

/**
 * Brings a cached questionnaire up to the academic signup.
 *
 * Three separate jobs, each with its own rule about whose decision it may touch:
 *
 * - `turnedOn` — the two academic questions come back on and required, but only on a row still
 *   sitting at what the streamlined build shipped. An operator who had already switched Academic
 *   Year back on, or left Department off on purpose, keeps their setting.
 * - `relabelled` — the label and the option list are replaced from `shipped`, because the Form
 *   Schema screen only ever edits required/enabled, so anything else a cached row says is what some
 *   earlier build wrote, not something anybody chose.
 * - `added` — a question this device has never been offered is inserted, taking the committee
 *   question's place in the order and pushing everything from there on back one. The committee
 *   selector only appears once the membership question is answered, so an order that put the answer
 *   after the question it controls would render the form inside out.
 */
export function upgradeAcademicSignupSchema(rows: unknown[], shipped: Record<string, unknown>): {
  rows: unknown[];
  turnedOn: string[];
  relabelled: string[];
  added: string[];
  kept: string[];
} {
  const turnedOn: string[] = [];
  const relabelled: string[] = [];
  const kept: string[] = [];

  const nameOf = (row: unknown): string | null => {
    if (typeof row !== 'object' || row === null) return null;
    const name = (row as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  };

  let next = rows.map((row) => {
    const name = nameOf(row);
    if (name === null) return row;
    const update = shipped[name] as
      | { label?: unknown; options?: unknown; required?: unknown; enabled?: unknown }
      | undefined;
    if (!update) return row;

    const field = row as { label?: unknown; options?: unknown; required?: unknown; enabled?: unknown };
    const out: Record<string, unknown> = { ...field };
    const sameList = (a: unknown, b: unknown) =>
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

    if (typeof update.label === 'string' && field.label !== update.label) {
      out.label = update.label;
      relabelled.push(name);
    }
    if (update.options !== undefined && !sameList(out.options ?? field.options, update.options)) {
      out.options = update.options;
      if (!relabelled.includes(name)) relabelled.push(name);
    }

    const change = ACADEMIC_SIGNUP_FIELDS[name];
    if (change) {
      const at = { required: field.required === true, enabled: field.enabled === true };
      if (at.required === change.to.required && at.enabled === change.to.enabled) return out;
      if (at.required !== change.from.required || at.enabled !== change.from.enabled) {
        kept.push(name);
        return out;
      }
      turnedOn.push(name);
      out.required = change.to.required;
      out.enabled = change.to.enabled;
    }
    return out;
  });

  const add = Object.values(shipped).filter((row) => {
    const name = nameOf(row);
    return name !== null && !next.some((existing) => nameOf(existing) === name);
  }) as { name?: unknown; order?: unknown }[];

  for (const row of add) {
    const order = typeof row.order === 'number' ? row.order : Number.MAX_SAFE_INTEGER;
    next = next.map((existing) => {
      if (typeof existing !== 'object' || existing === null) return existing;
      const field = existing as { order?: unknown };
      return typeof field.order === 'number' && field.order >= order ? { ...field, order: field.order + 1 } : existing;
    });
    const committeeAt = next.findIndex((existing) => nameOf(existing) === 'preferredCommitteeId');
    const insertAt = committeeAt >= 0 ? committeeAt : next.length;
    next = [...next.slice(0, insertAt), row, ...next.slice(insertAt)];
  }

  return { rows: next, turnedOn, relabelled, added: add.map((row) => String(row.name)), kept };
}
