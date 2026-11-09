import type { AudioOutput } from '../providers/types';
import type { KeyValueStore } from './keyValueStore';

const KEY = 'anystream.audioOutput.v1';

/**
 * Stereo until the user says otherwise: most TVs and speaker pairs are two channels, and on those a surround
 * track that is not mixed down by the server can leave the dialogue in one speaker. Surround is one press away
 * in the player's menu. One setting for the whole TV, since it describes the speakers, not a viewer.
 */
export const DEFAULT_AUDIO_OUTPUT: AudioOutput = 'stereo';

export class AudioPrefsStore {
  constructor(private readonly store: KeyValueStore) {}

  get(): AudioOutput {
    const raw = this.store.getString(KEY);
    return raw === 'stereo' || raw === 'surround' ? raw : DEFAULT_AUDIO_OUTPUT;
  }

  set(output: AudioOutput): void {
    this.store.set(KEY, output);
  }
}
