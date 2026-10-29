import { PLEX_MAX_BACKOFF_MS, PLEX_PIN_POLL_MS } from '../../config';
import { PlexError, isPlexError } from './errors';
import type { PlexHttp } from './http';
import { signDeviceJwt, toJwk, tokenExpiry, type Ed25519Signer } from './jwt';

interface PinResponse {
  id: number;
  code: string;
  expiresIn?: number;
  expiresAt?: string;
  authToken?: string | null;
}

/** A code waiting for the user to approve it at plex.tv/link. `id` stays inside the app; only `code` is shown. */
export interface PlexLinkCode {
  id: number;
  /** Exactly what Plex returned. Its length depends on the PIN mode, so never assume four characters. */
  code: string;
  /** Epoch ms after which Plex will not accept this code. */
  expiresAt: number;
}

export interface PlexLinkResult {
  token: string;
  /** 'jwt' when Plex honoured our key (7-day token, refreshable); 'legacy' when it fell back to a long-lived token. */
  tokenKind: 'jwt' | 'legacy';
  /** When the token stops working, if Plex said. */
  expiresAt?: number;
}

export interface LinkDeps {
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PlexError('cancelled', 'Cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PlexError('cancelled', 'Cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Plex's TV linking: ask plex.tv for a short code, show it, and poll until someone approves it at
 * plex.tv/link. AnyStream never sees the Plex password. With a signing key the PIN carries our public key
 * and the poll carries a signed proof, so Plex returns a JWT; without one it returns a legacy token.
 */
export class PlexLinker {
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly http: PlexHttp,
    private readonly signer: Ed25519Signer | undefined,
    deps: LinkDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? abortableSleep;
  }

  /** One new code. Call once per user request, never per render. */
  async start(signal?: AbortSignal): Promise<PlexLinkCode> {
    const body = this.signer ? { jwk: toJwk(this.signer) } : undefined;
    const pin = await this.http.post<PinResponse>('/api/v2/pins', { body, signal });
    if (!pin || typeof pin.id !== 'number' || !pin.code) {
      throw new PlexError('server', 'Plex returned no link code');
    }
    return { id: pin.id, code: pin.code, expiresAt: this.expiry(pin) };
  }

  /**
   * Polls until the code is approved, expires or `signal` aborts. Expiry raises 'link-expired' and does not
   * make a new code: the screen offers Get new code instead.
   */
  async waitForApproval(pin: PlexLinkCode, signal?: AbortSignal): Promise<PlexLinkResult> {
    let delay = PLEX_PIN_POLL_MS;
    for (;;) {
      if (signal?.aborted) {
        throw new PlexError('cancelled', 'Cancelled');
      }
      if (this.now() >= pin.expiresAt) {
        throw new PlexError('link-expired', 'Link code expired');
      }
      try {
        const query = this.signer
          ? { deviceJWT: signDeviceJwt(this.signer, { clientId: this.http.device.id, nowSec: Math.floor(this.now() / 1000) }) }
          : undefined;
        const state = await this.http.get<PinResponse>(`/api/v2/pins/${pin.id}`, { query, signal });
        if (state?.authToken) {
          return this.result(state.authToken);
        }
        delay = PLEX_PIN_POLL_MS;
      } catch (e) {
        if (!isPlexError(e)) {
          throw e;
        }
        if (e.kind === 'not-found') {
          // Plex forgets a PIN once it expires.
          throw new PlexError('link-expired', 'Link code expired');
        }
        if (e.kind === 'rate-limited') {
          delay = e.retryAfterMs ?? Math.min(delay * 2, PLEX_MAX_BACKOFF_MS);
        } else if (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'service-unavailable') {
          // A blip while the user is typing the code on their phone should not end the attempt.
          delay = Math.min(delay * 2, PLEX_MAX_BACKOFF_MS);
        } else {
          throw e;
        }
      }
      await this.sleep(Math.min(delay, Math.max(0, pin.expiresAt - this.now())), signal);
    }
  }

  private result(token: string): PlexLinkResult {
    const expiresAt = tokenExpiry(token);
    return expiresAt === undefined ? { token, tokenKind: 'legacy' } : { token, tokenKind: 'jwt', expiresAt };
  }

  private expiry(pin: PinResponse): number {
    if (typeof pin.expiresIn === 'number') {
      return this.now() + pin.expiresIn * 1000;
    }
    const at = pin.expiresAt ? Date.parse(pin.expiresAt) : NaN;
    return Number.isNaN(at) ? this.now() + 15 * 60 * 1000 : at;
  }
}

/**
 * Exchanges a still-valid or expired Plex JWT for a fresh one, proving key possession with a nonce. Plex
 * documents this path loosely; it is unverified until tested with a real account.
 */
export async function refreshPlexToken(
  http: PlexHttp,
  signer: Ed25519Signer,
  nowMs: number,
  signal?: AbortSignal,
): Promise<PlexLinkResult> {
  const { nonce } = await http.get<{ nonce: string }>('/api/v2/auth/nonce', { signal });
  const jwt = signDeviceJwt(signer, { clientId: http.device.id, nonce, nowSec: Math.floor(nowMs / 1000) });
  const reply = await http.post<{ auth_token?: string; authToken?: string }>('/api/v2/auth/token', { body: { jwt }, signal });
  const token = reply?.auth_token ?? reply?.authToken;
  if (!token) {
    throw new PlexError('unauthorized', 'Plex did not issue a new token');
  }
  return { token, tokenKind: 'jwt', expiresAt: tokenExpiry(token) };
}
