import { QUICK_CONNECT_POLL_MS, QUICK_CONNECT_TIMEOUT_MS } from '../../config';
import type { ServerRecord, Session } from '../types';
import { isJellyfinError, JellyfinError } from './errors';
import type { JellyfinHttp } from './http';

interface AuthenticationResult {
  AccessToken: string;
  User: { Id: string; Name: string };
}

function toSession(server: ServerRecord, result: AuthenticationResult): Session {
  if (!result?.AccessToken || !result.User?.Id) {
    throw new JellyfinError('unauthorized', 'Sign-in response was incomplete');
  }
  return {
    server,
    userId: result.User.Id,
    userName: result.User.Name,
    accessToken: result.AccessToken,
  };
}

/** Username and password. The password is sent once and never stored. */
export async function signInWithPassword(
  http: JellyfinHttp,
  server: ServerRecord,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<Session> {
  const result = await http.post<AuthenticationResult>('/Users/AuthenticateByName', {
    body: { Username: username, Pw: password },
    signal,
  });
  return toSession(server, result);
}

export type SessionCheck = 'ok' | 'expired' | 'unavailable';

/**
 * Whether a saved sign-in still works, checked at start-up. Only a refusal from the server counts as expired;
 * anything else (offline, timeout, certificate) keeps the token so Retry can succeed later.
 */
export async function checkSession(http: JellyfinHttp, session: Session, signal?: AbortSignal, timeoutMs?: number): Promise<SessionCheck> {
  try {
    await http.withToken(session.accessToken).get(`/Users/${encodeURIComponent(session.userId)}`, { signal, timeoutMs });
    return 'ok';
  } catch (e) {
    if (isJellyfinError(e) && e.kind === 'cancelled') {
      throw e;
    }
    if (isJellyfinError(e) && (e.kind === 'unauthorized' || e.kind === 'not-found')) {
      return 'expired';
    }
    return 'unavailable';
  }
}

interface QuickConnectState {
  Secret: string;
  Code: string;
  Authenticated?: boolean;
}

export interface QuickConnectOptions {
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Quick Connect: the TV shows a short code, the person approves it from another signed-in
 * Jellyfin app (Settings > Quick Connect), and the TV receives a token. No typing on a remote.
 */
export class QuickConnectFlow {
  private secret?: string;

  constructor(
    private readonly http: JellyfinHttp,
    private readonly server: ServerRecord,
    private readonly options: QuickConnectOptions = {},
  ) {}

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    try {
      const enabled = await this.http.get<boolean>('/QuickConnect/Enabled', { signal });
      return enabled === true;
    } catch (e) {
      if (isJellyfinError(e) && e.kind === 'cancelled') {
        throw e;
      }
      return false;
    }
  }

  /** Requests a code to show on screen. */
  async start(signal?: AbortSignal): Promise<{ code: string }> {
    try {
      const state = await this.http.post<QuickConnectState>('/QuickConnect/Initiate', { signal });
      this.secret = state.Secret;
      return { code: state.Code };
    } catch (e) {
      if (isJellyfinError(e) && (e.kind === 'unauthorized' || e.kind === 'not-found')) {
        throw new JellyfinError('quick-connect-disabled', 'Quick Connect is disabled', e.status);
      }
      throw e;
    }
  }

  /**
   * Polls until the code is approved, then exchanges the secret for a session. `onApproved` runs between the
   * two, so the screen can say "Approved" while the token is fetched.
   */
  async waitForApproval(signal?: AbortSignal, onApproved?: () => void): Promise<Session> {
    const secret = this.secret;
    if (!secret) {
      throw new JellyfinError('quick-connect-expired', 'Quick Connect was not started');
    }
    const sleep = this.options.sleep ?? realSleep;
    const now = this.options.now ?? Date.now;
    const pollMs = this.options.pollMs ?? QUICK_CONNECT_POLL_MS;
    const deadline = now() + (this.options.timeoutMs ?? QUICK_CONNECT_TIMEOUT_MS);

    while (now() < deadline) {
      if (signal?.aborted) {
        throw new JellyfinError('cancelled', 'Quick Connect cancelled');
      }
      let state: QuickConnectState;
      try {
        state = await this.http.get<QuickConnectState>('/QuickConnect/Connect', {
          query: { secret },
          signal,
        });
      } catch (e) {
        if (isJellyfinError(e) && (e.kind === 'not-found' || e.status === 400)) {
          throw new JellyfinError('quick-connect-expired', 'Quick Connect code expired', e.status);
        }
        throw e;
      }
      if (state.Authenticated) {
        onApproved?.();
        const result = await this.http.post<AuthenticationResult>(
          '/Users/AuthenticateWithQuickConnect',
          { body: { Secret: secret }, signal },
        );
        this.secret = undefined;
        return toSession(this.server, result);
      }
      await sleep(pollMs);
    }
    throw new JellyfinError('quick-connect-expired', 'Quick Connect timed out');
  }
}
