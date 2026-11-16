import { BackHandler, dispatchBack } from '../src/platform/back';
import { webCapabilities } from '../src/platform/capabilities';
import { browserName } from '../src/platform/device';
import { pickNearest, type Box } from '../src/platform/spatialNavigation';
import { stageScale } from '../src/platform/stage';

const box = (left: number, top: number, w = 100, h = 100): Box => ({ left, top, right: left + w, bottom: top + h });

describe('pickNearest (arrow-key focus)', () => {
  // A row of three cards, a wide button above, and a second row below.
  const from = box(200, 300);
  const candidates = [box(0, 300), box(400, 300), box(0, 0, 600, 60), box(150, 500), box(900, 450)];

  it('moves along a row', () => {
    expect(pickNearest(from, candidates, 'right')).toBe(1);
    expect(pickNearest(from, candidates, 'left')).toBe(0);
  });

  it('prefers the box in line over a nearer one off to the side', () => {
    expect(pickNearest(from, candidates, 'down')).toBe(3);
    expect(pickNearest(from, candidates, 'up')).toBe(2);
  });

  it('finds nothing past the edge', () => {
    expect(pickNearest(box(0, 0, 600, 60), [box(0, 300)], 'up')).toBe(-1);
    expect(pickNearest(box(400, 300), [box(0, 300), box(200, 300)], 'right')).toBe(-1);
  });
});

describe('webCapabilities', () => {
  it('keeps H.264 and AAC even if the browser answers no', () => {
    const caps = webCapabilities(() => false);
    expect(caps.videoCodecs).toEqual(['h264']);
    expect(caps.audioCodecs).toEqual(['aac']);
    expect(caps.hlsVideoCodecs).toEqual(['h264']);
    expect(caps.hlsAudioCodecs).toEqual(['aac']);
  });

  it('adds HEVC and Dolby audio only where the browser decodes them', () => {
    const caps = webCapabilities(type => /hvc1|ac-3|ec-3/.test(type));
    expect(caps.videoCodecs).toEqual(['h264', 'hevc']);
    expect(caps.hlsVideoCodecs).toEqual(['h264', 'hevc']);
    expect(caps.hlsAudioCodecs).toEqual(['aac', 'ac3', 'eac3']);
  });

  it('plays only MP4 directly, over http or https, and asks for HLS in fragmented MP4', () => {
    const caps = webCapabilities(() => true);
    expect(caps.directPlayContainers).toEqual(['mp4', 'm4v']);
    expect(caps.directPlayNeedsHttps).toBe(false);
    expect(caps.directPlayVideoCodecs).toBeUndefined();
    expect(caps.hlsContainer).toBe('mp4');
  });
});

describe('BackHandler', () => {
  it('asks the newest handler first and stops at the one that keeps the key', () => {
    const calls: string[] = [];
    const a = BackHandler.addEventListener('hardwareBackPress', () => {
      calls.push('a');
      return true;
    });
    const b = BackHandler.addEventListener('hardwareBackPress', () => {
      calls.push('b');
      return false;
    });
    expect(dispatchBack()).toBe(true);
    expect(calls).toEqual(['b', 'a']);
    a.remove();
    b.remove();
    expect(dispatchBack()).toBe(false);
  });
});

describe('browserName', () => {
  it('names the common browsers', () => {
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chrome');
    expect(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('Safari');
    expect(browserName('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox');
    expect(browserName('something else')).toBe('Web Browser');
  });
});

describe('stageScale', () => {
  it('fits 1920 x 1080 inside the window', () => {
    expect(stageScale(1920, 1080)).toBe(1);
    expect(stageScale(1280, 720)).toBeCloseTo(2 / 3);
    expect(stageScale(1000, 1000)).toBeCloseTo(1000 / 1920);
    expect(stageScale(0, 0)).toBe(1);
  });
});
