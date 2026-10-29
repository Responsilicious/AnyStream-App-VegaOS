export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();

  getString(key: string): string | undefined {
    return this.data.get(key);
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }
}

declare const require: (name: string) => any;

/**
 * MMKV on a device; memory elsewhere (unit tests, simulators without the module).
 * The native module is loaded lazily so a missing package never breaks startup.
 */
export function createDefaultStore(): KeyValueStore {
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
