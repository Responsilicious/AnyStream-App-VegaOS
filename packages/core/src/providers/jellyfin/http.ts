import { APP_NAME, REQUEST_TIMEOUT_MS } from '../../config';
import { buildQuery, joinUrl, type QueryValue } from '../../util/url';
import { JellyfinError } from './errors';

export interface DeviceInfo {
  id: string;
  name: string;
  version: string;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: any) => Promise<ResponseLike>;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** fetch gives no error codes, only text; TLS failures name the certificate or handshake in it. */
const CERTIFICATE_FAILURE = /certificate|ssl|tls|handshake|trust anchor|self[- ]signed/i;

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as Promise<ResponseLike>;

/**
 * Minimal Jellyfin HTTP client: one place for the auth header, timeouts and error mapping.
 * Immutable: `withToken` returns a new client, so a session never mutates a shared one.
 */
export class JellyfinHttp {
  constructor(
    readonly baseUrl: string,
    readonly device: DeviceInfo,
    readonly token?: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  withToken(token: string): JellyfinHttp {
    return new JellyfinHttp(this.baseUrl, this.device, token, this.fetchImpl);
  }

  authorizationHeader(): string {
    const parts = [
      `Client="${APP_NAME}"`,
      `Device="${this.device.name}"`,
      `DeviceId="${this.device.id}"`,
      `Version="${this.device.version}"`,
    ];
    if (this.token) {
      parts.push(`Token="${this.token}"`);
    }
    return `MediaBrowser ${parts.join(', ')}`;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = joinUrl(this.baseUrl, path) + buildQuery(options.query);
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

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authorizationHeader(),
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: ResponseLike;
    try {
      response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (e) {
      if (timedOut) {
        throw new JellyfinError('timeout', `Timed out: ${method} ${path}`);
      }
      if (options.signal?.aborted) {
        throw new JellyfinError('cancelled', `Cancelled: ${method} ${path}`);
      }
      const cause = e instanceof Error ? e.message : String(e);
      if (CERTIFICATE_FAILURE.test(cause)) {
        throw new JellyfinError('certificate', `Certificate error: ${method} ${path} (${cause})`);
      }
      throw new JellyfinError('network', `Network error: ${method} ${path} (${cause})`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new JellyfinError('unauthorized', `Not authorised: ${method} ${path}`, status);
      }
      if (status === 404) {
        throw new JellyfinError('not-found', `Not found: ${method} ${path}`, status);
      }
      // The body usually says why (e.g. which field the server rejected); keep it out of the user-facing text.
      const detail = await response.text().then(t => t.slice(0, 300), () => '');
      throw new JellyfinError('server', `Server error ${status}: ${method} ${path} ${detail}`.trim(), status);
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new JellyfinError('not-jellyfin', `Unexpected response: ${method} ${path}`);
    }
  }
}
