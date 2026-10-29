import type { ServerRecord, Session } from '../providers/types';
import type { KeyValueStore } from '../storage/keyValueStore';
import {
  accountId,
  connectionId,
  serverId,
  type ConnectionCapabilities,
  type ConnectionsState,
  type ConnectionView,
  type Preferences,
  type ProviderAccount,
  type SavedConnection,
  type ServerEntry,
} from './model';

const STATE_KEY = 'anystream.connections.v2';
/** The single-server save written by SessionStore before multi-server support. Read once, never written. */
const LEGACY_KEY = 'anystream.state.v1';
const SECRET_PREFIX = 'anystream.secret.v1.';
/** Plex accounts are scoped to plex.tv, not to a server. */
const PLEX_SCOPE = 'plex.tv';

const EMPTY: ConnectionsState = {
  schemaVersion: 2,
  accounts: [],
  servers: [],
  connections: [],
  preferences: { startup: 'last-used', removedPlexServers: [] },
};

export interface JellyfinSignIn {
  /** The server's stable id from /System/Info/Public. */
  serverNativeId: string;
  serverName: string;
  baseUrl: string;
  userId: string;
  userName: string;
  accessToken: string;
  capabilities?: ConnectionCapabilities;
}

export interface PlexAccountSignIn {
  userId: string;
  userName: string;
  token: string;
  tokenKind: 'jwt' | 'legacy';
}

export interface PlexServerChoice {
  machineId: string;
  name: string;
  ownerName?: string;
  accessToken: string;
  /** Verified addresses, best first. */
  endpoints: string[];
}

/** What removing an account takes with it, so the confirmation can say so (spec §10). */
export interface AccountImpact {
  account: ProviderAccount;
  connections: ConnectionView[];
}

/**
 * Every saved server, account and connection, plus startup and active choices. Records are plain JSON;
 * tokens are kept under their own keys so they never sit in the preferences blob or get logged with it.
 *
 * Vega offers apps no keystore, so "secure" here means the app's private storage (MMKV), the same place the
 * Jellyfin token has always lived. See docs/servers.md.
 */
export class ConnectionStore {
  private state: ConnectionsState;

  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {
    this.state = this.load();
  }

  // ----- reading

  list(): ConnectionView[] {
    return this.state.connections
      .map(c => this.view(c))
      .filter((v): v is ConnectionView => v !== undefined)
      .sort((a, b) => (b.connection.lastUsed ?? 0) - (a.connection.lastUsed ?? 0));
  }

  get(id: string): ConnectionView | undefined {
    const c = this.state.connections.find(x => x.id === id);
    return c ? this.view(c) : undefined;
  }

  getActive(): ConnectionView | undefined {
    const id = this.state.preferences.activeConnectionId;
    return id ? this.get(id) : undefined;
  }

  preferences(): Preferences {
    return { ...this.state.preferences, removedPlexServers: [...this.state.preferences.removedPlexServers] };
  }

  accounts(): ProviderAccount[] {
    return [...this.state.accounts];
  }

  /** The connection to open at launch: the pinned one if still saved, else the last one used. */
  startupConnection(): ConnectionView | undefined {
    const prefs = this.state.preferences;
    if (prefs.startup === 'pinned' && prefs.pinnedConnectionId) {
      const pinned = this.get(prefs.pinnedConnectionId);
      if (pinned) {
        return pinned;
      }
    }
    return this.getActive() ?? this.list()[0];
  }

  getSecret(ref: string): string | undefined {
    return this.store.getString(SECRET_PREFIX + ref);
  }

  /** Secrets that belong to this TV rather than to an account, such as its Plex signing key. */
  getDeviceSecret(name: string): string | undefined {
    return this.store.getString(`${SECRET_PREFIX}device.${name}`);
  }

  setDeviceSecret(name: string, value: string): void {
    this.store.set(`${SECRET_PREFIX}device.${name}`, value);
  }

  /**
   * The provider-facing session for a connection, or undefined when its credential is gone (signed out or
   * expired). The server record carries the provider-native id so existing provider code keeps working.
   */
  toSession(id: string): Session | undefined {
    const v = this.get(id);
    if (!v) {
      return undefined;
    }
    const token = this.getSecret(v.connection.credentialRef);
    if (!token || v.account.authStatus !== 'ok') {
      return undefined;
    }
    const server: ServerRecord = {
      id: v.server.nativeId,
      kind: v.server.provider,
      name: v.displayName,
      baseUrl: v.server.endpoints[0] ?? '',
    };
    return { server, userId: v.connection.profileId, userName: v.connection.profileName, accessToken: token };
  }

  /** Plex servers already saved for this account, by machine id, for the server picker. */
  savedPlexServerIds(account: string): string[] {
    const ids = new Set(this.state.connections.filter(c => c.accountId === account).map(c => c.serverId));
    return this.state.servers.filter(s => ids.has(s.id)).map(s => s.nativeId);
  }

  isRemovedPlexServer(machineId: string): boolean {
    return this.state.preferences.removedPlexServers.includes(machineId);
  }

  // ----- adding

  /**
   * Saves a Jellyfin sign-in. Signing in again as the same user on the same server refreshes that entry
   * instead of adding a second one. Does not change the active connection unless `activate` is set.
   */
  addJellyfin(signIn: JellyfinSignIn, options: { activate?: boolean } = {}): ConnectionView {
    const sid = serverId('jellyfin', signIn.serverNativeId);
    const aid = accountId('jellyfin', signIn.serverNativeId, signIn.userId);
    const ref = `${aid}`;
    this.setSecret(ref, signIn.accessToken);
    this.upsertServer({ id: sid, provider: 'jellyfin', nativeId: signIn.serverNativeId, name: signIn.serverName, endpoints: [signIn.baseUrl] });
    this.upsertAccount({
      id: aid,
      provider: 'jellyfin',
      nativeUserId: signIn.userId,
      displayName: signIn.userName,
      credentialRef: ref,
      authStatus: 'ok',
    });
    const id = this.upsertConnection({
      id: connectionId(sid, aid, signIn.userId),
      serverId: sid,
      accountId: aid,
      profileId: signIn.userId,
      profileName: signIn.userName,
      credentialRef: ref,
      capabilities: signIn.capabilities ?? {},
    });
    if (options.activate || !this.state.preferences.activeConnectionId) {
      this.activate(id);
    }
    this.persist();
    return this.get(id) as ConnectionView;
  }

  /** Saves (or refreshes) a linked Plex account. Its servers are added separately, by the user's choice. */
  addPlexAccount(signIn: PlexAccountSignIn): ProviderAccount {
    const aid = accountId('plex', PLEX_SCOPE, signIn.userId);
    const ref = aid;
    this.setSecret(ref, signIn.token);
    const account: ProviderAccount = {
      id: aid,
      provider: 'plex',
      nativeUserId: signIn.userId,
      displayName: signIn.userName,
      credentialRef: ref,
      authStatus: 'ok',
      tokenKind: signIn.tokenKind,
    };
    this.upsertAccount(account);
    this.persist();
    return account;
  }

  /**
   * Saves the Plex servers the user ticked, under one account sign-in. A server already saved for this
   * account gets its token and addresses refreshed, not a duplicate row. Choosing a server clears any earlier
   * "removed" mark for it, because the user picked it explicitly.
   */
  /**
   * After linking again, discovery hands out fresh per-server tokens. Servers already saved for this account
   * take them (and any new addresses) without being added again; nothing new is added here.
   */
  refreshPlexServers(account: string, discovered: PlexServerChoice[]): void {
    const owner = this.state.accounts.find(a => a.id === account);
    // Only connections browsing as the account owner take the owner's tokens: a Home profile's connection keeps
    // its own, so a relink never lifts a restricted profile's limits.
    const ownerServers = new Set(
      this.state.connections.filter(c => c.accountId === account && c.profileId === owner?.nativeUserId).map(c => c.serverId),
    );
    let changed = false;
    for (const server of discovered) {
      if (!ownerServers.has(serverId('plex', server.machineId))) {
        continue;
      }
      const sid = serverId('plex', server.machineId);
      this.setSecret(`${sid}|${account}`, server.accessToken);
      this.upsertServer({ id: sid, provider: 'plex', nativeId: server.machineId, name: server.name, ownerName: server.ownerName, endpoints: [] });
      this.updateEndpointsQuiet(sid, server.endpoints);
      changed = true;
    }
    if (changed) {
      this.persist();
    }
  }

  addPlexServers(account: string, choices: PlexServerChoice[]): ConnectionView[] {
    const owner = this.state.accounts.find(a => a.id === account && a.provider === 'plex');
    if (!owner) {
      throw new Error('Unknown Plex account');
    }
    const added: string[] = [];
    for (const choice of choices) {
      const sid = serverId('plex', choice.machineId);
      const ref = `${sid}|${account}`;
      this.setSecret(ref, choice.accessToken);
      this.upsertServer({ id: sid, provider: 'plex', nativeId: choice.machineId, name: choice.name, ownerName: choice.ownerName, endpoints: choice.endpoints });
      added.push(
        this.upsertConnection({
          id: connectionId(sid, account, owner.nativeUserId),
          serverId: sid,
          accountId: account,
          profileId: owner.nativeUserId,
          profileName: owner.displayName,
          credentialRef: ref,
          capabilities: {},
        }),
      );
      this.state.preferences.removedPlexServers = this.state.preferences.removedPlexServers.filter(m => m !== choice.machineId);
    }
    this.persist();
    return added.map(id => this.get(id) as ConnectionView);
  }

  // ----- changing

  /** Makes a connection active and records it as used. Only call once a switch has been validated. */
  activate(id: string): void {
    const c = this.state.connections.find(x => x.id === id);
    if (!c) {
      return;
    }
    c.lastUsed = this.now();
    this.state.preferences.activeConnectionId = id;
    this.persist();
  }

  rename(id: string, alias: string | undefined): void {
    const v = this.get(id);
    if (!v) {
      return;
    }
    const trimmed = alias?.trim();
    const server = this.state.servers.find(s => s.id === v.server.id) as ServerEntry;
    server.alias = trimmed ? trimmed : undefined;
    this.persist();
  }

  setStartup(strategy: 'last-used'): void;
  setStartup(strategy: 'pinned', id: string): void;
  setStartup(strategy: 'last-used' | 'pinned', id?: string): void {
    this.state.preferences.startup = strategy;
    this.state.preferences.pinnedConnectionId = strategy === 'pinned' ? id : undefined;
    this.persist();
  }

  /** Adds discovered addresses after the saved ones, so a working saved address keeps first place. */
  private updateEndpointsQuiet(server: string, endpoints: string[]): void {
    const entry = this.state.servers.find(s => s.id === server);
    if (entry) {
      entry.endpoints = unique([...entry.endpoints, ...endpoints]);
    }
  }

  /**
   * Browses a Plex connection as another Home profile. Its server token is replaced by that profile's own, so
   * Plex keeps enforcing the profile's restrictions. The connection keeps its id; per-profile data is keyed by
   * contextKey, which includes the profile.
   */
  setPlexProfile(id: string, profile: { profileId: string; profileName: string; serverToken: string }): void {
    const c = this.state.connections.find(x => x.id === id);
    if (!c) {
      return;
    }
    c.profileId = profile.profileId;
    c.profileName = profile.profileName;
    this.setSecret(c.credentialRef, profile.serverToken);
    this.persist();
  }

  /** New addresses for a server after it was found somewhere else, best first. */
  updateEndpoints(server: string, endpoints: string[]): void {
    const entry = this.state.servers.find(s => s.id === server);
    if (entry && endpoints.length) {
      entry.endpoints = unique(endpoints);
      this.persist();
    }
  }

  /** New token for an account (Plex refresh, Jellyfin sign-in again). */
  updateAccountToken(account: string, token: string, tokenKind?: 'jwt' | 'legacy'): void {
    const a = this.state.accounts.find(x => x.id === account);
    if (!a) {
      return;
    }
    this.setSecret(a.credentialRef, token);
    a.authStatus = 'ok';
    if (tokenKind) {
      a.tokenKind = tokenKind;
    }
    this.persist();
  }

  /**
   * The credential was refused. The token goes, the entries stay, so the manager can offer Sign in again on
   * the same server and account. Offline is not this: an unreachable server keeps its sign-in.
   */
  markAuthExpired(account: string): void {
    const a = this.state.accounts.find(x => x.id === account);
    if (!a) {
      return;
    }
    a.authStatus = 'expired';
    this.store.delete(SECRET_PREFIX + a.credentialRef);
    if (a.provider === 'jellyfin') {
      // A Jellyfin connection's token is the account's token.
      for (const c of this.state.connections.filter(x => x.accountId === account)) {
        this.store.delete(SECRET_PREFIX + c.credentialRef);
      }
    }
    this.persist();
  }

  /**
   * Removes one connection from this TV. Library media on the server is untouched. If it was active the app
   * has no active connection until the user picks one; if it was the startup pin, startup goes back to
   * last-used. A removed Plex server is remembered so discovery does not quietly add it back.
   */
  remove(id: string): void {
    const c = this.state.connections.find(x => x.id === id);
    if (!c) {
      return;
    }
    this.state.connections = this.state.connections.filter(x => x.id !== id);
    if (c.credentialRef !== this.state.accounts.find(a => a.id === c.accountId)?.credentialRef) {
      this.store.delete(SECRET_PREFIX + c.credentialRef);
    }
    const server = this.state.servers.find(s => s.id === c.serverId);
    if (server?.provider === 'plex' && !this.state.preferences.removedPlexServers.includes(server.nativeId)) {
      this.state.preferences.removedPlexServers.push(server.nativeId);
    }
    this.dropOrphans();
    this.clearPreferencesFor([id]);
    this.persist();
  }

  /** Everything an account sign-out would remove. */
  accountImpact(account: string): AccountImpact | undefined {
    const a = this.state.accounts.find(x => x.id === account);
    if (!a) {
      return undefined;
    }
    return { account: a, connections: this.list().filter(v => v.account.id === account) };
  }

  /** Signs an account out of this TV: its token and every connection that depends on it go. */
  signOutAccount(account: string): void {
    const a = this.state.accounts.find(x => x.id === account);
    if (!a) {
      return;
    }
    const gone = this.state.connections.filter(c => c.accountId === account);
    for (const c of gone) {
      this.store.delete(SECRET_PREFIX + c.credentialRef);
    }
    this.store.delete(SECRET_PREFIX + a.credentialRef);
    this.state.connections = this.state.connections.filter(c => c.accountId !== account);
    this.state.accounts = this.state.accounts.filter(x => x.id !== account);
    this.dropOrphans();
    this.clearPreferencesFor(gone.map(c => c.id));
    this.persist();
  }

  // ----- internals

  private view(c: SavedConnection): ConnectionView | undefined {
    const server = this.state.servers.find(s => s.id === c.serverId);
    const account = this.state.accounts.find(a => a.id === c.accountId);
    if (!server || !account) {
      return undefined;
    }
    const prefs = this.state.preferences;
    return {
      connection: { ...c, capabilities: { ...c.capabilities } },
      server: { ...server, endpoints: [...server.endpoints] },
      account: { ...account },
      displayName: server.alias ?? server.name,
      active: prefs.activeConnectionId === c.id,
      startup: prefs.startup === 'pinned' && prefs.pinnedConnectionId === c.id,
    };
  }

  private setSecret(ref: string, value: string): void {
    this.store.set(SECRET_PREFIX + ref, value);
  }

  private upsertServer(entry: ServerEntry): void {
    const existing = this.state.servers.find(s => s.id === entry.id);
    if (existing) {
      existing.name = entry.name;
      existing.ownerName = entry.ownerName ?? existing.ownerName;
      // The newly verified address goes first; older ones stay as fallbacks.
      existing.endpoints = unique([...entry.endpoints, ...existing.endpoints]);
    } else {
      this.state.servers.push({ ...entry, endpoints: unique(entry.endpoints) });
    }
  }

  private upsertAccount(account: ProviderAccount): void {
    const i = this.state.accounts.findIndex(a => a.id === account.id);
    if (i >= 0) {
      this.state.accounts[i] = account;
    } else {
      this.state.accounts.push(account);
    }
  }

  private upsertConnection(c: SavedConnection): string {
    const existing = this.state.connections.find(x => x.id === c.id);
    if (existing) {
      existing.profileName = c.profileName;
      existing.credentialRef = c.credentialRef;
      existing.capabilities = { ...existing.capabilities, ...c.capabilities };
    } else {
      this.state.connections.push(c);
    }
    return c.id;
  }

  private dropOrphans(): void {
    const usedServers = new Set(this.state.connections.map(c => c.serverId));
    this.state.servers = this.state.servers.filter(s => usedServers.has(s.id));
    // A Plex account with no servers left stays signed in: the user may add servers from it later.
    const usedAccounts = new Set(this.state.connections.map(c => c.accountId));
    const gone = this.state.accounts.filter(a => a.provider === 'jellyfin' && !usedAccounts.has(a.id));
    for (const a of gone) {
      this.store.delete(SECRET_PREFIX + a.credentialRef);
    }
    this.state.accounts = this.state.accounts.filter(a => !gone.includes(a));
  }

  private clearPreferencesFor(ids: string[]): void {
    const prefs = this.state.preferences;
    if (prefs.activeConnectionId && ids.includes(prefs.activeConnectionId)) {
      prefs.activeConnectionId = undefined;
    }
    if (prefs.pinnedConnectionId && ids.includes(prefs.pinnedConnectionId)) {
      prefs.pinnedConnectionId = undefined;
      prefs.startup = 'last-used';
    }
  }

  private load(): ConnectionsState {
    const raw = this.store.getString(STATE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ConnectionsState;
        if (parsed && parsed.schemaVersion === 2) {
          return {
            ...EMPTY,
            ...parsed,
            preferences: { ...EMPTY.preferences, ...parsed.preferences },
          };
        }
      } catch {
        // Fall through: a damaged save is replaced by the legacy one or nothing.
      }
    }
    const migrated = this.migrateLegacy();
    this.state = migrated;
    this.persist();
    return migrated;
  }

  /**
   * Turns the single-server save (one Jellyfin session per server) into connections. The legacy key is left
   * alone, so the old screens keep working until they move over. Expired sign-ins become entries without a
   * token, so the manager can offer Sign in again.
   */
  private migrateLegacy(): ConnectionsState {
    const state: ConnectionsState = JSON.parse(JSON.stringify(EMPTY));
    const raw = this.store.getString(LEGACY_KEY);
    if (!raw) {
      return state;
    }
    let legacy: {
      servers?: ServerRecord[];
      sessions?: Record<string, Session>;
      activeServerId?: string;
      lastUserNames?: Record<string, string>;
    };
    try {
      legacy = JSON.parse(raw);
    } catch {
      return state;
    }
    this.state = state;
    for (const server of legacy.servers ?? []) {
      if (server.kind !== 'jellyfin') {
        continue;
      }
      const session = legacy.sessions?.[server.id];
      const sid = serverId('jellyfin', server.id);
      if (session) {
        const view = this.addJellyfin(
          {
            serverNativeId: server.id,
            serverName: server.name,
            baseUrl: server.baseUrl,
            userId: session.userId,
            userName: session.userName,
            accessToken: session.accessToken,
          },
          { activate: legacy.activeServerId === server.id },
        );
        if (legacy.activeServerId !== server.id && this.state.preferences.activeConnectionId === view.connection.id) {
          this.state.preferences.activeConnectionId = undefined;
        }
      } else {
        // Signed out after an expiry: keep the server and who used it, without a token.
        const userName = legacy.lastUserNames?.[server.id] ?? '';
        const aid = accountId('jellyfin', server.id, `unknown:${userName}`);
        this.upsertServer({ id: sid, provider: 'jellyfin', nativeId: server.id, name: server.name, endpoints: [server.baseUrl] });
        this.upsertAccount({ id: aid, provider: 'jellyfin', nativeUserId: '', displayName: userName, credentialRef: aid, authStatus: 'expired' });
        this.upsertConnection({ id: connectionId(sid, aid, ''), serverId: sid, accountId: aid, profileId: '', profileName: userName, credentialRef: aid, capabilities: {} });
        if (legacy.activeServerId === server.id) {
          this.state.preferences.activeConnectionId = connectionId(sid, aid, '');
        }
      }
    }
    return this.state;
  }

  private persist(): void {
    this.store.set(STATE_KEY, JSON.stringify(this.state));
  }
}

function unique(values: string[]): string[] {
  return values.filter((v, i) => v && values.indexOf(v) === i);
}

