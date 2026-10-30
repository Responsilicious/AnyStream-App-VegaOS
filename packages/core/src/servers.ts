import type { ConnectionStatus, ConnectionView } from './connections/model';
import type { PlexConnectionKind, PlexServerInfo, Reachability } from './providers/plex';
import type { ServerKind } from './providers/types';

/**
 * Words and choices for the server screens (spec §8, §10, §11): provider chooser, Plex server picker,
 * connected-server manager and quick switcher. Kept apart from the screens so it can be unit-tested.
 */

export function providerName(kind: ServerKind): string {
  return kind === 'plex' ? 'Plex' : kind === 'emby' ? 'Emby' : 'Jellyfin';
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  checking: 'Checking…',
  online: 'Online',
  unavailable: 'Unavailable',
  'auth-required': 'Sign in again',
  'permission-denied': 'No access',
  'rate-limited': 'Busy, try later',
  'service-unavailable': 'Plex is down',
  'playback-restricted': 'Playback restricted',
};

export function statusText(status: ConnectionStatus, route?: Route): string {
  return status === 'online' && route ? `Online · ${route.where === 'local' ? 'Local' : 'Remote'}` : STATUS_TEXT[status];
}

/** How an address is reached: on this network or over the internet, and whether it is encrypted. */
export interface Route {
  where: 'local' | 'remote';
  secure: boolean;
}

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/;

/**
 * Local when the host is a private address, including Plex's `192-168-1-5.<hash>.plex.direct` names, which
 * carry the LAN address in their first label.
 */
export function routeOf(url: string): Route {
  const match = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url.trim());
  if (!match) {
    return { where: 'remote', secure: false };
  }
  const secure = match[1].toLowerCase() === 'https';
  let host = match[2].toLowerCase();
  if (host.endsWith('.plex.direct')) {
    host = host.split('.')[0].replace(/-/g, '.');
  }
  const local = PRIVATE_V4.test(host) || host === 'localhost' || host.startsWith('[fd') || host.startsWith('[fe80');
  return { where: local ? 'local' : 'remote', secure };
}

export function routeText(route: Route): string {
  return `${route.where === 'local' ? 'Local' : 'Remote'} · ${route.secure ? 'Secure' : 'Not encrypted'}`;
}

/** "Plex · Will", "Jellyfin · Will" or "Emby · Will"; shared Plex servers add whose they are. */
export function connectionSubtitle(view: ConnectionView): string {
  const parts = [providerName(view.server.provider), view.connection.profileName || view.account.displayName];
  if (view.server.ownerName) {
    parts.push(`shared by ${view.server.ownerName}`);
  }
  return parts.filter(Boolean).join(' · ');
}

export function startupText(view: ConnectionView): string {
  return view.startup ? 'Opens at startup' : 'Last used server';
}

/** What a screen reader says for a row: name, provider, account, state, and Active / Startup. */
export function rowLabel(view: ConnectionView, status: ConnectionStatus): string {
  const flags = [view.active ? 'Active' : '', view.startup ? 'Startup server' : ''].filter(Boolean);
  return [view.displayName, connectionSubtitle(view), statusText(status), ...flags].join(', ');
}

export type ManagerAction = 'switch' | 'rename' | 'startup' | 'clear-startup' | 'sign-in' | 'remove' | 'sign-out-account';

export const MANAGER_ACTION_LABELS: Record<ManagerAction, string> = {
  switch: 'Switch to this server',
  rename: 'Rename in AnyStream',
  startup: 'Set as startup server',
  'clear-startup': 'Open last used at startup',
  'sign-in': 'Sign in again',
  remove: 'Remove from this TV',
  'sign-out-account': 'Sign out of Plex account',
};

/** The actions a saved connection's panel offers, most useful first. Account sign-out is a separate link. */
export function managerActions(view: ConnectionView, status: ConnectionStatus): ManagerAction[] {
  const actions: ManagerAction[] = [];
  const needsSignIn = status === 'auth-required' || view.account.authStatus === 'expired';
  if (needsSignIn) {
    actions.push('sign-in');
  } else if (!view.active) {
    actions.push('switch');
  }
  actions.push('rename', view.startup ? 'clear-startup' : 'startup', 'remove');
  return actions;
}

/** The remove confirmation names exactly what goes, and what stays. */
export function removeMessage(view: ConnectionView): string {
  const name = view.displayName;
  const base = `Remove ${name} from this TV? Nothing on the server is deleted.`;
  return view.active ? `${base} You'll choose another server afterwards.` : base;
}

/** Account sign-out reaches every server that account opened; say which. */
export function signOutMessage(accountName: string, servers: string[]): string {
  if (servers.length === 0) {
    return `Sign ${accountName} out of Plex on this TV?`;
  }
  const list = servers.length === 1 ? servers[0] : `${servers.slice(0, -1).join(', ')} and ${servers[servers.length - 1]}`;
  return `Sign ${accountName} out of Plex on this TV? This also removes ${list}.`;
}

// ----- Plex server picker

export type PickerReach =
  | { state: 'checking' }
  | { state: 'unreachable' }
  | { state: 'online'; uri: string; kind: PlexConnectionKind };

export interface PickerRow {
  server: PlexServerInfo;
  reach: PickerReach;
  /** Already saved on this TV for this account. */
  alreadyAdded: boolean;
  /** Removed by the user earlier: shown, never preselected. */
  removedBefore: boolean;
  selected: boolean;
}

export function pickerRows(servers: PlexServerInfo[], saved: string[], removed: string[]): PickerRow[] {
  return servers.map(server => ({
    server,
    reach: { state: 'checking' },
    alreadyAdded: saved.includes(server.machineId),
    removedBefore: removed.includes(server.machineId),
    selected: false,
  }));
}

/** A refreshed discovery keeps what the user had ticked and drops servers the account lost. */
export function refreshRows(previous: PickerRow[], servers: PlexServerInfo[], saved: string[], removed: string[]): PickerRow[] {
  const ticked = new Set(previous.filter(r => r.selected).map(r => r.server.machineId));
  return pickerRows(servers, saved, removed).map(r => ({ ...r, selected: ticked.has(r.server.machineId) && !r.alreadyAdded }));
}

export function withReach(rows: PickerRow[], machineId: string, reach: Reachability): PickerRow[] {
  return rows.map(r =>
    r.server.machineId === machineId
      ? { ...r, reach: reach.status === 'online' ? { state: 'online', uri: reach.uri, kind: reach.kind } : { state: 'unreachable' } }
      : r,
  );
}

/** Only rows not already saved can be ticked. Unreachable ones can: they may be off right now. */
export function toggleRow(rows: PickerRow[], machineId: string): PickerRow[] {
  return rows.map(r => (r.server.machineId === machineId && !r.alreadyAdded ? { ...r, selected: !r.selected } : r));
}

export function pickerRowStatus(row: PickerRow): string {
  if (row.alreadyAdded) {
    return 'Already added';
  }
  switch (row.reach.state) {
    case 'checking':
      return 'Checking…';
    case 'unreachable':
      return 'Unavailable';
    case 'online':
      return row.reach.kind === 'local' ? 'Online · Local' : row.reach.kind === 'relay' ? 'Online · Relay' : 'Online · Remote';
  }
}

export function pickerRowSubtitle(row: PickerRow): string {
  const owner = row.server.owned ? 'Owned by you' : row.server.ownerName ? `Shared by ${row.server.ownerName}` : 'Shared with you';
  return `${owner} · Plex`;
}

/** Addresses to save for a ticked server: the one that answered first, then the rest in rank order. */
export function endpointsFor(row: PickerRow): string[] {
  const all = row.server.candidates.map(c => c.uri);
  if (row.reach.state !== 'online') {
    return all;
  }
  const first = row.reach.uri;
  return [first, ...all.filter(u => u !== first)];
}
