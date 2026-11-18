import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { durations, easings } from '../motion/tokens'
import { PALETTE } from '../theme/palette'

/*
 * The token layer is only a single source of truth if something enforces it. These four checks are
 * that enforcement, and they are the reason a new screen cannot quietly hard-code a colour:
 *
 *   1. no colour literal anywhere in src except the two token files
 *   2. no colour *invented* by the token layer — every value must have been in the product already
 *   3. the JS palette cannot hold a colour the CSS layer does not declare
 *   4. the CSS motion tokens must equal the ones src/motion/tokens.ts animates with
 */

const SRC = join(process.cwd(), 'src')
const TOKEN_CSS = 'src/styles/tokens.css'
const TOKEN_JS = 'src/theme/palette.ts'

/** `#abc`, `#abcd`, `#abcdef`, `#abcdef12` — and nothing that merely starts with hex-looking text. */
const COLOR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g
/**
 * The same literal URL-encoded, because `background-image: url("data:image/svg+xml,…%2394a3b8…")`
 * is how a colour sneaks into a build without a `#` anywhere in the source. An inline SVG element is
 * the alternative that a token can actually reach.
 */
const COLOR_URI = /%23([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g

function normalize(literal: string): string {
  const hex = literal.replace(/^%23/, '').replace(/^#/, '').toLowerCase()
  if (hex.length === 3) return hex.split('').map((c) => c + c).join('')
  if (hex.length === 4) return hex.split('').map((c) => c + c).join('')
  return hex
}

function literalsIn(text: string): string[] {
  return [...text.matchAll(COLOR), ...text.matchAll(COLOR_URI)].map((m) => normalize(m[0]))
}

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(css|ts|tsx)$/.test(entry)) out.push(relative(SRC, full).split(sep).join('/'))
    }
  }
  walk(SRC)
  return out.sort()
}

const files = sourceFiles()
const read = (repoPath: string) => readFileSync(join(process.cwd(), repoPath), 'utf8')

/**
 * Copy that quotes the brand palette as text — the public standards blurb names Navy and Orange by
 * their hex, for a reader who is being told what the colours are. That literal is content, not a
 * colour the app renders, so it is exempt. The exemption is per file: nothing else can hide behind
 * it, and a screen cannot become copy by adding itself to this set without a reviewer seeing why.
 */
const BRAND_COPY = new Set(['data/referenceContent.ts'])

const PRE_EXISTING_COLORS = new Set([
  '000000', '00000000', '020617', '050505', '0a2239', '0b0a0c', '0b0b0d', '0d0d0d', '0d2c47',
  '0d2c48', '0d6b45', '0e2f4d', '0f0e11', '0f172a', '10b981', '123b60', '16181d', '171310',
  '1b1512', '1d5485', '1e293b', '2c241d', '2e7d5b', '334155', '3a2a1c', '475569', '55381d',
  '5a3418', '5b5249', '5b6068', '6366f1', '64748b', '6b5335', '7a4d05', '7a5832', '7a7f88',
  '8a8f98', '8b5cf6', '8d8075', '8f1f2e', '94a3b8', '9ec5e8', 'a6e6c5', 'b3b8bf', 'c3b7ab',
  'cbd5e1', 'd47f0a', 'd9430f', 'e2e8f0', 'e9e4db', 'ec4899', 'edf0e8', 'efe7d6', 'efe9e1',
  'f1f5f9', 'f4f1ec', 'f59a16', 'f5b64f', 'f6f3ee', 'f6f4f1', 'f8f5f0', 'f8fafc', 'fdfbf7',
  'ff4a12', 'ff5a1f', 'ff6b2c', 'ff7a3c', 'ff8a3d', 'ffaf38', 'ffb06a', 'ffb3bd', 'ffd8a0',
  'ffd9b5', 'ffe1d3', 'ffe9c9', 'fff3e6', 'ffffff',
])

describe('token layer hygiene', () => {
  it('keeps colour literals inside the token files', () => {
    const offenders = files
      .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
      .filter((f) => f !== 'styles/tokens.css' && f !== 'theme/palette.ts')
      .filter((f) => !BRAND_COPY.has(f))
      .filter((f) => literalsIn(read(join('src', f))).length > 0)

    expect(offenders).toEqual([])
  })

  it('invents no colour of its own', () => {
    const introduced = [...new Set([...literalsIn(read(TOKEN_CSS)), ...literalsIn(read(TOKEN_JS))])]
      .filter((hex) => !PRE_EXISTING_COLORS.has(hex))

    expect(introduced, 'new hex values outside the palette the product already rendered').toEqual([])
  })

  it('declares every JS palette colour as a CSS primitive too', () => {
    const css = literalsIn(read(TOKEN_CSS))
    const missing = Object.entries(PALETTE)
      .map(([name, value]) => [name, normalize(value)] as const)
      .filter(([, hex]) => !css.includes(hex))
      .map(([name]) => name)

    expect(missing, 'palette.ts entries with no matching value in tokens.css').toEqual([])
  })

  it('publishes a semantic alias for each role a screen needs', () => {
    const css = read(TOKEN_CSS)
    for (const role of [
      'bg', 'surface', 'surface-raised', 'surface-muted', 'border', 'border-strong', 'text',
      'text-muted', 'brand', 'accent', 'accent-strong', 'focus', 'overlay', 'success', 'danger',
    ]) {
      expect(css).toContain(`--app-${role}: `)
    }
  })

  it('holds the Edge Function mail copy inside the palette', () => {
    // `supabase/functions/_shared/email.ts` restates the mail chrome because an Edge bundle cannot
    // import from src/. It is the one place outside the token files a colour may be written down —
    // so it may only write down a colour the palette already owns, and the byte-compare in
    // emailTemplates.server.test.ts keeps the two renderers identical.
    const allowed = new Set(Object.values(PALETTE).map(normalize))
    const mail = readFileSync(join(process.cwd(), 'supabase/functions/_shared/email.ts'), 'utf8')
    const outside = [...new Set(literalsIn(mail))].filter((hex) => !allowed.has(hex))

    expect(outside, 'the server mail template uses a colour the token layer does not declare').toEqual([])
  })

  it('agrees with src/motion/tokens.ts on timing', () => {
    const css = read(TOKEN_CSS)
    for (const [name, seconds] of Object.entries(durations)) {
      const token = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      expect(`${css}\n`, `--transition-duration-${token}`).toContain(
        `--transition-duration-${token}: ${Math.round(seconds * 1000)}ms;`
      )
    }
    for (const [name, curve] of Object.entries(easings)) {
      if (!Array.isArray(curve)) continue
      const token = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      expect(css, `--ease-${token}`).toContain(`--ease-${token}: cubic-bezier(${curve.join(', ')})`)
    }
  })

  it('publishes the timing tokens under the namespaces Tailwind actually reads', () => {
    // Found by the kit: a `--duration-micro` declaration is a perfectly good custom property and a
    // perfectly useless `duration-micro` utility, because Tailwind v4 looks durations up under
    // `--transition-duration-*`. Nothing in TypeScript or in a jsdom test notices the difference —
    // the animation simply never gets its length. So the namespace itself is asserted here.
    const theme = read(TOKEN_CSS).split('@theme inline {')[1]?.split('\n}')[0] ?? ''
    expect(theme, 'the @theme inline block must be present').not.toBe('')

    for (const name of Object.keys(durations)) {
      const token = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      expect(theme).toContain(`--transition-duration-${token}:`)
    }
    expect(theme).not.toMatch(/--duration-[a-z]+:/)
    for (const [name, curve] of Object.entries(easings)) {
      // A spring has no CSS transition equivalent, so it is deliberately absent from the theme block.
      if (!Array.isArray(curve)) continue
      const token = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      expect(theme).toContain(`--ease-${token}:`)
    }
  })

})
