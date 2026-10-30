import { QuickConnectFlow, signInWithPassword } from '../src/providers/jellyfin/auth';
import { JellyfinHttp } from '../src/providers/jellyfin/http';
import { probeServer } from '../src/providers/jellyfin/probe';
import { describeError, JellyfinError } from '../src/providers/jellyfin/errors';
import { DEVICE, SERVER, fakeFetch } from './helpers/fakes';

const AUTH_RESULT = { AccessToken: 'tok', User: { Id: 'u1', Name: 'will' } };

describe('JellyfinHttp', () => {
  it('sends the MediaBrowser header with the token once signed in', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: {} }));
    const http = new JellyfinHttp('https://a.com', DEVICE, undefined, fetchImpl);
    await http.get('/x');
    await http.withToken('secret').get('/y');
    expect(calls[0].headers.Authorization).toBe(
      'MediaBrowser Client="AnyStream", Device="Fire TV", DeviceId="device-1", Version="0.1.0"',
    );
    expect(calls[1].headers.Authorization).toContain('Token="secret"');
  });

  it('maps status codes to error kinds', async () => {
    const statuses: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [404, 'not-found'],
      [500, 'server'],
    ];
    for (const [status, kind] of statuses) {
      const { fetchImpl } = fakeFetch(() => ({ status }));
      const http = new JellyfinHttp('https://a.com', DEVICE, undefined, fetchImpl);
      await expect(http.get('/x')).rejects.toMatchObject({ kind });
    }
  });

  it('maps a failed request to a network error and bad JSON to not-jellyfin', async () => {
    const down = new JellyfinHttp('https://a.com', DEVICE, undefined, fakeFetch(() => 'throw').fetchImpl);
    await expect(down.get('/x')).rejects.toMatchObject({ kind: 'network' });

    const html = new JellyfinHttp(
      'https://a.com',
      DEVICE,
      undefined,
      fakeFetch(() => ({ text: '<html>' })).fetchImpl,
    );
    await expect(html.get('/x')).rejects.toMatchObject({ kind: 'not-jellyfin' });
  });

  it('times out a hanging request', async () => {
    const http = new JellyfinHttp('https://a.com', DEVICE, undefined, fakeFetch(() => 'hang').fetchImpl);
    await expect(http.get('/x', { timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('reports cancellation separately from a timeout', async () => {
    const controller = new AbortController();
    const http = new JellyfinHttp('https://a.com', DEVICE, undefined, fakeFetch(() => 'hang').fetchImpl);
    const pending = http.get('/x', { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('returns undefined for an empty body', async () => {
    const http = new JellyfinHttp('https://a.com', DEVICE, undefined, fakeFetch(() => ({ status: 204 })).fetchImpl);
    await expect(http.post('/x')).resolves.toBeUndefined();
  });
});

describe('probeServer', () => {
  const info = { Id: 'srv', ServerName: 'Home', Version: '10.9.0' };

  it('returns the first candidate that answers like Jellyfin', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: info }));
    const result = await probeServer('watch.example.com', DEVICE, { fetchImpl });
    expect(result.baseUrl).toBe('https://watch.example.com');
    expect(result.info.ServerName).toBe('Home');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://watch.example.com/System/Info/Public');
  });

  it('falls back to http when https is unreachable', async () => {
    const { calls, fetchImpl } = fakeFetch(call => (call.url.startsWith('https') ? 'throw' : { body: info }));
    const result = await probeServer('nas.example.com', DEVICE, { fetchImpl });
    expect(result.baseUrl).toBe('http://nas.example.com');
    expect(calls.map(c => c.url.split(':')[0])).toEqual(['https', 'http']);
  });

  it('rejects an address that answers but is not Jellyfin, and says so', async () => {
    const { fetchImpl } = fakeFetch(call => (call.url.startsWith('https') ? { body: { hello: 1 } } : 'throw'));
    await expect(probeServer('example.com', DEVICE, { fetchImpl })).rejects.toMatchObject({
      kind: 'not-jellyfin',
    });
  });

  it('fails clearly on blank input', async () => {
    await expect(probeServer('  ', DEVICE)).rejects.toBeInstanceOf(JellyfinError);
  });
});

describe('signInWithPassword', () => {
  it('posts credentials and returns a session', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ body: AUTH_RESULT }));
    const http = new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl);
    const session = await signInWithPassword(http, SERVER, 'will', 'pw');
    expect(session).toEqual({ server: SERVER, userId: 'u1', userName: 'will', accessToken: 'tok' });
    expect(calls[0].url).toBe('https://watch.example.com/Users/AuthenticateByName');
    expect(calls[0].body).toEqual({ Username: 'will', Pw: 'pw' });
  });

  it('surfaces a rejected password as unauthorized', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401 }));
    const http = new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl);
    await expect(signInWithPassword(http, SERVER, 'will', 'bad')).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('rejects an incomplete response', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: {} }));
    const http = new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl);
    await expect(signInWithPassword(http, SERVER, 'a', 'b')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('QuickConnectFlow', () => {
  const noSleep = async () => {};

  it('reports availability from the server flag', async () => {
    const on = new QuickConnectFlow(
      new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fakeFetch(() => ({ body: true })).fetchImpl),
      SERVER,
    );
    expect(await on.isAvailable()).toBe(true);

    const off = new QuickConnectFlow(
      new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fakeFetch(() => ({ body: false })).fetchImpl),
      SERVER,
    );
    expect(await off.isAvailable()).toBe(false);

    const broken = new QuickConnectFlow(
      new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fakeFetch(() => 'throw').fetchImpl),
      SERVER,
    );
    expect(await broken.isAvailable()).toBe(false);
  });

  it('shows a code, polls until approved, then signs in', async () => {
    let polls = 0;
    const { calls, fetchImpl } = fakeFetch(call => {
      if (call.url.includes('/QuickConnect/Initiate')) {
        return { body: { Secret: 's3cret', Code: '123456' } };
      }
      if (call.url.includes('/QuickConnect/Connect')) {
        polls += 1;
        return { body: { Authenticated: polls >= 3 } };
      }
      return { body: AUTH_RESULT };
    });
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER, {
      sleep: noSleep,
    });

    expect(await flow.start()).toEqual({ code: '123456' });
    const session = await flow.waitForApproval();

    expect(session.accessToken).toBe('tok');
    expect(polls).toBe(3);
    const last = calls[calls.length - 1];
    expect(last.url).toContain('/Users/AuthenticateWithQuickConnect');
    expect(last.body).toEqual({ Secret: 's3cret' });
    expect(calls.find(c => c.url.includes('/QuickConnect/Connect'))!.url).toContain('secret=s3cret');
  });

  it('maps a disabled feature to quick-connect-disabled', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401 }));
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER);
    await expect(flow.start()).rejects.toMatchObject({ kind: 'quick-connect-disabled' });
  });

  it('reports an expired code when the server forgets the secret', async () => {
    const { fetchImpl } = fakeFetch(call =>
      call.url.includes('Initiate') ? { body: { Secret: 's', Code: '1' } } : { status: 404 },
    );
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER, {
      sleep: noSleep,
    });
    await flow.start();
    await expect(flow.waitForApproval()).rejects.toMatchObject({ kind: 'quick-connect-expired' });
  });

  it('gives up after the timeout', async () => {
    const { fetchImpl } = fakeFetch(call =>
      call.url.includes('Initiate') ? { body: { Secret: 's', Code: '1' } } : { body: { Authenticated: false } },
    );
    let clock = 0;
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER, {
      sleep: async ms => {
        clock += ms;
      },
      now: () => clock,
      pollMs: 1000,
      timeoutMs: 5000,
    });
    await flow.start();
    await expect(flow.waitForApproval()).rejects.toMatchObject({ kind: 'quick-connect-expired' });
    expect(clock).toBeGreaterThanOrEqual(5000);
  });

  it('stops polling when cancelled', async () => {
    const { fetchImpl } = fakeFetch(call =>
      call.url.includes('Initiate') ? { body: { Secret: 's', Code: '1' } } : { body: { Authenticated: false } },
    );
    const controller = new AbortController();
    const flow = new QuickConnectFlow(new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fetchImpl), SERVER, {
      sleep: async () => controller.abort(),
    });
    await flow.start();
    await expect(flow.waitForApproval(controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('refuses to wait before a code was requested', async () => {
    const flow = new QuickConnectFlow(
      new JellyfinHttp(SERVER.baseUrl, DEVICE, undefined, fakeFetch(() => ({ body: {} })).fetchImpl),
      SERVER,
    );
    await expect(flow.waitForApproval()).rejects.toMatchObject({ kind: 'quick-connect-expired' });
  });
});

describe('describeError', () => {
  it('gives plain language for known kinds and a safe default otherwise', () => {
    expect(describeError(new JellyfinError('unauthorized', 'x'))).toMatch(/password/i);
    expect(describeError(new JellyfinError('quick-connect-expired', 'x'))).toMatch(/expired/i);
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
