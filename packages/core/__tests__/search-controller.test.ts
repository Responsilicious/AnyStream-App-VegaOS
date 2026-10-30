import { ALL_SOURCES, findAlternatives, SearchController, type FailureKind, type SearchProvider } from '../src/search/controller';
import type { SearchSource } from '../src/search/model';
import type { KindFilter, MediaItem } from '../src/providers/types';

/** Timers driven by hand: `advance` fires everything due, in order. */
class FakeTimers {
  now = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.pending.delete(handle as number);
  };
  advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = until;
  }
}

/** A provider whose answers the test releases one at a time. */
class FakeSearch implements SearchProvider {
  calls: Array<{ term: string; filter: KindFilter; signal?: AbortSignal; resolve: (items: MediaItem[]) => void; reject: (e: unknown) => void }> = [];
  search(term: string, filter: KindFilter, signal?: AbortSignal): Promise<MediaItem[]> {
    return new Promise((resolve, reject) => {
      this.calls.push({ term, filter, signal, resolve, reject });
    });
  }
  last() {
    return this.calls[this.calls.length - 1];
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

function source(key: string, extra: Partial<SearchSource> = {}): SearchSource {
  return { key, contextKey: `${key}.ctx`, provider: 'jellyfin', serverId: `${key}-id`, label: key, profileName: 'will', revision: 'r1', signedIn: true, ...extra };
}

function movie(id: string, extra: Partial<MediaItem> = {}): MediaItem {
  return { id, title: 'Matrix', kind: 'movie', year: 1999, resumeMs: 0, played: false, ...extra };
}

function setup(keys = ['a', 'b', 'c'], options: { concurrency?: number; recheck?: boolean } = {}) {
  const timers = new FakeTimers();
  let sources = keys.map(k => source(k));
  const providers = new Map(keys.map(k => [k, new FakeSearch()]));
  let active: string | undefined = keys[0];
  const rechecks: string[] = [];
  const classify = (e: unknown): FailureKind => (e === 'auth' ? 'auth-required' : e === 'cancel' ? 'cancelled' : 'unavailable');
  const controller = new SearchController({
    sources: () => sources,
    provider: s => (s.signedIn ? providers.get(s.key) : undefined),
    activeKey: () => active,
    classify,
    recheck: options.recheck
      ? async s => {
          rechecks.push(s.key);
        }
      : undefined,
    timers,
    debounceMs: 300,
    concurrency: options.concurrency ?? 3,
    deadlineMs: 5000,
    sessionEntries: 4,
  });
  return {
    timers,
    controller,
    providers,
    rechecks,
    p: (k: string) => providers.get(k)!,
    setSources: (next: SearchSource[]) => {
      sources = next;
      for (const s of next) {
        if (!providers.has(s.key)) {
          providers.set(s.key, new FakeSearch());
        }
      }
    },
    setActive: (k: string | undefined) => {
      active = k;
    },
    statuses: () => controller.snapshot().states.map(s => `${s.source.key}:${s.status}`),
  };
}

describe('SearchController', () => {
  it('waits for typing to pause, then asks every source', () => {
    const t = setup();
    t.controller.setRequest({ query: 'mat', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(299);
    expect(t.p('a').calls).toHaveLength(0);
    expect(t.statuses()).toEqual(['a:pending', 'b:pending', 'c:pending']);
    t.timers.advance(1);
    expect(['a', 'b', 'c'].map(k => t.p(k).calls.length)).toEqual([1, 1, 1]);
    expect(t.p('a').last().term).toBe('mat');
  });

  it('shows each server as it answers and leaves a failure beside the results', async () => {
    const t = setup();
    t.controller.setRequest({ query: 'matrix', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    t.p('b').last().resolve([movie('b1')]);
    await flush();
    expect(t.statuses()).toEqual(['a:pending', 'b:complete', 'c:pending']);
    expect(t.controller.snapshot().groups).toHaveLength(1);
    expect(t.controller.snapshot().pending).toBe(2);
    t.p('c').last().reject(new Error('down'));
    t.p('a').last().reject('auth');
    await flush();
    expect(t.statuses()).toEqual(['a:auth-required', 'b:complete', 'c:unavailable']);
    expect(t.controller.snapshot().groups).toHaveLength(1);
  });

  it('cancels the old search when the query changes, and drops its late answers', async () => {
    const t = setup(['a']);
    t.controller.setRequest({ query: 'ma', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    const old = t.p('a').last();
    t.controller.setRequest({ query: 'mat', filter: 'all', scope: ALL_SOURCES });
    expect(old.signal?.aborted).toBe(true);
    old.resolve([movie('stale')]);
    await flush();
    expect(t.controller.snapshot().groups).toEqual([]);
    t.timers.advance(300);
    t.p('a').last().resolve([movie('fresh')]);
    await flush();
    expect(t.controller.snapshot().groups.map(g => g.display.item.id)).toEqual(['fresh']);
  });

  it('runs at most the configured number of searches at once', async () => {
    const t = setup(['a', 'b', 'c'], { concurrency: 2 });
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    expect(['a', 'b', 'c'].map(k => t.p(k).calls.length)).toEqual([1, 1, 0]);
    t.p('a').last().resolve([]);
    await flush();
    expect(t.p('c').calls).toHaveLength(1);
  });

  it('times out a hung server without holding up the others', async () => {
    const t = setup(['a', 'b']);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    t.p('b').last().resolve([movie('b1')]);
    await flush();
    t.timers.advance(5000);
    expect(t.statuses()).toEqual(['a:timed-out', 'b:complete']);
    expect(t.p('a').last().signal?.aborted).toBe(true);
    // A reply after the deadline changes nothing.
    t.p('a').last().resolve([movie('late')]);
    await flush();
    expect(t.controller.snapshot().groups.map(g => g.display.item.id)).toEqual(['b1']);
  });

  it('retries only the failed source, re-checking its address first', async () => {
    const t = setup(['a', 'b'], { recheck: true });
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    t.p('a').last().resolve([movie('a1')]);
    t.p('b').last().reject(new Error('down'));
    await flush();
    t.controller.retry('a'); // complete: nothing to retry
    t.controller.retry('b');
    expect(t.statuses()).toEqual(['a:complete', 'b:pending']);
    await flush();
    expect(t.rechecks).toEqual(['b']);
    expect(t.p('a').calls).toHaveLength(1);
    expect(t.p('b').calls).toHaveLength(2);
    t.p('b').last().resolve([movie('b1', { year: 2001 })]);
    await flush();
    expect(t.controller.snapshot().groups).toHaveLength(2);
  });

  it('lists a source without a sign-in and never asks it', () => {
    const t = setup(['a']);
    t.setSources([source('a'), source('b', { signedIn: false })]);
    t.controller.syncSources();
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    expect(t.statuses()).toEqual(['a:pending', 'b:auth-required']);
    expect(t.p('b').calls).toHaveLength(0);
    t.controller.retry('b');
    expect(t.p('b').calls).toHaveLength(0);
  });

  it('searches one server when the scope says so, reusing answers already in memory', async () => {
    const t = setup(['a', 'b']);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    t.p('a').last().resolve([movie('a1')]);
    t.p('b').last().resolve([movie('b1', { year: 2001 })]);
    await flush();
    t.controller.setRequest({ query: 'x', filter: 'all', scope: 'b' });
    expect(t.statuses()).toEqual(['b:complete']);
    expect(t.p('b').calls).toHaveLength(1);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    expect(t.statuses()).toEqual(['a:complete', 'b:complete']);
    // Back to an earlier query: answered from memory without asking again.
    t.controller.setRequest({ query: 'y', filter: 'all', scope: ALL_SOURCES });
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    expect(t.statuses()).toEqual(['a:complete', 'b:complete']);
    expect(t.p('a').calls).toHaveLength(1);
  });

  it('drops a removed source and its late answer', async () => {
    const t = setup(['a', 'b']);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    const pending = t.p('b').last();
    t.setSources([source('a')]);
    t.controller.syncSources();
    expect(pending.signal?.aborted).toBe(true);
    pending.resolve([movie('b1')]);
    await flush();
    expect(t.statuses()).toEqual(['a:pending']);
    expect(t.controller.snapshot().groups).toEqual([]);
  });

  it('asks again as the new profile after a profile change, never showing the old one', async () => {
    const t = setup(['a']);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    t.p('a').last().resolve([movie('owner-copy')]);
    await flush();
    t.setSources([source('a', { revision: 'r2', contextKey: 'a.kid' })]);
    t.controller.syncSources();
    expect(t.statuses()).toEqual(['a:pending']);
    expect(t.controller.snapshot().groups).toEqual([]);
    expect(t.p('a').calls).toHaveLength(2);
    t.p('a').last().resolve([movie('kid-copy')]);
    await flush();
    expect(t.controller.snapshot().groups[0].display.ref.contextKey).toBe('a.kid');
    // The owner's answer is not in memory any more either.
    t.setSources([source('a')]);
    t.controller.syncSources();
    expect(t.statuses()).toEqual(['a:pending']);
  });

  it('puts the active connection’s copy first, and re-orders without asking again after a switch', async () => {
    const t = setup(['a', 'b']);
    t.controller.setRequest({ query: 'matrix', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    t.p('a').last().resolve([movie('a1', { externalIds: { tmdb: '603' } })]);
    t.p('b').last().resolve([movie('b1', { externalIds: { tmdb: '603' } })]);
    await flush();
    expect(t.controller.snapshot().groups[0].display.item.id).toBe('a1');
    t.setActive('b');
    t.controller.activeChanged();
    expect(t.controller.snapshot().groups[0].display.item.id).toBe('b1');
    expect(t.p('a').calls).toHaveLength(1);
  });

  it('keeps the remembered card only while the query stays the same', () => {
    const t = setup(['a']);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.controller.remember({ key: 'k', hitKeys: ['k'] });
    t.controller.setRequest({ query: 'x', filter: 'all', scope: 'a' });
    expect(t.controller.remembered()).toEqual({ key: 'k', hitKeys: ['k'] });
    t.controller.setRequest({ query: 'xy', filter: 'all', scope: 'a' });
    expect(t.controller.remembered()).toBeUndefined();
  });

  it('cancels everything on reset', () => {
    const t = setup(['a']);
    t.controller.setRequest({ query: 'x', filter: 'all', scope: ALL_SOURCES });
    t.timers.advance(300);
    const pending = t.p('a').last();
    t.controller.reset();
    expect(pending.signal?.aborted).toBe(true);
    expect(t.controller.snapshot().states).toEqual([]);
  });
});

describe('findAlternatives', () => {
  const timers = new FakeTimers();
  const A = source('a');
  const B = source('b');
  const C = source('c');

  it('keeps only copies whose ids agree, looking up this copy’s ids when it has none', async () => {
    const answers: Record<string, MediaItem[]> = {
      a: [movie('a1', { externalIds: { tmdb: '603' } })],
      b: [movie('b1', { externalIds: { tmdb: '603', imdb: 'tt0133093' } }), movie('b2', { externalIds: { tmdb: '9' } })],
      // Same title and year but no ids: not proof, so not offered.
      c: [movie('c1')],
    };
    const provider = (s: SearchSource): SearchProvider => ({ search: async () => answers[s.key] });
    const found = await findAlternatives(movie('a1'), A, [A, B, C], provider, { deadlineMs: 1000, timers });
    expect(found.map(h => h.item.id)).toEqual(['b1']);
    expect(found[0].sourceKey).toBe('b');
  });

  it('treats a failed source as unknown, not absent, and skips episodes', async () => {
    const provider = (s: SearchSource): SearchProvider => ({
      search: async () => {
        if (s.key === 'b') {
          throw new Error('down');
        }
        return [movie(`${s.key}1`, { externalIds: { tmdb: '603' } })];
      },
    });
    const found = await findAlternatives(movie('a1', { externalIds: { tmdb: '603' } }), A, [A, B, C], provider, { deadlineMs: 1000, timers });
    expect(found.map(h => h.sourceKey)).toEqual(['c']);
    expect(await findAlternatives(movie('e', { kind: 'episode' }), A, [A, B], provider, { deadlineMs: 1000, timers })).toEqual([]);
  });
});
