import { MemoryStore, type KeyValueStore } from '@anystream/core';

const PREFIX = 'anystream:';

/**
 * localStorage, which keeps sign-ins on this browser profile for this site only. Memory when the browser
 * blocks it (some private windows), so start-up never breaks; the viewer then signs in each visit.
 */
export function createWebStore(): KeyValueStore {
  try {
    const storage = window.localStorage;
    const probe = `${PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return {
      getString: key => storage.getItem(PREFIX + key) ?? undefined,
      set: (key, value) => {
        try {
          storage.setItem(PREFIX + key, value);
        } catch (e) {
          console.log(`AnyStream storage: could not save ${key}: ${String(e)}`);
        }
      },
      delete: key => storage.removeItem(PREFIX + key),
    };
  } catch (e) {
    console.log(`AnyStream storage: localStorage unavailable, using memory: ${String(e)}`);
    return new MemoryStore();
  }
}
