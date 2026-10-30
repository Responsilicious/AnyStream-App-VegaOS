import { SESSION_CHECK_TIMEOUT_MS } from '../config';
import { checkSession, httpForServer } from '../providers/jellyfin';
import type { DeviceInfo, FetchLike } from '../providers/jellyfin/http';
import { isPlexError, PlexHttp } from '../providers/plex';
import { isJellyfinFamily } from '../providers/types';
import type { ConnectionStore } from './connectionStore';
import type { ConnectionStatus } from './model';

export interface StatusCheck {
  status: ConnectionStatus;
  /** The address that answered, when it is not the first saved one. */
  workingEndpoint?: string;
  /** The address that answered, whichever it was. */
  endpoint?: string;
}

/**
 * The address that answered moves to the front of the saved list, so the session built next uses it. On the
 * stick, a Plex server's https plex.direct address can fail certificate checks (its Let's Encrypt chain is newer
 * than Vega's CA store, 29 Oct 2026) while plain http on the LAN works; without this the app kept using the
 * failing address after the check had found a working one.
 */
function answered(store: ConnectionStore, serverId: string, endpoints: string[], endpoint: string): StatusCheck {
  if (endpoint === endpoints[0]) {
    return { status: 'online', endpoint };
  }
  store.updateEndpoints(serverId, [endpoint, ...endpoints]);
  return { status: 'online', endpoint, workingEndpoint: endpoint };
}

/**
 * Is this saved connection usable right now? Unreachable and signed-out are different answers: an offline
 * server keeps its sign-in, and a refused token keeps its server entry (spec §5, §11). Cancellation rejects.
 */
export async function checkConnection(
  store: ConnectionStore,
  id: string,
  device: DeviceInfo,
  signal?: AbortSignal,
  fetchImpl?: FetchLike,
): Promise<StatusCheck> {
  const view = store.get(id);
  if (!view) {
    return { status: 'unavailable' };
  }
  const token = store.getSecret(view.connection.credentialRef);
  if (!token || view.account.authStatus === 'expired') {
    return { status: 'auth-required' };
  }
  const endpoints = view.server.endpoints;

  if (isJellyfinFamily(view.server.provider)) {
    const session = store.toSession(id);
    if (!session) {
      return { status: 'auth-required' };
    }
    for (const endpoint of endpoints) {
      const server = { ...session.server, baseUrl: endpoint };
      const result = await checkSession(httpForServer(server, device, undefined, fetchImpl), { ...session, server }, signal, SESSION_CHECK_TIMEOUT_MS);
      if (result === 'ok') {
        return answered(store, view.server.id, endpoints, endpoint);
      }
      if (result === 'expired') {
        return { status: 'auth-required' };
      }
    }
    return { status: 'unavailable' };
  }

  // Plex: prove the address is this machine before handing it the token, then try the token.
  for (const endpoint of endpoints) {
    if (signal?.aborted) {
      break;
    }
    const open = new PlexHttp(endpoint, device, undefined, fetchImpl);
    try {
      const identity = await open.get<{ MediaContainer?: { machineIdentifier?: string } }>('/identity', { signal, timeoutMs: SESSION_CHECK_TIMEOUT_MS });
      if (identity?.MediaContainer?.machineIdentifier !== view.server.nativeId) {
        continue;
      }
      await open.withToken(token).get('/library/sections', { signal, timeoutMs: SESSION_CHECK_TIMEOUT_MS });
      return answered(store, view.server.id, endpoints, endpoint);
    } catch (e) {
      if (!isPlexError(e)) {
        continue;
      }
      switch (e.kind) {
        case 'cancelled':
          throw e;
        case 'unauthorized':
          return { status: 'auth-required' };
        case 'forbidden':
          return { status: 'permission-denied' };
        case 'rate-limited':
          return { status: 'rate-limited' };
        default:
          continue;
      }
    }
  }
  if (signal?.aborted) {
    throw new Error('cancelled');
  }
  return { status: 'unavailable' };
}
