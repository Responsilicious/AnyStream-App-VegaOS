import { isPlexError } from './errors';
import type { PlexHttp } from './http';

/**
 * Only the server's owner may scan its libraries; Plex refuses shared and managed users. Server settings are
 * guarded the same way, so reading them is the check. A refusal reads as no; anything else still rejects.
 */
export async function canScanPlex(http: PlexHttp, signal?: AbortSignal): Promise<boolean> {
  try {
    await http.get('/:/prefs', { signal });
    return true;
  } catch (e) {
    if (isPlexError(e) && (e.kind === 'unauthorized' || e.kind === 'forbidden')) {
      return false;
    }
    throw e;
  }
}

/** "Scan Library Files": Plex looks for new and changed files only. `all` covers every section. */
export async function scanPlex(http: PlexHttp, libraryId?: string): Promise<void> {
  await http.get(`/library/sections/${libraryId ?? 'all'}/refresh`);
}
