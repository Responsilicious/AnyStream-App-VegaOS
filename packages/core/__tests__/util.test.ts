import { buildQuery, joinUrl, serverUrlCandidates, stripTrailingSlash } from '../src/util/url';
import { formatClock, msToTicks, ticksToMs } from '../src/util/ticks';
import { newDeviceId } from '../src/util/ids';

describe('serverUrlCandidates', () => {
  it('respects an explicit scheme and trims the trailing slash', () => {
    expect(serverUrlCandidates('https://watch.example.com/')).toEqual(['https://watch.example.com']);
    expect(serverUrlCandidates('http://192.168.1.5:8096')).toEqual(['http://192.168.1.5:8096']);
  });

  it('tries https first for a public hostname', () => {
    expect(serverUrlCandidates('watch.example.com')).toEqual([
      'https://watch.example.com',
      'http://watch.example.com',
    ]);
  });

  it('tries http first for local addresses and the default Jellyfin port', () => {
    expect(serverUrlCandidates('192.168.1.5')[0]).toBe('http://192.168.1.5');
    expect(serverUrlCandidates('localhost:8096')[0]).toBe('http://localhost:8096');
    expect(serverUrlCandidates('nas.local')[0]).toBe('http://nas.local');
    expect(serverUrlCandidates('media.example.com:8096')[0]).toBe('http://media.example.com:8096');
  });

  it('keeps a sub-path for reverse proxies', () => {
    expect(serverUrlCandidates('https://example.com/jellyfin/')).toEqual(['https://example.com/jellyfin']);
  });

  it('returns nothing for blank input', () => {
    expect(serverUrlCandidates('   ')).toEqual([]);
  });
});

describe('url helpers', () => {
  it('joins without doubling slashes', () => {
    expect(joinUrl('https://a.com/', '/x/y')).toBe('https://a.com/x/y');
    expect(joinUrl('https://a.com', 'x')).toBe('https://a.com/x');
    expect(stripTrailingSlash('https://a.com///')).toBe('https://a.com');
  });

  it('builds an encoded query, skipping empty values and joining arrays', () => {
    expect(buildQuery({ a: 'x y', b: undefined, c: null, d: 5, e: true, f: ['a', 'b'] })).toBe(
      '?a=x%20y&d=5&e=true&f=a%2Cb',
    );
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });
});

describe('ticks', () => {
  it('converts between milliseconds and Jellyfin ticks', () => {
    expect(msToTicks(1000)).toBe(10000000);
    expect(ticksToMs(10000000)).toBe(1000);
    expect(ticksToMs(undefined)).toBe(0);
    expect(ticksToMs(-5)).toBe(0);
    expect(msToTicks(-5)).toBe(0);
  });

  it('formats a clock', () => {
    expect(formatClock(65000)).toBe('1:05');
    expect(formatClock(3725000)).toBe('1:02:05');
    expect(formatClock(-1)).toBe('0:00');
  });
});

describe('newDeviceId', () => {
  it('produces a v4-shaped id', () => {
    expect(newDeviceId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs between calls', () => {
    expect(newDeviceId()).not.toBe(newDeviceId());
  });
});
