import type { RegistrationRecord } from '../auth/types';
import type { RegistrationApplication } from '../types';
import { applicationStageFor } from './accountState';

/**
 * One queue row, two identities.
 *
 * `esme_registration_requests.id` is the row a decision must name; `profile_id` is the person
 * the row is about. The workspace application is keyed by the person (one queue row per
 * profile) and carries the queue id separately for the decision call. Reading the queue by the
 * queue id instead leaves a locally captured copy beside the provider row — and that copy has
 * no queue id, so its Accept button used to send the profile id and raise `ESME_NOT_FOUND`.
 */
export function applicationFromRecord(
  record: RegistrationRecord,
  existing?: RegistrationApplication
): RegistrationApplication {
  // Older adapters answered only one id. Treating it as both keeps them working without
  // pretending the two identities are the same in the provider that distinguishes them.
  const profileId = record.profileId ?? record.id;
  const base: RegistrationApplication = existing ?? {
    id: `app_${record.id}`,
    fullName: record.fullName,
    universityEmail: record.email,
    studentId: record.studentId ?? '',
    academicYear: record.academicYear ?? '',
    department: record.department ?? '',
    phone: record.phone ?? '',
    committeeMembership: record.committeeMembership,
    preferredCommitteeId: record.committeeId ?? '',
    secondCommitteePreferenceId: record.secondCommitteePreferenceId,
    technicalSkills: record.technicalSkills,
    previousExperience: record.previousExperience,
    motivation: record.motivation,
    availabilityHours: record.availabilityHours,
    agreedToPolicies: record.agreedToPolicies,
    appliedDate: record.submittedAt,
    status: applicationStageFor(record.status),
    authUserId: profileId,
    requestId: record.id,
  };
  return {
    ...base,
    fullName: record.fullName,
    universityEmail: record.email,
    status: applicationStageFor(record.status),
    accountStatus: record.status,
    authUserId: profileId,
    requestId: record.id,
    appliedDate: base.appliedDate || record.submittedAt,
    rejectionReason: record.rejectionReason ?? base.rejectionReason,
    assignedCommitteeId: record.assignedCommitteeId ?? base.assignedCommitteeId,
    committeeMembership: base.committeeMembership ?? record.committeeMembership,
    reviewedBy: record.decisionBy ?? base.reviewedBy,
    technicalSkills: base.technicalSkills || record.technicalSkills,
    previousExperience: base.previousExperience || record.previousExperience,
    motivation: base.motivation || record.motivation,
    availabilityHours: base.availabilityHours || record.availabilityHours,
  };
}

/**
 * The id a decision names. Only the local vault, which stores no separate request table, may
 * fall back to the account id; the provider must always be addressed with the queue row id.
 */
export function decisionTargetOf(
  application: Pick<RegistrationApplication, 'requestId' | 'authUserId'>,
  adapterKind: 'supabase' | 'local-dev'
): string | undefined {
  return application.requestId ?? (adapterKind === 'local-dev' ? application.authUserId : undefined);
}
