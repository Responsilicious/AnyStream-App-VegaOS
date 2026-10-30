/**
 * Plex's JWT sign-in: the TV holds an Ed25519 key pair, sends the public half (as a JWK) when it asks for a
 * link code, and proves itself afterwards with short-lived JWTs signed by the private half. Vega's
 * keplercrypto has no Ed25519 (its WebCrypto rejects it as not supported), so signing is pure JS; only the
 * random seed comes from the platform.
 */

/** An Ed25519 key pair the TV can sign with. The secret never leaves this object except to be saved. */
export interface Ed25519Signer {
  /** Key id registered with Plex alongside the public key. */
  readonly kid: string;
  /** The 32-byte public key. */
  readonly publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
}

/** What Plex accepts in the `jwk` field of a new PIN. */
export interface PlexJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  alg: 'EdDSA';
  use: 'sig';
  kid: string;
  x: string;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** RFC 4648 base64url without padding. Hand-written because Hermes has no Buffer and btoa is not guaranteed. */
export function base64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63] + BASE64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63] + BASE64URL[(n >> 6) & 63];
  }
  return out;
}

export function base64UrlDecode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = BASE64URL.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
    if (v < 0) {
      throw new Error('Invalid base64url');
    }
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** UTF-8 encode without TextEncoder, which Vega only has through a polyfill. */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return new Uint8Array(out);
}

export function fromUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c: number;
    if (b < 0x80) {
      c = b;
      i += 1;
    } else if (b < 0xe0) {
      c = ((b & 31) << 6) | (bytes[i + 1] & 63);
      i += 2;
    } else if (b < 0xf0) {
      c = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
      i += 3;
    } else {
      c = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      i += 4;
    }
    out += String.fromCodePoint(c);
  }
  return out;
}

export function toJwk(signer: Ed25519Signer): PlexJwk {
  return { kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig', kid: signer.kid, x: base64Url(signer.publicKey) };
}

export interface DeviceJwtClaims {
  /** The TV's X-Plex-Client-Identifier. */
  clientId: string;
  /** From GET /api/v2/auth/nonce, for a refresh; not needed when polling a PIN. */
  nonce?: string;
  /** Seconds since the epoch. */
  nowSec: number;
  /** How long the proof is good for. Short: it is used once, straight away. */
  lifetimeSec?: number;
}

/** A compact JWS proving this TV holds the key: header names the key, payload is aimed at plex.tv. */
export function signDeviceJwt(signer: Ed25519Signer, claims: DeviceJwtClaims): string {
  const header = { kid: signer.kid, alg: 'EdDSA', typ: 'JWT' };
  const payload: Record<string, unknown> = {
    aud: 'plex.tv',
    iss: claims.clientId,
    iat: claims.nowSec,
    exp: claims.nowSec + (claims.lifetimeSec ?? 300),
  };
  if (claims.nonce) {
    payload.nonce = claims.nonce;
  }
  const signingInput = `${base64Url(utf8(JSON.stringify(header)))}.${base64Url(utf8(JSON.stringify(payload)))}`;
  return `${signingInput}.${base64Url(signer.sign(utf8(signingInput)))}`;
}

/** The `exp` of a JWT Plex issued, in epoch ms, or undefined for a legacy token or one we cannot read. */
export function tokenExpiry(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payload = JSON.parse(fromUtf8(base64UrlDecode(parts[1]))) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
