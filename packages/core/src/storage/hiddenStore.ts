import type { HiddenContinue } from '../home';
import type { KeyValueStore } from './keyValueStore';

/** Most entries kept per profile; the oldest go first, so the list cannot grow without end. */
const MAX_ENTRIES = 200;

/**
 * Titles and series the user removed from Continue Playing, for one profile on one server. Removing never
 * touches the server: the resume point stays, and the entry returns once the title is played again.
 */
export class HiddenContinueStore {
  private readonly key: string;

  constructor(
    private readonly store: KeyValueStore,
    profileKey: string,
  ) {
    this.key = `anystream.hiddenContinue.v1.${profileKey}`;
  }

  get(): HiddenContinue {
    const raw = this.store.getString(this.key);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object') {
        const result: HiddenContinue = {};
        for (const [id, stamp] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof stamp === 'number') {
            result[id] = stamp;
          }
        }
        return result;
      }
    } catch {
      // A damaged list is the same as no list: everything shows again.
    }
    return {};
  }

  /** Hides `key` (a series or item id) until it is played after `lastPlayed`. */
  hide(key: string, lastPlayed: number): void {
    const next = { ...this.get(), [key]: lastPlayed };
    const entries = Object.entries(next);
    const kept =
      entries.length > MAX_ENTRIES
        ? entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES)
        : entries;
    this.store.set(this.key, JSON.stringify(Object.fromEntries(kept)));
  }
}
