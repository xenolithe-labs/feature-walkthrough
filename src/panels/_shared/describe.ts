/**
 * Small helpers the panels' `describe` functions share: they turn what a pane holds into a few
 * short lines of text. Pure; no React.
 *
 * Conventions every `describe` follows: a value the call touched is written `>value<`, a named
 * thing it touched ends in `*`, a thing the call removed says "(removed)". Lines are short:
 * long lists end in "and n more".
 */
import { touched, type ElementsState, type Effect, type Touched } from '../../core';

/** Items a list line shows before it says "and n more". */
export const MOST = 10;

export interface Hit extends Touched {
  /** Any verb at all: the call marks this element. */
  has(id: string): boolean;
}

export function hitOf(current: readonly Effect[]): Hit {
  const base = touched([...current]);
  return {
    ...base,
    has: (id) =>
      base.added.has(id) || base.updated.has(id) || base.read.has(id) || base.removed.has(id),
  };
}

const NONE: ElementsState = { present: [], patches: {}, focus: undefined };

/** The element state of a pane, or an empty one when the state has another shape. */
export function elements(state: unknown): ElementsState {
  if (typeof state !== 'object' || state === null) return NONE;
  const { present, patches, focus } = state as Partial<ElementsState>;
  return {
    present: Array.isArray(present) ? present : [],
    patches: typeof patches === 'object' && patches !== null ? patches : {},
    focus: typeof focus === 'string' ? focus : undefined,
  };
}

export function clip(text: string, length = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** A scalar as it reads on screen; anything else as clipped JSON. */
export function show(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  if (typeof value === 'object' && value !== null) return clip(JSON.stringify(value), 40);
  return String(value);
}

/** `a, b, c and 2 more`. */
export function cap(items: readonly string[], limit = MOST): string {
  return items.length > limit
    ? `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`
    : items.join(', ');
}

/** A name with `*` after it when the call touched the element. */
export function starred(name: string, id: string, hit: Hit): string {
  return hit.has(id) ? `${name}*` : name;
}

/** A value, in `>...<` when the call touched what holds it. */
export function marked(value: string, on: boolean): string {
  return on ? `>${value}<` : value;
}

/**
 * Items that nest, as one line: `A[B, C*[D]]`. An item whose parent is not in the list is at the
 * top. `text` is what to write for each.
 */
export function nested(
  items: readonly { id: string; parent?: string | undefined; text: string }[],
): string {
  const ids = new Set(items.map((item) => item.id));
  const kids = new Map<string | undefined, typeof items>();
  for (const item of items) {
    const parent = item.parent !== undefined && ids.has(item.parent) ? item.parent : undefined;
    kids.set(parent, [...(kids.get(parent) ?? []), item]);
  }
  const seen = new Set<string>();
  const write = (parent: string | undefined): string[] =>
    (kids.get(parent) ?? []).flatMap((item) => {
      if (seen.has(item.id)) return [];
      seen.add(item.id);
      const inner = write(item.id);
      return [inner.length === 0 ? item.text : `${item.text}[${inner.join(', ')}]`];
    });
  return write(undefined).join(', ');
}
