/**
 * Arrow-key focus movement, as a TV's D-pad gives it. Browsers only move focus with Tab, so this finds the
 * focusable element nearest in the pressed direction and focuses it; the browser scrolls it into view.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const FOCUSABLE = '[tabindex]:not([tabindex="-1"]), button:not([disabled]), input:not([disabled]), textarea, select, a[href]';

/**
 * Picks the best box in `direction` from `from`: it must lie beyond `from`'s centre that way, and the score
 * favours a short step along the direction and, much more, staying in line (overlapping on the other axis),
 * so Down from a card lands on the row below rather than a far-off card that is barely lower.
 */
export function pickNearest(from: Box, candidates: Box[], direction: Direction): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((box, index) => {
    const bx = (box.left + box.right) / 2;
    const by = (box.top + box.bottom) / 2;
    let along: number;
    let across: number;
    switch (direction) {
      case 'right':
        if (bx <= cx + 1 || box.left < from.left + 1) {
          return;
        }
        along = Math.max(0, box.left - from.right);
        across = gap(from.top, from.bottom, box.top, box.bottom);
        break;
      case 'left':
        if (bx >= cx - 1 || box.right > from.right - 1) {
          return;
        }
        along = Math.max(0, from.left - box.right);
        across = gap(from.top, from.bottom, box.top, box.bottom);
        break;
      case 'down':
        if (by <= cy + 1 || box.top < from.top + 1) {
          return;
        }
        along = Math.max(0, box.top - from.bottom);
        across = gap(from.left, from.right, box.left, box.right);
        break;
      case 'up':
        if (by >= cy - 1 || box.bottom > from.bottom - 1) {
          return;
        }
        along = Math.max(0, from.top - box.bottom);
        across = gap(from.left, from.right, box.left, box.right);
        break;
    }
    // Among boxes in line, the nearer centre wins ties (a row of cards under a wide button).
    const centreOffset = direction === 'left' || direction === 'right' ? Math.abs(by - cy) : Math.abs(bx - cx);
    const score = along + across * 4 + centreOffset * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

/** How far apart two ranges are on one axis; 0 when they overlap. */
function gap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  if (bEnd < aStart) {
    return aStart - bEnd;
  }
  if (bStart > aEnd) {
    return bStart - aEnd;
  }
  return 0;
}

function focusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]')) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  });
}

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Moves focus one step. With nothing focused yet, the top-left control takes focus. True when focus moved. */
export function moveFocus(direction: Direction): boolean {
  const current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const elements = focusableElements().filter(el => el !== current);
  if (elements.length === 0) {
    return false;
  }
  if (!current) {
    const first = elements.reduce((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.top < ra.top - 1 || (Math.abs(rb.top - ra.top) <= 1 && rb.left < ra.left) ? b : a;
    });
    first.focus();
    return true;
  }
  const index = pickNearest(boxOf(current), elements.map(boxOf), direction);
  if (index < 0) {
    return false;
  }
  elements[index].focus();
  return true;
}
