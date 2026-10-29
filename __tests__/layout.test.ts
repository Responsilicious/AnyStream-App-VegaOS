jest.mock(
  'react-native',
  () => ({
    useWindowDimensions: () => ({ width: 1920, height: 1080 }),
    Dimensions: { get: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }) },
  }),
  { virtual: true },
);

import { DESIGN_WIDTH, designScale, describeWindow, px } from '../src/layout';

describe('designScale', () => {
  it('is 1 at the design width and scales with the window', () => {
    expect(designScale(DESIGN_WIDTH)).toBe(1);
    expect(designScale(960)).toBe(0.5);
    expect(designScale(3840)).toBe(2);
  });

  it('falls back to 1 for a zero or missing width', () => {
    expect(designScale(0)).toBe(1);
  });
});

describe('px and describeWindow', () => {
  it('leaves design pixels alone at the design width', () => {
    expect(px(96)).toBe(96);
    expect(px(28)).toBe(28);
  });

  it('never returns less than one unit', () => {
    expect(px(0)).toBe(1);
  });

  it('reports the window, screen and scale for the start-up log', () => {
    expect(describeWindow()).toBe('window 1920x1080 scale 1 fontScale 1; screen 1920x1080; design scale 1.000');
  });
});
