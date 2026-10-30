import { DISCOVERY_CONCURRENCY, DISCOVERY_PORT, DISCOVERY_TIMEOUT_MS } from './config';

/**
 * "Find servers on this network" (docs/sign-in.md). Jellyfin's and Emby's own discovery is a UDP broadcast, and
 * Vega has no UDP socket for apps, so this asks every address on the TV's local /24 network for the servers'
 * public info on their shared default port (8096) instead. It only finds servers on the home network; anything
 * remote needs its address.
 */

export interface FoundServer {
  id: string;
  name: string;
  /** Base URL to connect to, e.g. http://192.168.1.20:8096 */
  address: string;
  /** Which kind of server answered, when the probe can tell. */
  product?: 'jellyfin' | 'emby';
}

/** The TV's IPv4 address and netmask, as the platform reports them. */
export interface LocalNetwork {
  ipAddress: string;
  subnet?: string | null;
}

function parseIpv4(text: string | null | undefined): number[] | null {
  if (!text) {
    return null;
  }
  const parts = text.trim().split('.');
  if (parts.length !== 4) {
    return null;
  }
  const nums = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every(n => n >= 0 && n <= 255) ? nums : null;
}

/**
 * The other addresses on the TV's network. Capped at the TV's own /24 (254 hosts) even on a wider netmask, so
 * a search stays quick; home networks are almost always /24.
 */
export function subnetHosts(network: LocalNetwork): string[] {
  const ip = parseIpv4(network.ipAddress);
  if (!ip || ip[0] === 127 || (ip[0] === 169 && ip[1] === 254)) {
    return [];
  }
  const mask = parseIpv4(network.subnet ?? '255.255.255.0') ?? [255, 255, 255, 0];
  // A narrower mask than /24 (for example /25) shrinks the range; a wider one is treated as /24.
  const last = mask[3];
  const size = 256 - last;
  const start = ip[3] - (ip[3] % size);
  const prefix = `${ip[0]}.${ip[1]}.${ip[2]}`;
  const hosts: string[] = [];
  for (let n = start + 1; n < start + size - 1; n++) {
    if (n !== ip[3]) {
      hosts.push(`${prefix}.${n}`);
    }
  }
  return hosts;
}

/** Answers one host: the server it found there, or null. Must honour the signal. */
export type HostProbe = (address: string, signal: AbortSignal, timeoutMs: number) => Promise<FoundServer | null>;

export interface DiscoverOptions {
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called as each server answers, so the list can grow while the search runs. */
  onFound?: (server: FoundServer) => void;
}

/**
 * Asks every host, a few at a time. A server that answers on several addresses is listed once. Stops early,
 * returning what it has, when the signal aborts.
 */
export async function discoverServers(hosts: string[], probe: HostProbe, options: DiscoverOptions = {}): Promise<FoundServer[]> {
  const concurrency = Math.max(1, options.concurrency ?? DISCOVERY_CONCURRENCY);
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  const found = new Map<string, FoundServer>();
  let next = 0;

  const worker = async () => {
    while (next < hosts.length && !controller.signal.aborted) {
      const host = hosts[next++];
      const address = `http://${host}:${DISCOVERY_PORT}`;
      try {
        const server = await probe(address, controller.signal, timeoutMs);
        if (server && !found.has(server.id) && !controller.signal.aborted) {
          found.set(server.id, server);
          options.onFound?.(server);
        }
      } catch {
        // Nothing there, or not Jellyfin: the usual answer from most addresses.
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "192.168.1.176/24" → address and netmask; a bare address passes through. */
export function splitCidr(text: string, netmask?: string | null): LocalNetwork {
  const [address, bits] = text.trim().split('/');
  if (bits === undefined || !/^\d+$/.test(bits)) {
    return { ipAddress: address, subnet: netmask ?? null };
  }
  const n = Math.max(0, Math.min(32, Number(bits)));
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
  return { ipAddress: address, subnet: [24, 16, 8, 0].map(shift => (mask >>> shift) & 255).join('.') };
}
