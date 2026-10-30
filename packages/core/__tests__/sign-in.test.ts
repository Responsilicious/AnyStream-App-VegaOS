import { EXPIRED_NOTICE, initialStep, stepBack } from '../src/authFlow';
import {
  addressProblem,
  connectProblem,
  connectStatus,
  displayAddress,
  signInError,
  spokenCode,
} from '../src/connect';
import { discoverServers, splitCidr, subnetHosts, type FoundServer } from '../src/discovery';
import {
  applyKey,
  insertText,
  keyboardRows,
  KEY_COLUMNS,
  maskText,
  MAX_LENGTH,
  shifted,
  startEdit,
  type KeyCell,
} from '../src/keyboard';
import { checkSession, QuickConnectFlow } from '../src/providers/jellyfin/auth';
import { JellyfinError } from '../src/providers/jellyfin/errors';
import { JellyfinHttp, type FetchLike } from '../src/providers/jellyfin/http';
import { identifyServer, probeServer } from '../src/providers/jellyfin/probe';
import { MemoryStore } from '../src/storage/keyValueStore';
import { SessionStore } from '../src/storage/sessionStore';
import { serverUrlCandidates } from '../src/util/url';
import { DEVICE, SERVER, SESSION, fakeFetch } from './helpers/fakes';

const span = (row: KeyCell[]) => row.reduce((n, cell) => n + cell.span, 0);
const labels = (rows: KeyCell[][]) => rows.flat().map(c => c.label);

describe('keyboard layouts', () => {
  it('uses the same structure for every field: a six-wide grid, then the controls', () => {
    for (const mode of ['server', 'username', 'password'] as const) {
      for (const page of ['letters', 'symbols', 'accents'] as const) {
        for (const shift of [false, true]) {
          const rows = keyboardRows(mode, page, shift);
          expect(rows).toHaveLength(mode === 'server' ? 9 : 8);
          for (const row of rows) {
            expect(span(row)).toBeLessThanOrEqual(KEY_COLUMNS + 1e-9);
          }
          // The control rows fill the width exactly, so the panel edges line up.
          expect(span(rows[rows.length - 1])).toBeCloseTo(KEY_COLUMNS);
          // The last row is always the editing controls, ending in Done.
          expect(rows[rows.length - 1].map(c => c.id)).toEqual(expect.arrayContaining(['k:left', 'k:right', 'k:delete', 'k:clear', 'k:done']));
          const ids = rows.flat().map(c => c.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    }
  });

  it('gives the address keyboard its shortcuts and no Shift, Space or accents', () => {
    const rows = keyboardRows('server', 'letters', false);
    expect(labels(rows)).toEqual(expect.arrayContaining(['https://', 'http://', ':8096', '.', ':', '/']));
    expect(rows[0].map(c => c.label).join('')).toBe('abcdef');
    expect(rows[4].map(c => c.label).join('')).toBe('yz.:/-');
    const ids = rows.flat().map(c => c.id);
    expect(ids).not.toContain('k:shift');
    expect(ids).not.toContain('k:space');
  });

  it('gives credentials Shift, Symbols, accents and Space, and starts in lower case', () => {
    const rows = keyboardRows('password', 'letters', false);
    const ids = rows.flat().map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['k:shift', 'k:page', 'k:space']));
    expect(rows[4].map(c => c.label).join('')).toBe('yz1234');
    expect(rows[0][0].label).toBe('a');
    expect(keyboardRows('username', 'letters', true)[0][0].label).toBe('A');
  });

  it('offers every printable ASCII character to passwords', () => {
    const typed = new Set([
      ...labels(keyboardRows('password', 'letters', false)),
      ...labels(keyboardRows('password', 'letters', true)),
      ...labels(keyboardRows('password', 'symbols', false)),
    ]);
    for (let code = 33; code < 127; code++) {
      expect(typed).toContain(String.fromCharCode(code));
    }
  });

  it('keeps key ids stable across Shift and pages so focus is not lost', () => {
    const lower = keyboardRows('password', 'letters', false);
    const upper = keyboardRows('password', 'letters', true);
    expect(lower.flat().map(c => c.id)).toEqual(upper.flat().map(c => c.id));
    const control = (rows: KeyCell[][]) => rows.slice(-2).flat().map(c => c.id);
    expect(control(keyboardRows('password', 'symbols', false))).toEqual(control(lower));
    expect(control(keyboardRows('password', 'accents', false))).toEqual(control(lower));
    // The address keyboard's Symbols key sits in the same row on both pages.
    const page = (rows: KeyCell[][]) => rows.findIndex(r => r.some(c => c.id === 'k:page'));
    expect(page(keyboardRows('server', 'symbols', false))).toBe(page(keyboardRows('server', 'letters', false)));
  });

  it('upper-cases accented letters, leaving ß alone', () => {
    expect(shifted('é')).toBe('É');
    expect(shifted('ß')).toBe('ß');
    expect(shifted('1')).toBe('1');
  });

  it('names symbols and capitals for screen readers', () => {
    const shiftedRows = keyboardRows('username', 'letters', true);
    expect(shiftedRows[0][0].spoken).toBe('capital A');
    const sym = keyboardRows('password', 'symbols', false).flat().find(c => c.label === '@');
    expect(sym?.spoken).toBe('at sign');
  });
});

describe('editing text', () => {
  const max = 10;

  it('inserts at the caret, exactly as typed', () => {
    let edit = startEdit('');
    for (const ch of ['P', 'a', ' ', '$']) {
      edit = applyKey(edit, { type: 'char', value: ch }, max);
    }
    expect(edit).toEqual({ text: 'Pa $', caret: 4 });
    edit = applyKey(edit, { type: 'left' }, max);
    edit = applyKey(edit, { type: 'left' }, max);
    edit = applyKey(edit, { type: 'char', value: 'X' }, max);
    expect(edit).toEqual({ text: 'PaX $', caret: 3 });
  });

  it('deletes before the caret and stops at the ends', () => {
    let edit = { text: 'abc', caret: 1 };
    edit = applyKey(edit, { type: 'delete' }, max);
    expect(edit).toEqual({ text: 'bc', caret: 0 });
    expect(applyKey(edit, { type: 'delete' }, max)).toEqual(edit);
    expect(applyKey(edit, { type: 'left' }, max).caret).toBe(0);
    expect(applyKey({ text: 'bc', caret: 2 }, { type: 'right' }, max).caret).toBe(2);
  });

  it('inserts a shortcut whole, or not at all when it would overflow', () => {
    expect(applyKey(startEdit(''), { type: 'insert', value: 'https://' }, 256).text).toBe('https://');
    expect(insertText(startEdit('123456789'), ':8096', max).text).toBe('123456789');
  });

  it('clears, and leaves text alone for Shift, pages and Done', () => {
    expect(applyKey({ text: 'abc', caret: 2 }, { type: 'clear' }, max)).toEqual({ text: '', caret: 0 });
    expect(applyKey({ text: 'abc', caret: 2 }, { type: 'done' }, max)).toEqual({ text: 'abc', caret: 2 });
    expect(applyKey({ text: 'abc', caret: 2 }, { type: 'shift' }, max)).toEqual({ text: 'abc', caret: 2 });
  });

  it('caps each field', () => {
    const full = startEdit('x'.repeat(MAX_LENGTH.username));
    expect(applyKey(full, { type: 'char', value: 'y' }, MAX_LENGTH.username)).toEqual(full);
  });

  it('masks a password one dot per character', () => {
    expect(maskText('pä ss')).toBe('•••••');
    expect(maskText('')).toBe('');
  });
});

describe('server address', () => {
  it('accepts names, IPs, ports, paths and http or https', () => {
    for (const ok of ['watch.example.com', 'https://watch.example.com/jellyfin', 'http://192.168.1.20:8096', '192.168.1.20:8096', 'nas.local']) {
      expect(addressProblem(ok)).toBeNull();
    }
  });

  it('explains what is wrong before going on the network', () => {
    expect(addressProblem('  ')).toMatch(/Enter/);
    expect(addressProblem('watch example.com')).toMatch(/spaces/);
    expect(addressProblem('ftp://watch.example.com')).toMatch(/http/);
    expect(addressProblem('https://')).toMatch(/not complete/);
    expect(addressProblem('host:70000')).toMatch(/not complete/);
  });

  it('keeps custom ports and paths when choosing URLs to try', () => {
    expect(serverUrlCandidates('example.com:8920/jf')).toEqual(['https://example.com:8920/jf', 'http://example.com:8920/jf']);
    expect(serverUrlCandidates('http://10.0.0.5:8096/')).toEqual(['http://10.0.0.5:8096']);
  });

  it('shows an address without its trailing slash', () => {
    expect(displayAddress('https://a.com/')).toBe('https://a.com');
  });
});

describe('connection states', () => {
  it('maps each failure to the wording in the design', () => {
    expect(connectStatus(connectProblem(new JellyfinError('network', 'x'))).title).toBe('Server unavailable');
    expect(connectStatus(connectProblem(new JellyfinError('certificate', 'x'))).title).toBe('Certificate could not be verified');
    expect(connectStatus(connectProblem(new JellyfinError('not-jellyfin', 'x'))).title).toBe('Address does not point to a Jellyfin server');
    expect(connectStatus(connectProblem(new JellyfinError('timeout', 'x'))).title).toBe('Server unavailable');
    expect(connectProblem(new Error('odd'))).toBe('unavailable');
  });

  it('tells a refused sign-in from a connection problem without revealing accounts', () => {
    const refused = signInError(new JellyfinError('unauthorized', 'x', 401), 'Home');
    expect(refused).toMatch(/username and password/);
    expect(refused).not.toMatch(/exist|unknown user|no such/i);
    expect(signInError(new JellyfinError('network', 'x'), 'Home')).toMatch(/Could not reach Home/);
    expect(signInError(new JellyfinError('server', 'x', 500), 'Home')).toMatch(/Home could not sign you in/);
  });

  it('reads a code one character at a time', () => {
    expect(spokenCode('AB12CD')).toBe('A B 1 2 C D');
  });
});

describe('certificate failures', () => {
  const failing = (message: string): FetchLike => () => Promise.reject(new TypeError(message));

  it('are told apart from other network errors', async () => {
    const cert = new JellyfinHttp('https://a.com', DEVICE, undefined, failing('SSL handshake failed: certificate verify failed'));
    await expect(cert.get('/x')).rejects.toMatchObject({ kind: 'certificate' });
    const down = new JellyfinHttp('https://a.com', DEVICE, undefined, failing('Network request failed'));
    await expect(down.get('/x')).rejects.toMatchObject({ kind: 'network' });
  });

  it('win over the http retry failing to connect', async () => {
    const fetchImpl: FetchLike = url =>
      Promise.reject(new TypeError(url.startsWith('https') ? 'Trust anchor for certification path not found' : 'Network request failed'));
    await expect(probeServer('watch.example.com', DEVICE, { fetchImpl })).rejects.toMatchObject({ kind: 'certificate' });
  });
});

describe('checkSession', () => {
  const http = (reply: Parameters<typeof fakeFetch>[0]) => {
    const fake = fakeFetch(reply);
    return { calls: fake.calls, http: new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fake.fetchImpl) };
  };

  it('accepts a working token, sent as the header', async () => {
    const { calls, http: client } = http(() => ({ body: { Id: 'user-1' } }));
    await expect(checkSession(client, SESSION)).resolves.toBe('ok');
    expect(calls[0].url).toBe('https://watch.example.com/Users/user-1');
    expect(calls[0].headers.Authorization).toContain('Token="token-abc"');
  });

  it('calls a refused token expired, and anything else unavailable', async () => {
    await expect(checkSession(http(() => ({ status: 401 })).http, SESSION)).resolves.toBe('expired');
    await expect(checkSession(http(() => 'throw').http, SESSION)).resolves.toBe('unavailable');
    await expect(checkSession(http(() => ({ status: 503 })).http, SESSION)).resolves.toBe('unavailable');
  });

  it('passes cancellation through', async () => {
    const controller = new AbortController();
    const pending = checkSession(http(() => 'hang').http, SESSION, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('Quick Connect approval', () => {
  it('reports approval before fetching the token', async () => {
    const events: string[] = [];
    const { fetchImpl } = fakeFetch(call => {
      if (call.url.includes('Initiate')) {
        return { body: { Secret: 's', Code: 'ABC123' } };
      }
      if (call.url.includes('/QuickConnect/Connect')) {
        return { body: { Authenticated: true } };
      }
      events.push('token');
      return { body: { AccessToken: 't', User: { Id: 'u', Name: 'n' } } };
    });
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER, { sleep: async () => {} });
    await flow.start();
    await flow.waitForApproval(undefined, () => events.push('approved'));
    expect(events).toEqual(['approved', 'token']);
  });

  it('stops polling when the screen goes away', async () => {
    let polls = 0;
    const controller = new AbortController();
    const { fetchImpl } = fakeFetch(call => {
      if (call.url.includes('Initiate')) {
        return { body: { Secret: 's', Code: 'ABC123' } };
      }
      polls += 1;
      if (polls === 2) {
        controller.abort();
      }
      return { body: { Authenticated: false } };
    });
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER, { sleep: async () => {} });
    await flow.start();
    await expect(flow.waitForApproval(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(polls).toBe(2);
  });
});

describe('network search', () => {
  it('lists the other hosts of the TV network', () => {
    const hosts = subnetHosts({ ipAddress: '192.168.1.176', subnet: '255.255.255.0' });
    expect(hosts).toHaveLength(253);
    expect(hosts[0]).toBe('192.168.1.1');
    expect(hosts).not.toContain('192.168.1.176');
    expect(hosts).not.toContain('192.168.1.255');
  });

  it('caps a wide network at its /24, narrows for a small one, and skips non-routable addresses', () => {
    expect(subnetHosts({ ipAddress: '10.0.5.9', subnet: '255.255.0.0' })).toHaveLength(253);
    const small = subnetHosts({ ipAddress: '10.0.0.130', subnet: '255.255.255.192' });
    expect(small[0]).toBe('10.0.0.129');
    expect(small).toHaveLength(61);
    expect(subnetHosts({ ipAddress: '169.254.3.4' })).toEqual([]);
    expect(subnetHosts({ ipAddress: 'nonsense' })).toEqual([]);
  });

  it('reads an address given with a prefix length', () => {
    expect(splitCidr('192.168.1.176/24')).toEqual({ ipAddress: '192.168.1.176', subnet: '255.255.255.0' });
    expect(splitCidr('10.0.0.130/26')).toEqual({ ipAddress: '10.0.0.130', subnet: '255.255.255.192' });
    expect(splitCidr('192.168.1.5', '255.255.255.0')).toEqual({ ipAddress: '192.168.1.5', subnet: '255.255.255.0' });
  });

  it('asks each host on the Jellyfin port, lists each server once, sorted', async () => {
    const seen: string[] = [];
    const servers: Record<string, FoundServer> = {
      'http://10.0.0.2:8096': { id: 'b', name: 'Basement', address: 'http://10.0.0.2:8096' },
      'http://10.0.0.3:8096': { id: 'a', name: 'Attic', address: 'http://10.0.0.3:8096' },
      'http://10.0.0.4:8096': { id: 'a', name: 'Attic', address: 'http://10.0.0.4:8096' },
    };
    const found: string[] = [];
    const result = await discoverServers(
      ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'],
      async url => {
        seen.push(url);
        if (url.endsWith('.1:8096')) {
          throw new Error('refused');
        }
        return servers[url] ?? null;
      },
      { concurrency: 2, onFound: s => found.push(s.name) },
    );
    expect(seen).toHaveLength(4);
    expect(result.map(s => s.name)).toEqual(['Attic', 'Basement']);
    expect(found.sort()).toEqual(['Attic', 'Basement']);
  });

  it('stops asking once cancelled', async () => {
    const controller = new AbortController();
    let asked = 0;
    await discoverServers(
      Array.from({ length: 50 }, (_, i) => `10.0.0.${i + 1}`),
      async () => {
        asked += 1;
        if (asked === 3) {
          controller.abort();
        }
        return null;
      },
      { concurrency: 1, signal: controller.signal },
    );
    expect(asked).toBe(3);
  });

  it('identifies a Jellyfin server at one exact address', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: { Id: 'srv', ServerName: 'Home', Version: '10.9' } }));
    await expect(identifyServer('http://10.0.0.2:8096', DEVICE, { fetchImpl })).resolves.toEqual({
      id: 'srv',
      name: 'Home',
      address: 'http://10.0.0.2:8096',
      product: 'jellyfin',
    });
    expect(calls).toHaveLength(1);
    const other = fakeFetch(() => ({ body: { hello: 1 } }));
    await expect(identifyServer('http://10.0.0.3:8096', DEVICE, { fetchImpl: other.fetchImpl })).resolves.toBeNull();
  });
});

describe('entry flow', () => {
  it('starts at Welcome, or at sign-in on a known server', () => {
    expect(initialStep()).toEqual({ name: 'welcome' });
    expect(initialStep({ server: SERVER, userName: 'will', notice: EXPIRED_NOTICE })).toEqual({
      name: 'signin',
      server: SERVER,
      userName: 'will',
      notice: EXPIRED_NOTICE,
    });
    expect(initialStep({ connect: true, server: SERVER })).toEqual({ name: 'connect', address: SERVER.baseUrl });
  });

  it('goes back one step at a time, keeping the server', () => {
    expect(stepBack({ name: 'welcome' })).toBeNull();
    expect(stepBack({ name: 'connect' })).toEqual({ name: 'welcome' });
    expect(stepBack({ name: 'signin', server: SERVER })).toEqual({ name: 'connect', address: SERVER.baseUrl });
    expect(stepBack({ name: 'quickconnect', server: SERVER, userName: 'will' })).toEqual({
      name: 'signin',
      server: SERVER,
      quickConnect: true,
      userName: 'will',
    });
  });
});

describe('SessionStore after an expired sign-in', () => {
  it('drops the token but keeps the server and username', () => {
    const backing = new MemoryStore();
    const store = new SessionStore(backing);
    store.saveSession(SESSION);
    store.forgetSignIn(SESSION.server.id);

    const reopened = new SessionStore(backing);
    expect(reopened.getActiveSession()).toBeUndefined();
    expect(reopened.getLastServer()).toEqual(SESSION.server);
    expect(reopened.getLastUserName(SESSION.server.id)).toBe('will');
    expect(backing.getString('anystream.state.v1')).not.toContain('token-abc');
  });

  it('forgets the username too when the server is removed', () => {
    const store = new SessionStore(new MemoryStore());
    store.saveSession(SESSION);
    store.forgetSignIn(SESSION.server.id);
    store.removeServer(SESSION.server.id);
    expect(store.getLastUserName(SESSION.server.id)).toBeUndefined();
    expect(store.getLastServer()).toBeUndefined();
  });
});
