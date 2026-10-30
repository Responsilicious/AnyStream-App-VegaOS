/**
 * Vega's clearTimeout/clearInterval throw "invalid handle" for handles that are stale or were never
 * valid (the runtime hands out -1 for some timers). Browsers ignore those calls, and hls.js relies on
 * that: a throw inside its fragment loader swallows the success callback and the stream buffers forever.
 */
const INVALID_HANDLE = /invalid handle/i;
const MAX_LOGGED = 5;

type TimerFn = (handle?: unknown) => void;
type GuardTarget = Record<string, unknown>;

export function installTimerGuard(target: GuardTarget = globalThis as unknown as GuardTarget): void {
  if (target.__timerGuardInstalled) {
    return;
  }
  target.__timerGuardInstalled = true;
  let logged = 0;
  for (const name of ['clearTimeout', 'clearInterval']) {
    const real = target[name] as TimerFn | undefined;
    if (typeof real !== 'function') {
      continue;
    }
    target[name] = (handle?: unknown) => {
      try {
        real.call(target, handle);
      } catch (e) {
        if (!(e instanceof Error) || !INVALID_HANDLE.test(e.message)) {
          throw e;
        }
        if (logged < MAX_LOGGED) {
          logged += 1;
          console.log(`timerGuard: ignored ${name}(${String(handle)})`);
        }
      }
    };
  }
}
