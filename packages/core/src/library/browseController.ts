import type { LibraryPage, LibraryView } from '../providers/types';
import { canonicalKey } from './viewState';

/**
 * One library page's results (docs/library-filters.md §5, §8). Every change of filters or sort is one transaction:
 * the first page of the new view is fetched while the old results stay on screen, and only a successful fetch
 * replaces them and is saved. Each request carries a sequence number, so a late answer to an older query, a
 * superseded count or a page of a previous view can never land on the current one.
 */

export interface BrowseSource<T> {
  query(view: LibraryView, start: number, limit: number, signal: AbortSignal): Promise<LibraryPage<T>>;
  /** Exact match count for a draft, or null. Left out when the server cannot count. */
  count?(view: LibraryView, signal: AbortSignal): Promise<number | null>;
}

export interface BrowseState<T> {
  applied: LibraryView;
  items: T[];
  /** Exact total for `applied`, or null when the server did not say. */
  total: number | null;
  /** The first page of `applied` has loaded. */
  loaded: boolean;
  loadingMore: boolean;
  /** Every page of `applied` is loaded. */
  exhausted: boolean;
}

export type ApplyResult = { outcome: 'applied' } | { outcome: 'failed'; error: unknown } | { outcome: 'superseded' };

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BrowseOptions {
  pageSize: number;
  /** Called once a view's first page has loaded: the place to save it. Never called for failed or superseded work. */
  onCommit?: (view: LibraryView) => void;
  /** Count previews wait this long after the last draft edit. */
  countDebounceMs?: number;
  timers?: Timers;
}

type Listener<T> = (state: BrowseState<T>) => void;

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class BrowseController<T> {
  private state: BrowseState<T>;
  private listeners = new Set<Listener<T>>();
  private applySeq = 0;
  private applying: AbortController | undefined;
  /** Bumped on every commit: a page fetched for an earlier commit is thrown away. */
  private generation = 0;
  private more: AbortController | undefined;
  private countSeq = 0;
  private counting: AbortController | undefined;
  private countTimer: unknown;
  private disposed = false;
  private readonly timers: Timers;

  constructor(
    private readonly source: BrowseSource<T>,
    private readonly options: BrowseOptions,
    initial: LibraryView,
  ) {
    this.timers = options.timers ?? realTimers;
    this.state = { applied: initial, items: [], total: null, loaded: false, loadingMore: false, exhausted: false };
  }

  getState(): BrowseState<T> {
    return this.state;
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True while an apply is in flight. */
  isApplying(): boolean {
    return this.applying !== undefined;
  }

  /**
   * Puts back results the page had before it was left (Back from a title page), without asking the server again.
   * Only for the same view; anything else must go through `apply`.
   */
  restore(state: BrowseState<T>): void {
    this.generation += 1;
    this.state = { ...state, loadingMore: false };
    this.emit();
  }

  /**
   * Fetches the first page of `view` and, if that succeeds and nothing newer started meanwhile, makes it the
   * applied view. On failure the current view and results are untouched.
   */
  async apply(view: LibraryView): Promise<ApplyResult> {
    if (this.disposed) {
      return { outcome: 'superseded' };
    }
    this.applying?.abort();
    const controller = new AbortController();
    this.applying = controller;
    const seq = ++this.applySeq;
    try {
      const page = await this.source.query(view, 0, this.options.pageSize, controller.signal);
      if (seq !== this.applySeq || this.disposed) {
        return { outcome: 'superseded' };
      }
      this.applying = undefined;
      this.more?.abort();
      this.more = undefined;
      this.generation += 1;
      this.state = {
        applied: view,
        items: page.items,
        total: page.total,
        loaded: true,
        loadingMore: false,
        exhausted: isExhausted(page.items.length, page.items.length, page.total, this.options.pageSize),
      };
      this.options.onCommit?.(view);
      this.emit();
      return { outcome: 'applied' };
    } catch (error) {
      if (seq !== this.applySeq || this.disposed) {
        return { outcome: 'superseded' };
      }
      this.applying = undefined;
      return { outcome: 'failed', error };
    }
  }

  /** Stops an apply in flight (Back while the drawer waits). The applied view stays. */
  cancelApply(): void {
    if (this.applying) {
      this.applySeq += 1;
      this.applying.abort();
      this.applying = undefined;
    }
  }

  /** Loads the next page of the applied view. Does nothing while one is loading or when all are in. */
  async loadMore(): Promise<void> {
    const { loaded, loadingMore, exhausted, items, applied } = this.state;
    if (this.disposed || !loaded || loadingMore || exhausted) {
      return;
    }
    const generation = this.generation;
    const key = canonicalKey(applied);
    const controller = new AbortController();
    this.more = controller;
    this.state = { ...this.state, loadingMore: true };
    this.emit();
    try {
      const page = await this.source.query(applied, items.length, this.options.pageSize, controller.signal);
      if (generation !== this.generation || this.disposed || canonicalKey(this.state.applied) !== key) {
        return;
      }
      const seen = new Set(this.state.items.map(identity));
      const fresh = page.items.filter(item => !seen.has(identity(item)));
      const all = [...this.state.items, ...fresh];
      const total = page.total ?? this.state.total;
      this.state = {
        ...this.state,
        items: all,
        total,
        loadingMore: false,
        // A page that adds nothing new ends paging even if the server's total disagrees, so it cannot loop.
        exhausted: fresh.length === 0 || isExhausted(page.items.length, all.length, total, this.options.pageSize),
      };
      this.more = undefined;
      this.emit();
    } catch {
      if (generation !== this.generation || this.disposed) {
        return;
      }
      // Keep what is loaded; scrolling to the end again retries.
      this.more = undefined;
      this.state = { ...this.state, loadingMore: false };
      this.emit();
    }
  }

  /**
   * Asks for an exact count of `draft` once edits pause. `onCount` gets the number, or null when the server
   * cannot say or the request failed. Only the newest request ever reports.
   */
  previewCount(draft: LibraryView, onCount: (count: number | null) => void): void {
    this.cancelPreview();
    const count = this.source.count;
    if (!count || this.disposed) {
      onCount(null);
      return;
    }
    const seq = ++this.countSeq;
    this.countTimer = this.timers.setTimeout(() => {
      this.countTimer = undefined;
      const controller = new AbortController();
      this.counting = controller;
      count.call(this.source, draft, controller.signal).then(
        n => {
          if (seq === this.countSeq && !this.disposed) {
            this.counting = undefined;
            onCount(typeof n === 'number' && n >= 0 ? n : null);
          }
        },
        () => {
          if (seq === this.countSeq && !this.disposed) {
            this.counting = undefined;
            onCount(null);
          }
        },
      );
    }, this.options.countDebounceMs ?? 300);
  }

  cancelPreview(): void {
    this.countSeq += 1;
    if (this.countTimer !== undefined) {
      this.timers.clearTimeout(this.countTimer);
      this.countTimer = undefined;
    }
    this.counting?.abort();
    this.counting = undefined;
  }

  /** The page is going away (or the server or profile changed): stop everything and ignore late answers. */
  dispose(): void {
    this.disposed = true;
    this.applying?.abort();
    this.more?.abort();
    this.cancelPreview();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

function identity(item: unknown): unknown {
  return item && typeof item === 'object' && 'id' in item ? (item as { id: unknown }).id : item;
}

function isExhausted(pageLength: number, loaded: number, total: number | null, pageSize: number): boolean {
  if (total !== null) {
    return loaded >= total;
  }
  return pageLength < pageSize;
}
