import type { ServerRecord } from './providers/types';

/**
 * Where the person is in the entry flow (docs/sign-in.md): Welcome → Connect to server → Sign in or Quick
 * Connect → Home. A server, once verified, travels with the steps after it so its name is always on screen.
 */
export type AuthStep =
  | { name: 'welcome' }
  | { name: 'connect'; address?: string }
  | { name: 'signin'; server: ServerRecord; quickConnect?: boolean; userName?: string; notice?: string }
  | { name: 'quickconnect'; server: ServerRecord; userName?: string };

export interface AuthStart {
  /** A server is already known, e.g. its sign-in expired. */
  server?: ServerRecord;
  userName?: string;
  notice?: string;
  /** Open on Connect to server (Change server from the "server unavailable" screen). */
  connect?: boolean;
}

/** First launch starts at Welcome; an expired sign-in goes straight back to sign-in on the same server. */
export function initialStep(start: AuthStart = {}): AuthStep {
  if (start.connect) {
    return { name: 'connect', address: start.server?.baseUrl };
  }
  if (start.server) {
    return { name: 'signin', server: start.server, userName: start.userName, notice: start.notice };
  }
  return { name: 'welcome' };
}

/** Back from each step. Welcome has nowhere to go: Back there leaves the app. */
export function stepBack(step: AuthStep): AuthStep | null {
  switch (step.name) {
    case 'welcome':
      return null;
    case 'connect':
      return { name: 'welcome' };
    case 'signin':
      return { name: 'connect', address: step.server.baseUrl };
    case 'quickconnect':
      return { name: 'signin', server: step.server, quickConnect: true, userName: step.userName };
  }
}

export const EXPIRED_NOTICE = 'Your sign-in has expired. Sign in again to continue.';
