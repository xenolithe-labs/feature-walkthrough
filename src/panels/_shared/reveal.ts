/**
 * Keeping what a call is about in view. A pane with a fixed height scrolls when its
 * content is taller or wider than the pane; the element a call touches may then be
 * out of sight. These helpers bring it back without moving the page.
 */
import { useEffect, useRef } from 'react';

/** The id the shell gives to the slides it starts (see shell/motion.ts). */
export const SLIDE = 'fw-slide';

/** Stops every slide under `root` where it is going. */
export function cancelSlides(root: HTMLElement): void {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation.id === SLIDE) animation.cancel();
  }
}

/**
 * Runs `measure` as if every slide under `box` had finished, then puts them back: a reader who
 * steps with motion on is scrolled to the same place as one who steps with it off.
 */
function atRest<T>(box: HTMLElement, measure: () => T): T {
  const slides = box.getAnimations({ subtree: true }).filter((item) => item.id === SLIDE);
  const times = slides.map((item) => item.currentTime);
  for (const item of slides) {
    item.pause();
    item.currentTime = item.effect?.getComputedTiming().endTime ?? 0;
  }
  try {
    return measure();
  } finally {
    slides.forEach((item, index) => {
      item.currentTime = times[index] ?? 0;
      item.play();
    });
  }
}

/** One axis: where the visible window is and where the item is, in the same units. */
export interface Span {
  start: number;
  size: number;
}

/**
 * The scroll position that makes `item` visible inside a window of `size` that is now
 * scrolled to `scroll`, or `undefined` when it is already fully visible. An item that fits
 * is centred; one that does not fit is aligned to the start. `inset` is space at the start
 * of the window that something else (a sticky header) covers.
 */
export function revealScroll(
  view: { scroll: number; size: number; inset?: number },
  item: Span,
  margin = 8,
): number | undefined {
  const inset = view.inset ?? 0;
  const top = view.scroll + inset;
  const room = view.size - inset;
  if (item.start >= top && item.start + item.size <= top + room) return undefined;
  if (item.size + margin * 2 > room) return Math.max(0, item.start - inset - margin);
  return Math.max(0, item.start - inset - (room - item.size) / 2);
}

/** Marks that mean a call touched the element. */
export const TOUCHED_SELECTOR = [
  '[data-mark="added"]',
  '[data-mark="updated"]',
  '[data-mark="read"]',
  '[data-mark="removed"]',
].join(',');

/**
 * Returns a ref for a scrolling element. Whenever `key` changes (the call, normally) the
 * first element inside it that the call touched is scrolled into view, on both axes.
 * `inset` selects a sticky header that covers the top of the window.
 */
export function useRevealTouched<T extends HTMLElement>(
  key: unknown,
  options: { inset?: string } = {},
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const { inset } = options;
  useEffect(() => {
    const box = ref.current;
    if (box === null) return;
    const target = box.querySelector<HTMLElement>(TOUCHED_SELECTOR);
    if (target === null) return;
    atRest(box, () => {
      const frame = box.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const covered =
        inset === undefined ? 0 : (box.querySelector(inset)?.getBoundingClientRect().height ?? 0);
      const y = revealScroll(
        { scroll: box.scrollTop, size: box.clientHeight, inset: covered },
        { start: rect.top - frame.top + box.scrollTop, size: rect.height },
      );
      if (y !== undefined) box.scrollTop = y;
      const x = revealScroll(
        { scroll: box.scrollLeft, size: box.clientWidth },
        { start: rect.left - frame.left + box.scrollLeft, size: rect.width },
      );
      if (x !== undefined) box.scrollLeft = x;
    });
  }, [key, inset]);
  return ref;
}
