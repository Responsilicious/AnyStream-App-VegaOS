import { isJellyfinError } from './errors';
import type { JellyfinHttp } from './http';

interface UserResponse {
  Policy?: { IsAdministrator?: boolean };
}

/**
 * Jellyfin and Emby let only administrators start a scan, so only they are offered one. A refused lookup
 * reads as no; anything else (offline, timed out, cancelled) still rejects.
 */
export async function canScanJellyfin(http: JellyfinHttp, userId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const user = await http.get<UserResponse>(`/Users/${userId}`, { signal });
    return user?.Policy?.IsAdministrator === true;
  } catch (e) {
    if (isJellyfinError(e) && e.kind === 'unauthorized') {
      return false;
    }
    throw e;
  }
}

/**
 * Every library is the dashboard's "Scan All Libraries". One library is the dashboard's "Scan library": a
 * recursive refresh of its folder that keeps existing metadata and images, so only new and changed files are
 * read. Both return as soon as the server has queued the task.
 */
export async function scanJellyfin(http: JellyfinHttp, libraryId?: string): Promise<void> {
  if (!libraryId) {
    await http.post('/Library/Refresh');
    return;
  }
  await http.post(`/Items/${libraryId}/Refresh`, {
    query: {
      Recursive: true,
      MetadataRefreshMode: 'Default',
      ImageRefreshMode: 'Default',
      ReplaceAllMetadata: false,
      ReplaceAllImages: false,
    },
  });
}
