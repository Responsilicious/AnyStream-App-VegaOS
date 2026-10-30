import { createSigningKey, loadSigningKey, platformRandom, type Ed25519Signer, type RandomBytes, type StoredSigningKey } from '../providers/plex';
import type { ConnectionStore } from './connectionStore';

const KEY_NAME = 'plexSigningKey';

/**
 * The TV's one Plex signing key, made on first use and kept so tokens can be refreshed later. Returns
 * undefined when the device has no secure random source: Plex then issues a legacy token instead, which is
 * worse (no expiry) but never a guessable key.
 */
export function plexSigner(store: ConnectionStore, random?: RandomBytes): Ed25519Signer | undefined {
  const saved = store.getDeviceSecret(KEY_NAME);
  if (saved) {
    try {
      return loadSigningKey(JSON.parse(saved) as StoredSigningKey);
    } catch {
      // Damaged: make a new one. Accounts linked with the old key will need linking again.
    }
  }
  try {
    const { signer, stored } = createSigningKey(random ?? platformRandom());
    store.setDeviceSecret(KEY_NAME, JSON.stringify(stored));
    return signer;
  } catch {
    return undefined;
  }
}
