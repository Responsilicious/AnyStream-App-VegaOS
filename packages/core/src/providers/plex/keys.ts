import nacl from 'tweetnacl';
import { hasPlatform, platform } from '../../platform';
import { PlexError } from './errors';
import { base64Url, base64UrlDecode, type Ed25519Signer } from './jwt';

/** Fills `n` bytes from a cryptographically secure source. */
export type RandomBytes = (n: number) => Uint8Array;

/**
 * The device's secure random source: whatever the app shell registered, else a WebCrypto on globalThis. There is
 * deliberately no Math.random fallback: a guessable key would let anyone impersonate this TV to Plex, so without
 * a secure source Plex linking is off.
 */
export function platformRandom(): RandomBytes {
  if (hasPlatform()) {
    const fromPlatform = platform().randomBytes;
    if (fromPlatform) {
      return fromPlatform;
    }
  }
  const global = globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } };
  if (typeof global.crypto?.getRandomValues === 'function') {
    const source = global.crypto as { getRandomValues(a: Uint8Array): Uint8Array };
    return n => source.getRandomValues(new Uint8Array(n));
  }
  throw new PlexError('no-signing-key', 'No secure random source on this device');
}

/** What gets saved: the key id and the 64-byte tweetnacl secret key (seed + public key), base64url. */
export interface StoredSigningKey {
  kid: string;
  secret: string;
}

function signerFrom(kid: string, secretKey: Uint8Array): Ed25519Signer {
  const publicKey = secretKey.slice(32);
  return {
    kid,
    publicKey,
    sign: message => nacl.sign.detached(message, secretKey),
  };
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function createSigningKey(random: RandomBytes): { signer: Ed25519Signer; stored: StoredSigningKey } {
  const seed = random(32);
  if (seed.length !== 32) {
    throw new PlexError('no-signing-key', 'Random source returned the wrong length');
  }
  const pair = nacl.sign.keyPair.fromSeed(seed);
  const kid = hex(random(16));
  return { signer: signerFrom(kid, pair.secretKey), stored: { kid, secret: base64Url(pair.secretKey) } };
}

export function loadSigningKey(stored: StoredSigningKey): Ed25519Signer {
  const secretKey = base64UrlDecode(stored.secret);
  if (secretKey.length !== 64) {
    throw new PlexError('no-signing-key', 'Saved Plex key is damaged');
  }
  return signerFrom(stored.kid, secretKey);
}
