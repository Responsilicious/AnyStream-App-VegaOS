export const APP_NAME = 'AnyStream';
export const APP_VERSION = '0.1.0';

/** Shown in the server's "Devices" list. Keep ASCII: it travels in an HTTP header. */
export const DEVICE_NAME = 'Fire TV';

/**
 * True only for a package meant for the Appstore: no prefilled test server and no diagnostic logging (some of
 * it records LAN addresses). Test builds leave it false; the store build sets it in the build copy only.
 */
export const STORE_BUILD = false;

/** Prefills the server address because typing on a remote is painful. Empty in store builds. */
export const DEFAULT_SERVER_ADDRESS = STORE_BUILD ? '' : 'watch.example.com';

export const PROBE_TIMEOUT_MS = 6000;

/**
 * How long a direct-play file gets to start before the app gives up and asks the server for a transcode. The
 * stick's player can stall on a file it cannot decode without ever reporting an error (seen with an MKV of
 * HEVC Main 10 and E-AC-3), so silence has to count as failure.
 */
export const DIRECT_PLAY_START_TIMEOUT_MS = 15000;

export const REQUEST_TIMEOUT_MS = 10000;

/** How often playback position is reported to the server. */
export const PROGRESS_INTERVAL_MS = 10000;

export const QUICK_CONNECT_POLL_MS = 2000;
export const QUICK_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

/** Skip-forward / skip-back step on the remote. */
export const SEEK_STEP_MS = 10000;

/** Start-up check of a saved sign-in. Short, because Home waits for it. */
export const SESSION_CHECK_TIMEOUT_MS = 6000;

/** Network search: Jellyfin's default port, how long each address gets, and how many are asked at once. */
export const DISCOVERY_PORT = 8096;
export const DISCOVERY_TIMEOUT_MS = 1500;
export const DISCOVERY_CONCURRENCY = 24;

/** Plex linking: where the user enters the code, and how often the TV asks whether it was approved. */
export const PLEX_LINK_ADDRESS = 'plex.tv/link';
/**
 * Link with Plex's JWT method (a key pair on the TV) instead of the long-lived legacy token. Off: on 29 Oct 2026
 * Plex Media Server 1.43.5 refused, with HTTP 401, the server token plex.tv issued to a JWT-linked account,
 * whether sent as a header or in the query, so the app looped back to sign-in. The JWT code stays for when
 * servers accept it.
 */
export const PLEX_JWT_SIGN_IN = false;
export const PLEX_PIN_POLL_MS = 2000;
/** Longest wait after a 429 when Plex gives no Retry-After. */
export const PLEX_MAX_BACKOFF_MS = 30000;
/** How long each candidate address of a Plex server gets to answer /identity. */
export const PLEX_PROBE_TIMEOUT_MS = 4000;
