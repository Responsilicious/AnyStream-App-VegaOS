import type { RandomBytes } from '@anystream/core';

declare const require: (name: string) => any;

/**
 * Vega's native random source (keplercrypto WebCrypto), or undefined when the module is missing. The core then
 * falls back to globalThis.crypto and, failing that, leaves Plex linking on legacy tokens: never Math.random.
 */
export function keplerRandom(): RandomBytes | undefined {
  try {
    const { WebCrypto } = require('@amazon-devices/keplercrypto');
    const crypto: { getRandomValues(a: Uint8Array): Uint8Array } = new WebCrypto().crypto;
    return n => crypto.getRandomValues(new Uint8Array(n));
  } catch {
    return undefined;
  }
}
