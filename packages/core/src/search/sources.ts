import type { ConnectionStore } from '../connections/connectionStore';
import { contextKey } from '../connections/model';
import { isJellyfinError } from '../providers/jellyfin/errors';
import { isPlexError } from '../providers/plex/errors';
import type { MediaItem } from '../providers/types';
import { providerName } from '../servers';
import { ALL_SOURCES, type FailureKind, type SearchScope, type SearchSnapshot } from './controller';
import type { SearchGroup, SearchSource, SourceHit } from './model';

/** Words and choices for cross-server search, kept apart from the screen so they can be unit-tested. */

/** A short fingerprint of a token: changes when the token does, but cannot be turned back into it. In memory only. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Every saved connection as a search source: its currently selected profile and nothing broader. No other
 * user is discovered and no owner token stands in for a profile's; a connection without a usable sign-in is
 * listed so the screen can say so, but is never asked.
 */
export function searchSources(store: ConnectionStore): SearchSource[] {
  return store.list().map(view => {
    const token = store.getSecret(view.connection.credentialRef);
    const signedIn = !!token && view.account.authStatus !== 'expired';
    return {
      key: view.connection.id,
      contextKey: contextKey(view.connection),
      provider: view.server.provider,
      serverId: view.server.nativeId,
      label: view.displayName,
      profileName: view.connection.profileName,
      revision: [view.connection.profileId, view.connection.credentialRef, view.account.authStatus, token ? fingerprint(token) : '-'].join('|'),
      signedIn,
    };
  });
}

/**
 * The name to show for each source: the server's name, then the provider when two servers share a name, then
 * the profile when the same server is saved for two people.
 */
export function sourceLabels(sources: SearchSource[]): Map<string, string> {
  const count = (keyOf: (s: SearchSource) => string) => {
    const counts = new Map<string, number>();
    for (const s of sources) {
      counts.set(keyOf(s), (counts.get(keyOf(s)) ?? 0) + 1);
    }
    return counts;
  };
  const byName = count(s => s.label);
  const byNameProvider = count(s => `${s.label}\u0000${s.provider}`);
  const labels = new Map<string, string>();
  for (const s of sources) {
    let label = s.label;
    if ((byName.get(s.label) ?? 0) > 1) {
      label = `${label} (${providerName(s.provider)})`;
    }
    if ((byNameProvider.get(`${s.label}\u0000${s.provider}`) ?? 0) > 1) {
      label = `${label} · ${s.profileName}`;
    }
    labels.set(s.key, label);
  }
  return labels;
}

/**
 * Which servers a search covers before the user picks. One viewer: every server. Several people on this TV:
 * only the active server, until the viewer chooses more (docs/cross-server-search.md §1). Profile names cannot
 * tell people apart across providers (one person is "will" on Jellyfin and "will_plex" on Plex), so the only
 * sure sign of a second person is the same server saved under two different profiles.
 */
export function defaultScope(sources: SearchSource[], activeKey: string | undefined): SearchScope {
  const profiles = new Map<string, Set<string>>();
  for (const s of sources) {
    const server = `${s.provider}:${s.serverId}`;
    const seen = profiles.get(server) ?? new Set<string>();
    seen.add(s.contextKey);
    profiles.set(server, seen);
  }
  const shared = [...profiles.values()].some(seen => seen.size > 1);
  if (shared && activeKey && sources.some(s => s.key === activeKey)) {
    return activeKey;
  }
  return ALL_SOURCES;
}

/** Sorts a provider failure into what search shows. */
export function classifySearchError(error: unknown): FailureKind {
  if (isJellyfinError(error) || isPlexError(error)) {
    switch (error.kind) {
      case 'cancelled':
        return 'cancelled';
      case 'unauthorized':
        return 'auth-required';
      case 'forbidden':
        return 'denied';
      case 'timeout':
        return 'timed-out';
      default:
        return 'unavailable';
    }
  }
  return 'unavailable';
}

/** The chip over a card's artwork: "On 3 servers", or the one server's provider (or name, when two share a provider). */
export interface CardBadge {
  kind: SearchSource['provider'] | 'many';
  label: string;
  /** The single server it is on is the one being shown. */
  current: boolean;
}

export function cardBadge(group: SearchGroup, labels: Map<string, string>, sources: SearchSource[], activeKey: string | undefined): CardBadge {
  const keys = [...new Set(group.hits.map(h => h.sourceKey))];
  if (keys.length > 1) {
    return { kind: 'many', label: `On ${keys.length} servers`, current: false };
  }
  const source = sources.find(s => s.key === keys[0]);
  const provider = source?.provider ?? group.display.ref.provider;
  const sameProvider = sources.filter(s => s.provider === provider).length;
  const label = sameProvider > 1 ? labels.get(keys[0]) ?? source?.label ?? providerName(provider) : providerName(provider);
  return { kind: provider, label, current: keys[0] === activeKey };
}

/** The providers a search covers, for the line beside the heading: "Jellyfin · Plex · Emby". */
export function providersLine(sources: SearchSource[]): string {
  return [...new Set(sources.filter(s => s.signedIn).map(s => providerName(s.provider)))].join('  ·  ');
}

/** One line for a copy in the source or copy chooser. */
export function hitDetail(item: MediaItem): string {
  const parts: string[] = [];
  if (item.year) {
    parts.push(String(item.year));
  }
  if (item.runtimeMs) {
    const minutes = Math.round(item.runtimeMs / 60000);
    parts.push(minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);
  }
  if (item.played) {
    parts.push('Watched');
  } else if (item.resumeMs > 0) {
    parts.push('Started');
  }
  return parts.join('  ·  ');
}

/** Choices for a group's copies: one per copy, the server's name, and "copy 2" when one server has two. */
export function copyChoices(hits: SourceHit[], labels: Map<string, string>): Array<{ hit: SourceHit; label: string; detail: string }> {
  const perSource = new Map<string, number>();
  for (const hit of hits) {
    perSource.set(hit.sourceKey, (perSource.get(hit.sourceKey) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return hits.map(hit => {
    const n = (seen.get(hit.sourceKey) ?? 0) + 1;
    seen.set(hit.sourceKey, n);
    const name = labels.get(hit.sourceKey) ?? hit.sourceKey;
    return { hit, label: (perSource.get(hit.sourceKey) ?? 0) > 1 ? `${name}, copy ${n}` : name, detail: hitDetail(hit.item) };
  });
}

/** The status line over the results: what is still running and what went wrong, in plain words. */
export function searchStatus(snapshot: SearchSnapshot, labels: Map<string, string>): { line?: string; empty?: string } {
  const { states, groups, pending, request } = snapshot;
  const term = request.query.trim();
  if (!term || states.length === 0) {
    return {};
  }
  const name = (key: string) => labels.get(key) ?? key;
  const failed = states.filter(s => s.status === 'unavailable' || s.status === 'timed-out' || s.status === 'denied');
  const signIn = states.filter(s => s.status === 'auth-required');
  const complete = states.filter(s => s.status === 'complete');
  const parts: string[] = [];
  if (pending > 0) {
    parts.push(complete.length > 0 || failed.length > 0 ? `Searching ${pending} more ${pending === 1 ? 'server' : 'servers'}…` : 'Searching…');
  }
  if (failed.length > 0) {
    parts.push(`Couldn't search ${listNames(failed.map(s => name(s.source.key)))}.`);
  }
  if (signIn.length > 0) {
    parts.push(`${listNames(signIn.map(s => name(s.source.key)))} ${signIn.length === 1 ? 'needs' : 'need'} you to sign in again.`);
  }
  let empty: string | undefined;
  if (pending === 0 && groups.length === 0) {
    if (complete.length === 0) {
      empty = signIn.length === states.length ? 'Sign in again to search.' : "Couldn't search any of your servers.";
    } else if (failed.length > 0 || signIn.length > 0) {
      empty = `No results for “${term}” on the servers that answered.`;
    } else {
      empty = `No results for “${term}”.`;
    }
  }
  return { line: parts.length > 0 ? parts.join('  ') : undefined, empty };
}

function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
