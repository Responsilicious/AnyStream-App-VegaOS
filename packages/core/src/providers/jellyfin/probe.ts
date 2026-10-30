import { PROBE_TIMEOUT_MS } from '../../config';
import { serverUrlCandidates } from '../../util/url';
import { isJellyfinError, JellyfinError } from './errors';
import { JellyfinHttp, type DeviceInfo, type FetchLike } from './http';

export interface PublicServerInfo {
  Id: string;
  ServerName: string;
  Version: string;
  ProductName?: string;
}

export interface ProbeResult {
  baseUrl: string;
  info: PublicServerInfo;
}

/**
 * Finds a working Jellyfin server from what a person typed. Tries https and http as
 * appropriate and confirms the answer really is Jellyfin before anything is saved.
 */
export async function probeServer(
  input: string,
  device: DeviceInfo,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProbeResult> {
  const candidates = serverUrlCandidates(input);
  if (candidates.length === 0) {
    throw new JellyfinError('network', 'No server address entered');
  }

  let lastError: unknown;
  for (const baseUrl of candidates) {
    try {
      const http = new JellyfinHttp(baseUrl, device, undefined, options.fetchImpl);
      const info = await http.get<PublicServerInfo>('/System/Info/Public', {
        timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
        signal: options.signal,
      });
      if (!info || typeof info.Id !== 'string' || typeof info.ServerName !== 'string') {
        throw new JellyfinError('not-jellyfin', `Not a Jellyfin server: ${baseUrl}`);
      }
      return { baseUrl, info };
    } catch (e) {
      if (isJellyfinError(e) && e.kind === 'cancelled') {
        throw e;
      }
      // Keep the most informative failure: "reached something, but not Jellyfin" beats a certificate problem,
      // which beats "unreachable" (the http retry of an https address usually just fails to connect).
      if (failureRank(e) > failureRank(lastError)) {
        lastError = e;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new JellyfinError('network', 'Could not connect');
}

function failureRank(e: unknown): number {
  if (e === undefined) {
    return -1;
  }
  if (!isJellyfinError(e)) {
    return 0;
  }
  return e.kind === 'not-jellyfin' ? 3 : e.kind === 'certificate' ? 2 : 1;
}

/**
 * One address of a network search: its Jellyfin identity, or null. Uses only that exact URL (no https retry),
 * because a search asks hundreds of addresses.
 */
export async function identifyServer(
  baseUrl: string,
  device: DeviceInfo,
  options: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ id: string; name: string; address: string } | null> {
  const http = new JellyfinHttp(baseUrl, device, undefined, options.fetchImpl);
  const info = await http.get<PublicServerInfo>('/System/Info/Public', {
    timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
    signal: options.signal,
  });
  if (!info || typeof info.Id !== 'string' || typeof info.ServerName !== 'string') {
    return null;
  }
  return { id: info.Id, name: info.ServerName, address: baseUrl };
}
