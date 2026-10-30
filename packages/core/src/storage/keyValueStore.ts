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
