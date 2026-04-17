/**
 * TRADE AI — Unified Color System
 * Single source of truth for all page-level inline styles.
 * Backgrounds, borders, text colors are IDENTICAL across pages.
 * Per-page accent overrides allowed via spread: { ...C, accent: '#00e5ff' }
 *
 * Mirrors CSS variables in globals.css — keep in sync.
 */
export const C = {
  // Backgrounds — unified across all pages
  bg: '#06040a',
  surface: '#0d0a14',
  surfaceAlt: '#110e1a',
  card: '#110e1a',
  cardHover: '#181424',
  input: '#0a0810',

  // Borders — gold tinted
  border: 'rgba(212,175,55,0.12)',
  borderAlt: '#1e1828',
  borderLight: '#1e1828',
  borderFocus: '#DAA520',

  // Text
  text: '#eae6f0',
  textDim: '#9a93a8',
  muted: '#5e576e',
  mutedLight: '#9a93a8',
  white: '#edf2fb',

  // Accent palette
  gold: '#DAA520',
  goldBright: '#FFD700',
  green: '#00e676',
  greenBg: '#00e67614',
  red: '#DC143C',
  redBg: '#DC143C14',
  blue: '#3b82f6',
  blueBg: '#3b82f614',
  cyan: '#00e5ff',
  yellow: '#ffd740',
  yellowBg: '#ffd74014',
  orange: '#ff9100',
  purple: '#8b5cf6',
  purpleBg: '#8b5cf614',
  purpleDark: '#6d28d9',
  violet: '#8a6aff',
  dragon: '#8B0000',

  // Typography
  font: 'system-ui,-apple-system,"Segoe UI",sans-serif',
} as const;

/** Per-page accent override for Cockpit (cyan/violet theme) */
export const CockpitAccent = {
  bgDeep: '#05020d',
  bgViolet: '#0a0518',
  panelBg: 'rgba(18,10,36,0.62)',
  panelBorder: 'rgba(138,106,255,0.14)',
  panelBorderAccent: 'rgba(0,229,255,0.22)',
} as const;
