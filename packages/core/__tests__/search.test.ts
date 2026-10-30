import { editQuery, GENRE_FILTERS, KEY_ROWS, KIND_FILTERS, MAX_QUERY, typeKey } from '../src/search';
import type { MediaItem } from '../src/providers/types';
import { typeLabel, typeYearSubtitle } from '../src/util/format';

const item = (extra: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  title: 'T',
  kind: 'movie',
  resumeMs: 0,
  played: false,
  ...extra,
});

describe('keyboard', () => {
  it('has A to Z then 1 to 0, six to a row, each key once', () => {
    const keys = KEY_ROWS.flat();
    expect(KEY_ROWS.every(row => row.length === 6)).toBe(true);
    expect(keys).toHaveLength(36);
    expect(new Set(keys).size).toBe(36);
    expect(keys.slice(0, 26).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(keys.slice(26).join('')).toBe('1234567890');
  });
});

describe('query editing', () => {
  it('types lower case letters and digits', () => {
    expect(typeKey(typeKey(typeKey('', 'S'), 'P'), '7')).toBe('sp7');
  });

  it('stops growing at the longest query', () => {
    const full = 'a'.repeat(MAX_QUERY);
    expect(typeKey(full, 'B')).toBe(full);
    expect(editQuery(full, 'space')).toBe(full);
  });

  it('never starts with a space or doubles one', () => {
    expect(editQuery('', 'space')).toBe('');
    expect(editQuery('star', 'space')).toBe('star ');
    expect(editQuery('star ', 'space')).toBe('star ');
  });

  it('deletes one character, and Clear empties the box', () => {
    expect(editQuery('star', 'delete')).toBe('sta');
    expect(editQuery('', 'delete')).toBe('');
    expect(editQuery('star wars', 'clear')).toBe('');
  });
});

describe('filter chips', () => {
  it('match the mockups: Search has Episodes, Genres does not', () => {
    expect(KIND_FILTERS.map(f => f.label)).toEqual(['All', 'Movies', 'Series', 'Episodes']);
    expect(GENRE_FILTERS.map(f => f.label)).toEqual(['All libraries', 'Movies', 'Series']);
  });
});

describe('result captions', () => {
  it('names the kind and year, with Documentary for a documentary', () => {
    expect(typeYearSubtitle(item({ kind: 'movie', year: 2025 }))).toBe('Movie  ·  2025');
    expect(typeYearSubtitle(item({ kind: 'series', year: 2026 }))).toBe('Series  ·  2026');
    expect(typeLabel(item({ kind: 'episode' }))).toBe('Episode');
    expect(typeLabel(item({ kind: 'movie', genres: ['Drama', 'documentary'] }))).toBe('Documentary');
  });

  it('leaves out a missing year without a stray separator', () => {
    expect(typeYearSubtitle(item({ kind: 'series' }))).toBe('Series');
    expect(typeYearSubtitle(item({ kind: 'other' }))).toBe('');
  });
});
