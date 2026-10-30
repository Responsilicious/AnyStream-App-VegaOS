export type JellyfinErrorKind =
  | 'network'
  | 'certificate'
  | 'timeout'
  | 'cancelled'
  | 'unauthorized'
  | 'not-found'
  | 'server'
  | 'not-jellyfin'
  | 'wrong-product'
  | 'quick-connect-disabled'
  | 'quick-connect-expired'
  | 'no-compatible-stream';

/** Every failure the Jellyfin layer raises, tagged so screens can show the right message. */
export class JellyfinError extends Error {
  readonly kind: JellyfinErrorKind;
  readonly status?: number;
  /** For 'wrong-product': the product that did answer. */
  readonly detected?: 'jellyfin' | 'emby';

  constructor(kind: JellyfinErrorKind, message: string, status?: number, detected?: 'jellyfin' | 'emby') {
    super(message);
    this.name = 'JellyfinError';
    this.kind = kind;
    this.status = status;
    this.detected = detected;
    Object.setPrototypeOf(this, JellyfinError.prototype);
  }
}

export function isJellyfinError(e: unknown): e is JellyfinError {
  return e instanceof JellyfinError;
}

/** Plain-language text for a person, never a status code or stack. */
export function describeError(e: unknown): string {
  if (!isJellyfinError(e)) {
    // Other providers' errors carry their own plain-language text.
    const own = (e as { userMessage?: unknown } | null)?.userMessage;
    return typeof own === 'string' ? own : 'Something went wrong. Please try again.';
  }
  switch (e.kind) {
    case 'network':
      return 'Could not reach the server. Check the address and your network.';
    case 'certificate':
      return "The server's security certificate could not be verified.";
    case 'timeout':
      return 'The server took too long to respond.';
    case 'cancelled':
      return 'Cancelled.';
    case 'unauthorized':
      return 'The username or password was not accepted, or your sign-in has expired.';
    case 'not-found':
      return 'That item was not found on the server.';
    case 'not-jellyfin':
      return 'That address answered, but it does not look like a media server.';
    case 'wrong-product':
      return e.detected === 'emby' ? 'That address is an Emby server.' : 'That address is a Jellyfin server.';
    case 'quick-connect-disabled':
      return 'Quick Connect is turned off on this server.';
    case 'quick-connect-expired':
      return 'That Quick Connect code expired. Start again for a new one.';
    case 'no-compatible-stream':
      return 'This title cannot be played on this device.';
    default:
      return 'The server reported a problem. Please try again.';
  }
}
