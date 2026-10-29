import { createJellyfinProvider } from './jellyfin';
import type { DeviceInfo } from './jellyfin/http';
import { createPlexProvider } from './plex';
import type { DeviceCapabilities, MediaProvider, Session } from './types';

/** The provider for a saved session's kind of server. The only place that knows both kinds exist. */
export function createProvider(session: Session, device: DeviceInfo, caps: DeviceCapabilities): MediaProvider {
  return session.server.kind === 'plex' ? createPlexProvider(session, device, caps) : createJellyfinProvider(session, device, caps);
}
