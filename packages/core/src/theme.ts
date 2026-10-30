import { px } from './layout';

/** 10-foot UI: deep navy, one cyan accent, high contrast. Values follow docs/design.md section 8. */
export const colors = {
  background: '#0B101B',
  surface: '#172131',
  surfaceFocused: '#22304A',
  text: '#F5F7FB',
  textMuted: '#B8C3D3',
  accent: '#67D8EF',
  /** Text on an accent-coloured button: dark, because white on cyan is too faint. */
  accentText: '#0B101B',
  danger: '#FF8A8A',
  focusRing: '#FFFFFF',
};

/** All sizes are 1080p design pixels converted for the real window (see layout.ts). */
export const spacing = {
  safeMargin: px(96),
  gap: px(16),
  gapLarge: px(32),
};

/** Text sizes (docs/design.md section 4). Never go below `caption`. */
export const type = {
  featured: px(52),
  title: px(40),
  heading: px(34),
  card: px(28),
  body: px(24),
  caption: px(22),
};

/** Marks for each kind of server on search cards (docs/cross-server-search.md); shapes only, no brand artwork. */
export const providerColors = {
  plex: '#E5A00D',
  jellyfin: '#AA5CC3',
  emby: '#52B54B',
  many: '#67D8EF',
};

/** The dark chip over artwork that names a card's server, readable on bright stills. */
export const badgeBackground = 'rgba(11, 16, 27, 0.85)';

export const focus = {
  borderWidth: px(4),
  /** Kept subtle so a focused card does not clip against its neighbours. */
  scale: 1.04,
};
