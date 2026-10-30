import type { ExternalIds } from '../providers/types';

/**
 * Normalised external ids, read at the provider boundary. Values are compared as strings, so each namespace
 * has one spelling: IMDb as lower-case `tt` + digits, TMDB and TVDB as plain digits without leading zeros.
 * Anything else is dropped rather than guessed at: a wrong id merges different titles, a missing one only
 * leaves them as separate cards.
 */

export function normalizeImdb(value: unknown): string | undefined {
  const text = String(value ?? '').trim().toLowerCase();
  return /^tt\d{5,}$/.test(text) ? text : undefined;
}

export function normalizeNumericId(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    return undefined;
  }
  const stripped = text.replace(/^0+/, '');
  return stripped === '' ? undefined : stripped;
}

/** Builds an ExternalIds from loose values, or undefined when none is usable. */
export function externalIds(values: { tmdb?: unknown; imdb?: unknown; tvdb?: unknown }): ExternalIds | undefined {
  const ids: ExternalIds = {};
  const tmdb = normalizeNumericId(values.tmdb);
  const imdb = normalizeImdb(values.imdb);
  const tvdb = normalizeNumericId(values.tvdb);
  if (tmdb) {
    ids.tmdb = tmdb;
  }
  if (imdb) {
    ids.imdb = imdb;
  }
  if (tvdb) {
    ids.tvdb = tvdb;
  }
  return tmdb || imdb || tvdb ? ids : undefined;
}

/** Jellyfin and Emby `ProviderIds`. Key case varies between versions ("Tmdb", "IMDB"), so it is ignored. */
export function fromProviderIds(providerIds: Record<string, unknown> | undefined): ExternalIds | undefined {
  if (!providerIds) {
    return undefined;
  }
  const lower: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(providerIds)) {
    lower[key.toLowerCase()] = value;
  }
  return externalIds({ tmdb: lower.tmdb, imdb: lower.imdb, tvdb: lower.tvdb });
}

/**
 * Plex ids: the `Guid` list (`imdb://tt0133093`, `tmdb://603`, `tvdb://12345`) on the new agents, or a legacy
 * agent guid on the item itself (`com.plexapp.agents.imdb://tt0133093?lang=en`,
 * `com.plexapp.agents.themoviedb://603?lang=en`, `com.plexapp.agents.thetvdb://12345/1/2?lang=en`). A legacy
 * guid with season and episode parts names the series, not the episode, so it is skipped. `plex://` guids are
 * Plex's own and say nothing across servers.
 */
export function fromPlexGuids(guids: Array<{ id?: string }> | undefined, guid: string | undefined): ExternalIds | undefined {
  const values: { tmdb?: string; imdb?: string; tvdb?: string } = {};
  for (const entry of guids ?? []) {
    const match = /^(imdb|tmdb|tvdb):\/\/(.+)$/.exec(entry.id ?? '');
    if (match) {
      values[match[1] as 'imdb' | 'tmdb' | 'tvdb'] = match[2];
    }
  }
  const legacy = /^com\.plexapp\.agents\.(imdb|themoviedb|thetvdb):\/\/([^?]+)/.exec(guid ?? '');
  if (legacy && !legacy[2].includes('/')) {
    const [, agent, id] = legacy;
    if (agent === 'imdb') {
      values.imdb = values.imdb ?? id;
    } else if (agent === 'themoviedb') {
      values.tmdb = values.tmdb ?? id;
    } else {
      values.tvdb = values.tvdb ?? id;
    }
  }
  return externalIds(values);
}
