export type PlexErrorKind =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'service-unavailable'
  | 'server'
  | 'link-expired'
  | 'no-signing-key'
  | 'playback-restricted'
  | 'unsupported'
  | 'wrong-pin';

/** Every failure the Plex layer raises. Messages never contain tokens, PIN ids or signed JWTs. */
export class PlexError extends Error {
  readonly kind: PlexErrorKind;
  readonly status?: number;
  /** For 'rate-limited': how long Plex asked us to wait, when it said. */
  readonly retryAfterMs?: number;

  constructor(kind: PlexErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'PlexError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, PlexError.prototype);
  }

  /** Plain-language text; screens that only know the shared error helper read this. */
  get userMessage(): string {
    return describePlexError(this);
  }
}

export function isPlexError(e: unknown): e is PlexError {
  return e instanceof PlexError;
}

/** Plain-language text for a person. */
export function describePlexError(e: unknown): string {
  if (!isPlexError(e)) {
    return 'Something went wrong. Please try again.';
  }
  switch (e.kind) {
    case 'network':
      return 'Could not reach Plex. Check your network.';
    case 'timeout':
      return 'Plex took too long to respond.';
    case 'cancelled':
      return 'Cancelled.';
    case 'unauthorized':
      return 'Your Plex sign-in has expired. Link this TV again.';
    case 'forbidden':
      return 'This Plex account does not have access to that.';
    case 'not-found':
      return 'Plex could not find that.';
    case 'rate-limited':
      return 'Plex is asking us to slow down. Try again in a moment.';
    case 'service-unavailable':
      return 'Plex is not available right now. Try again later.';
    case 'link-expired':
      return 'That code expired. Get a new code to try again.';
    case 'no-signing-key':
      return 'This TV could not create its Plex sign-in key.';
    case 'playback-restricted':
      return 'Plex did not allow this to play here. Streaming away from home can need a Plex Pass or Remote Watch Pass on the account.';
    case 'unsupported':
      return 'Plex does not offer that.';
    case 'wrong-pin':
      return 'That PIN is not right. Try again.';
    default:
      return 'Plex reported a problem. Please try again.';
  }
}
