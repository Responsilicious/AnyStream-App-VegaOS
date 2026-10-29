/**
 * hls.js asks MediaSource.isTypeSupported about mp3 and ac-3 before it demuxes a segment. On Vega the
 * native audio decoder query throws (InvalidOperationError) for codecs the device cannot decode instead
 * of answering false, which kills the stream as a fatal internal exception. Browsers answer false.
 */
type SupportFn = (type: string) => boolean;
type MseTarget = { MediaSource?: { isTypeSupported?: SupportFn } & Record<string, unknown> };

export function installTypeSupportGuard(target: MseTarget = globalThis as unknown as MseTarget): void {
  const mediaSource = target.MediaSource;
  const real = mediaSource?.isTypeSupported;
  if (!mediaSource || typeof real !== 'function' || mediaSource.__typeSupportGuarded) {
    return;
  }
  mediaSource.__typeSupportGuarded = true;
  mediaSource.isTypeSupported = (type: string) => {
    try {
      return real.call(mediaSource, type);
    } catch (e) {
      console.log(`mseGuard: isTypeSupported(${type}) threw, answering false: ${String(e)}`);
      return false;
    }
  };
}
