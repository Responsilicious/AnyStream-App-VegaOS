import { MemoryStore, type KeyValueStore } from '@anystream/core';

declare const require: (name: string) => any;

/** MMKV (app-private, synchronous) on a device; memory when the module is missing, so start-up never breaks. */
export function createMmkvStore(): KeyValueStore {
  try {
    const mod = require('react-native-mmkv');
    // v4 exposes createMMKV(); v2 and v3 a class.
    const mmkv = typeof mod.createMMKV === 'function' ? mod.createMMKV({ id: 'anystream' }) : new mod.MMKV({ id: 'anystream' });
    return {
      getString: key => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      delete: key => (typeof mmkv.remove === 'function' ? mmkv.remove(key) : mmkv.delete(key)),
    };
  } catch (e) {
    console.log(`AnyStream storage: MMKV unavailable, using memory: ${String(e)}`);
    return new MemoryStore();
  }
}
