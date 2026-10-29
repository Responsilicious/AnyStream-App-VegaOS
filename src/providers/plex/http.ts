import { APP_NAME, REQUEST_TIMEOUT_MS } from '../../config';
import { buildQuery, joinUrl, type QueryValue } from '../../util/url';
import type { DeviceInfo, FetchLike, ResponseLike } from '../jellyfin/http';
import { PlexError } from './errors';

export type { DeviceInfo, FetchLike, ResponseLike };

/** plex.tv's API for linking, accounts and server discovery. */
export const PLEX_CLIENTS_URL = 'https://clients.plex.tv';

export interface PlexRequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as Promise<ResponseLike>;

/** Scheme, host and port of a URL, for logs. */
export function originOf(url: string): string {
  const match = /^[a-z]+:\/\/[^/?#]+/i.exec(url);
  return match ? match[0] : '';
}

/** Retry-After is seconds or an HTTP date; anything else means Plex did not say. */
export function parseRetryAfter(value: string | undefined, now: number = Date.now()): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/**
 * Plex HTTP client for one origin (plex.tv or one media server). The token is only ever sent to the origin
 * this client was made for: discovery hands each server its own token, never the account's.
 */
export class PlexHttp {
  constructor(
    readonly baseUrl: string,
    readonly device: DeviceInfo,
    readonly token?: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  withToken(token: string | undefined): PlexHttp {
    return new PlexHttp(this.baseUrl, this.device, token, this.fetchImpl);
  }

  /** The same identity at another origin, with that origin's own token. */
  at(baseUrl: string, token: string | undefined): PlexHttp {
    return new PlexHttp(baseUrl, this.device, token, this.fetchImpl);
  }

  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': this.device.id,
      'X-Plex-Product': APP_NAME,
      'X-Plex-Version': this.device.version,
      'X-Plex-Device-Name': this.device.name,
      'X-Plex-Platform': 'Vega',
      'X-Plex-Device': 'Fire TV',
      'X-Plex-Provides': 'player',
    };
    if (this.token) {
      headers['X-Plex-Token'] = this.token;
    }
    return headers;
  }

  get<T>(path: string, options?: PlexRequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: PlexRequestOptions): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  delete<T>(path: string, options?: PlexRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: PlexRequestOptions = {}): Promise<T> {
    const url = joinUrl(this.baseUrl, path) + buildQuery(options.query);
    // Error messages name the path only: query strings can carry a deviceJWT.
    const where = `${method} ${path}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onExternalAbort);
      }
    }

    const headers = this.headers();
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: ResponseLike & { headers?: { get(name: string): string | null } };
    try {
      response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (e) {
      if (timedOut) {
        throw new PlexError('timeout', `Timed out: ${where}`);
      }
      if (options.signal?.aborted) {
        throw new PlexError('cancelled', `Cancelled: ${where}`);
      }
      // Origin and path only: the query can carry a token or a signed JWT, and so can a URL inside the cause.
      const cause = (e instanceof Error ? e.message : String(e)).replace(/\?\S*/g, '?…');
      console.warn(`Plex request failed: ${method} ${originOf(this.baseUrl)}${path} (${cause})`);
      throw new PlexError('network', `Network error: ${where}`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    if (!response.ok) {
      const status = response.status;
      // Plex explains a 400 in the body. Log a short piece of it, with anything token-like removed.
      const reason =
        status === 400
          ? ` ${(await response.text().catch(() => '')).replace(/X-Plex-Token=[^&\s"']*/gi, 'X-Plex-Token=…').replace(/\s+/g, ' ').slice(0, 200)}`
          : '';
      console.warn(`Plex request refused: ${method} ${originOf(this.baseUrl)}${path} (HTTP ${status})${reason}`);
      if (status === 401) {
        throw new PlexError('unauthorized', `Not authorised: ${where}`, status);
      }
      if (status === 403) {
        throw new PlexError('forbidden', `Forbidden: ${where}`, status);
      }
      if (status === 404) {
        throw new PlexError('not-found', `Not found: ${where}`, status);
      }
      if (status === 429) {
        const retry = parseRetryAfter(response.headers?.get('Retry-After') ?? undefined);
        throw new PlexError('rate-limited', `Rate limited: ${where}`, status, retry);
      }
      if (status === 502 || status === 503 || status === 504) {
        throw new PlexError('service-unavailable', `Unavailable: ${where}`, status);
      }
      throw new PlexError('server', `Server error ${status}: ${where}`, status);
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // A proxy in front of Plex can answer with HTML or XML; say so in the log, without the body.
      console.warn(`Plex response not JSON: ${method} ${originOf(this.baseUrl)}${path} (starts ${JSON.stringify(text.slice(0, 15))})`);
      throw new PlexError('server', `Unexpected response: ${where}`);
    }
  }
}
