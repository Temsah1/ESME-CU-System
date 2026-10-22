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
  constructor(message = 'Those credentials did not match an approved account.') {
    super(message);
    this.name = 'AuthFailedError';
  }
}

/** A live session whose server-side status no longer permits access. */
export class AccessRevokedError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`This session is no longer authorized (account status: ${status}).`);
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
