import { PLEX_PROBE_TIMEOUT_MS } from '../../config';
import type { PlexHttp } from './http';

/** The fields AnyStream reads from GET /api/v2/resources. */
interface RawConnection {
  protocol?: string;
  address?: string;
  port?: number;
  uri?: string;
  local?: boolean;
  relay?: boolean;
  IPv6?: boolean;
}

interface RawResource {
  name?: string;
  provides?: string;
  clientIdentifier?: string;
  owned?: boolean;
  accessToken?: string;
  sourceTitle?: string;
  presence?: boolean;
  connections?: RawConnection[];
}

export type PlexConnectionKind = 'local' | 'remote' | 'relay';

export interface PlexCandidate {
  uri: string;
  kind: PlexConnectionKind;
  secure: boolean;
}

/** One media server this Plex account may use. */
export interface PlexServerInfo {
  /** Plex's machineIdentifier: the stable id used to spot the same server at another address. */
  machineId: string;
  name: string;
  owned: boolean;
  /** For a shared server, whose it is. */
  ownerName?: string;
  /** This server's own token for this account. Never sent anywhere but this server. */
  accessToken: string;
  /** Addresses to try, best first. */
  candidates: PlexCandidate[];
}

/**
 * Best first: secure local, secure direct remote, plain-HTTP local (LAN servers without a certificate), relay
 * last. Plain HTTP to a remote address is never offered: the token would cross the internet in the clear.
 */
export function rankCandidates(connections: RawConnection[]): PlexCandidate[] {
  const seen = new Set<string>();
  const ranked: Array<PlexCandidate & { score: number }> = [];
  for (const c of connections) {
    if (!c.uri || seen.has(c.uri)) {
      continue;
    }
    const secure = c.protocol === 'https' || c.uri.startsWith('https://');
    const kind: PlexConnectionKind = c.relay ? 'relay' : c.local ? 'local' : 'remote';
    if (!secure && kind !== 'local') {
      continue;
    }
    seen.add(c.uri);
    const score = kind === 'relay' ? 3 : !secure ? 2 : kind === 'local' ? 0 : 1;
    ranked.push({ uri: c.uri, kind, secure, score: score * 2 + (c.IPv6 ? 1 : 0) });
  }
  return ranked.sort((a, b) => a.score - b.score).map(({ score: _score, ...rest }) => rest);
}

export function parseResources(raw: unknown): PlexServerInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const servers: PlexServerInfo[] = [];
  const seen = new Set<string>();
  for (const r of raw as RawResource[]) {
    const provides = (r.provides ?? '').split(',');
    if (!provides.includes('server') || !r.clientIdentifier || !r.accessToken || seen.has(r.clientIdentifier)) {
      continue;
    }
    seen.add(r.clientIdentifier);
    servers.push({
      machineId: r.clientIdentifier,
      name: r.name || 'Plex server',
      owned: r.owned === true,
      ownerName: r.owned ? undefined : r.sourceTitle,
      accessToken: r.accessToken,
      candidates: rankCandidates(r.connections ?? []),
    });
  }
  return servers;
}

/** Every server this account can use, owned or shared, with each server's own token. */
export async function listPlexServers(account: PlexHttp, signal?: AbortSignal): Promise<PlexServerInfo[]> {
  const raw = await account.get<unknown>('/api/v2/resources', {
    query: { includeHttps: 1, includeRelay: 1, includeIPv6: 1 },
    signal,
  });
  return parseResources(raw);
}

export type Reachability =
  | { status: 'online'; uri: string; kind: PlexConnectionKind }
  | { status: 'unreachable' };

/**
 * Tries each address in order until one answers as this server. /identity needs no token, so nothing secret
 * goes to an address before it has proved to be the right machine.
 */
export async function findReachable(
  base: PlexHttp,
  server: PlexServerInfo,
  signal?: AbortSignal,
): Promise<Reachability> {
  for (const candidate of server.candidates) {
    if (signal?.aborted) {
      break;
    }
    try {
      const reply = await base
        .at(candidate.uri, undefined)
        .get<{ MediaContainer?: { machineIdentifier?: string } }>('/identity', { timeoutMs: PLEX_PROBE_TIMEOUT_MS, signal });
      if (reply?.MediaContainer?.machineIdentifier === server.machineId) {
        return { status: 'online', uri: candidate.uri, kind: candidate.kind };
      }
    } catch {
      // Next address.
    }
  }
  return { status: 'unreachable' };
}

export interface PlexUser {
  id: string;
  name: string;
}

export async function getPlexUser(account: PlexHttp, signal?: AbortSignal): Promise<PlexUser> {
  const user = await account.get<{ id?: number; uuid?: string; username?: string; title?: string; friendlyName?: string }>(
    '/api/v2/user',
    { signal },
  );
  return {
    id: String(user?.uuid ?? user?.id ?? ''),
    name: user?.friendlyName || user?.title || user?.username || 'Plex user',
  };
}
