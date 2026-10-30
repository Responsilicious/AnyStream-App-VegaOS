import NetInfo from '@react-native-community/netinfo';
import { splitCidr, type LocalNetwork } from '@anystream/core';

/** The TV's IPv4 address and netmask from NetInfo (Wi-Fi or Ethernet), or null when offline or unknown. */
export async function readLocalNetwork(): Promise<LocalNetwork | null> {
  try {
    const state = await NetInfo.fetch();
    const details = state.details as { ipAddress?: string | null; subnet?: string | null } | null;
    console.log(`AnyStream discovery: NetInfo ${state.type} connected=${state.isConnected} ip=${details?.ipAddress}`);
    if (state.isConnected === false || !details?.ipAddress) {
      return null;
    }
    return splitCidr(details.ipAddress, details.subnet);
  } catch (e) {
    console.log(`AnyStream discovery: NetInfo failed: ${String(e)}`);
    return null;
  }
}
