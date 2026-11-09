import { AudioPrefsStore } from '../src/storage/audioPrefs';
import { MemoryStore } from '../src/storage/keyValueStore';

describe('AudioPrefsStore', () => {
  it('starts on stereo, remembers a choice, and reads anything unknown as stereo', () => {
    const kv = new MemoryStore();
    const prefs = new AudioPrefsStore(kv);
    expect(prefs.get()).toBe('stereo');
    prefs.set('surround');
    expect(new AudioPrefsStore(kv).get()).toBe('surround');
    kv.set('anystream.audioOutput.v1', 'quad');
    expect(prefs.get()).toBe('stereo');
  });
});
