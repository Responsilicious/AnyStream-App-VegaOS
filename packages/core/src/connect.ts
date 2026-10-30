import { isJellyfinError } from './providers/jellyfin/errors';

/**
 * Wording for the start, connect and sign-in screens (docs/sign-in.md). Kept apart from the screens so each
 * state's text can be tested, and so a failure always says what to do next.
 */

export type ConnectProblem = 'unavailable' | 'certificate' | 'not-jellyfin' | 'timeout' | 'invalid';

export interface ConnectStatus {
  tone: 'busy' | 'info' | 'success' | 'error';
  title: string;
  detail?: string;
}

export const CHECKING: ConnectStatus = { tone: 'busy', title: 'Checking server…' };

export function serverFound(name: string): ConnectStatus {
  return { tone: 'success', title: 'Server found', detail: `${name}. Continue to sign in.` };
}

/** Why the server could not be used, in the design's words. */
export function connectProblem(e: unknown): ConnectProblem {
  if (!isJellyfinError(e)) {
    return 'unavailable';
  }
  switch (e.kind) {
    case 'certificate':
      return 'certificate';
    case 'not-jellyfin':
    case 'not-found':
      return 'not-jellyfin';
    case 'timeout':
      return 'timeout';
    default:
      return 'unavailable';
  }
}

export function connectStatus(problem: ConnectProblem, message?: string): ConnectStatus {
  switch (problem) {
    case 'certificate':
      return {
        tone: 'error',
        title: 'Certificate could not be verified',
        detail: 'The server needs a certificate from a trusted authority. On your home network you can try its http:// address.',
      };
    case 'not-jellyfin':
      return { tone: 'error', title: 'Address does not point to a Jellyfin server', detail: 'Check the address, including any port or path.' };
    case 'timeout':
      return { tone: 'error', title: 'Server unavailable', detail: 'The server took too long to answer. Check the address or network.' };
    case 'invalid':
      return { tone: 'error', title: 'Check the address', detail: message };
    default:
      return { tone: 'error', title: 'Server unavailable', detail: 'Check the address or network.' };
  }
}

/**
 * A quick look at what was typed, before anything goes on the network. Returns what is wrong, or null.
 * Bare names, IP addresses, ports and paths are all fine; util/url.ts decides between https and http.
 */
export function addressProblem(input: string): string | null {
  const text = input.trim();
  if (!text) {
    return 'Enter the server address.';
  }
  if (/\s/.test(text)) {
    return 'A server address has no spaces.';
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return 'Use an address that starts with http:// or https://, or just the server name.';
  }
  const rest = scheme ? text.slice(scheme[0].length) : text;
  const host = rest.split('/')[0];
  const port = /:(\d+)$/.exec(host);
  if (!host || host.startsWith(':') || (port && (Number(port[1]) < 1 || Number(port[1]) > 65535))) {
    return 'That address is not complete. For example: https://watch.example.com or 192.168.1.20:8096';
  }
  return null;
}

/**
 * Sign-in failures. A refusal never says whether the account exists; a connection problem says so plainly,
 * so the person does not retype a correct password.
 */
export function signInError(e: unknown, serverName: string): string {
  if (!isJellyfinError(e)) {
    return 'Sign-in did not work. Try again.';
  }
  switch (e.kind) {
    case 'unauthorized':
      return 'Sign-in failed. Check the username and password, then try again.';
    case 'network':
    case 'timeout':
    case 'certificate':
      return `Could not reach ${serverName}. Check your network, then try again.`;
    default:
      return `${serverName} could not sign you in right now. Try again in a moment.`;
  }
}

/** What the start-up check found when the saved server could not be reached. */
export function unavailableMessage(serverName: string): string {
  return `${serverName} is not answering. Check that it is running and that this TV is online.`;
}

/** The address as people recognise it: no trailing slash. */
export function displayAddress(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** "A B C 1 2 3": a screen reader reads the Quick Connect code one character at a time. */
export function spokenCode(code: string): string {
  return Array.from(code).join(' ');
}
