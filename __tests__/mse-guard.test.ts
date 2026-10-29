import { installTypeSupportGuard } from '../src/player/mseGuard';

function fakeTarget() {
  const mediaSource: Record<string, any> = {
    isTypeSupported: jest.fn(function (this: unknown, type: string) {
      if (type.includes('ac-3')) {
        throw new Error('[com.amazon.apmf.InvalidOperationError]: Invalid Operation');
      }
      return type.includes('mp4a');
    }),
  };
  return { MediaSource: mediaSource };
}

describe('installTypeSupportGuard', () => {
  it('passes real answers through and turns a native throw into false', () => {
    const target = fakeTarget();
    installTypeSupportGuard(target);
    expect(target.MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')).toBe(true);
    expect(target.MediaSource.isTypeSupported('audio/mpeg')).toBe(false);
    expect(target.MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"')).toBe(false);
  });

  it('wraps only once and tolerates a missing MediaSource', () => {
    const target = fakeTarget();
    installTypeSupportGuard(target);
    const guarded = target.MediaSource.isTypeSupported;
    installTypeSupportGuard(target);
    expect(target.MediaSource.isTypeSupported).toBe(guarded);
    expect(() => installTypeSupportGuard({})).not.toThrow();
  });
});
