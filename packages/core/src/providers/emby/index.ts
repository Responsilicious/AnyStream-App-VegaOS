import { buildQuery, joinUrl } from '../../util/url';
import { createJellyfinProvider, httpForServer, type JellyfinProvider } from '../jellyfin';
import { isJellyfinError } from '../jellyfin/errors';
import type { DeviceInfo, FetchLike } from '../jellyfin/http';
import type { DeviceCapabilities, ServerRecord, Session } from '../types';

/**
 * Emby (docs/emby.md). Browsing, playback, progress and filters reuse the Jellyfin provider, which speaks
 * Emby's headers when the server's kind is 'emby'. What only Emby has lives here: the public user list
 * shown before sign-in. Emby has no Quick Connect, and Emby Connect is not built yet.
 */

export function createEmbyProvider(session: Session, device: DeviceInfo, caps: DeviceCapabilities, fetchImpl?: FetchLike): JellyfinProvider {
  return createJellyfinProvider(session, device, caps, fetchImpl);
}

/** A user the server shows on its sign-in screen. Hidden users are never listed; they type their name. */
export interface PublicUser {
  id: string;
  name: string;
  hasPassword: boolean;
  /** Small square picture, or undefined to show initials. */
  imageUrl?: string;
}

interface RawPublicUser {
  Id?: unknown;
  Name?: unknown;
  HasPassword?: unknown;
  HasConfiguredPassword?: unknown;
  PrimaryImageTag?: unknown;
}

const AVATAR_WIDTH = 240;

/**
 * The users the server admin made visible on the sign-in screen (`GET /Users/Public`, no token). Anything that
 * is not a list of named users counts as none, so the sign-in form opens instead; the list is a convenience,
 * never a requirement. Cancellation still rejects.
 */
export async function fetchPublicUsers(
  server: ServerRecord,
  device: DeviceInfo,
  options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<PublicUser[]> {
  const http = httpForServer(server, device, undefined, options.fetchImpl);
  let raw: unknown;
  try {
    raw = await http.get<unknown>('/Users/Public', { signal: options.signal });
  } catch (e) {
    if (isJellyfinError(e) && e.kind === 'cancelled') {
      throw e;
    }
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return (raw as RawPublicUser[])
    .filter(u => u && typeof u.Id === 'string' && typeof u.Name === 'string' && u.Name.trim() !== '')
    .map(u => ({
      id: u.Id as string,
      name: u.Name as string,
      hasPassword: u.HasPassword !== false || u.HasConfiguredPassword === true,
      imageUrl:
        typeof u.PrimaryImageTag === 'string' && u.PrimaryImageTag
          ? joinUrl(server.baseUrl, `/Users/${encodeURIComponent(u.Id as string)}/Images/Primary`) +
            buildQuery({ tag: u.PrimaryImageTag, maxWidth: AVATAR_WIDTH, quality: 90 })
          : undefined,
    }));
}

/** "AL" for Alex, "MR" for Media Room: shown when a user has no picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]].map(w => Array.from(w)[0]) : Array.from(words[0] ?? '').slice(0, 2);
  return letters.join('').toUpperCase();
}
