import { createEmbyProvider } from './emby';
import { createJellyfinProvider } from './jellyfin';
import type { DeviceInfo } from './jellyfin/http';
import { createPlexProvider } from './plex';
import type { DeviceCapabilities, MediaProvider, Session } from './types';

/** The provider for a saved session's kind of server. The only place that knows every kind exists. */
export function createProvider(session: Session, device: DeviceInfo, caps: DeviceCapabilities): MediaProvider {
  switch (session.server.kind) {
    case 'plex':
      return createPlexProvider(session, device, caps);
    case 'emby':
      return createEmbyProvider(session, device, caps);
    case 'jellyfin':
      return createJellyfinProvider(session, device, caps);
  }
}
