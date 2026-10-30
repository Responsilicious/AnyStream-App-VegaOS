/**
 * Safe server switching (spec §11): idle → checking → preparing → commit → ready. The current context stays
 * live until the destination has been validated and prepared; only then does it change, all at once. Every
 * context gets a new generation number, and work tagged with an old generation is ignored, so a late reply
 * from the previous server can never fill the new server's screens.
 */

export type SwitchPhase = 'idle' | 'checking' | 'preparing' | 'ready' | 'failed';

export interface ActiveContext<T> {
  connectionId: string;
  generation: number;
  /** Whatever the app needs to show this context: a provider, Home's first rows. */
  data: T;
}

export type SwitchResult<T> =
  | { outcome: 'switched'; context: ActiveContext<T> }
  | { outcome: 'failed'; error: unknown }
  /** Another switch started (or this one was cancelled) before this one finished. Nothing changed. */
  | { outcome: 'superseded' };

export interface SwitchSteps<T> {
  /** Check the destination: reachable, credentials accepted, profile allowed. Throws on failure. */
  check(connectionId: string, signal: AbortSignal): Promise<void>;
  /** Build the destination's context (provider, minimum Home data). Throws on failure. */
  prepare(connectionId: string, signal: AbortSignal): Promise<T>;
  /** Persist the choice once committed (mark active and last used). */
  commit?(connectionId: string): void;
}

type Listener<T> = (state: { phase: SwitchPhase; target?: string; active?: ActiveContext<T> }) => void;

export class ContextCoordinator<T> {
  private active: ActiveContext<T> | undefined;
  private generation = 0;
  private pending: { target: string; controller: AbortController } | undefined;
  private phase: SwitchPhase = 'idle';
  private listeners = new Set<Listener<T>>();

  constructor(private readonly steps: SwitchSteps<T>) {}

  current(): ActiveContext<T> | undefined {
    return this.active;
  }

  currentPhase(): SwitchPhase {
    return this.phase;
  }

  /** True while `generation` is still the active context: check before applying any async result. */
  isCurrent(generation: number): boolean {
    return this.active?.generation === generation;
  }

  /** Runs `apply` only if the context that started the work is still active. Returns whether it ran. */
  ifCurrent(generation: number, apply: () => void): boolean {
    if (!this.isCurrent(generation)) {
      return false;
    }
    apply();
    return true;
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Switches to `connectionId`. A switch already in flight is cancelled. On failure the current context is
   * left exactly as it was. Asking for the context that is already active does nothing.
   *
   * `destination` prepares what the switch is for, such as the title chosen in search, after the context is
   * built and before anything commits: if the title has gone or the switch was superseded, nothing changes.
   */
  async switchTo(connectionId: string, destination?: (data: T, signal: AbortSignal) => Promise<void>): Promise<SwitchResult<T>> {
    if (this.active?.connectionId === connectionId && !this.pending && !destination) {
      return { outcome: 'switched', context: this.active };
    }
    this.cancel();
    const controller = new AbortController();
    const mine = { target: connectionId, controller };
    this.pending = mine;
    const stillMine = () => this.pending === mine && !controller.signal.aborted;

    try {
      this.setPhase('checking', connectionId);
      await this.steps.check(connectionId, controller.signal);
      if (!stillMine()) {
        return { outcome: 'superseded' };
      }
      this.setPhase('preparing', connectionId);
      const data = await this.steps.prepare(connectionId, controller.signal);
      if (!stillMine()) {
        return { outcome: 'superseded' };
      }
      if (destination) {
        await destination(data, controller.signal);
        if (!stillMine()) {
          return { outcome: 'superseded' };
        }
      }
      this.generation += 1;
      this.active = { connectionId, generation: this.generation, data };
      this.pending = undefined;
      this.steps.commit?.(connectionId);
      this.setPhase('ready');
      return { outcome: 'switched', context: this.active };
    } catch (error) {
      if (!stillMine()) {
        return { outcome: 'superseded' };
      }
      this.pending = undefined;
      this.setPhase('failed', connectionId);
      return { outcome: 'failed', error };
    }
  }

  /** Stops a switch in flight (Back, Cancel). The current context is untouched. */
  cancel(): void {
    if (this.pending) {
      this.pending.controller.abort();
      this.pending = undefined;
      this.setPhase(this.active ? 'ready' : 'idle');
    }
  }

  /** Drops the active context (its connection was removed or signed out). */
  clear(): void {
    this.cancel();
    this.generation += 1;
    this.active = undefined;
    this.setPhase('idle');
  }

  private setPhase(phase: SwitchPhase, target?: string): void {
    this.phase = phase;
    for (const listener of this.listeners) {
      listener({ phase, target, active: this.active });
    }
  }
}
