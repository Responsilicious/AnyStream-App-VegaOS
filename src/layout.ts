import { Dimensions, useWindowDimensions } from 'react-native';

/** The design in docs/design.md is drawn at 1920 × 1080. */
export const DESIGN_WIDTH = 1920;

/** Layout units per design pixel for a window this wide. */
export function designScale(windowWidth: number): number {
  return windowWidth > 0 ? windowWidth / DESIGN_WIDTH : 1;
}

/** The window never changes size on a TV, so it is read once; every size in the app goes through this. */
const SCALE = designScale(Dimensions.get('window').width);

/**
 * Design pixels to layout units. Use it for every size, text included, so the screen keeps its proportions
 * whether the platform reports the window as 1920 wide, 960 (a 2x density) or anything else.
 */
export function px(designPx: number): number {
  return Math.max(1, Math.round(designPx * SCALE));
}

/** The same conversion as a hook, for sizes worked out inside a component. */
export function useScale(): (designPx: number) => number {
  const { width } = useWindowDimensions();
  const k = designScale(width);
  return designPx => Math.max(1, Math.round(designPx * k));
}

/** What the window reports, for the start-up log: the first thing to check when sizes look wrong. */
export function describeWindow(): string {
  const window = Dimensions.get('window');
  const screen = Dimensions.get('screen');
  return (
    `window ${window.width}x${window.height} scale ${window.scale} fontScale ${window.fontScale}; ` +
    `screen ${screen.width}x${screen.height}; design scale ${SCALE.toFixed(3)}`
  );
}
