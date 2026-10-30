import { splitCidr, type LocalNetwork } from '@anystream/core';

declare const require: (name: string) => any;

/**
 * The TV's IPv4 address and netmask, or null when they cannot be read (no module, offline, simulator).
 * Asks NetworkManager.getIpConfig directly: on the stick (29 Oct 2026) the NetInfo wrapper returned no
 * address on Wi-Fi, because it takes the address from the Wi-Fi connection info, which the app is not
 * allowed to read ("failed to find state -11"). getIpConfig needs no privilege; NetInfo stays as a fallback.
 * Loaded lazily so a missing package never breaks start-up.
 */
export async function readLocalNetwork(): Promise<LocalNetwork | null> {
  let netmgr: any;
  try {
    netmgr = require('@amazon-devices/keplerscript-netmgr-lib');
  } catch (e) {
    console.log(`AnyStream discovery: network library unavailable: ${String(e)}`);
    return null;
  }
  try {
    const manager = new netmgr.NetworkManager();
    const active = { type: 0, name: '', id: 0, priority: 0 };
    const activeStatus = manager.getActiveNetworkInterface(active);
    // Interface 0 means "the default one", so a failed lookup can still read the IP configuration.
    const id = activeStatus === 0 ? active.id : 0;
    const ip: { type: number; provision: number; ipAddresses?: string[]; netmask?: string } = { type: 0, provision: 1 };
    const status = manager.getIpConfig(id, 0, ip);
    const address = ip.ipAddresses?.find(a => /^\d+\.\d+\.\d+\.\d+/.test(a));
    console.log(`AnyStream discovery: interface ${active.id} (${activeStatus}), ip config ${status}: ${ip.ipAddresses?.join(', ')} / ${ip.netmask}`);
    if (status === 0 && address) {
      return splitCidr(address, ip.netmask);
    }
  } catch (e) {
    console.log(`AnyStream discovery: NetworkManager failed: ${String(e)}`);
  }
  try {
    const fetchState = netmgr.fetch ?? netmgr.default?.fetch;
    const state = await fetchState();
    const details = state?.details;
    console.log(`AnyStream discovery: NetInfo ${state?.type} connected=${state?.isConnected} ip=${details?.ipAddress}`);
    if (state?.isConnected === false || !details?.ipAddress) {
      return null;
    }
    return splitCidr(details.ipAddress, details.subnet);
  } catch (e) {
    console.log(`AnyStream discovery: NetInfo failed: ${String(e)}`);
    return null;
  }
}
