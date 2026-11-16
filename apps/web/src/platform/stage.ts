/**
 * The shared screens are laid out for a 1920 × 1080 TV (docs/design.md) and read the window size once, at
 * start-up. A browser window is any size and changes, so the app renders into a fixed 1920 × 1080 stage that
 * is scaled to fit the window and centred (letterboxed when the window is not 16:9). The app always sees a
 * 1920-wide window, so every design pixel is one layout pixel, and resizing never needs a reload.
 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/** What `Dimensions` and `useWindowDimensions` report to the app. */
export const STAGE_METRICS = { width: STAGE_WIDTH, height: STAGE_HEIGHT, scale: 1, fontScale: 1 };

/** The largest scale at which the stage fits the window. */
export function stageScale(windowWidth: number, windowHeight: number): number {
  if (windowWidth <= 0 || windowHeight <= 0) {
    return 1;
  }
  return Math.min(windowWidth / STAGE_WIDTH, windowHeight / STAGE_HEIGHT);
}

/** Sizes and centres `stage` inside the window, now and whenever the window changes size. */
export function fitStage(stage: HTMLElement): void {
  const fit = () => {
    const k = stageScale(window.innerWidth, window.innerHeight);
    stage.style.width = `${STAGE_WIDTH}px`;
    stage.style.height = `${STAGE_HEIGHT}px`;
    stage.style.left = `${(window.innerWidth - STAGE_WIDTH * k) / 2}px`;
    stage.style.top = `${(window.innerHeight - STAGE_HEIGHT * k) / 2}px`;
    stage.style.transform = `scale(${k})`;
  };
  fit();
  window.addEventListener('resize', fit);
}
