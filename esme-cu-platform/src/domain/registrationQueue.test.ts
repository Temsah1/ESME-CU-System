import { describe, expect, it } from 'vitest';
import type { RegistrationRecord } from '../auth/types';
import type { RegistrationApplication } from '../types';
import { applicationFromRecord, decisionTargetOf } from './registrationQueue';

const record = (overrides: Partial<RegistrationRecord> = {}): RegistrationRecord => ({
  id: 'req_9f1c',
  profileId: 'usr_2ab7',
  fullName: 'Mona Adel',
  email: 'mona.adel@example.test',
  username: 'mona.adel',
  committeeId: 'comm_te',
  submittedAt: '2026-10-20T09:00:00.000Z',
  status: 'pending_approval',
  technicalSkills: 'AutoCAD',
  previousExperience: '',
  motivation: 'Wants to join the technical committee',
  availabilityHours: '8',
  agreedToPolicies: true,
  ...overrides,
});

describe('the queue row maps to one application without merging its two ids', () => {
  it('keeps the queue id for the decision and the profile id for the person', () => {
    const application = applicationFromRecord(record());
    expect(application.requestId).toBe('req_9f1c');
    expect(application.authUserId).toBe('usr_2ab7');
    expect(application.id).toBe('app_req_9f1c');
    expect(application.status).toBe('under_review');
  });

  it('refreshes the provider fields on an existing local copy instead of adding a second row', () => {
    const local: RegistrationApplication = {
      id: 'app_1750000000000',
      fullName: 'Mona Adel',
      universityEmail: 'mona.adel@example.test',
      preferredCommitteeId: 'comm_te',
      technicalSkills: 'AutoCAD',
      previousExperience: '',
      motivation: 'Captured in this browser',
      availabilityHours: '8',
      agreedToPolicies: true,
      appliedDate: '2026-10-19T18:00:00.000Z',
      status: 'accepted',
      authUserId: 'usr_2ab7',
    };

    const merged = applicationFromRecord(
      record({ status: 'rejected', rejectionReason: 'No seat this season' }),
      local
    );
    expect(merged.id).toBe('app_1750000000000');
    expect(merged.requestId).toBe('req_9f1c');
    expect(merged.authUserId).toBe('usr_2ab7');
    expect(merged.status).toBe('rejected');
    expect(merged.rejectionReason).toBe('No seat this season');
    expect(merged.motivation).toBe('Captured in this browser');
  });

  it('still accepts an adapter that only answers one id', () => {
    const application = applicationFromRecord(record({ profileId: undefined }));
    expect(application.requestId).toBe('req_9f1c');
    expect(application.authUserId).toBe('req_9f1c');
  });
});

describe('the decision target is the queue row id', () => {
  it('never sends the profile id to a provider that distinguishes it', () => {
    expect(decisionTargetOf({ requestId: 'req_9f1c', authUserId: 'usr_2ab7' }, 'supabase')).toBe('req_9f1c');
  });

  it('refuses a provider target that has no queue row yet', () => {
    expect(decisionTargetOf({ authUserId: 'usr_2ab7' }, 'supabase')).toBeUndefined();
  });

  it('lets the local vault fall back to its account id, so local decisions keep working', () => {
    expect(decisionTargetOf({ authUserId: 'usr_2ab7' }, 'local-dev')).toBe('usr_2ab7');
  });
});
