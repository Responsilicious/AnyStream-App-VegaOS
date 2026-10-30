import { installTimerGuard } from '../src/player/timerGuard';

function fakeGlobal() {
  const calls: unknown[] = [];
  return {
    calls,
    clearTimeout: jest.fn((handle?: unknown) => {
      calls.push(handle);
      if (handle === -1) {
        throw new Error('clearTimeout called with an invalid handle');
      }
      if (handle === 'boom') {
        throw new Error('something else');
      }
    }),
    clearInterval: jest.fn(),
  } as Record<string, any>;
}

describe('installTimerGuard', () => {
  it('ignores invalid-handle errors but still clears valid handles', () => {
    const g = fakeGlobal();
    const real = g.clearTimeout;
    installTimerGuard(g);
    expect(() => g.clearTimeout(-1)).not.toThrow();
    expect(() => g.clearTimeout(7)).not.toThrow();
    expect(real).toHaveBeenCalledWith(7);
  });

  it('lets unrelated errors through', () => {
    const g = fakeGlobal();
    installTimerGuard(g);
    expect(() => g.clearTimeout('boom')).toThrow('something else');
  });

  it('guards clearInterval and installs only once', () => {
    const g = fakeGlobal();
    installTimerGuard(g);
    const guarded = g.clearTimeout;
    installTimerGuard(g);
    expect(g.clearTimeout).toBe(guarded);
    g.clearInterval(3);
  });

  it('skips timers the runtime does not have', () => {
    expect(() => installTimerGuard({})).not.toThrow();
  });
});
