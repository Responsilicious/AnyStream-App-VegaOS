/** Jellyfin measures time in 100 ns ticks: 10,000 ticks per millisecond. */
const TICKS_PER_MS = 10000;

export function msToTicks(ms: number): number {
  return Math.max(0, Math.round(ms * TICKS_PER_MS));
}

export function ticksToMs(ticks: number | undefined | null): number {
  if (!ticks || ticks < 0) {
    return 0;
  }
  return Math.round(ticks / TICKS_PER_MS);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
