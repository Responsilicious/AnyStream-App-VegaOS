import type { FetchLike, DeviceInfo } from '../../src/providers/jellyfin/http';
import type { MediaElementLike, AdaptiveLoader, StreamContent } from '../../src/player/PlayerEngine';
import type { ServerRecord, Session } from '../../src/providers/types';

export const DEVICE: DeviceInfo = { id: 'device-1', name: 'Fire TV', version: '0.1.0' };

export const SERVER: ServerRecord = {
  id: 'server-1',
  kind: 'jellyfin',
  name: 'Home',
  baseUrl: 'https://watch.example.com',
};

export const SESSION: Session = {
  server: SERVER,
  userId: 'user-1',
  userName: 'will',
  accessToken: 'token-abc',
};

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
}

export type Reply = { status?: number; body?: unknown; text?: string } | 'hang' | 'throw';

/** Records every request and answers from a handler. 'hang' never resolves until aborted; 'throw' is a network failure. */
export function fakeFetch(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = handler(call);
    if (reply === 'throw') {
      return Promise.reject(new TypeError('Network request failed'));
    }
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text });
  };
  return { calls, fetchImpl };
}

export class FakeElement implements MediaElementLike {
  src = '';
  autoplay = false;
  currentTime = 0;
  duration = 0;
  paused = true;
  ended = false;
  error: { code: number; message?: string } | null = null;

  initialize = jest.fn(async () => {});
  deinitialize = jest.fn(async () => {});
  setSurfaceHandle = jest.fn();
  clearSurfaceHandle = jest.fn();
  setCaptionViewHandle = jest.fn();
  clearCaptionViewHandle = jest.fn();
  play = jest.fn(() => {
    this.paused = false;
  });
  pause = jest.fn(() => {
    this.paused = true;
  });

  private listeners = new Map<string, Set<(e: any) => void>>();

  addEventListener(type: string, listener: (e: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(): number {
    let n = 0;
    this.listeners.forEach(set => (n += set.size));
    return n;
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach(l => l({ type }));
  }
}

export class FakeLoader implements AdaptiveLoader {
  loaded: Array<{ content: StreamContent; autoplay: boolean }> = [];
  unloads = 0;

  load(content: StreamContent, autoplay: boolean): void {
    this.loaded.push({ content, autoplay });
  }

  unload(): void {
    this.unloads += 1;
  }
}
