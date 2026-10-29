import { AccessibilityInfo } from 'react-native';

/** Says a status change out loud when a screen reader is on (connection and sign-in progress). */
export function announce(text: string): void {
  try {
    AccessibilityInfo.announceForAccessibility?.(text);
  } catch {
    // Not every platform build has it; the on-screen text is still there.
  }
}
