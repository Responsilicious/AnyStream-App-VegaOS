import { PROBE_TIMEOUT_MS } from '../../config';
import { joinUrl, serverUrlCandidates } from '../../util/url';
import { isJellyfinError, JellyfinError } from './errors';
import { JellyfinHttp, type ApiDialect, type DeviceInfo, type FetchLike } from './http';

export interface PublicServerInfo {
  Id: string;
  ServerName: string;
  Version: string;
  ProductName?: string;
}

export interface ProbeResult {
  /** The API base: the address typed, or Emby's `/emby` path under it when only that answered. */
  baseUrl: string;
  info: PublicServerInfo;
  product: ApiDialect;
}

/**
 * Which product answered `/System/Info/Public`. Jellyfin names itself in `ProductName` ("Jellyfin Server") and is
 * on version 10 or later; Emby leaves `ProductName` out or names Emby, and is on 4.x. Null when neither is clear.
 */
export function serverProduct(info: PublicServerInfo): ApiDialect | null {
  const name = info.ProductName ?? '';
  if (/jellyfin/i.test(name)) {
    return 'jellyfin';
  }
  if (/emby/i.test(name)) {
    return 'emby';
  }
  const major = Number(/^(\d+)\./.exec(info.Version ?? '')?.[1]);
  if (!Number.isFinite(major)) {
    return null;
  }
  return major >= 10 ? 'jellyfin' : 'emby';
}

/**
 * The API bases to try for one candidate address. Emby serves its API under `/emby` (its own apps always use
 * that path) and usually at the root too; a reverse proxy may forward only one of them. Jellyfin needs no
 * prefix. An address that already ends in `/emby` is used as it is, so the path is never doubled.
 */
function apiBases(baseUrl: string, product: ApiDialect): string[] {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (product === 'jellyfin' || /\/emby$/i.test(trimmed)) {
    return [trimmed];
  }
  return [trimmed, joinUrl(trimmed, '/emby')];
}

function isServerInfo(info: PublicServerInfo | undefined): info is PublicServerInfo {
  return !!info && typeof info.Id === 'string' && typeof info.ServerName === 'string';
}

/**
 * Finds a working server of the chosen kind from what a person typed. Tries https and http as appropriate and
 * confirms which product answered before anything is saved. A server that clearly is the other product fails
 * with 'wrong-product' and its `detected` kind, so the screen can offer to connect it that way instead; it
 * never quietly signs in through the other adapter.
 */
export async function probeServer(
  input: string,
  device: DeviceInfo,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal; product?: ApiDialect } = {},
): Promise<ProbeResult> {
  const product = options.product ?? 'jellyfin';
  const candidates = serverUrlCandidates(input);
  if (candidates.length === 0) {
    throw new JellyfinError('network', 'No server address entered');
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    for (const baseUrl of apiBases(candidate, product)) {
      try {
        const http = new JellyfinHttp(baseUrl, device, undefined, options.fetchImpl, product);
        const info = await http.get<PublicServerInfo>('/System/Info/Public', {
          timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
          signal: options.signal,
        });
        if (!isServerInfo(info)) {
          throw new JellyfinError('not-jellyfin', `Not a ${product} server: ${baseUrl}`);
        }
        const found = serverProduct(info);
        if (found && found !== product) {
          throw new JellyfinError('wrong-product', `${baseUrl} is ${found}, not ${product}`, undefined, found);
        }
        return { baseUrl, info, product };
      } catch (e) {
        if (isJellyfinError(e) && e.kind === 'cancelled') {
          throw e;
        }
        if (failureRank(e) > failureRank(lastError)) {
          lastError = e;
        }
        // Nothing listens at this address at all: its `/emby` path will not answer either.
        if (isJellyfinError(e) && (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'certificate')) {
          break;
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new JellyfinError('network', 'Could not connect');
}

/**
 * Keep the most informative failure: "it is the other product" beats "reached something, but not a server
 * we know", which beats a certificate problem, which beats "unreachable" (the http retry of an https address
 * usually just fails to connect).
 */
function failureRank(e: unknown): number {
  if (e === undefined) {
    return -1;
  }
  if (!isJellyfinError(e)) {
    return 0;
  }
  switch (e.kind) {
    case 'wrong-product':
      return 4;
    case 'not-jellyfin':
    case 'not-found':
      return 3;
    case 'certificate':
      return 2;
    default:
      return 1;
  }
}

/**
 * One address of a network search: its identity and product, or null. Uses only that exact URL (no https
 * retry), because a search asks hundreds of addresses. An Emby server that only answers under `/emby` is
 * asked there next, but only when the root answered with a 404: an empty address costs one request.
 */
export async function identifyServer(
  baseUrl: string,
  device: DeviceInfo,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ id: string; name: string; address: string; product: ApiDialect } | null> {
  const ask = async (url: string) => {
    const http = new JellyfinHttp(url, device, undefined, options.fetchImpl);
    const info = await http.get<PublicServerInfo>('/System/Info/Public', {
      timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
      signal: options.signal,
    });
    const product = isServerInfo(info) ? serverProduct(info) : null;
    return isServerInfo(info) && product ? { id: info.Id, name: info.ServerName, address: url, product } : null;
  };
  try {
    return await ask(baseUrl);
  } catch (e) {
    if (isJellyfinError(e) && e.kind === 'not-found') {
      return ask(joinUrl(baseUrl, '/emby'));
    }
    throw e;
  }
}
