import { useCallback, useRef } from 'react';
import type { ScrollView } from 'react-native';
import { px } from './layout';

interface Box {
  y: number;
  h: number;
}

/**
 * Keeps the focused row on screen in a vertical list of rows. The platform does not always scroll a row
 * into view by itself, and the last row used to sit half off the bottom.
 *
 * Give the ScrollView `scrollRef`, `onLayout` and `onScroll` (with `scrollEventThrottle`), give each row's
 * wrapper `measure(id)` as its onLayout, and call `ensureVisible(id)` when a card in that row gets focus.
 * The row named by `topId` scrolls all the way back up, so whatever sits above it (a preview, a title)
 * comes back into view, and the row named by `lastId` scrolls all the way down, so the padding under the
 * last row is on screen too. A TV can crop its edges (overscan), so rows keep a generous gap from the
 * bottom of the screen: at least the 54 design pixels of docs/design.md, plus room for the row's own text.
 */
export function useRowScroll(topId?: string, lastId?: string) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewHeight = useRef(0);
  const boxes = useRef<Record<string, Box>>({});

  const onLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => {
    viewHeight.current = event.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const measure = useCallback(
    (id: string) => (event: { nativeEvent: { layout: { y: number; height: number } } }) => {
      boxes.current[id] = { y: event.nativeEvent.layout.y, h: event.nativeEvent.layout.height };
    },
    [],
  );

  /** Forget measurements, for when the rows are rebuilt. */
  const reset = useCallback(() => {
    boxes.current = {};
    scrollY.current = 0;
  }, []);

  const ensureVisible = useCallback(
    (id: string) => {
      const box = boxes.current[id];
      if (!box || viewHeight.current === 0) {
        return;
      }
      const marginTop = px(24);
      const marginBottom = px(110);
      const top = scrollY.current;
      const bottom = top + viewHeight.current;
      let target: number | null = null;
      let toEnd = false;
      if (id === topId) {
        target = top > 0 ? 0 : null;
      } else if (id === lastId) {
        toEnd = true;
      } else if (box.y - marginTop < top) {
        target = Math.max(0, box.y - marginTop);
      } else if (box.y + box.h + marginBottom > bottom) {
        target = box.y + box.h + marginBottom - viewHeight.current;
      }
      // What the stick measures, for when a row still ends up off screen.
      console.log(
        `rowScroll ${id}: y=${Math.round(box.y)} h=${Math.round(box.h)} scrollY=${Math.round(top)} ` +
          `view=${Math.round(viewHeight.current)} -> ${toEnd ? 'end' : target === null ? 'stay' : Math.round(target)}`,
      );
      if (toEnd) {
        scrollRef.current?.scrollToEnd({ animated: true });
      } else if (target !== null) {
        scrollRef.current?.scrollTo({ y: target, animated: true });
      }
    },
    [topId, lastId],
  );

  return { scrollRef, onLayout, onScroll, measure, reset, ensureVisible };
}
