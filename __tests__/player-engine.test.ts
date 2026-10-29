import { PlayerEngine, type EngineState, type PlayerFailure } from '../src/player/PlayerEngine';
import type { PlaybackDecision } from '../src/providers/types';
import { FakeElement, FakeLoader } from './helpers/fakes';

const URL_DECISION: PlaybackDecision = {
  mode: 'url',
  method: 'DirectPlay',
  url: 'https://s/Videos/1/stream?static=true',
  mediaSourceId: 'm',
};

const HLS_DECISION: PlaybackDecision = {
  mode: 'hls',
  method: 'Transcode',
  url: 'https://s/videos/1/master.m3u8',
  mediaSourceId: 'm',
  durationMs: 600000,
};

function setup() {
  const element = new FakeElement();
  const loader = new FakeLoader();
  const global: { value: unknown } = { value: undefined };
  const prepare = jest.fn();
  const engine = new PlayerEngine({
    createElement: () => element,
    createAdaptiveLoader: () => loader,
    prepare,
    setGlobalElement: el => {
      global.value = el;
    },
  });
  const states: EngineState[] = [];
  const failures: PlayerFailure[] = [];
  const times: Array<[number, number]> = [];
  engine.subscribe({
    onState: s => states.push(s),
    onError: f => failures.push(f),
    onTime: (p, d) => times.push([p, d]),
  });
  return { element, loader, engine, global, prepare, states, failures, times };
}

describe('PlayerEngine', () => {
  it('prepares, creates the element, exposes it globally, and starts paused', async () => {
    const { engine, element, global, prepare } = setup();
    await engine.init();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(element.initialize).toHaveBeenCalledTimes(1);
    expect(global.value).toBe(element);
    expect(element.autoplay).toBe(false);
  });

  it('init twice is harmless', async () => {
    const { engine, element } = setup();
    await engine.init();
    await engine.init();
    expect(element.initialize).toHaveBeenCalledTimes(1);
  });

  it('starts the element after an hls load, but not if released mid-load', async () => {
    const first = setup();
    await first.engine.init();
    first.engine.attachSurface('surface-1');
    await first.engine.load(HLS_DECISION, 0);
    expect(first.loader.loaded).toHaveLength(1);
    expect(first.element.play).toHaveBeenCalledTimes(1);

    const second = setup();
    await second.engine.init();
    const pending = second.engine.load(HLS_DECISION, 0);
    await Promise.resolve();
    await second.engine.release();
    await pending;
    expect(second.element.play).not.toHaveBeenCalled();
  });

  it('waits for the video surface before loading', async () => {
    const { engine, element } = setup();
    await engine.init();

    let loaded = false;
    const pending = engine.load(URL_DECISION, 0).then(() => {
      loaded = true;
    });
    await Promise.resolve();
    expect(loaded).toBe(false);
    expect(element.src).toBe('');

    engine.attachSurface('surface-1');
    await pending;
    expect(element.setSurfaceHandle).toHaveBeenCalledWith('surface-1');
    expect(element.src).toBe(URL_DECISION.url);
    expect(element.autoplay).toBe(true);
  });

  it('hands a surface that arrived before init to the element', async () => {
    const { engine, element } = setup();
    engine.attachSurface('early');
    await engine.init();
    expect(element.setSurfaceHandle).toHaveBeenCalledWith('early');
    await engine.load(URL_DECISION, 0);
    expect(element.src).toBe(URL_DECISION.url);
  });

  it('hands captions to the element whenever they appear', async () => {
    const { engine, element } = setup();
    engine.attachCaptions('cap-early');
    await engine.init();
    expect(element.setCaptionViewHandle).toHaveBeenCalledWith('cap-early');
    engine.detachCaptions('cap-early');
    expect(element.clearCaptionViewHandle).toHaveBeenCalledWith('cap-early');
  });

  it('loads HLS through the adaptive loader with autoplay', async () => {
    const { engine, loader, element } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(HLS_DECISION, 0);

    expect(loader.loaded).toHaveLength(1);
    expect(loader.loaded[0].autoplay).toBe(true);
    expect(loader.loaded[0].content).toEqual({
      secure: 'false',
      uri: HLS_DECISION.url,
      drm_scheme: '',
      drm_license_uri: '',
    });
    expect(element.src).toBe('');
  });

  it('unloads the previous HLS stream before loading another', async () => {
    const { engine, loader } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(HLS_DECISION, 0);
    await engine.load(HLS_DECISION, 0);
    expect(loader.unloads).toBe(1);
    expect(loader.loaded).toHaveLength(2);
  });

  it('seeks to the resume point once metadata is ready, and only once', async () => {
    const { engine, element } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(URL_DECISION, 90000);

    expect(element.currentTime).toBe(0);
    element.emit('loadedmetadata');
    expect(element.currentTime).toBe(90);

    element.currentTime = 12;
    element.emit('loadedmetadata');
    expect(element.currentTime).toBe(12);
  });

  it('does not seek when starting from the beginning', async () => {
    const { engine, element } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(URL_DECISION, 0);
    element.currentTime = 0;
    element.emit('loadedmetadata');
    expect(element.currentTime).toBe(0);
  });

  it('follows playback state from media events', async () => {
    const { engine, element, states } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(URL_DECISION, 0);

    element.paused = false;
    element.emit('playing');
    element.emit('waiting');
    element.emit('canplay');
    element.paused = true;
    element.emit('pause');
    element.ended = true;
    element.emit('ended');

    expect(states).toEqual(['loading', 'playing', 'buffering', 'playing', 'paused', 'ended']);
  });

  it('does not call a pause at the end of the file "paused"', async () => {
    const { engine, element, states } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(URL_DECISION, 0);
    element.emit('playing');
    element.ended = true;
    element.emit('pause');
    expect(states[states.length - 1]).toBe('playing');
  });

  it('reports time in milliseconds and falls back to the server duration', async () => {
    const { engine, element, times } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(HLS_DECISION, 0);

    element.currentTime = 12.5;
    element.emit('timeupdate');
    expect(times[0]).toEqual([12500, 600000]);

    element.duration = 3600;
    element.emit('timeupdate');
    expect(times[1]).toEqual([12500, 3600000]);

    element.duration = NaN;
    expect(engine.getDurationMs()).toBe(600000);
  });

  it('marks a direct-play failure as recoverable and a transcode failure as final', async () => {
    const a = setup();
    await a.engine.init();
    a.engine.attachSurface('s');
    await a.engine.load(URL_DECISION, 0);
    a.element.error = { code: 4, message: 'unsupported' };
    a.element.emit('error');
    expect(a.failures[0]).toEqual({ recoverable: true, message: 'unsupported', code: 4 });
    expect(a.engine.getState()).toBe('error');

    const b = setup();
    await b.engine.init();
    b.engine.attachSurface('s');
    await b.engine.load(HLS_DECISION, 0);
    b.element.error = null;
    b.element.emit('error');
    expect(b.failures[0]).toMatchObject({ recoverable: false, message: 'Playback failed' });
  });

  it('seeks within bounds', async () => {
    const { engine, element } = setup();
    await engine.init();
    engine.attachSurface('s');
    await engine.load(URL_DECISION, 0);
    element.duration = 100;

    element.currentTime = 50;
    engine.seekBy(10000);
    expect(element.currentTime).toBe(60);
    engine.seekBy(-999999);
    expect(element.currentTime).toBe(0);
    engine.seekTo(999999);
    expect(element.currentTime).toBe(99);
  });

  it('toggles play and pause', async () => {
    const { engine, element } = setup();
    await engine.init();
    element.paused = true;
    engine.togglePlayPause();
    expect(element.play).toHaveBeenCalled();
    engine.togglePlayPause();
    expect(element.pause).toHaveBeenCalled();
  });

  it('releases everything once, even when called twice', async () => {
    const { engine, element, loader, global } = setup();
    await engine.init();
    engine.attachSurface('s');
    engine.attachCaptions('c');
    await engine.load(HLS_DECISION, 0);

    await engine.release();
    await engine.release();

    expect(loader.unloads).toBe(1);
    expect(element.clearSurfaceHandle).toHaveBeenCalledWith('s');
    expect(element.clearCaptionViewHandle).toHaveBeenCalledWith('c');
    expect(element.deinitialize).toHaveBeenCalledTimes(1);
    expect(element.listenerCount()).toBe(0);
    expect(global.value).toBeNull();
  });

  it('a release while waiting for the surface lets the pending load finish quietly', async () => {
    const { engine, element } = setup();
    await engine.init();
    const pending = engine.load(URL_DECISION, 0);
    await engine.release();
    await expect(pending).resolves.toBeUndefined();
    expect(element.src).toBe('');
  });

  it('refuses to load before init', async () => {
    const { engine } = setup();
    await expect(engine.load(URL_DECISION, 0)).rejects.toThrow(/init/);
  });

  describe('reload on a fresh element', () => {
    function withElements() {
      const elements: FakeElement[] = [];
      const loader = new FakeLoader();
      const globals: unknown[] = [];
      const engine = new PlayerEngine({
        createElement: () => {
          const element = new FakeElement();
          elements.push(element);
          return element;
        },
        createAdaptiveLoader: () => loader,
        setGlobalElement: el => {
          globals.push(el);
        },
      });
      const states: EngineState[] = [];
      engine.subscribe({ onState: s => states.push(s) });
      return { elements, loader, engine, globals, states };
    }

    it('frees the old element and plays the new stream on a new one with the same surface and captions', async () => {
      const { elements, loader, engine, globals } = withElements();
      await engine.init();
      engine.attachSurface('s');
      engine.attachCaptions('c');
      await engine.load(HLS_DECISION, 0);

      await engine.reload(HLS_DECISION, 42000);

      const [old, fresh] = elements;
      expect(loader.unloads).toBe(1);
      expect(old.clearSurfaceHandle).toHaveBeenCalledWith('s');
      expect(old.clearCaptionViewHandle).toHaveBeenCalledWith('c');
      expect(old.deinitialize).toHaveBeenCalledTimes(1);
      expect(old.listenerCount()).toBe(0);
      expect(fresh.initialize).toHaveBeenCalledTimes(1);
      expect(fresh.setSurfaceHandle).toHaveBeenCalledWith('s');
      expect(fresh.setCaptionViewHandle).toHaveBeenCalledWith('c');
      expect(fresh.play).toHaveBeenCalledTimes(1);
      expect(loader.loaded).toHaveLength(2);
      expect(globals[globals.length - 1]).toBe(fresh);

      fresh.emit('loadedmetadata');
      expect(fresh.currentTime).toBe(42);
    });

    it('follows events from the new element only', async () => {
      const { elements, engine, states } = withElements();
      await engine.init();
      engine.attachSurface('s');
      await engine.load(URL_DECISION, 0);
      await engine.reload(URL_DECISION, 0);

      elements[0].emit('playing');
      expect(states[states.length - 1]).toBe('loading');
      elements[1].emit('playing');
      expect(states[states.length - 1]).toBe('playing');
    });

    it('stops quietly when released during the swap', async () => {
      const { elements, engine } = withElements();
      await engine.init();
      engine.attachSurface('s');
      await engine.load(HLS_DECISION, 0);

      const pending = engine.reload(HLS_DECISION, 0);
      await engine.release();
      await expect(pending).resolves.toBeUndefined();
      elements.forEach(el => expect(el.play.mock.calls.length).toBeLessThanOrEqual(1));
      expect(elements[elements.length - 1].deinitialize).toHaveBeenCalled();
    });
  });

  describe('direct play start-up deadline', () => {
    function withTimers() {
      const element = new FakeElement();
      const loader = new FakeLoader();
      const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
      const engine = new PlayerEngine({
        createElement: () => element,
        createAdaptiveLoader: () => loader,
        directPlayTimeoutMs: 15000,
        setTimer: (fn, ms) => {
          const timer = { fn, ms, cleared: false };
          timers.push(timer);
          return timer;
        },
        clearTimer: handle => {
          (handle as { cleared: boolean }).cleared = true;
        },
      });
      const failures: PlayerFailure[] = [];
      engine.subscribe({ onError: f => failures.push(f) });
      return { element, engine, timers, failures };
    }

    it('fails direct play as recoverable when the file never shows signs of life', async () => {
      const { engine, timers, failures } = withTimers();
      await engine.init();
      engine.attachSurface('s');
      await engine.load(URL_DECISION, 0);

      expect(timers).toHaveLength(1);
      expect(timers[0].ms).toBe(15000);
      timers[0].fn();
      expect(failures).toEqual([{ recoverable: true, message: 'Direct play did not start' }]);
      expect(engine.getState()).toBe('error');
    });

    it('stands down once the file loads its metadata', async () => {
      const { engine, element, timers, failures } = withTimers();
      await engine.init();
      engine.attachSurface('s');
      await engine.load(URL_DECISION, 0);
      element.emit('loadedmetadata');
      expect(timers[0].cleared).toBe(true);
      timers[0].fn();
      expect(failures).toEqual([]);
    });

    it('never fires for a later load or after release', async () => {
      const { engine, timers, failures } = withTimers();
      await engine.init();
      engine.attachSurface('s');
      await engine.load(URL_DECISION, 0);
      await engine.load(HLS_DECISION, 0);
      timers[0].fn();
      await engine.release();
      expect(failures).toEqual([]);
    });

    it('does not watch HLS, which reports its own errors', async () => {
      const { engine, timers } = withTimers();
      await engine.init();
      engine.attachSurface('s');
      await engine.load(HLS_DECISION, 0);
      expect(timers).toHaveLength(0);
    });
  });
});
