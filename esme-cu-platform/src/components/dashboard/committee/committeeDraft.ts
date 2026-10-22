import type { CommitteeInput } from '../../../domain/committees';

/** The form keeps list fields as newline-separated text; storage keeps arrays. */
export type FormValues = {
  name: string;
  shortCode: string;
  description: string;
  objectives: string;
  subTeams: string;
  category: CommitteeInput['category'];
  status: CommitteeInput['status'];
  isPublic: boolean;
};

export const CATEGORIES: { value: CommitteeInput['category']; label: string }[] = [
  { value: 'technical', label: 'Technical' },
  { value: 'media', label: 'Media' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'operations', label: 'Operations' },
  { value: 'management', label: 'Management' },
];

export const toFormValues = (committee?: CommitteeInput): FormValues => ({
  name: committee?.name ?? '',
  shortCode: committee?.shortCode ?? '',
  description: committee?.description ?? '',
  objectives: (committee?.objectives ?? []).join('\n'),
  subTeams: (committee?.subTeams ?? []).join('\n'),
  category: committee?.category ?? 'technical',
  status: committee?.status ?? 'active',
  isPublic: committee?.isPublic ?? true,
});

export const linesOf = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

export const toDraft = (values: FormValues): CommitteeInput => ({
  name: values.name,
  shortCode: values.shortCode,
  description: values.description,
  // Counts are not clamped here: over the limit must be reported by validation, not trimmed.
  objectives: linesOf(values.objectives),
  subTeams: linesOf(values.subTeams),
  category: values.category,
  status: values.status,
  isPublic: values.isPublic,
});
