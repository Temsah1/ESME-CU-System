import { capabilitiesFor } from '../domain/roles';
import { canAccessErp, repairStoredStatus } from '../domain/accountState';
import { normalizeEmail, normalizeUsername, validatePassword, DUPLICATE_IDENTITY_MESSAGE } from '../domain/registration';
import { emptyTestAccountReport, testAccountSeedRefusal } from '../domain/testAccounts';
import { AccessRevokedError, AuthFailedError, AuthMisconfiguredError, AuthNotConfiguredError, ProfileResolutionError, RateLimitedError } from './errors';
import type {
  AuthAccount,
  AuthAdapter,
  AuthIdentity,
  AuthSession,
  AdminActionFailure,
  RegistrationRecord,
  RewardWriteReceipt,
} from './types';

const SESSION_MINUTES = 8 * 60;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * What a browser-safe Supabase configuration must look like, checked before a client is built.
 *
 * Without this, both mistakes below arrive at the sign-in screen as a rejected login: a URL that
 * carries a path makes every request go to `…/rest/v1/rest/v1/…`, and a secret or service-role key
 * in the public slot is a credential that must never leave the server. `isSupabaseConfigured()`
 * deliberately stays a presence check — flipping it on a malformed value would silently fall back to
 * the development vault while the operator believes the real provider is live. Failing loudly here is
 * the correct direction.
 *
 * Problems are described, never quoted: one of the two values checked here may be a secret.
 */
export function configurationProblems(url: string | undefined, key: string | undefined): string[] {
  const problems: string[] = [];

  if (url) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      problems.push('VITE_SUPABASE_URL is not an absolute URL.');
    }
    if (parsed) {
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !import.meta.env.PROD)) {
        problems.push('VITE_SUPABASE_URL must be an https:// project URL.');
      }
      if (parsed.pathname !== '/' && parsed.pathname !== '') {
        problems.push(
          `VITE_SUPABASE_URL must name the project root only (it currently carries the path “${parsed.pathname}”); ` +
            'the client appends /rest/v1 and /auth/v1 itself.'
        );
      }
    }
  }

  if (key) {
    if (key.startsWith('sb_secret_')) {
      problems.push('VITE_SUPABASE_ANON_KEY holds a secret API key. Only the publishable key belongs in a VITE_ variable.');
    } else if (isServiceRoleJwt(key)) {
      problems.push('VITE_SUPABASE_ANON_KEY holds a service-role key, which bypasses row level security and must stay on the server.');
    }
  }

  return problems;
}

/**
 * Legacy service-role keys are JWTs whose payload declares that role. Reading the claim is not
 * verification — it is a string comparison on an untrusted local value, used only to refuse a
 * credential that must never be bundled.
 */
function isServiceRoleJwt(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[1].length === 0) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

async function createClient() {
  const mod = await import('@supabase/supabase-js');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const missing = [!url ? 'VITE_SUPABASE_URL' : null, !anonKey ? 'VITE_SUPABASE_ANON_KEY' : null].filter(
    Boolean
  ) as string[];
  if (missing.length > 0) throw new AuthNotConfiguredError(missing);
  const problems = configurationProblems(url, anonKey);
  if (problems.length > 0) throw new AuthMisconfiguredError(problems);
  return mod.createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
  });
}

let cachedClient: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  if (!cachedClient) {
    cachedClient = createClient().catch((error) => {
      // A failed attempt must not be the answer for the rest of the page's life. Building the client
      // awaits a dynamic import of supabase-js — a lazy chunk, so it can fail on a hiccup — and a
      // cached rejection would then reject every later auth call with the first error, including the
      // sign-in that would otherwise have worked.
      cachedClient = null;
      throw error;
    });
  }
  return cachedClient;
}

function toSession(identity: AuthIdentity): AuthSession {
  const now = Date.now();
  return { identity, issuedAt: now, expiresAt: now + SESSION_MINUTES * 60_000 };
}

/**
 * Why `esme_identity` did not answer, decided from the reply the provider actually gave.
 *
 * Collapsing these is what turned a network hiccup into "you have no profile" and a missing
 * migration into a password problem. Each reason has one job: tell the reader whether to retry,
 * tell the operator which object to look at, or tell both that the row genuinely is not there.
 */
function profileFailureOf(error: unknown): ProfileResolutionError {
  const detail = messageOf(error);
  const code = errorCodeOf(error);

  if (code === '42501' || /permission denied|insufficient privilege|row-level security/i.test(detail)) {
    return new ProfileResolutionError('access_denied', detail);
  }
  if (code === 'PGRST202' || /could not find the function|does not exist\b/i.test(detail)) {
    return new ProfileResolutionError('not_migrated', detail);
  }
  if (
    /fetch failed|failed to fetch|network|timeout|timed out|ECONNRESET|ECONNREFUSED|temporarily unavailable|service unavailable/i.test(detail)
  ) {
    return new ProfileResolutionError('provider_unavailable', detail);
  }
  // Anything else is the database answering with a fault this build has no name for. It still
  // gets the retryable reading, because a profile row is never invented from an unknown error.
  return new ProfileResolutionError('provider_unavailable', detail || `code ${code || 'unknown'}`);
}

/**
 * Runs a PostgREST call and returns its reply instead of throwing.
 *
 * The client reports a fault two ways — as the `error` field of the result and, for a transport
 * failure, as a rejection — and both have to reach the same classifier. Nothing here decides what
 * the failure *means*; that is `profileFailureOf`'s job.
 */
async function attempt<T>(run: () => PromiseLike<{ data?: T; error?: unknown }>): Promise<{ data: T | null; error: unknown }> {
  try {
    const result = await run();
    return { data: result.data ?? null, error: result.error ?? null };
  } catch (error) {
    return { data: null, error };
  }
}

function errorCodeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code ?? '') : '';
}

/**
 * `esme_identity` is a SECURITY DEFINER function: role and account status come from
 * the database, never from anything the browser sends.
 *
 * An empty answer means the profile row is absent, and one idempotent recovery is tried before
 * that is reported: `esme_ensure_own_profile()` (0019) inserts the *caller's own* row as a member,
 * keyed to the auth uid the provider already issued, so a signup whose trigger failed can sign in
 * without anybody typing SQL. A client cannot name the role, the status or another id, which is
 * why this is recovery rather than privilege. If the function is missing, or the retry still
 * answers nothing, the reason is reported instead of a fabricated session.
 */
async function loadIdentity(sb: SupabaseClient, userId: string): Promise<AuthIdentity> {
  const read = async (): Promise<{ row: Record<string, unknown> | null; error: unknown }> => {
    const { data, error } = await attempt(() => sb.rpc('esme_identity', { p_user_id: userId }));
    // PostgREST answers "no rows" with this code. To this caller it is an absent profile, not an
    // outage: the recovery step below has to run, and reporting it as a fault would hide the one
    // case where creating the row is the correct fix.
    if (error && errorCodeOf(error) === 'PGRST116') return { row: null, error: null };
    const row = Array.isArray(data) ? data[0] : data;
    return { row: (row as Record<string, unknown> | null) ?? null, error };
  };

  const first = await read();
  if (first.error) throw profileFailureOf(first.error);
  let row = first.row;

  if (!row) {
    const ensured = await attempt(() => sb.rpc('esme_ensure_own_profile'));
    if (ensured.error) {
      const failure = profileFailureOf(ensured.error);
      // The recovery step is not installed here: say which migration is missing rather than
      // reporting a profile that may exist and simply cannot be reached yet.
      throw failure.reason === 'not_migrated'
        ? failure
        : new ProfileResolutionError('missing_profile', messageOf(ensured.error));
    }
    const again = await read();
    if (again.error) throw profileFailureOf(again.error);
    row = again.row;
    if (!row) throw new ProfileResolutionError('missing_profile');
  }

  const identity: AuthIdentity = {
    id: String(row.id),
    email: String(row.email ?? ''),
    username: String(row.username ?? ''),
    displayName: String(row.display_name ?? ''),
    role: row.role as AuthIdentity['role'],
    // A project that has not applied 0007 yet can still answer with the retired stage.
    status: repairStoredStatus(String(row.status ?? '')),
    committeeId: typeof row.committee_id === 'string' && row.committee_id.length > 0 ? row.committee_id : undefined,
    capabilities: capabilitiesFor(row.role as AuthIdentity['role']),
  };
  return identity;
}

function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : '';
}

/**
 * A row of `esme_reward_entries` as PostgREST returns it, mapped to the shape the ledger renders.
 * Names are not here — see `RewardWriteReceipt` — and neither is anything the caller asserted: the
 * actor, its role and the target's role come from the row the database wrote.
 */
function rewardReceiptOf(row: Record<string, unknown>): RewardWriteReceipt {
  return {
    id: String(row.id),
    kind: row.kind === 'warning' ? 'warning' : 'bonus',
    actorId: String(row.actor_id),
    actorRole: row.actor_role as RewardWriteReceipt['actorRole'],
    targetId: String(row.target_id),
    targetRoleAtTime: row.target_role_at_time as RewardWriteReceipt['targetRoleAtTime'],
    committeeId: (row.committee_id as string | null) ?? undefined,
    points: Number(row.points ?? 0),
    severity: (row.severity as RewardWriteReceipt['severity']) ?? undefined,
    reason: String(row.reason ?? ''),
    evidenceUrl: (row.evidence_url as string | null) ?? undefined,
    issuedAt: String(row.issued_at ?? ''),
    status: row.status === 'reversed' ? 'reversed' : 'active',
    reversedByEntryId: (row.reversed_by_entry_id as string | null) ?? undefined,
    idempotencyKey: String(row.idempotency_key ?? ''),
  };
}

/**
 * The rule that answered, taken from the exception the function raised: every guard in 0006 opens its
 * message with `ESME_<CODE>`, so the officer sees which ceiling or which rank check spoke rather than
 * a transport error. A message without one of those prefixes means the request never reached the
 * function — a missing migration (PGRST202) or a dropped connection — and says so.
 */
function rewardFailureOf(error: unknown): AdminActionFailure {
  const message = messageOf(error);
  // This one has a sentence of its own: the code alone reads like a bug, while the rule is a policy
  // decision an officer has to understand before trying another route.
  if (/ESME_HIGH_BOARD_TARGET/.test(message)) {
    return {
      code: 'high_board_target',
      message: 'Bonus points are not awarded to a High Board seat. A warning can still be recorded against that account.',
    };
  }
  const raised = /ESME_[A-Z_]+/.exec(message);
  if (raised) return { code: raised[0].toLowerCase(), message };
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'PGRST202' || /could not find the function|does not exist/i.test(message)) {
    return {
      code: 'schema_missing',
      message: 'The chapter database has no reward ledger yet, so this entry could not be filed. Apply supabase/migrations/0006_rewards_discipline.sql.',
    };
  }
  return { code: 'reward_write_failed', message: 'The chapter could not record this entry. Nothing was filed — try again.' };
}

/**
 * Supabase adapter — the production integration. Registration, approval, role
 * changes and status changes all go through SECURITY DEFINER functions guarded by
 * row level security, so a hand-made request cannot elevate a caller.
 */
export function createSupabaseAdapter(): AuthAdapter {
  return {
    kind: 'supabase',
    warningBanner: '',

    /**
     * Re-opens a persisted provider session.
     *
     * Only a profile whose *database status is a sanction* is torn down. When the profile read fails
     * for another reason, the provider session is left in place and the reason is thrown: dropping it
     * would convert an outage or an unapplied migration into a logout, and the user would lose a
     * credential that is still valid.
     */
    async restore() {
      const sb = await client();
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (!session) return null;
      const identity = await loadIdentity(sb, session.user.id);
      if (!canAccessErp(identity.status)) {
        await sb.auth.signOut();
        throw new AccessRevokedError(identity.status);
      }
      return toSession(identity);
    },

    /**
     * The alert itself is the database's decision: it reads the member's address, applies the
     * rate window against its own delivery log, and ignores anything this request claims. A
     * failure here is silent on purpose — losing one security notice must not break sign-in.
     */
    async reportSignIn(input) {
      try {
        const sb = await client();
        await sb.rpc('esme_report_sign_in', { p_device: input.device, p_occurred_at: input.occurredAt });
      } catch {
        // Nothing to retry from here: the next sign-in reports again.
      }
    },

    /**
     * Read through row level security, which only exposes the caller's own row. The filter is
     * written anyway so the intent survives a later policy change.
     */
    async readEmailPreferences() {
      const sb = await client();
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (!session) return null;
      const { data, error } = await sb
        .from('esme_email_preferences')
        .select('locale, muted_events, updated_at')
        .eq('profile_id', session.user.id)
        .maybeSingle();
      if (error || !data) return null;
      return {
        userId: session.user.id,
        locale: data.locale === 'ar' ? 'ar' : 'en',
        mutedEvents: Array.isArray(data.muted_events) ? data.muted_events : [],
        updatedAt: data.updated_at ?? new Date(0).toISOString(),
      };
    },

    async saveEmailPreferences(prefs) {
      const sb = await client();
      const { error } = await sb.rpc('esme_save_email_preferences', {
        p_locale: prefs.locale,
        p_muted_events: prefs.mutedEvents,
      });
      if (error) {
        return {
          ok: false,
          error: {
            code: 'email-preferences',
            message: messageOf(error).includes('account-safety')
              ? 'An account-safety notice cannot be muted.'
              : 'The chapter could not save those email preferences. Try again.',
          },
        };
      }
      return { ok: true };
    },

    /**
     * The provider's own auth events drive this: INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED and
     * SIGNED_OUT all arrive here, so a session that outlives the page is re-verified rather than
     * trusted.
     *
     * A profile read that fails is not a logout. Sign-out is reserved for the one case where the
     * database actually said this account is under a sanction; anything else — unreachable database,
     * refused read, missing migration — keeps the provider session and hands the listener the error so
     * the screen can name it. Reporting those as `listener(null)` is what made a transient fault look
     * like the user had been signed out or never signed in.
     */
    subscribe(listener) {
      let unsubscribe: (() => void) | undefined;
      let cancelled = false;
      void client().then((sb) => {
        if (cancelled) return;
        const { data } = sb.auth.onAuthStateChange(async (event, session) => {
          if (!session) {
            listener(null);
            return;
          }
          try {
            const identity = await loadIdentity(sb, session.user.id);
            if (!canAccessErp(identity.status)) {
              await sb.auth.signOut();
              listener(null);
              return;
            }
            listener(toSession(identity));
          } catch (problem) {
            // A sanctioned-status sign-out above reaches the listener with no problem; this is the
            // other branch — the session stands and the caller is told why it has no profile yet.
            if (event === 'SIGNED_OUT') {
              listener(null);
              return;
            }
            listener(null, problem instanceof Error ? problem : new Error(String(problem)));
          }
        });
        unsubscribe = () => data.subscription.unsubscribe();
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },

    /**
     * A rejected credential is the only thing reported as a sign-in failure here. A profile that
     * cannot be resolved throws its own classified error with the provider session kept, because
     * "the password was right and the chapter database would not answer" is a different problem
     * for both the reader and the operator.
     */
    async signIn(identifier, password) {
      const sb = await client();
      const email = identifier.includes('@') ? normalizeEmail(identifier) : identifier;
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        if (/rate|too many/i.test(messageOf(error))) throw new RateLimitedError();
        throw new AuthFailedError();
      }
      const identity = await loadIdentity(sb, data.user.id);
      if (!canAccessErp(identity.status)) {
        await sb.auth.signOut();
        throw new AccessRevokedError(identity.status);
      }
      return toSession(identity);
    },

    async signOut() {
      const sb = await client();
      await sb.auth.signOut();
    },

    /**
     * Registration runs through the provider's own sign-up endpoint: GoTrue hashes the
     * password (bcrypt) and enforces the per-IP rate limit, and the `esme_on_auth_user_created`
     * trigger forces role=member and, since 0012, status=active regardless of anything this
     * client sends. Requirement: "Confirm email" may be switched on or off; the account row is
     * created either way. See supabase/README.md.
     */
    async register(draft) {
      const sb = await client();
      const { data, error } = await sb.auth.signUp({
        email: normalizeEmail(draft.email),
        password: draft.password,
        options: {
          data: {
            full_name: draft.fullName.trim(),
            username: normalizeUsername(draft.username),
            committee_id: draft.committeeId ?? '',
            accepted_policies: String(draft.acceptedPolicies),
            // esme_handle_new_auth_user copies these into esme_registration_requests;
            // without them the reviewer sees an identity with an empty questionnaire.
            technical_skills: draft.technicalSkills ?? '',
            previous_experience: draft.previousExperience ?? '',
            motivation: draft.motivation ?? '',
            availability_hours: draft.availabilityHours ?? '',
            // Read by the trigger 0011_registration_academic_fields.sql installs. Until that
            // migration runs, these keys sit unused in the signup metadata and the queue keeps
            // its old shape — sending them is inert, not a schema change.
            student_id: draft.studentId ?? '',
            academic_year: draft.academicYear ?? '',
            department: draft.department ?? '',
            phone: draft.phone ?? '',
            committee_membership: draft.committeeMembership ?? '',
            second_committee_preference_id: draft.secondCommitteePreferenceId ?? '',
          },
          captchaToken: draft.captchaToken,
        },
      });
      if (error) {
        const message = messageOf(error);
        if (/unique|duplicate|already|taken|exists/i.test(message)) {
          return { ok: false, failure: { code: 'duplicate', message: DUPLICATE_IDENTITY_MESSAGE } };
        }
        if (/rate|too many/i.test(message)) {
          return { ok: false, failure: { code: 'rate_limited', message: 'Too many attempts. Wait before trying again.' } };
        }
        if (/weak password|password/i.test(message)) {
          return { ok: false, failure: { code: 'validation', message: 'Check the highlighted fields and try again.' } };
        }
        return { ok: false, failure: { code: 'unavailable', message: 'Registration is temporarily unavailable. Try again shortly.' } };
      }
      return {
        ok: true,
        receipt: {
          reference: data.user?.id ?? '',
          // 0012 makes the profile active at signup; the registration request row is the
          // committee-placement queue and does not gate access.
          status: 'active',
          // The provider decides this, not this client: with "Confirm email" on, signUp hands back
          // a user with no session, and a browser cannot enter the chapter until the link is used.
          // Reporting that as a granted sign-in is what made the verification step look like an
          // approval step someone inside the chapter owed the applicant.
          emailVerificationRequired: !data.session,
        },
      };
    },

    async requestPasswordReset(email) {
      const sb = await client();
      await sb.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: `${window.location.origin}/#reset-password`,
      });
    },

    /**
     * The recovery link already established a short-lived session carrying `type: 'recovery'`;
     * this exchanges it for the new password and ends the session so it cannot be reused.
     */
    async confirmPasswordReset(_token, newPassword) {
      const sb = await client();
      const failures = validatePassword(newPassword);
      if (failures.length > 0) {
        return { ok: false, error: { code: 'weak_password', message: `Password needs: ${failures.join(', ')}.` } };
      }
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: { code: 'reset_failed', message: messageOf(error) } };
      await sb.auth.signOut();
      return { ok: true };
    },

    async listRegistrations() {
      const sb = await client();
      const { data, error } = await sb
        .from('esme_registration_requests')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (error) throw new AuthFailedError('The registration queue could not be loaded.');
      return (data ?? []).map(
        (row: Record<string, unknown>) =>
          ({
            id: String(row.id),
            profileId: (row.profile_id as string | null) ?? undefined,
            fullName: String(row.full_name),
            email: String(row.email),
            username: String(row.username),
            committeeId: (row.requested_committee_id as string | null) ?? undefined,
            assignedCommitteeId: (row.assigned_committee_id as string | null) ?? undefined,
            submittedAt: String(row.submitted_at),
            status: repairStoredStatus(String(row.status)),
            decisionBy: (row.decided_by_name as string | undefined) ?? undefined,
            decisionAt: (row.decided_at as string | undefined) ?? undefined,
            rejectionReason: (row.rejection_reason as string | undefined) ?? undefined,
            // These columns arrive with 0011. Read as optional so a queue from a project that has
            // not applied it yet still loads, showing nothing rather than a made-up answer.
            studentId: (row.student_id as string | undefined) ?? undefined,
            academicYear: (row.academic_year as string | undefined) ?? undefined,
            department: (row.department as string | undefined) ?? undefined,
            phone: (row.phone as string | undefined) ?? undefined,
            committeeMembership: (row.committee_membership as string | undefined) ?? undefined,
            secondCommitteePreferenceId: (row.second_committee_preference_id as string | undefined) ?? undefined,
            technicalSkills: String(row.technical_skills ?? ''),
            previousExperience: String(row.previous_experience ?? ''),
            motivation: String(row.motivation ?? ''),
            availabilityHours: String(row.availability_hours ?? ''),
            agreedToPolicies: Boolean(row.agreed_to_policies),
          }) satisfies RegistrationRecord
      );
    },

    /**
     * The directory is a plain select on `esme_profiles`; the `esme_profiles_self` policy
     * already limits it to the caller's own row plus everyone reachable through the
     * `users.read` capability. Nothing here filters or widens that list in the browser.
     */
    async listAccounts() {
      const sb = await client();
      const { data, error } = await sb
        .from('esme_profiles')
        .select('id, email, username, display_name, role, status, committee_id, created_at')
        .order('display_name');
      if (error) throw new AuthFailedError('The account directory could not be loaded. Try again shortly.');
      return (data ?? []).map(
        (row: Record<string, unknown>) =>
          ({
            id: String(row.id),
            email: String(row.email),
            username: String(row.username),
            displayName: String(row.display_name),
            role: row.role as AuthAccount['role'],
            status: repairStoredStatus(String(row.status)),
            committeeId: (row.committee_id as string | null) ?? undefined,
            createdAt: String(row.created_at ?? ''),
          }) satisfies AuthAccount
      );
    },

    /**
     * `id` is the `esme_registration_requests.id`. The function locks that row and raises
     * `ESME_NOT_FOUND: registration request` when no such row exists — which is what a caller
     * that passed the profile id used to trigger. The two refusals a reviewer can actually
     * meet (the row vanished, or another reviewer decided it first) are translated into a
     * message that tells them to refresh, so `ESME_NOT_FOUND` never reaches a toast verbatim.
     */
    async decideRegistration(id, decision, options) {
      if (!id) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: 'This request has no queue record on the server yet. Refresh the queue before deciding it.',
          },
        };
      }
      const sb = await client();
      const { error } = await sb.rpc('esme_decide_registration', {
        p_request_id: id,
        p_decision: decision,
        p_reason: options?.reason ?? null,
        p_committee_id: options?.committeeId ?? null,
      });
      if (!error) return { ok: true };
      const message = messageOf(error);
      if (/ESME_NOT_FOUND/.test(message)) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message:
              'That registration request is no longer in the queue. Another reviewer may have decided it; refresh to see the latest state.',
          },
        };
      }
      if (/ESME_ALREADY_DECIDED/.test(message)) {
        return {
          ok: false,
          error: {
            code: 'already_decided',
            message: 'This request was already decided by another reviewer. Refresh to see the outcome.',
          },
        };
      }
      return { ok: false, error: { code: 'decision_denied', message } };
    },

    async setAccountStatus(id, status) {
      const sb = await client();
      const { error } = await sb.rpc('esme_set_account_status', { p_user_id: id, p_status: status });
      if (error) return { ok: false, error: { code: 'status_denied', message: messageOf(error) } };
      return { ok: true };
    },

    async assignRole(id, role) {
      const sb = await client();
      const { error } = await sb.rpc('esme_assign_role', { p_user_id: id, p_role: role });
      if (error) return { ok: false, error: { code: 'role_denied', message: messageOf(error) } };
      return { ok: true };
    },

    /**
     * The four reward writes are RPC calls and nothing else: `esme_reward_entries` revokes insert,
     * update and delete from `authenticated`, and `esme_assert_reward_channel()` refuses a direct
     * write even for a caller that holds the grant. The row read back is the database's answer, so an
     * over-cap bonus, a bonus aimed up the rank chain, or a replayed click with a key already filed
     * all arrive as a refusal or as the entry that already exists — never as a local record that
     * looks like it was kept.
     */
    async awardBonus(write) {
      const sb = await client();
      const { data, error } = await sb.rpc('esme_award_bonus', {
        p_target: write.targetId,
        p_points: write.points,
        p_reason: write.reason,
        p_evidence_url: write.evidenceUrl ?? null,
        p_idempotency_key: write.idempotencyKey,
      });
      if (error) return { ok: false, error: rewardFailureOf(error) };
      if (!data) return { ok: false, error: { code: 'no_row', message: 'The chapter recorded nothing for this bonus.' } };
      return { ok: true, receipt: rewardReceiptOf(data as Record<string, unknown>) };
    },

    async issueWarning(write) {
      const sb = await client();
      const { data, error } = await sb.rpc('esme_issue_warning', {
        p_target: write.targetId,
        p_severity: write.severity,
        p_reason: write.reason,
        p_evidence_url: write.evidenceUrl ?? null,
        p_idempotency_key: write.idempotencyKey,
      });
      if (error) return { ok: false, error: rewardFailureOf(error) };
      if (!data) return { ok: false, error: { code: 'no_row', message: 'The chapter recorded nothing for this warning.' } };
      return { ok: true, receipt: rewardReceiptOf(data as Record<string, unknown>) };
    },

    /**
     * `p_entry` is the only input the server uses: the entry it corrects is read by id inside the
     * function, so the `original` this adapter is handed cannot change what gets reversed.
     */
    async reverseRewardEntry(write) {
      const sb = await client();
      const { data, error } = await sb.rpc('esme_reverse_reward_entry', {
        p_entry: write.entryId,
        p_reason: write.reason,
      });
      if (error) return { ok: false, error: rewardFailureOf(error) };
      if (!data) return { ok: false, error: { code: 'no_row', message: 'The chapter filed no reversing entry.' } };
      return { ok: true, receipt: rewardReceiptOf(data as Record<string, unknown>) };
    },

    async acknowledgeWarning(entry) {
      const sb = await client();
      const { error } = await sb.rpc('esme_acknowledge_warning', { p_entry: entry.id });
      if (error) return { ok: false, error: rewardFailureOf(error) };
      return { ok: true };
    },

    /**
     * Not callable from a browser, for the same reason `bootstrapPrimaryAdmin` is not: an endpoint
     * that creates auth identities has no business being reachable from a client JWT, and the
     * anonymous key is publishable. `esme_seed_test_accounts()` is granted to `service_role` only
     * and refuses an environment the operator has not declared as development or staging. The panel
     * shows these statements instead of submitting them, and the directory the caller can already
     * read says whether the three testers exist.
     */
    async seedTestAccounts() {
      const refusal = testAccountSeedRefusal({
        adapterKind: 'supabase',
        isProductionBuild: Boolean(import.meta.env.PROD),
        allowedByEnvironment: import.meta.env.VITE_ALLOW_TEST_ACCOUNTS === 'true',
      });
      return emptyTestAccountReport(refusal);
    },

    async removeTestAccounts() {
      return emptyTestAccountReport(
        'Deletion runs through the same service-role guard: select esme_remove_test_accounts(); from the SQL editor. ' +
          'It removes only the three seeded addresses and reports what it dropped.'
      );
    },

    async requiresPrimaryAdminBootstrap() {
      const sb = await client();
      const { data, error } = await sb.rpc('esme_needs_primary_admin');
      if (error) return false;
      return Boolean(data);
    },

    /**
     * Not callable from a browser. `esme_bootstrap_primary_admin` is granted to
     * `service_role` only, because before the first administrator exists any caller
     * from the client would be anonymous or a self-registered applicant. The sign-in
     * screen shows these two statements instead of submitting them.
     */
    async bootstrapPrimaryAdmin() {
      return {
        ok: false,
        error: {
          code: 'operator_required',
          message:
            'The first Super Admin is provisioned in the Supabase SQL editor, never from a browser. ' +
            'Run: select esme_arm_bootstrap(interval \'15 minutes\'); then ' +
            'select esme_bootstrap_primary_admin(\'<full name>\', \'<email>\', \'<username>\', \'<password>\');',
        },
      };
    },
  };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}
