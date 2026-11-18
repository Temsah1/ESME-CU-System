import type { ContentSocial } from '../types';

/**
 * The chapter's official external addresses, kept in one place so no screen retypes a URL.
 *
 * Every value is carried EXACTLY as the chapter supplied it — tracking query strings, percent
 * escapes and all. They are not shortened, cleaned or redirected through anything: a link that
 * leaves this site must arrive at the address the chapter published, or it is not their link.
 */
export const EXTERNAL_LINKS = {
  tiktok: 'https://www.tiktok.com/@esme.cairo?_r=1&_t=ZS-95WfFMRZQdY',
  instagram: 'https://www.instagram.com/esme.cu?igsh=MTNjcXpqaHJiZjNpdQ%3D%3D',
  linkedin: 'https://www.linkedin.com/company/esme-cairo-university-student-chapter/posts/?viewAsMember=true',
  facebook: 'https://www.facebook.com/ESMECairo',
  drive: 'https://drive.google.com/drive/folders/1vZNDtJTb1O6PxsPDhY2OlxyYe2GtyruT',
  whatsapp: 'http://api.whatsapp.com/send/?phone=%2B201223441144&text&type=phone_number&app_absent=0',
} as const;

export type ExternalLinkKey = keyof typeof EXTERNAL_LINKS;

/** The glyph keys the platform marks understand — one per destination the chapter can publish. */
export type PlatformKey =
  | 'tiktok'
  | 'instagram'
  | 'linkedin'
  | 'facebook'
  | 'whatsapp'
  | 'drive'
  | 'github'
  | 'x'
  | 'youtube'
  | 'telegram'
  | 'discord'
  | 'email';

/** Maps a CMS `network` string (or a link key) onto the glyph it should wear. */
export const platformFromNetwork = (network: string): PlatformKey | null => {
  const n = network.trim().toLowerCase();
  if (n === 'tiktok') return 'tiktok';
  if (n === 'instagram') return 'instagram';
  if (n === 'linkedin') return 'linkedin';
  if (n === 'facebook') return 'facebook';
  if (n === 'whatsapp') return 'whatsapp';
  if (n === 'drive' || n === 'google drive' || n === 'google-drive') return 'drive';
  if (n === 'github') return 'github';
  if (n === 'x' || n === 'twitter' || n === 'x (twitter)') return 'x';
  if (n === 'youtube' || n === 'yt') return 'youtube';
  if (n === 'telegram') return 'telegram';
  if (n === 'discord') return 'discord';
  if (n === 'email' || n === 'mail' || n === 'e-mail') return 'email';
  return null;
};

/** One addressable social destination, in the shape every SocialLinks surface consumes. */
export type SocialLinkItem = {
  id: string;
  label: string;
  href: string;
  network?: string;
  /** Optional visible caption for labeled rows; falls back to `label` (the accessible name). */
  text?: string;
};

/**
 * The four public profiles, in the shape the CMS publishes. This replaces the placeholder entry
 * that carried a handle but no address — the footer used to render it as a link to nowhere.
 * An operator can still edit or hide any of them from the CMS; these are the shipped defaults.
 */
export const OFFICIAL_SOCIALS: ContentSocial[] = [
  { id: 'social_tiktok', network: 'TikTok', handle: '@esme.cairo', url: EXTERNAL_LINKS.tiktok, visible: true },
  { id: 'social_instagram', network: 'Instagram', handle: '@esme.cu', url: EXTERNAL_LINKS.instagram, visible: true },
  {
    id: 'social_linkedin',
    network: 'LinkedIn',
    handle: 'ESME Cairo University Student Chapter',
    url: EXTERNAL_LINKS.linkedin,
    visible: true,
  },
  { id: 'social_facebook', network: 'Facebook', handle: 'ESMECairo', url: EXTERNAL_LINKS.facebook, visible: true },
];

/** Labels for the two utility links, so the footer and the contact band agree on the wording. */
export const RESOURCE_LINK_LABELS = {
  drive: 'Access Shared Resources',
  whatsapp: 'WhatsApp the chapter',
} as const;
