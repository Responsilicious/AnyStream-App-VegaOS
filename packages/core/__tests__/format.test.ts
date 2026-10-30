import type { MediaItem } from '../src/providers/types';
import { episodeLabel, formatMeta, formatRuntime, formatRuntimeCompact } from '../src/util/format';

const base: MediaItem = { id: 'i', title: 'T', kind: 'movie', resumeMs: 0, played: false };

describe('formatRuntime', () => {
  it('writes hours and minutes, dropping empty parts', () => {
    expect(formatRuntime(8180000)).toBe('2 h 16 min');
    expect(formatRuntime(7200000)).toBe('2 h');
    expect(formatRuntime(2700000)).toBe('45 min');
  });

  it('is blank when the runtime is unknown or under a minute', () => {
    expect(formatRuntime(undefined)).toBe('');
    expect(formatRuntime(0)).toBe('');
    expect(formatRuntime(30000)).toBe('');
  });
});

describe('formatMeta', () => {
  it('joins what is known, with at most three genres', () => {
    const text = formatMeta({
      ...base,
      year: 1999,
      officialRating: 'R',
      runtimeMs: 8180000,
      communityRating: 8.7,
      genres: ['Action', 'Sci-Fi', 'Thriller', 'Drama'],
    });
    expect(text).toBe('1999  ·  R  ·  2 h 16 min  ·  8.7/10  ·  Action, Sci-Fi, Thriller');
  });

  it('skips missing fields without stray separators', () => {
    expect(formatMeta({ ...base, year: 2020 })).toBe('2020');
    expect(formatMeta(base)).toBe('');
  });
});

describe('episodeLabel', () => {
  it('shows season and episode, or whichever is known', () => {
    expect(episodeLabel({ ...base, kind: 'episode', seasonIndex: 2, index: 5 })).toBe('S2 E5');
    expect(episodeLabel({ ...base, kind: 'episode', index: 5 })).toBe('E5');
    expect(episodeLabel(base)).toBe('');
  });
});

describe('formatRuntimeCompact', () => {
  it('writes hours with padded minutes, or plain minutes under an hour', () => {
    expect(formatRuntimeCompact(128 * 60000)).toBe('2h 08m');
    expect(formatRuntimeCompact(114 * 60000)).toBe('1h 54m');
    expect(formatRuntimeCompact(60 * 60000)).toBe('1h 00m');
    expect(formatRuntimeCompact(48 * 60000)).toBe('48 min');
  });

  it('is blank when unknown', () => {
    expect(formatRuntimeCompact(undefined)).toBe('');
    expect(formatRuntimeCompact(30000)).toBe('');
  });
});
