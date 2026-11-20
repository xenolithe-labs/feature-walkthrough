import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cancelSlides, SLIDE } from '../panels/_shared/reveal';

/**
 * Motion helps the eye follow one change: from the call before to this one. It is never the only
 * carrier of meaning and every call looks the same at rest. Most of it is CSS (motion.css), keyed
 * on `data-motion` and `data-moving` on the root. This file does the part CSS cannot: an element
 * that sits in a grid cell, such as an array pointer, or that is placed along a line, such as the
 * "now" marker, has no style change to transition. It is measured before and after, and slid from
 * where it was (the FLIP technique, with the Web Animations API).
 */
const MOVERS = [
  '.fw-array-pointer',
  '.fw-array-range',
  '.fw-by-cursor',
  '.fw-bus-cursor',
  '.fw-tree-row',
  '.fw-tl-now',
  '.fw-tl-nowline',
  '.fw-tl-future',
  '.fw-tl-span',
].join(', ');
/** Things that grow and shrink as well as move. */
const STRETCHY = '.fw-array-range, .fw-tl-span, .fw-tl-future';
const DURATION_MS = 220;
/** Steps closer together than this snap. It keeps fast stepping instant and nothing flashes. */
const CALM_MS = 350;
const MOST_MEASURED = 400;

type Box = { x: number; y: number; w: number; h: number };

function keyOf(node: HTMLElement): string {
  const pane = node.closest<HTMLElement>('[data-pane]')?.dataset.pane ?? '';
  return `${pane}/${node.dataset.entity ?? node.classList[0] ?? ''}`;
}

/** Where every mover is, relative to the shell, at rest. */
function measure(root: HTMLElement): Map<string, Box> {
  cancelSlides(root);
  const boxes = new Map<string, Box>();
  const nodes = root.querySelectorAll<HTMLElement>(MOVERS);
  if (nodes.length > MOST_MEASURED) return boxes;
  const origin = root.getBoundingClientRect();
  for (const node of nodes) {
    if (node.classList.contains('is-absent')) continue;
    const rect = node.getBoundingClientRect();
    boxes.set(keyOf(node), {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      w: rect.width,
      h: rect.height,
    });
  }
  return boxes;
}

function slide(root: HTMLElement, before: Map<string, Box>): void {
  const after = measure(root);
  for (const node of root.querySelectorAll<HTMLElement>(MOVERS)) {
    const key = keyOf(node);
    const from = before.get(key);
    const to = after.get(key);
    if (from === undefined || to === undefined) continue;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const stretch = node.matches(STRETCHY) && to.w > 0;
    const sx = stretch ? from.w / to.w : 1;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
    const timing = { id: SLIDE, duration: DURATION_MS, easing: 'ease-out' };
    node.animate(
      {
        // `transform`, because some panels centre an element with the `translate` property.
        transform: [`translate(${dx}px, ${dy}px) scale(${sx}, 1)`, 'none'],
        transformOrigin: ['0 0', '0 0'],
      },
      timing,
    );
    // The label inside a bracket that grows keeps its shape.
    if (sx !== 1) {
      node.firstElementChild?.animate(
        { transform: [`scale(${1 / sx}, 1)`, 'none'], transformOrigin: ['0 0', '0 0'] },
        timing,
      );
    }
  }
}

type Memory = {
  current: {
    time: number;
    tick: number;
    before: { at: number; boxes: Map<string, Box> } | undefined;
  };
};

/** Decides whether the step from `at` to `to` animates, and keeps the boxes it slides from. */
function start(
  memory: Memory,
  root: RefObject<HTMLElement | null>,
  on: boolean,
  at: number,
  to: number,
): 'a' | 'b' | undefined {
  const mem = memory.current;
  const now = performance.now();
  const calm = now - mem.time >= CALM_MS;
  mem.time = now;
  mem.before = undefined;
  const element = root.current;
  if (!on || !calm || element === null || Math.abs(to - at) !== 1) return undefined;
  mem.tick ^= 1;
  mem.before = { at: to, boxes: measure(element) };
  return mem.tick === 1 ? 'a' : 'b';
}

/**
 * Whether this step animates, and the slide of what moved. `begin(to)` is called by whatever
 * changes the cursor, just before it does, while the page still shows the call before. When
 * motion is on and `to` is the call next to this one, the root gets `moving` ("a" or "b",
 * alternating so that CSS animations start again) in the same render as the new call. In a hurry,
 * after a jump, or with motion off there is no `moving`: the next call just appears. A change that
 * does not come through `begin` (the address edited by hand) also just appears.
 */
export function useStepMotion(
  root: RefObject<HTMLElement | null>,
  on: boolean,
  scope: string,
  at: number,
): { moving: 'a' | 'b' | undefined; begin(to: number): void } {
  const memory = useRef<Memory['current']>({ time: 0, tick: 0, before: undefined });
  const [mark, setMark] = useState<{ scope: string; at: number; tick: 'a' | 'b' } | undefined>();
  const moving = on && mark?.scope === scope && mark.at === at ? mark.tick : undefined;
  // The step is over a moment after it ends. Remounting panels later (another view, a pinned
  // pane) then does not play it again.
  useEffect(() => {
    if (mark === undefined) return;
    const timer = window.setTimeout(() => setMark(undefined), DURATION_MS + 60);
    return () => window.clearTimeout(timer);
  }, [mark]);

  const begin = useCallback(
    (to: number) => {
      const tick = start(memory, root, on, at, to);
      setMark(tick === undefined ? undefined : { scope, at: to, tick });
    },
    [on, root, scope, at],
  );

  useLayoutEffect(() => {
    const element = root.current;
    const mem = memory.current;
    if (element === null) return;
    const before = mem.before?.at === at ? mem.before.boxes : undefined;
    mem.before = undefined;
    if (moving === undefined || before === undefined) cancelSlides(element);
    else slide(element, before);
  }, [root, moving, at]);

  return { moving, begin };
}

const CONTROLS = 'button, a, input, select, textarea, summary, [role], [contenteditable="true"]';
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

interface PlayOptions {
  /** Whether Play is on offer at all. */
  enabled: boolean;
  /** Where the reader is, counted from the first call. Changes whenever the call does. */
  at: number;
  atEnd: boolean;
  delay: number;
  /** Whether the call after the next one is the last: Play stops on it. */
  lastNext: boolean;
  advance(): void;
  restart(): void;
}

/**
 * Steps on its own, one call at a time. It holds while the pointer or focus is in the panes or the
 * card, and stops on any key or click (the Play button aside), when the tab is hidden and at the
 * last call. Space starts and stops it when focus is not in a control.
 */
export function usePlay({ enabled, at, atEnd, delay, lastNext, advance, restart }: PlayOptions) {
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState('');
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const on = playing && enabled;
  const held = hover || focus;

  const stop = useCallback(() => {
    setPlaying(false);
    setNote((was) => (was === 'Playback started' ? 'Playback stopped' : was));
  }, []);
  const toggle = useCallback(() => {
    if (on) return stop();
    if (atEnd) restart();
    setNote('Playback started');
    setPlaying(true);
  }, [on, atEnd, stop, restart]);

  useEffect(() => {
    if (!on || held) return;
    const timer = window.setTimeout(() => {
      advance();
      if (lastNext) stop();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [on, held, delay, lastNext, advance, stop, at]);

  // The listeners below are added once, not on every render: a listener replaced while a key is
  // being delivered (by the shell's own handler moving the call) would never hear that key.
  const latest = useRef(toggle);
  useLayoutEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    if (!enabled) return;
    const inPlay = (target: EventTarget | null) =>
      target instanceof Element && target.closest('.fw-play') !== null;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      // On the button, Space and Enter press it. Every other key is "any key", and the speed
      // choice is the reader's to move through with the arrow keys.
      if (target instanceof Element && target.closest('.fw-play select')) return;
      if (
        (event.key === ' ' || event.key === 'Enter') &&
        target instanceof Element &&
        target.closest('.fw-play-button')
      ) {
        return;
      }
      if (event.key === ' ' && !(target instanceof Element && target.closest(CONTROLS))) {
        event.preventDefault();
        latest.current();
      } else if (!MODIFIERS.has(event.key)) {
        stop();
      }
    };
    const onPointer = (event: Event) => {
      if (!inPlay(event.target)) stop();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, stop]);

  return {
    playing: on,
    held,
    note,
    toggle,
    /** Spread on the element around the panes and the card. */
    holdProps: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: () => setFocus(true),
      onBlur: () => setFocus(false),
    },
  };
}
