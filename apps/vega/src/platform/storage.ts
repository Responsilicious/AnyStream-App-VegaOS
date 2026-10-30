import { MemoryStore, type KeyValueStore } from '@anystream/core';

declare const require: (name: string) => any;

/**
 * MMKV on a device; memory elsewhere (the Vega Virtual Device without the module). The native module is
 * loaded lazily so a missing package never breaks startup.
 */
export function createMmkvStore(): KeyValueStore {
  try {
    const { MMKV } = require('@amazon-devices/react-native-mmkv');
    const mmkv = new MMKV({ id: 'anystream' });
    return {
      getString: key => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      delete: key => (typeof mmkv.delete === 'function' ? mmkv.delete(key) : mmkv.remove(key)),
    };
  } catch {
    return new MemoryStore();
  }
}
