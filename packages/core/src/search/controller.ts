import type { KindFilter, MediaItem } from '../providers/types';
import { groupHits, normalizeTitle } from './match';
import { ID_ORDER, makeHit, type SearchGroup, type SearchSource, type SourceHit, type SourceState, type SourceStatus } from './model';

/**
 * Runs one search across several servers (docs/cross-server-search.md §3). Each server answers on its own:
 * results show as they arrive, a slow or failed server never holds up the others, and anything that arrives
 * for an older query, an older profile or a removed connection is dropped. Pure TypeScript: providers, timers
 * and the source list are injected so it runs in Node tests.
 */

/** The slice of a provider search needs. */
export interface SearchProvider {
  search(term: string, filter: KindFilter, signal?: AbortSignal): Promise<MediaItem[]>;
}

/** 'all', or one source's key. */
export type SearchScope = string;
export const ALL_SOURCES: SearchScope = 'all';

export interface SearchRequest {
  query: string;
  filter: KindFilter;
  scope: SearchScope;
}

export interface SearchSnapshot {
  request: SearchRequest;
  /** Every source in scope, in source order, with how far it got. */
  states: SourceState[];
  groups: SearchGroup[];
  /** Sources still searching. */
  pending: number;
}

/** What a failure means to search. 'cancelled' is our own abort and is not shown. */
export type FailureKind = Exclude<SourceStatus, 'pending' | 'complete'> | 'cancelled';

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SearchControllerDeps {
  /** Every saved connection search may ask, in display order. Read again on `syncSources`. */
  sources(): SearchSource[];
  /** Builds the source's provider from its private credentials; undefined when it has none. */
  provider(source: SearchSource): SearchProvider | undefined;
  /** The connection the app is showing: its copies come first. */
  activeKey(): string | undefined;
  classify(error: unknown): FailureKind;
  /** Before a retry: re-checks the server's addresses, so a working one is used next. */
  recheck?(source: SearchSource, signal: AbortSignal): Promise<void>;
  timers?: Timers;
  debounceMs: number;
  concurrency: number;
  deadlineMs: number;
  /** How many recent query + filter answers to keep in memory. */
  sessionEntries: number;
}

interface Run {
  controller: AbortController;
  timer: unknown;
  done: boolean;
}

interface Result {
  revision: string;
  status: SourceStatus;
  hits: SourceHit[];
}

/** Where the user was on the results, so Back from a title lands on the same card. */
export interface SearchFocus {
  key: string;
  hitKeys: string[];
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class SearchController {
  private request: SearchRequest = { query: '', filter: 'all', scope: ALL_SOURCES };
  private generation = 0;
  private results = new Map<string, Result>();
  private runs = new Map<string, Run>();
  private queue: string[] = [];
  private debounce: unknown;
  private sourceList: SearchSource[];
  /** Answers per `filter + query`, then per `source + revision`. Memory only, never persisted. */
  private session = new Map<string, Map<string, SourceHit[]>>();
  private listeners = new Set<(snapshot: SearchSnapshot) => void>();
  private cached: SearchSnapshot | undefined;
  private focus: SearchFocus | undefined;
  private readonly timers: Timers;

  constructor(private readonly deps: SearchControllerDeps) {
    this.timers = deps.timers ?? defaultTimers;
    this.sourceList = deps.sources();
  }

  subscribe(listener: (snapshot: SearchSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SearchSnapshot {
    if (!this.cached) {
      const states = this.inScope().map(source => {
        const result = this.results.get(source.key);
        return { source, status: result?.status ?? 'pending', count: result?.hits.length ?? 0 };
      });
      const hits = states.flatMap(state => (state.status === 'complete' ? this.results.get(state.source.key)?.hits ?? [] : []));
      const active = this.deps.activeKey();
      const keys = this.sourceList.map(s => s.key);
      const sourceOrder = active && keys.includes(active) ? [active, ...keys.filter(k => k !== active)] : keys;
      this.cached = {
        request: this.request,
        states: this.request.query.trim() ? states : [],
        groups: this.request.query.trim() ? groupHits(hits, { query: this.request.query.trim(), sourceOrder }) : [],
        pending: this.request.query.trim() ? states.filter(s => s.status === 'pending').length : 0,
      };
    }
    return this.cached;
  }

  sources(): SearchSource[] {
    return this.sourceList;
  }

  remembered(): SearchFocus | undefined {
    return this.focus;
  }

  remember(focus: SearchFocus | undefined): void {
    this.focus = focus;
  }

  /**
   * A new query, filter or scope. Answers already in memory show at once; the rest are asked after the debounce.
   * Work for the previous request is cancelled.
   */
  setRequest(next: SearchRequest): void {
    const same = next.query === this.request.query && next.filter === this.request.filter && next.scope === this.request.scope;
    if (same) {
      return;
    }
    const sameAnswers = next.query.trim() === this.request.query.trim() && next.filter === this.request.filter;
    this.request = next;
    if (!sameAnswers) {
      this.focus = undefined;
    }
    this.restart(sameAnswers ? 0 : this.deps.debounceMs);
  }

  /** Asks one failed source again, for the current query only. */
  retry(sourceKey: string): void {
    const source = this.inScope().find(s => s.key === sourceKey);
    const result = this.results.get(sourceKey);
    if (!source || !result || result.status === 'pending' || result.status === 'complete' || result.status === 'auth-required') {
      return;
    }
    const generation = this.generation;
    this.results.set(sourceKey, { revision: source.revision, status: 'pending', hits: [] });
    this.changed();
    if (this.deps.recheck) {
      const controller = new AbortController();
      this.runs.set(sourceKey, { controller, timer: undefined, done: false });
      this.deps.recheck(source, controller.signal).then(
        () => this.afterRecheck(sourceKey, generation, controller),
        () => this.afterRecheck(sourceKey, generation, controller),
      );
    } else {
      this.enqueue(sourceKey);
    }
  }

  /**
   * Saved connections changed (added, removed, signed out, profile switched). Answers from a source whose
   * profile or credential changed are dropped and asked again; a removed source disappears, along with its work.
   */
  syncSources(): void {
    const next = this.deps.sources();
    const byKey = new Map(next.map(s => [s.key, s]));
    for (const old of this.sourceList) {
      const now = byKey.get(old.key);
      if (!now || now.revision !== old.revision || now.signedIn !== old.signedIn) {
        this.forgetSource(old.key);
      }
    }
    this.sourceList = next;
    if (this.request.query.trim()) {
      for (const source of this.inScope()) {
        if (!this.results.has(source.key)) {
          this.prime(source);
        }
      }
      this.pump();
    }
    this.changed();
  }

  /** The active connection changed: copies are re-ordered so its own come first. No network. */
  activeChanged(): void {
    this.changed();
  }

  /** Leaves search for good (sign-out of everything): cancels all work and forgets every answer. */
  reset(): void {
    this.cancelAll();
    this.session.clear();
    this.request = { query: '', filter: 'all', scope: ALL_SOURCES };
    this.focus = undefined;
    this.changed();
  }

  dispose(): void {
    this.cancelAll();
    this.listeners.clear();
  }

  private inScope(): SearchSource[] {
    const { scope } = this.request;
    return scope === ALL_SOURCES ? this.sourceList : this.sourceList.filter(s => s.key === scope);
  }

  private sessionKey(): string {
    return `${this.request.filter}\u0000${normalizeTitle(this.request.query)}`;
  }

  private restart(delay: number): void {
    this.cancelAll();
    this.generation += 1;
    this.results.clear();
    if (this.request.query.trim()) {
      for (const source of this.inScope()) {
        this.prime(source);
      }
      if (this.queue.length > 0) {
        const generation = this.generation;
        const start = () => {
          if (generation === this.generation) {
            this.debounce = undefined;
            this.pump();
          }
        };
        if (delay > 0) {
          this.debounce = this.timers.setTimeout(start, delay);
        } else {
          start();
        }
      }
    }
    this.changed();
  }

  /** Fills a source's state from memory, or as needing sign-in, or queues it. */
  private prime(source: SearchSource): void {
    if (!source.signedIn) {
      this.results.set(source.key, { revision: source.revision, status: 'auth-required', hits: [] });
      return;
    }
    const remembered = this.session.get(this.sessionKey())?.get(`${source.key}\u0000${source.revision}`);
    if (remembered) {
      this.results.set(source.key, { revision: source.revision, status: 'complete', hits: remembered });
      return;
    }
    this.results.set(source.key, { revision: source.revision, status: 'pending', hits: [] });
    if (!this.queue.includes(source.key)) {
      this.queue.push(source.key);
    }
  }

  private enqueue(sourceKey: string): void {
    if (!this.queue.includes(sourceKey)) {
      this.queue.push(sourceKey);
    }
    this.pump();
  }

  private afterRecheck(sourceKey: string, generation: number, controller: AbortController): void {
    if (generation !== this.generation || controller.signal.aborted) {
      return;
    }
    this.runs.delete(sourceKey);
    this.enqueue(sourceKey);
  }

  private pump(): void {
    if (this.debounce !== undefined) {
      return;
    }
    while (this.runs.size < this.deps.concurrency && this.queue.length > 0) {
      const key = this.queue.shift() as string;
      const source = this.sourceList.find(s => s.key === key);
      if (source && this.results.get(key)?.status === 'pending') {
        this.run(source);
      }
    }
  }

  private run(source: SearchSource): void {
    const generation = this.generation;
    const { query, filter } = this.request;
    const sessionKey = this.sessionKey();
    const provider = this.deps.provider(source);
    if (!provider) {
      this.results.set(source.key, { revision: source.revision, status: 'auth-required', hits: [] });
      this.changed();
      return;
    }
    const controller = new AbortController();
    const run: Run = { controller, timer: undefined, done: false };
    const current = () => !run.done && generation === this.generation && this.runs.get(source.key) === run;
    const settle = (status: SourceStatus, hits: SourceHit[]) => {
      if (!current()) {
        return;
      }
      run.done = true;
      this.timers.clearTimeout(run.timer);
      this.runs.delete(source.key);
      this.results.set(source.key, { revision: source.revision, status, hits });
      this.changed();
      this.pump();
    };
    // A server that never answers (or ignores the abort) still finishes, as timed out, after the deadline.
    run.timer = this.timers.setTimeout(() => {
      settle('timed-out', []);
      controller.abort();
    }, this.deps.deadlineMs);
    this.runs.set(source.key, run);

    let request: Promise<MediaItem[]>;
    try {
      request = provider.search(query.trim(), filter, controller.signal);
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      items => {
        if (!current()) {
          return;
        }
        const hits = items.map((item, rank) => makeHit(source, item, rank));
        this.store(sessionKey, source, hits);
        settle('complete', hits);
      },
      error => {
        const kind = this.deps.classify(error);
        settle(kind === 'cancelled' ? 'unavailable' : kind, []);
      },
    );
  }

  private store(sessionKey: string, source: SearchSource, hits: SourceHit[]): void {
    let entry = this.session.get(sessionKey);
    if (entry) {
      // Most recently used last, so the oldest query is the first to go.
      this.session.delete(sessionKey);
    } else {
      entry = new Map();
    }
    entry.set(`${source.key}\u0000${source.revision}`, hits);
    this.session.set(sessionKey, entry);
    while (this.session.size > this.deps.sessionEntries) {
      const oldest = this.session.keys().next().value as string;
      this.session.delete(oldest);
    }
  }

  private forgetSource(key: string): void {
    const run = this.runs.get(key);
    if (run) {
      run.done = true;
      this.timers.clearTimeout(run.timer);
      run.controller.abort();
      this.runs.delete(key);
    }
    this.queue = this.queue.filter(k => k !== key);
    this.results.delete(key);
    const prefix = `${key}\u0000`;
    for (const entry of this.session.values()) {
      for (const sourceKey of [...entry.keys()]) {
        if (sourceKey.startsWith(prefix)) {
          entry.delete(sourceKey);
        }
      }
    }
    if (this.request.scope === key) {
      this.request = { ...this.request, scope: ALL_SOURCES };
    }
  }

  private cancelAll(): void {
    if (this.debounce !== undefined) {
      this.timers.clearTimeout(this.debounce);
      this.debounce = undefined;
    }
    for (const run of this.runs.values()) {
      run.done = true;
      this.timers.clearTimeout(run.timer);
      run.controller.abort();
    }
    this.runs.clear();
    this.queue = [];
  }

  private changed(): void {
    this.cached = undefined;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

/**
 * Other servers' copies of one title, for "Also on…" on a title page opened from Home or a library. Each
 * source is searched by title, and only copies whose external ids agree with this copy's are kept: a title
 * match alone is not proof, and a failed or slow source just means no entry, not that the title is absent.
 */
export async function findAlternatives(
  item: MediaItem,
  from: SearchSource,
  sources: SearchSource[],
  provider: (source: SearchSource) => SearchProvider | undefined,
  options: { deadlineMs: number; signal?: AbortSignal; timers?: Timers },
): Promise<SourceHit[]> {
  const filter: KindFilter | undefined = item.kind === 'movie' ? 'movies' : item.kind === 'series' ? 'series' : undefined;
  if (!filter || !item.title.trim()) {
    return [];
  }
  const timers = options.timers ?? defaultTimers;
  const ask = async (source: SearchSource): Promise<MediaItem[]> => {
    const search = provider(source);
    if (!search) {
      return [];
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    let timer: unknown;
    const deadline = new Promise<MediaItem[]>(resolve => {
      timer = timers.setTimeout(() => {
        controller.abort();
        resolve([]);
      }, options.deadlineMs);
    });
    try {
      return await Promise.race([search.search(item.title, filter, controller.signal).catch(() => []), deadline]);
    } finally {
      timers.clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  };

  // This copy's ids: the item itself may have come from a list that did not ask for them, so look it up too.
  let anchorIds = item.externalIds;
  if (!anchorIds) {
    const own = await ask(from);
    anchorIds = own.find(found => found.id === item.id)?.externalIds;
  }
  if (!anchorIds || options.signal?.aborted) {
    return [];
  }
  const ids = anchorIds;
  const others = sources.filter(s => s.signedIn && s.key !== from.key);
  const answers = await Promise.all(others.map(async source => ({ source, items: await ask(source) })));
  if (options.signal?.aborted) {
    return [];
  }
  const agrees = (found: MediaItem) =>
    found.kind === item.kind &&
    ID_ORDER.some(ns => ids[ns] !== undefined && found.externalIds?.[ns] === ids[ns]) &&
    !ID_ORDER.some(ns => ids[ns] !== undefined && found.externalIds?.[ns] !== undefined && found.externalIds[ns] !== ids[ns]);
  return answers.flatMap(({ source, items }) => items.filter(agrees).map((found, rank) => makeHit(source, found, rank)));
}
