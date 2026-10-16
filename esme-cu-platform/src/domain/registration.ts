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
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
};

/**
 * Validation that must also run server-side. Returning a field-keyed map keeps the
 * error messages safe to show: nothing here reveals whether an email already exists.
 */
export function validateRegistration(input: RegistrationInput): Partial<Record<keyof RegistrationInput, string>> {
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

export const VERIFICATION_REQUIRED_MESSAGE =
  'Confirm your email address before an administrator can review your request.';

export type PendingRegistration = {
  role: typeof PUBLIC_REGISTRATION_ROLE;
  status: Extract<AccountStatus, 'pending_email_verification'>;
  emailVerified: false;
  capabilities: Capability[];
};

/**
 * What public registration actually produces. A pending applicant holds no
 * capabilities — approval is what assigns the `member` role.
 */
export function createPendingRegistration(): PendingRegistration {
  return {
    role: PUBLIC_REGISTRATION_ROLE,
    status: 'pending_email_verification',
    emailVerified: false,
    capabilities: [],
  };
}
