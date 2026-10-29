import type { ServerKind } from '../providers/types';

/**
 * Saved servers and sign-ins (spec §9). A connection is a server + account + profile, not an address:
 * Jellyfin accounts belong to one server, while one Plex account can reach many servers, each with its own
 * token. Nothing in these records is secret; tokens live in the credential store under `credentialRef`.
 */

export type AuthStatus = 'ok' | 'expired';

export interface ProviderAccount {
  /** `<provider>:<scope>:<native user id>`; Jellyfin's scope is its server, Plex's is plex.tv. */
  id: string;
  provider: ServerKind;
  nativeUserId: string;
  displayName: string;
  credentialRef: string;
  authStatus: AuthStatus;
  /** Plex: 'jwt' tokens expire after days and are refreshed with the TV's key; 'legacy' ones do not. */
  tokenKind?: 'jwt' | 'legacy';
}

export interface ServerEntry {
  /** `<provider>:<native server id>`, so a new address for the same server never makes a second entry. */
  id: string;
  provider: ServerKind;
  nativeId: string;
  /** The name the server reports. */
  name: string;
  /** A name the user gave it on this TV only; the server is never renamed. */
  alias?: string;
  /** Verified addresses, best first. */
  endpoints: string[];
  /** Plex: whose server it is when it is shared with this account. */
  ownerName?: string;
}

export interface ConnectionCapabilities {
  quickConnect?: boolean;
}

export interface SavedConnection {
  id: string;
  serverId: string;
  accountId: string;
  /** The provider's own user or Plex Home profile this connection browses as. */
  profileId: string;
  profileName: string;
  /** The token this connection sends to its server (for Plex, the server's own token). */
  credentialRef: string;
  lastUsed?: number;
  capabilities: ConnectionCapabilities;
}

export type StartupStrategy = 'last-used' | 'pinned';

export interface Preferences {
  startup: StartupStrategy;
  pinnedConnectionId?: string;
  activeConnectionId?: string;
  /** Plex servers the user removed; discovery shows them unticked rather than adding them back. */
  removedPlexServers: string[];
}

export interface ConnectionsState {
  schemaVersion: 2;
  accounts: ProviderAccount[];
  servers: ServerEntry[];
  connections: SavedConnection[];
  preferences: Preferences;
}

/** What a list row needs: one connection with its server and account. */
export interface ConnectionView {
  connection: SavedConnection;
  server: ServerEntry;
  account: ProviderAccount;
  /** Alias if set, else the server's own name. */
  displayName: string;
  active: boolean;
  startup: boolean;
}

/** Status shown on a row. Online says nothing about playback rights or codecs (spec §13). */
export type ConnectionStatus =
  | 'checking'
  | 'online'
  | 'unavailable'
  | 'auth-required'
  | 'permission-denied'
  | 'rate-limited'
  | 'service-unavailable'
  | 'playback-restricted';

export function serverId(provider: ServerKind, nativeId: string): string {
  return `${provider}:${nativeId}`;
}

export function accountId(provider: ServerKind, scope: string, nativeUserId: string): string {
  return `${provider}:${scope}:${nativeUserId}`;
}

export function connectionId(server: string, account: string, profileId: string): string {
  return `${server}|${account}|${profileId}`;
}

/**
 * Prefix for anything cached per context (media ids, progress, hidden rows, view state). Item 42 on one
 * server has nothing to do with item 42 on another.
 */
export function contextKey(connection: SavedConnection): string {
  return `${connection.serverId}.${connection.accountId}.${connection.profileId}`;
}
