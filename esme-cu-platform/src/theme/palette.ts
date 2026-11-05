/*
 * The JS half of the token layer.
 *
 * Screens style themselves through CSS custom properties, but three kinds of colour cannot live
 * there: SVG fills handed to Recharts as plain strings, WebGL/GSAP scene colours, and the inline
 * styles an HTML email or a printable report has to carry (email clients and print pipelines strip
 * custom properties). Those consumers read this file.
 *
 * Every value here is also a primitive in src/styles/tokens.css — tokens.test.ts asserts that, so
 * the two halves cannot drift and no colour can exist only in JS.
 */

export const PALETTE = {
  navy: '#123B60',
  navyLight: '#1D5485',
  navyMid: '#0E2F4D',
  navyDark: '#0A2239',
  navyDeep: '#0D2C47',
  navyAbyss: '#0D2C48',

  orange: '#F59A16',
  orangeLight: '#FFAF38',
  orangeDark: '#D47F0A',
  orangeInk: '#7A4D05',

  white: '#FFFFFF',
  black: '#000000',
  ivory: '#FDFBF7',

  slate950: '#020617',
  slate900: '#0F172A',
  slate800: '#1E293B',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748B',
  slate400: '#94A3B8',
  slate300: '#CBD5E1',
  slate200: '#E2E8F0',
  slate100: '#F1F5F9',
  slate50: '#F8FAFC',

  paper100: '#F8F5F0',
  paper200: '#F6F4F1',
  paper300: '#F6F3EE',
  paper400: '#F4F1EC',
  paper500: '#EFE9E1',
  paper600: '#EFE7D6',
  paper700: '#E9E4DB',
  paper800: '#EDF0E8',
  clay500: '#C3B7AB',
  clay600: '#8D8075',
  clay700: '#5B5249',
  stone400: '#B3B8BF',
  stone500: '#8A8F98',
  stone600: '#7A7F88',
  stone700: '#5B6068',

  ink900: '#050505',
  ink800: '#0D0D0D',
  ink700: '#0B0B0D',
  ink600: '#0B0A0C',
  ink500: '#0F0E11',
  ink400: '#171310',
  ink300: '#1B1512',
  ink200: '#16181D',

  ember100: '#FFF3E6',
  ember200: '#FFE9C9',
  ember300: '#FFD9B5',
  ember400: '#FFD8A0',
  ember500: '#FFE1D3',
  ember600: '#FFB06A',
  ember700: '#FF8A3D',
  ember800: '#FF7A3C',
  ember900: '#FF6B2C',
  ember1000: '#FF5A1F',
  ember1100: '#FF4A12',
  ember1200: '#F5B64F',
  ember1300: '#D9430F',

  wood100: '#7A5832',
  wood200: '#6B5335',
  wood300: '#5A3418',
  wood400: '#55381D',
  wood500: '#3A2A1C',
  wood600: '#2C241D',

  green: '#10B981',
  greenDark: '#0D6B45',
  greenMid: '#2E7D5B',
  greenPale: '#A6E6C5',
  red: '#8F1F2E',
  redPale: '#FFB3BD',
  pink: '#EC4899',
  violet: '#8B5CF6',
  indigo: '#6366F1',
  bluePale: '#9EC5E8',
} as const

export type PaletteColor = keyof typeof PALETTE

/**
 * One categorical ramp for every chart in the product. Six steps: the two brand colours first, then
 * hues that stay distinguishable for the most common colour-vision deficiencies and on a projector.
 */
export const CHART_SERIES = [
  PALETTE.navy,
  PALETTE.orange,
  PALETTE.green,
  PALETTE.indigo,
  PALETTE.pink,
  PALETTE.violet,
] as const

/** Axis and tooltip chrome — charts read these instead of picking their own greys. */
export const CHART_CHROME = {
  axis: PALETTE.slate400,
  tooltipBackground: PALETTE.slate900,
  tooltipText: PALETTE.white,
} as const
