// Node's crypto checks our pure-JS signatures; the project has no @types/node, so declare the bits used.
declare const require: (name: string) => any;
declare const Buffer: any;
const { createPublicKey, verify } = require('crypto');
import {
  createSigningKey,
  findReachable,
  listPlexServers,
  loadSigningKey,
  parseResources,
  PlexError,
  PlexHttp,
  PlexLinker,
  rankCandidates,
  signDeviceJwt,
  toJwk,
  tokenExpiry,
  listHomeUsers,
  switchHomeUser,
} from '../src/providers/plex';
import { base64Url, base64UrlDecode, fromUtf8, utf8 } from '../src/providers/plex/jwt';
import { parseRetryAfter } from '../src/providers/plex/http';
import type { FetchLike } from '../src/providers/jellyfin/http';
import { DEVICE, fakeFetch } from './helpers/fakes';

/** Deterministic but varied bytes; tests only. */
function seqRandom(start = 1) {
  let n = start;
  return (len: number) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = (n = (n * 73 + 41) & 0xff);
    }
    return out;
  };
}

const fakeJwt = (payload: object) =>
  `${base64Url(utf8('{"alg":"EdDSA"}'))}.${base64Url(utf8(JSON.stringify(payload)))}.sig`;

describe('base64url and utf8', () => {
  it('round-trips every length', () => {
    for (let len = 0; len < 10; len++) {
      const bytes = seqRandom(len)(len);
      expect(Array.from(base64UrlDecode(base64Url(bytes)))).toEqual(Array.from(bytes));
      expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });

  it('encodes and decodes non-ASCII text', () => {
    const text = 'Zoë — 東京 🎬';
    expect(Buffer.from(utf8(text)).toString('utf8')).toBe(text);
    expect(fromUtf8(utf8(text))).toBe(text);
  });
});

describe('Plex signing key', () => {
  it('signs a device JWT that verifies against the JWK sent to Plex', () => {
    const { signer, stored } = createSigningKey(seqRandom());
    const jwk = toJwk(signer);
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', kid: signer.kid });

    const jwt = signDeviceJwt(loadSigningKey(stored), { clientId: 'client-9', nowSec: 1000 });
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(fromUtf8(base64UrlDecode(h)))).toEqual({ kid: signer.kid, alg: 'EdDSA', typ: 'JWT' });
    expect(JSON.parse(fromUtf8(base64UrlDecode(p)))).toEqual({ aud: 'plex.tv', iss: 'client-9', iat: 1000, exp: 1300 });

    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
    expect(verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(base64UrlDecode(s)))).toBe(true);
  });

  it('includes a nonce only when given one', () => {
    const { signer } = createSigningKey(seqRandom());
    const p = signDeviceJwt(signer, { clientId: 'c', nowSec: 1, nonce: 'n-1' }).split('.')[1];
    expect(JSON.parse(fromUtf8(base64UrlDecode(p))).nonce).toBe('n-1');
  });

  it('refuses a damaged saved key', () => {
    expect(() => loadSigningKey({ kid: 'k', secret: 'abc' })).toThrow(PlexError);
  });

  it('reads expiry from a JWT and not from a legacy token', () => {
    expect(tokenExpiry(fakeJwt({ exp: 2000 }))).toBe(2_000_000);
    expect(tokenExpiry('legacy-token-abc')).toBeUndefined();
  });
});

describe('PlexHttp', () => {
  it('sends the client identity headers and only its own token', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: {} }));
    const http = new PlexHttp('https://clients.plex.tv', DEVICE, 'account-token', fetchImpl);
    await http.get('/api/v2/user');
    await http.at('https://10-0-0-5.abc.plex.direct:32400', undefined).get('/identity');
    expect(calls[0].headers['X-Plex-Client-Identifier']).toBe(DEVICE.id);
    expect(calls[0].headers['X-Plex-Token']).toBe('account-token');
    expect(calls[1].headers['X-Plex-Token']).toBeUndefined();
  });

  it('maps 429 with Retry-After, and keeps the query out of error messages', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 429,
      text: async () => '',
      headers: { get: (n: string) => (n === 'Retry-After' ? '7' : null) },
    }) as any;
    const http = new PlexHttp('https://clients.plex.tv', DEVICE, undefined, fetchImpl);
    const error: any = await http.get('/api/v2/pins/1', { query: { deviceJWT: 'secret.jwt.value' } }).catch((e: any) => e);
    expect(error).toMatchObject({ kind: 'rate-limited', retryAfterMs: 7000 });
    expect(String(error.message)).not.toContain('secret');
  });

  it('parses Retry-After as seconds or a date', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('PlexLinker', () => {
  function setup(handler: Parameters<typeof fakeFetch>[0], withKey = true) {
    const { calls, fetchImpl } = fakeFetch(handler);
    let clock = 1_000_000;
    const sleeps: number[] = [];
    const http = new PlexHttp('https://clients.plex.tv', DEVICE, undefined, fetchImpl);
    const signer = withKey ? createSigningKey(seqRandom()).signer : undefined;
    const linker = new PlexLinker(http, signer, {
      now: () => clock,
      sleep: async (ms, signal) => {
        if (signal?.aborted) {
          throw new PlexError('cancelled', 'Cancelled');
        }
        sleeps.push(ms);
        clock += ms;
      },
    });
    return { calls, linker, sleeps, advance: (ms: number) => (clock += ms) };
  }

  it('creates one PIN carrying the public key and shows Plex’s code as given', async () => {
    const { calls, linker } = setup(() => ({ status: 201, body: { id: 77, code: 'LY4X', expiresIn: 900 } }));
    const pin = await linker.start();
    expect(pin).toEqual({ id: 77, code: 'LY4X', expiresAt: 1_000_000 + 900_000 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body.jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
  });

  it('does not assume a four-character code', async () => {
    const { linker } = setup(() => ({ status: 201, body: { id: 1, code: 'am5ys6e0hpo2rejf6kjxxvesm', expiresIn: 1800 } }));
    expect((await linker.start()).code).toHaveLength(25);
  });

  it('polls with a signed deviceJWT until approved, then reports a JWT token', async () => {
    let polls = 0;
    const token = fakeJwt({ exp: 5000 });
    const { calls, linker, sleeps } = setup(() => {
      polls += 1;
      return { body: { id: 1, code: 'AB12', authToken: polls < 3 ? null : token } };
    });
    const result = await linker.waitForApproval({ id: 1, code: 'AB12', expiresAt: 2_000_000 });
    expect(result).toEqual({ token, tokenKind: 'jwt', expiresAt: 5_000_000 });
    expect(sleeps).toEqual([2000, 2000]);
    expect(calls[0].url).toMatch(/\/api\/v2\/pins\/1\?deviceJWT=[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('accepts Plex’s legacy-token fallback', async () => {
    const { linker } = setup(() => ({ body: { id: 1, authToken: 'legacy-abc' } }), false);
    expect(await linker.waitForApproval({ id: 1, code: 'X', expiresAt: 2_000_000 })).toEqual({ token: 'legacy-abc', tokenKind: 'legacy' });
  });

  it('stops at expiry with link-expired instead of making a new code', async () => {
    const { calls, linker } = setup(() => ({ body: { id: 1, authToken: null } }));
    const error = await linker.waitForApproval({ id: 1, code: 'X', expiresAt: 1_005_000 }).catch(e => e);
    expect(error).toMatchObject({ kind: 'link-expired' });
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('treats a forgotten PIN as expired', async () => {
    const { linker } = setup(() => ({ status: 404 }));
    await expect(linker.waitForApproval({ id: 1, code: 'X', expiresAt: 2_000_000 })).rejects.toMatchObject({ kind: 'link-expired' });
  });

  it('backs off on rate limiting and network blips, then carries on', async () => {
    let n = 0;
    const { linker, sleeps } = setup(() => {
      n += 1;
      return n === 1 ? { status: 429 } : n === 2 ? 'throw' : { body: { authToken: 'legacy' } };
    });
    await linker.waitForApproval({ id: 1, code: 'X', expiresAt: 2_000_000 });
    expect(sleeps).toEqual([4000, 8000]);
  });

  it('stops polling as soon as it is cancelled', async () => {
    const { calls, linker } = setup(() => ({ body: { authToken: null } }));
    const controller = new AbortController();
    const pending = linker.waitForApproval({ id: 1, code: 'X', expiresAt: 2_000_000 }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    const count = calls.length;
    await new Promise<void>(r => setTimeout(() => r(), 5));
    expect(calls.length).toBe(count);
  });

  it('gives up on a refused poll rather than retrying forever', async () => {
    const { linker } = setup(() => ({ status: 401 }));
    await expect(linker.waitForApproval({ id: 1, code: 'X', expiresAt: 2_000_000 })).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('Plex server discovery', () => {
  const RESOURCES = [
    {
      name: 'Basement',
      provides: 'server',
      clientIdentifier: 'm-1',
      owned: true,
      accessToken: 'server-token-1',
      connections: [
        { protocol: 'https', uri: 'https://1-2-3-4.x.plex.direct:32400', local: false, relay: false },
        { protocol: 'http', uri: 'http://192.168.1.5:32400', local: true },
        { protocol: 'http', uri: 'http://1.2.3.4:32400', local: false },
        { protocol: 'https', uri: 'https://relay.plex.direct:8443', local: false, relay: true },
        { protocol: 'https', uri: 'https://192-168-1-5.x.plex.direct:32400', local: true },
      ],
    },
    { name: 'Friend', provides: 'server', clientIdentifier: 'm-2', owned: false, sourceTitle: 'Sam', accessToken: 't2', connections: [] },
    { name: 'Phone', provides: 'client,player', clientIdentifier: 'p-1', accessToken: 't3' },
    { name: 'Basement again', provides: 'server', clientIdentifier: 'm-1', accessToken: 't4' },
  ];

  it('keeps servers only, once each, with owner for shared ones', () => {
    const servers = parseResources(RESOURCES);
    expect(servers.map(s => [s.machineId, s.owned, s.ownerName])).toEqual([
      ['m-1', true, undefined],
      ['m-2', false, 'Sam'],
    ]);
  });

  it('ranks secure local, secure remote, plain local, relay; never plain remote', () => {
    const ranked = rankCandidates(RESOURCES[0].connections as any);
    expect(ranked.map(c => c.uri)).toEqual([
      'https://192-168-1-5.x.plex.direct:32400',
      'https://1-2-3-4.x.plex.direct:32400',
      'http://192.168.1.5:32400',
      'https://relay.plex.direct:8443',
    ]);
  });

  it('asks plex.tv for resources with HTTPS, relay and IPv6 included', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: RESOURCES }));
    await listPlexServers(new PlexHttp('https://clients.plex.tv', DEVICE, 'acct', fetchImpl));
    expect(calls[0].url).toBe('https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1');
  });

  it('finds the first address that proves to be the same machine, sending no token', async () => {
    const [server] = parseResources(RESOURCES);
    const { calls, fetchImpl } = fakeFetch(call => {
      if (call.url.startsWith('https://192-168')) {
        return 'throw';
      }
      if (call.url.startsWith('https://1-2-3-4')) {
        return { body: { MediaContainer: { machineIdentifier: 'someone-else' } } };
      }
      return { body: { MediaContainer: { machineIdentifier: 'm-1' } } };
    });
    const result = await findReachable(new PlexHttp('https://clients.plex.tv', DEVICE, 'acct', fetchImpl), server);
    expect(result).toEqual({ status: 'online', uri: 'http://192.168.1.5:32400', kind: 'local' });
    expect(calls.every(c => c.headers['X-Plex-Token'] === undefined)).toBe(true);
  });

  it('reports unreachable rather than pretending', async () => {
    const [server] = parseResources(RESOURCES);
    const { fetchImpl } = fakeFetch(() => 'throw');
    expect(await findReachable(new PlexHttp('x', DEVICE, undefined, fetchImpl), server)).toEqual({ status: 'unreachable' });
  });
});

describe('Plex Home profiles', () => {
  const account = (handler: Parameters<typeof fakeFetch>[0]) => {
    const { calls, fetchImpl } = fakeFetch(handler);
    return { calls, http: new PlexHttp('https://clients.plex.tv', DEVICE, 'acct', fetchImpl) };
  };

  it('lists Home users with owner, restriction and PIN flags', async () => {
    const { http } = account(() => ({
      body: { users: [{ uuid: 'a', title: 'Will', admin: true }, { uuid: 'k', title: 'Kid', restricted: true, protected: true }] },
    }));
    expect(await listHomeUsers(http)).toEqual([
      { uuid: 'a', name: 'Will', thumb: undefined, admin: true, restricted: false, protected: false },
      { uuid: 'k', name: 'Kid', thumb: undefined, admin: false, restricted: true, protected: true },
    ]);
  });

  it('treats an account without a Home as having no other profiles', async () => {
    const { http } = account(() => ({ status: 404 }));
    expect(await listHomeUsers(http)).toEqual([]);
  });

  it('switches with the PIN and returns the profile token; a refused PIN is wrong-pin', async () => {
    const ok = account(() => ({ body: { authToken: 'kid-token' } }));
    expect(await switchHomeUser(ok.http, 'k', '1234')).toBe('kid-token');
    expect(ok.calls[0].url).toBe('https://clients.plex.tv/api/v2/home/users/k/switch?pin=1234');
    const refused = account(() => ({ status: 403 }));
    await expect(switchHomeUser(refused.http, 'k', '0000')).rejects.toMatchObject({ kind: 'wrong-pin' });
  });
});
