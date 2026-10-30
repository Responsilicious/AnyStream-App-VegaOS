import { PlexError, isPlexError } from './errors';
import type { PlexHttp } from './http';

/** One member of a Plex Home, as the profile picker shows it. */
export interface PlexHomeUser {
  /** Plex's uuid for the user: what a switch asks for. */
  uuid: string;
  name: string;
  thumb?: string;
  /** The account owner. */
  admin: boolean;
  /** Plex enforces content limits for this profile on the server side. */
  restricted: boolean;
  /** A PIN is needed to switch to this profile. */
  protected: boolean;
}

interface RawHomeUser {
  uuid?: string;
  id?: number;
  title?: string;
  username?: string;
  friendlyName?: string;
  thumb?: string;
  admin?: boolean;
  restricted?: boolean;
  protected?: boolean;
}

/**
 * The profiles of the account's Plex Home. An account without a Home has just itself; Plex answers that with
 * a single admin user, or with 404 on some accounts, which is treated the same.
 */
export async function listHomeUsers(account: PlexHttp, signal?: AbortSignal): Promise<PlexHomeUser[]> {
  let raw: { users?: RawHomeUser[] } | RawHomeUser[] | undefined;
  try {
    raw = await account.get<{ users?: RawHomeUser[] } | RawHomeUser[]>('/api/v2/home/users', { signal });
  } catch (e) {
    if (isPlexError(e) && e.kind === 'not-found') {
      return [];
    }
    throw e;
  }
  const users = Array.isArray(raw) ? raw : raw?.users ?? [];
  return users
    .filter(u => !!(u.uuid ?? u.id))
    .map(u => ({
      uuid: String(u.uuid ?? u.id),
      name: u.friendlyName || u.title || u.username || 'Plex user',
      thumb: u.thumb,
      admin: u.admin === true,
      restricted: u.restricted === true,
      protected: u.protected === true,
    }));
}

/**
 * Switches to a Home profile and returns that profile's plex.tv token. A wrong PIN is 'unauthorized' or
 * 'forbidden' from Plex; it is reported as 'wrong-pin' so the picker can ask again instead of signing out.
 */
export async function switchHomeUser(account: PlexHttp, uuid: string, pin: string | undefined, signal?: AbortSignal): Promise<string> {
  try {
    const user = await account.post<{ authToken?: string; authenticationToken?: string }>(
      `/api/v2/home/users/${encodeURIComponent(uuid)}/switch`,
      { query: { pin: pin || undefined }, signal },
    );
    const token = user?.authToken ?? user?.authenticationToken;
    if (!token) {
      throw new PlexError('server', 'Plex returned no profile token');
    }
    return token;
  } catch (e) {
    if (isPlexError(e) && (e.kind === 'unauthorized' || e.kind === 'forbidden')) {
      throw new PlexError('wrong-pin', 'Profile PIN not accepted', e.status);
    }
    throw e;
  }
}
