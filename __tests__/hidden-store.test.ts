import { HiddenContinueStore } from '../src/storage/hiddenStore';
import { MemoryStore } from '../src/storage/keyValueStore';

describe('HiddenContinueStore', () => {
  it('starts empty and remembers what was hidden, with when it was last played', () => {
    const store = new HiddenContinueStore(new MemoryStore(), 'server.user');
    expect(store.get()).toEqual({});
    store.hide('series-1', 1000);
    store.hide('movie-1', 2000);
    expect(store.get()).toEqual({ 'series-1': 1000, 'movie-1': 2000 });
  });

  it('keeps each profile apart, and survives a new instance on the same storage', () => {
    const kv = new MemoryStore();
    new HiddenContinueStore(kv, 'server.alice').hide('a', 1);
    expect(new HiddenContinueStore(kv, 'server.alice').get()).toEqual({ a: 1 });
    expect(new HiddenContinueStore(kv, 'server.bob').get()).toEqual({});
  });

  it('hiding the same entry again updates its time', () => {
    const store = new HiddenContinueStore(new MemoryStore(), 'p');
    store.hide('a', 1);
    store.hide('a', 5);
    expect(store.get()).toEqual({ a: 5 });
  });

  it('treats a damaged list as empty, and ignores entries that are not numbers', () => {
    const kv = new MemoryStore();
    const store = new HiddenContinueStore(kv, 'p');
    kv.set('anystream.hiddenContinue.v1.p', '{not json');
    expect(store.get()).toEqual({});
    kv.set('anystream.hiddenContinue.v1.p', JSON.stringify({ good: 3, bad: 'x' }));
    expect(store.get()).toEqual({ good: 3 });
  });

  it('keeps at most 200 entries, dropping the oldest', () => {
    const store = new HiddenContinueStore(new MemoryStore(), 'p');
    for (let i = 0; i < 205; i += 1) {
      store.hide(`id${i}`, i);
    }
    const kept = store.get();
    expect(Object.keys(kept)).toHaveLength(200);
    expect(kept.id0).toBeUndefined();
    expect(kept.id204).toBe(204);
  });
});
