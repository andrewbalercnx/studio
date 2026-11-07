/**
 * Shared visual identity for the StoryPic Kids app, aligned with the website
 * (lavender-violet primary, sky-blue accent, PT Sans). The old amber survives
 * only as `spark` — the logo glint and the "new story" moment.
 */

export const colors = {
  // brand
  primary: '#7c6ae0',       // lavender — main actions (web hsl 259 74% 75%, deepened for white text)
  primaryDark: '#4b3b86',   // strong headings / text on light
  primaryText: '#5b4ba0',   // body-weight lavender text
  primaryLight: '#ede7fb',  // tinted cards / fills
  primaryTint: '#faf7ff',   // faintest lavender wash
  accent: '#6e9bf0',        // sky blue
  spark: '#f59e0b',         // warm amber — used sparingly

  // surfaces
  background: '#f4f1fb',    // app background (web hsl 260 42% 96%)
  surface: '#ffffff',
  border: '#e3d9f8',

  // ink / neutrals (lavender-biased)
  ink: '#2e2a3a',
  inkSoft: '#6e6880',
  inkFaint: '#9a93ad',

  // semantic (unchanged)
  success: '#10b981',
  danger: '#ef4444',
  dangerDark: '#dc2626',
  white: '#ffffff',
} as const;

export const font = {
  regular: 'PTSans_400Regular',
  bold: 'PTSans_700Bold',
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
} as const;
