import React from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  TiktokIcon,
  InstagramIcon,
  Linkedin01Icon,
  Facebook01Icon,
  WhatsappIcon,
  GoogleDriveIcon,
  GithubIcon,
  NewTwitterIcon,
  YoutubeIcon,
  TelegramIcon,
  DiscordIcon,
  Mail01Icon,
  Link01Icon,
} from '@hugeicons/core-free-icons';
import { cn } from '../lib/cn';
import { platformFromNetwork, type PlatformKey, type SocialLinkItem } from '../config/externalLinks';

/**
 * The chapter's social icon system, drawn from Hugeicons' free stroke set so every platform shares
 * one outline language and one stroke weight. Glyphs inherit `currentColor`; the hover hue is
 * decided by the surface around them (light contact band vs. dark footer), never baked in here.
 */
const GLYPHS: Record<PlatformKey, IconSvgElement> = {
  tiktok: TiktokIcon,
  instagram: InstagramIcon,
  linkedin: Linkedin01Icon,
  facebook: Facebook01Icon,
  whatsapp: WhatsappIcon,
  drive: GoogleDriveIcon,
  github: GithubIcon,
  x: NewTwitterIcon,
  youtube: YoutubeIcon,
  telegram: TelegramIcon,
  discord: DiscordIcon,
  email: Mail01Icon,
};

const STROKE = 1.6;

/** Per-platform hover hues for light surfaces, all drawn from the palette the site already owns. */
const HOVER_LIGHT: Record<PlatformKey, string> = {
  tiktok: 'hover:text-ink-strong hover:border-ink-strong',
  instagram: 'hover:text-pink hover:border-pink',
  linkedin: 'hover:text-navy-light hover:border-navy-light',
  facebook: 'hover:text-indigo hover:border-indigo',
  whatsapp: 'hover:text-green-dark hover:border-green-dark',
  drive: 'hover:text-orange-dark hover:border-orange-dark',
  github: 'hover:text-ink-strong hover:border-ink-strong',
  x: 'hover:text-ink-strong hover:border-ink-strong',
  youtube: 'hover:text-danger hover:border-danger',
  telegram: 'hover:text-info hover:border-info',
  discord: 'hover:text-indigo hover:border-indigo',
  email: 'hover:text-brand hover:border-brand',
};

/** The same platforms answering on dark surfaces, where pale hues carry the contrast. */
const HOVER_DARK: Record<PlatformKey, string> = {
  tiktok: 'hover:text-white hover:border-white',
  instagram: 'hover:text-pink hover:border-pink',
  linkedin: 'hover:text-blue-pale hover:border-blue-pale',
  facebook: 'hover:text-indigo hover:border-indigo',
  whatsapp: 'hover:text-green hover:border-green',
  drive: 'hover:text-ember hover:border-ember',
  github: 'hover:text-white hover:border-white',
  x: 'hover:text-white hover:border-white',
  youtube: 'hover:text-danger hover:border-danger',
  telegram: 'hover:text-info hover:border-info',
  discord: 'hover:text-indigo hover:border-indigo',
  email: 'hover:text-ember hover:border-ember',
};

type Tone = 'light' | 'dark';
type Size = 'sm' | 'md';

/** The bare platform mark, for surfaces that already supply their own chip or anchor around it. */
export const SocialGlyph: React.FC<{ platform: PlatformKey; className?: string }> = ({ platform, className }) => (
  <HugeiconsIcon icon={GLYPHS[platform]} strokeWidth={STROKE} className={className} aria-hidden="true" focusable="false" />
);

/**
 * One circular icon link. `ring` draws the outlined badge from the reference; `bare` is just the
 * mark for thin utility bars and tinted contact chips that own their container.
 */
export const SocialIconLink: React.FC<{
  href: string;
  label: string;
  network?: string;
  platform?: PlatformKey;
  size?: Size;
  tone?: Tone;
  variant?: 'ring' | 'bare';
  className?: string;
}> = ({ href, label, network, platform, size = 'md', tone = 'light', variant = 'ring', className }) => {
  const key = platform ?? platformFromNetwork(network ?? '') ?? null;
  const hover = key
    ? (tone === 'dark' ? HOVER_DARK : HOVER_LIGHT)[key]
    : tone === 'dark'
      ? 'hover:text-white'
      : 'hover:text-ink-strong';
  const external = !href.startsWith('mailto:');
  const ring = variant === 'ring';
  const dims = size === 'md' ? 'h-11 w-11 sm:h-10 sm:w-10' : 'h-11 w-11 sm:h-9 sm:w-9';
  const glyph = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';

  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'group inline-flex items-center justify-center rounded-full',
        dims,
        'transition-[color,background-color,border-color,transform] duration-micro ease-out',
        'motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none',
        ring &&
          cn(
            'border bg-transparent motion-safe:hover:scale-105',
            tone === 'dark' ? 'border-white/15 text-white/70 hover:bg-white/5' : 'border-border-strong/60 text-ink-muted hover:bg-surface-muted/60',
            hover,
          ),
        !ring && cn('text-current', hover),
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex transition-transform duration-micro ease-out motion-safe:group-hover:scale-110 motion-reduce:transform-none',
          glyph,
        )}
      >
        {key ? (
          <SocialGlyph platform={key} className="h-full w-full" />
        ) : (
          <HugeiconsIcon icon={Link01Icon} strokeWidth={STROKE} className="h-full w-full" aria-hidden="true" focusable="false" />
        )}
      </span>
    </a>
  );
};

/**
 * The reusable row of social icon links. Address-less entries are dropped so no placeholder link
 * ever renders; each mark is a real anchor with a tooltip, an accessible name and native tab order.
 */
export const SocialLinks: React.FC<{
  links: SocialLinkItem[];
  size?: Size;
  tone?: Tone;
  className?: string;
  itemClassName?: string;
  showLabels?: boolean;
}> = ({ links, size = 'md', tone = 'light', className, itemClassName, showLabels = false }) => {
  const visible = links.filter((link) => link.href !== '' && link.href !== '#');
  if (visible.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap items-center gap-2.5 sm:gap-3', showLabels && 'gap-x-4 gap-y-2', className)}>
      {visible.map((link) => (
        <li key={link.id} className={cn(showLabels && 'inline-flex items-center gap-2')}>
          <SocialIconLink
            href={link.href}
            label={link.label}
            network={link.network}
            size={size}
            tone={tone}
            className={itemClassName}
          />
          {showLabels && (
            <span className={cn('text-xs font-bold', tone === 'dark' ? 'text-white/70' : 'text-ink-muted')}>
              {link.text ?? link.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
};