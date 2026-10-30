import { newDeviceId } from '../util/ids';
import type { ServerRecord, Session } from '../providers/types';
import type { KeyValueStore } from './keyValueStore';

const STATE_KEY = 'anystream.state.v1';

interface PersistedState {
  deviceId: string;
  servers: ServerRecord[];
  sessions: Record<string, Session>;
  activeServerId?: string;
  /** Who last signed in to each server, kept after a sign-in expires. */
  lastUserNames?: Record<string, string>;
}

/**
 * Servers, sign-ins and the install id, kept on the device only.
 * Tokens never leave the device except as headers to their own server.
 */
export class SessionStore {
  private state: PersistedState;

  constructor(private readonly store: KeyValueStore) {
    this.state = this.load();
  }

  getDeviceId(): string {
    return this.state.deviceId;
  }

  listServers(): ServerRecord[] {
    return [...this.state.servers];
  }

  getSession(serverId: string): Session | undefined {
    return this.state.sessions[serverId];
  }

  getActiveSession(): Session | undefined {
    const id = this.state.activeServerId;
    return id ? this.state.sessions[id] : undefined;
  }

  /** Saves the sign-in and makes its server the active one. */
  saveSession(session: Session): void {
    const others = this.state.servers.filter(s => s.id !== session.server.id);
    this.state.servers = [...others, session.server];
    this.state.sessions = { ...this.state.sessions, [session.server.id]: session };
    this.state.activeServerId = session.server.id;
    this.persist();
  }

  setActiveServer(serverId: string): void {
    if (this.state.sessions[serverId]) {
      this.state.activeServerId = serverId;
      this.persist();
    }
  }

  /**
   * The sign-in expired: drop the token but keep the server and who signed in, so the sign-in screen opens on
   * that server with the username filled in. The server stays the active one.
   */
  forgetSignIn(serverId: string): void {
    const session = this.state.sessions[serverId];
    if (!session) {
      return;
    }
    const { [serverId]: _expired, ...rest } = this.state.sessions;
    this.state.sessions = rest;
    this.state.lastUserNames = { ...this.state.lastUserNames, [serverId]: session.userName };
    this.persist();
  }

  /** The server the app was last using, even when its sign-in has expired. */
  getLastServer(): ServerRecord | undefined {
    const id = this.state.activeServerId;
    return this.state.servers.find(s => s.id === id);
  }

  /** The username last signed in on a server; never a password. */
  getLastUserName(serverId: string): string | undefined {
    return this.state.sessions[serverId]?.userName ?? this.state.lastUserNames?.[serverId];
  }

  removeServer(serverId: string): void {
    this.state.servers = this.state.servers.filter(s => s.id !== serverId);
    const { [serverId]: _removed, ...rest } = this.state.sessions;
    this.state.sessions = rest;
    const { [serverId]: _name, ...names } = this.state.lastUserNames ?? {};
    this.state.lastUserNames = names;
    if (this.state.activeServerId === serverId) {
      this.state.activeServerId = this.state.servers[0]?.id;
    }
    this.persist();
  }

  private load(): PersistedState {
    const raw = this.store.getString(STATE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PersistedState;
        if (parsed && typeof parsed.deviceId === 'string') {
          return {
            deviceId: parsed.deviceId,
            servers: parsed.servers ?? [],
            sessions: parsed.sessions ?? {},
            activeServerId: parsed.activeServerId,
            lastUserNames: parsed.lastUserNames ?? {},
          };
        }
      } catch {
        // fall through to a fresh state
      }
    }
    const fresh: PersistedState = { deviceId: newDeviceId(), servers: [], sessions: {} };
    this.store.set(STATE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  private persist(): void {
    this.store.set(STATE_KEY, JSON.stringify(this.state));
  }
}
