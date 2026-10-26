/** Raised when no provider is configured. Surfaced to the operator, never silently swallowed. */
export class AuthNotConfiguredError extends Error {
  readonly missingVariables: string[];

  constructor(missingVariables: string[]) {
    super(
      `No authentication provider is configured. Missing: ${missingVariables.join(', ')}. ` +
        'Production authentication cannot proceed until these are supplied.'
    );
    this.name = 'AuthNotConfiguredError';
    this.missingVariables = missingVariables;
  }
}

/**
 * The provider variables are present but cannot describe a working browser client — a URL that
 * carries a path, or a server-only key in the slot the bundle reads. Raised instead of letting a
 * misconfiguration surface as "those credentials did not match", which is what a bad Supabase URL
 * looks like from the sign-in screen.
 *
 * The message names the variable and the rule it broke. It never repeats a value: one of the two
 * failures this catches is a secret key, and this text can reach the screen and the audit trail.
 */
export class AuthMisconfiguredError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `The configured authentication provider cannot be used from a browser. ${problems.join(
        ' '
      )} Correct this in the environment before reading a rejected sign-in as bad credentials.`
    );
    this.name = 'AuthMisconfiguredError';
    this.problems = problems;
  }
}

/** Credential or session rejected. Message stays generic to avoid account enumeration. */
export class AuthFailedError extends Error {
  constructor(message = 'Those credentials did not match an existing account.') {
    super(message);
    this.name = 'AuthFailedError';
  }
}

/**
 * The credential was accepted and a provider session exists, but the chapter profile behind it
 * could not be resolved. Four different faults wear this one class because the sign-in screen has
 * to say which one happened: "no profile row", "the database refused to read it", "this deployment
 * has not been migrated yet" and "the database was not reachable" need different fixes, and
 * collapsing them into a revoked session — or into a request to find an administrator — sends the
 * reader after the wrong thing.
 *
 * `message` is safe to show. `providerDetail` is the raw text PostgREST returned: it can name a
 * table, a policy or a connection, so it belongs in a log, never on a screen.
 */
export class ProfileResolutionError extends Error {
  readonly reason: 'missing_profile' | 'access_denied' | 'not_migrated' | 'provider_unavailable';
  readonly providerDetail: string;
  /** True when the same read has already been retried, so the caller does not loop on a dead database. */
  readonly retryable: boolean;

  constructor(
    reason: ProfileResolutionError['reason'],
    providerDetail = '',
    retryable = reason !== 'missing_profile'
  ) {
    const messages: Record<ProfileResolutionError['reason'], string> = {
      missing_profile:
        'Your sign-in is valid, but this account has no chapter profile yet. Try signing in again; if it keeps happening, the profile-initialisation step in the deployment notes has to be run.',
      access_denied:
        'Your sign-in is valid, but the chapter database refused to read your profile. That is a security-policy or migration problem, not a wrong password.',
      not_migrated:
        'Your sign-in is valid, but this deployment is missing the database functions that read a chapter profile. Apply the migrations listed in the deployment notes, then sign in again.',
      provider_unavailable:
        'Your sign-in is valid, but the chapter could not reach its database to read your profile. Your session is kept — try again shortly.',
    };
    super(messages[reason]);
    this.name = 'ProfileResolutionError';
    this.reason = reason;
    this.providerDetail = providerDetail;
    this.retryable = retryable;
  }
}

/**
 * A live session whose server-side status is a sanction. Only `rejected` and `suspended` reach
 * this: a directory status that merely waits for a committee placement is not a revocation and
 * must not be reported as one.
 */
export class AccessRevokedError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`This account is ${status}, so its session is closed. An authorized reviewer has to change that status first.`);
    this.name = 'AccessRevokedError';
    this.status = status;
  }
}

export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 60) {
    super(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
