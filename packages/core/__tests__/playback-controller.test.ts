import { PlaybackController } from '../src/player/PlaybackController';
import { PlayerEngine } from '../src/player/PlayerEngine';
import type { MediaItem, PlaybackDecision, PlaybackProvider } from '../src/providers/types';
import { FakeElement, FakeLoader } from './helpers/fakes';

const ITEM: MediaItem = { id: 'item1', title: 'Film', kind: 'movie', resumeMs: 60000, played: false };

const DIRECT: PlaybackDecision = {
  mode: 'url',
  method: 'DirectPlay',
  url: 'https://s/Videos/item1/stream?static=true',
  mediaSourceId: 'src1',
  playSessionId: 'ps-direct',
};

const HLS: PlaybackDecision = {
  mode: 'hls',
  method: 'Transcode',
  url: 'https://s/videos/item1/master.m3u8',
  mediaSourceId: 'src1',
  playSessionId: 'ps-hls',
};

function makeProvider(decisions: PlaybackDecision[]) {
  let next = 0;
  const provider = {
    getPlayback: jest.fn(async () => decisions[Math.min(next++, decisions.length - 1)]),
    reportStarted: jest.fn(async () => {}),
    reportProgress: jest.fn(async () => {}),
    reportStopped: jest.fn(async () => {}),
    stopTranscode: jest.fn(async () => {}),
  };
  return provider satisfies PlaybackProvider;
}

async function setup(decisions: PlaybackDecision[] = [DIRECT]) {
  const element = new FakeElement();
  const loader = new FakeLoader();
  const engine = new PlayerEngine({ createElement: () => element, createAdaptiveLoader: () => loader });
  const provider = makeProvider(decisions);

  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const controller = new PlaybackController({
    provider,
    engine,
    progressIntervalMs: 10000,
    setInterval: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearInterval: handle => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });

  const fatal: string[] = [];
  controller.subscribe({ onFatalError: m => fatal.push(m) });

  await engine.init();
  engine.attachSurface('surface');
  return { element, loader, engine, provider, controller, timers, fatal };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('PlaybackController', () => {
  it('asks the server for playback from the resume point and loads what it returns', async () => {
    const { controller, provider, element } = await setup();
    await controller.start(ITEM);

    expect(provider.getPlayback).toHaveBeenCalledWith('item1', { startMs: 60000 });
    expect(element.src).toBe(DIRECT.url);
    element.emit('loadedmetadata');
    expect(element.currentTime).toBe(60);
  });

  it('starts with the version and tracks chosen on the title page, and keeps the file default as the default', async () => {
    const chosen: PlaybackDecision = {
      ...HLS,
      mediaSourceId: 'src2',
      selection: { audioIndex: 2, subtitleIndex: 3 },
      defaultAudioIndex: 1,
    };
    const { controller, provider } = await setup([chosen, HLS]);
    await controller.start(ITEM, { mediaSourceId: 'src2', audioIndex: 2, subtitleIndex: 3 });
    expect(provider.getPlayback).toHaveBeenCalledWith('item1', {
      startMs: 60000,
      mediaSourceId: 'src2',
      audioIndex: 2,
      subtitleIndex: 3,
    });

    // Going back to the file's own audio track asks for no particular track, which allows a simpler stream.
    await controller.changeTracks({ audioIndex: 1 });
    expect(provider.getPlayback).toHaveBeenLastCalledWith(
      'item1',
      expect.objectContaining({ mediaSourceId: 'src2', audioIndex: undefined, subtitleIndex: 3 }),
    );
  });

  it('reports the start once playback really begins, then keeps reporting on a timer', async () => {
    const { controller, provider, element, timers } = await setup();
    await controller.start(ITEM);
    expect(provider.reportStarted).not.toHaveBeenCalled();

    element.currentTime = 61;
    element.emit('playing');
    element.emit('playing');
    expect(provider.reportStarted).toHaveBeenCalledTimes(1);
    expect(provider.reportStarted).toHaveBeenCalledWith(
      expect.objectContaining({ item: ITEM, decision: DIRECT, positionMs: 61000, paused: false }),
    );
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(10000);

    provider.reportProgress.mockClear();
    element.currentTime = 71;
    timers[0].fn();
    expect(provider.reportProgress).toHaveBeenCalledWith(expect.objectContaining({ positionMs: 71000 }));
  });

  it('tells the server straight away when the viewer pauses', async () => {
    const { controller, provider, element } = await setup();
    await controller.start(ITEM);
    element.emit('playing');
    provider.reportProgress.mockClear();

    element.currentTime = 80;
    element.emit('pause');
    expect(provider.reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({ positionMs: 80000, paused: true }),
    );
  });

  it('on stop: reports the final position, releases the player, and leaves direct play alone', async () => {
    const { controller, provider, element, timers } = await setup();
    await controller.start(ITEM);
    element.currentTime = 100;
    element.emit('playing');
    element.currentTime = 123;

    await controller.stop();

    expect(provider.reportStopped).toHaveBeenCalledWith(expect.objectContaining({ positionMs: 123000 }));
    expect(provider.stopTranscode).not.toHaveBeenCalled();
    expect(element.deinitialize).toHaveBeenCalled();
    expect(timers[0].cleared).toBe(true);
  });

  it('on stop after a transcode: also stops the server-side encode', async () => {
    const { controller, provider, element } = await setup([HLS]);
    await controller.start(ITEM);
    element.emit('playing');
    await controller.stop();
    expect(provider.stopTranscode).toHaveBeenCalledWith(HLS);
  });

  it('does not report a stop for something that never started playing', async () => {
    const { controller, provider } = await setup();
    await controller.start(ITEM);
    await controller.stop();
    expect(provider.reportStopped).not.toHaveBeenCalled();
  });

  it('stop is idempotent', async () => {
    const { controller, provider, element } = await setup();
    await controller.start(ITEM);
    element.emit('playing');
    await controller.stop();
    await controller.stop();
    expect(provider.reportStopped).toHaveBeenCalledTimes(1);
  });

  it('retries once as an HLS transcode when direct play fails, resuming where it was', async () => {
    const { controller, provider, element, loader, fatal } = await setup([DIRECT, HLS]);
    await controller.start(ITEM);
    element.currentTime = 75;
    element.error = { code: 4, message: 'decode failed' };
    element.emit('error');
    await flush();

    expect(provider.getPlayback).toHaveBeenCalledTimes(2);
    expect(provider.getPlayback).toHaveBeenLastCalledWith('item1', {
      startMs: 75000,
      forceTranscode: true,
      mediaSourceId: 'src1',
    });
    expect(loader.loaded[0].content.uri).toBe(HLS.url);
    expect(fatal).toEqual([]);
  });

  it('reports a fatal error when the retry also fails', async () => {
    const { controller, element, fatal } = await setup([DIRECT, HLS]);
    await controller.start(ITEM);
    element.error = { code: 4, message: 'first' };
    element.emit('error');
    await flush();

    element.error = { code: 4, message: 'second' };
    element.emit('error');
    await flush();

    expect(fatal).toEqual(['second']);
  });

  it('does not retry a transcode failure', async () => {
    const { controller, provider, element, fatal } = await setup([HLS]);
    await controller.start(ITEM);
    element.error = { code: 3, message: 'stream broke' };
    element.emit('error');
    await flush();

    expect(provider.getPlayback).toHaveBeenCalledTimes(1);
    expect(fatal).toEqual(['stream broke']);
  });

  it('fails cleanly when the server cannot provide a stream', async () => {
    const { controller, provider, fatal } = await setup();
    provider.getPlayback.mockRejectedValueOnce(new Error('No playable source'));
    await controller.start(ITEM);
    expect(fatal).toEqual(['No playable source']);
  });

  it('fails cleanly when the retry request itself fails', async () => {
    const { controller, provider, element, fatal } = await setup([DIRECT]);
    await controller.start(ITEM);
    provider.getPlayback.mockRejectedValueOnce(new Error('server down'));
    element.error = { code: 4, message: 'decode failed' };
    element.emit('error');
    await flush();
    expect(fatal).toEqual(['server down']);
  });

  it('keeps playing when progress reports fail', async () => {
    const { controller, provider, element, timers, fatal } = await setup();
    provider.reportStarted.mockRejectedValue(new Error('offline'));
    provider.reportProgress.mockRejectedValue(new Error('offline'));
    provider.reportStopped.mockRejectedValue(new Error('offline'));
    await controller.start(ITEM);
    element.emit('playing');
    timers[0].fn();
    element.emit('pause');
    await flush();
    await expect(controller.stop()).resolves.toBeUndefined();
    expect(fatal).toEqual([]);
  });

  it('stops the progress timer when the film ends', async () => {
    const { controller, element, timers } = await setup();
    await controller.start(ITEM);
    element.emit('playing');
    element.ended = true;
    element.emit('ended');
    expect(timers[0].cleared).toBe(true);
  });

  it('passes state and time updates to listeners', async () => {
    const { controller, element } = await setup();
    const states: string[] = [];
    const times: number[] = [];
    controller.subscribe({ onState: s => states.push(s), onTime: p => times.push(p) });
    await controller.start(ITEM);
    element.emit('playing');
    element.currentTime = 5;
    element.emit('timeupdate');
    expect(states).toContain('playing');
    expect(times).toEqual([5000]);
  });

  describe('changing audio and subtitles', () => {
    const TRACKS = {
      audio: [
        { index: 1, label: 'English  ·  AC3 5.1', isDefault: true },
        { index: 2, label: 'French  ·  AAC stereo', isDefault: false },
      ],
      subtitles: [{ index: 3, label: 'English', isDefault: false }],
    };
    const first: PlaybackDecision = {
      ...HLS,
      playSessionId: 'ps-1',
      tracks: TRACKS,
      selection: { audioIndex: 1, subtitleIndex: -1 },
    };
    const french: PlaybackDecision = {
      ...HLS,
      url: 'https://s/videos/item1/master.m3u8?audio=2',
      playSessionId: 'ps-2',
      tracks: TRACKS,
      selection: { audioIndex: 2, subtitleIndex: -1 },
    };

    it('announces the tracks when playback starts', async () => {
      const { controller } = await setup([first]);
      const seen: unknown[] = [];
      controller.subscribe({ onTracks: (tracks, selection) => seen.push([tracks, selection]) });
      await controller.start(ITEM);
      expect(seen).toEqual([[TRACKS, { audioIndex: 1, subtitleIndex: -1 }]]);
    });

    it('asks for a new stream at the current position and swaps to it', async () => {
      const { controller, provider, element, loader } = await setup([first, french]);
      await controller.start(ITEM);
      element.emit('playing');
      element.currentTime = 300;

      await controller.changeTracks({ audioIndex: 2 });

      expect(provider.getPlayback).toHaveBeenLastCalledWith('item1', {
        startMs: 300000,
        mediaSourceId: 'src1',
        audioIndex: 2,
        subtitleIndex: undefined,
      });
      expect(loader.loaded.map(l => l.content.uri)).toEqual([first.url, french.url]);
      expect(provider.reportStopped).toHaveBeenCalledWith(expect.objectContaining({ decision: first }));
      expect(provider.stopTranscode).toHaveBeenCalledWith(first);
    });

    it('announces the new selection and reports the new viewing as started once it plays', async () => {
      const { controller, provider, element } = await setup([first, french]);
      const seen: unknown[] = [];
      controller.subscribe({ onTracks: (_t, selection) => seen.push(selection) });
      await controller.start(ITEM);
      element.emit('playing');
      provider.reportStarted.mockClear();

      await controller.changeTracks({ audioIndex: 2 });
      element.emit('playing');

      expect(seen[seen.length - 1]).toEqual({ audioIndex: 2, subtitleIndex: -1 });
      expect(provider.reportStarted).toHaveBeenCalledWith(expect.objectContaining({ decision: french }));
    });

    it('does nothing when the track asked for is already playing', async () => {
      const { controller, provider } = await setup([first, french]);
      await controller.start(ITEM);
      await controller.changeTracks({ audioIndex: 1 });
      await controller.changeTracks({ subtitleIndex: -1 });
      expect(provider.getPlayback).toHaveBeenCalledTimes(1);
    });

    it('asks for the default audio without naming it, so direct play stays possible', async () => {
      const { controller, provider } = await setup([first, french, first]);
      await controller.start(ITEM);
      await controller.changeTracks({ audioIndex: 2 });
      await controller.changeTracks({ audioIndex: 1 });
      expect(provider.getPlayback).toHaveBeenLastCalledWith('item1', expect.objectContaining({ audioIndex: undefined }));
    });

    it('sends the subtitle index when one is chosen, and omits it for Off', async () => {
      const withSubs: PlaybackDecision = { ...first, selection: { audioIndex: 1, subtitleIndex: 3 } };
      const { controller, provider } = await setup([first, withSubs, first]);
      await controller.start(ITEM);
      await controller.changeTracks({ subtitleIndex: 3 });
      expect(provider.getPlayback).toHaveBeenLastCalledWith('item1', expect.objectContaining({ subtitleIndex: 3 }));
      await controller.changeTracks({ subtitleIndex: -1 });
      expect(provider.getPlayback).toHaveBeenLastCalledWith('item1', expect.objectContaining({ subtitleIndex: undefined }));
    });

    it('leaves the current stream playing when the server cannot make the new one', async () => {
      const { controller, provider, loader, fatal } = await setup([first]);
      await controller.start(ITEM);
      provider.getPlayback.mockRejectedValueOnce(new Error('No stream for that track'));

      await expect(controller.changeTracks({ audioIndex: 2 })).rejects.toThrow('No stream for that track');

      expect(loader.loaded).toHaveLength(1);
      expect(provider.stopTranscode).not.toHaveBeenCalled();
      expect(fatal).toEqual([]);
    });

    it('ignores a second change while one is in progress', async () => {
      const { controller, provider } = await setup([first, french]);
      await controller.start(ITEM);
      await Promise.all([controller.changeTracks({ audioIndex: 2 }), controller.changeTracks({ subtitleIndex: 3 })]);
      expect(provider.getPlayback).toHaveBeenCalledTimes(2);
    });
  });
});
