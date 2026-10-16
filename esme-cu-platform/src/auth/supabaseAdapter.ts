import { capabilitiesFor } from '../domain/roles';
import { canAccessErp } from '../domain/accountState';
import { normalizeEmail, normalizeUsername, validatePassword, DUPLICATE_IDENTITY_MESSAGE } from '../domain/registration';
import { AccessRevokedError, AuthFailedError, AuthNotConfiguredError, RateLimitedError } from './errors';
import type {
  AuthAdapter,
  AuthIdentity,
  AuthSession,
  RegistrationRecord,
} from './types';

const SESSION_MINUTES = 8 * 60;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function createClient() {
  const mod = await import('@supabase/supabase-js');
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const missing = [!url ? 'VITE_SUPABASE_URL' : null, !anonKey ? 'VITE_SUPABASE_ANON_KEY' : null].filter(
    Boolean
  ) as string[];
  if (missing.length > 0) throw new AuthNotConfiguredError(missing);
  if (!url || !anonKey) throw new AuthNotConfiguredError(missing);
  return mod.createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
  });
}

let cachedClient: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  if (!cachedClient) cachedClient = createClient();
  return cachedClient;
}

function toSession(identity: AuthIdentity): AuthSession {
  const now = Date.now();
  return { identity, issuedAt: now, expiresAt: now + SESSION_MINUTES * 60_000 };
}

/**
 * `esme_identity` is a SECURITY DEFINER function: role and account status come from
 * the database, never from anything the browser sends.
 */
async function loadIdentity(sb: SupabaseClient, userId: string): Promise<AuthIdentity> {
  const { data, error } = await sb.rpc('esme_identity', { p_user_id: userId });
  if (error) throw new AuthFailedError('The chapter could not read your account profile. Try again shortly.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new AuthFailedError('This sign-in has no chapter profile yet. Ask an administrator to complete it.');
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    committeeId: row.committee_id ?? undefined,
    capabilities: capabilitiesFor(row.role),
  } as AuthIdentity;
}

function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : '';
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
          } catch {
            listener(null);
          }
        });
        unsubscribe = () => data.subscription.unsubscribe();
      });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },

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
     * password (bcrypt) and enforces rate limits, and the `esme_on_auth_user_created`
     * trigger forces role=member / status=pending_email_verification regardless of
     * anything this client sends.
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
        if (/confirm.*email|weak password|password/i.test(message)) {
          return { ok: false, failure: { code: 'validation', message: 'Check the highlighted fields and try again.' } };
        }
        return { ok: false, failure: { code: 'unavailable', message: 'Registration is temporarily unavailable. Try again shortly.' } };
      }
      return {
        ok: true,
        receipt: {
          reference: data.user?.id ?? '',
          status: 'pending_email_verification',
          requiresEmailVerification: !data.session,
        },
      };
    },

    async resendVerification(email) {
      const sb = await client();
      await sb.auth.resend({ type: 'signup', email: normalizeEmail(email) });
    },

    /** Consumes the token Supabase emailed; approval remains a separate, human step. */
    async completeEmailVerification(token) {
      const sb = await client();
      const { error } = await sb.auth.verifyOtp({ token_hash: token, type: 'email' });
      if (error) return { ok: false, error: { code: 'verification_failed', message: messageOf(error) } };
      // Verification must not leave the applicant signed in: approval is what opens access.
      await sb.auth.signOut();
      return { ok: true };
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
            fullName: String(row.full_name),
            email: String(row.email),
            username: String(row.username),
            committeeId: (row.requested_committee_id as string | null) ?? undefined,
            assignedCommitteeId: (row.assigned_committee_id as string | null) ?? undefined,
            submittedAt: String(row.submitted_at),
            emailVerified: Boolean(row.email_verified),
            status: row.status as RegistrationRecord['status'],
            decisionBy: (row.decided_by_name as string | undefined) ?? undefined,
            decisionAt: (row.decided_at as string | undefined) ?? undefined,
            rejectionReason: (row.rejection_reason as string | undefined) ?? undefined,
            technicalSkills: String(row.technical_skills ?? ''),
            previousExperience: String(row.previous_experience ?? ''),
            motivation: String(row.motivation ?? ''),
            availabilityHours: String(row.availability_hours ?? ''),
            agreedToPolicies: Boolean(row.agreed_to_policies),
          }) satisfies RegistrationRecord
      );
    },

    async decideRegistration(id, decision, options) {
      const sb = await client();
      const { error } = await sb.rpc('esme_decide_registration', {
        p_request_id: id,
        p_decision: decision,
        p_reason: options?.reason ?? null,
        p_committee_id: options?.committeeId ?? null,
      });
      if (error) return { ok: false, error: { code: 'decision_denied', message: messageOf(error) } };
      return { ok: true };
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
