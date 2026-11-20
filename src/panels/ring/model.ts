/**
 * The pure part of the ring panel: its content schema, and the questions the view, the lint and
 * the tests ask of a state: who owns a key, who holds its replicas, which arc each token owns,
 * how much of the ring each node owns, and what a call changed. No React, no CSS.
 *
 * The rules (the same as the ones Dynamo-style stores describe):
 *   - The hash space is the integers `0..size-1`, drawn clockwise from the top, and it wraps.
 *   - A node has one or more tokens (virtual nodes). A token owns the arc that ends at it: the
 *     positions after the previous token, up to and including its own.
 *   - A key belongs to the first token at or after its position, going clockwise.
 *   - The preference list of a key is its owner and then the next distinct nodes, skipping any
 *     further token of a node already listed: `replication` nodes in all.
 *   - A node that is `down` is skipped: the key's owner and replicas are the first `replication`
 *     healthy nodes along the walk (a sloppy quorum: the stand-in holds a hint for the node that
 *     is down). `suspect` is not skipped. Hint replay is not modelled.
 */
import { z } from 'zod';
import {
  IdSchema,
  own,
  reduceElements,
  type Effect,
  type ElementsState,
  type EntityDecl,
} from '../../core';
import { TONES } from '../_shared/changes';

export const NODE_STATES = ['up', 'suspect', 'down'] as const;
export type NodeState = (typeof NODE_STATES)[number];

export const RingContent = z.strictObject({
  /** The size of the hash space: positions are the integers 0 to size - 1, and 0 follows size - 1. */
  size: z.number().int().min(2),
  /** How many nodes hold each key: its owner and the next replication - 1 distinct nodes. */
  replication: z.number().int().min(1).default(1),
  nodes: z
    .array(
      z.strictObject({
        id: IdSchema,
        label: z.string().optional(),
        /** One position per token (virtual node). The element id of the n-th is `node.n`, from 0. */
        positions: z.array(z.number()).min(1),
        /** up, suspect or down. A down node is skipped when owners and replicas are chosen. */
        state: z.enum(NODE_STATES).default('up'),
        tone: z.enum(TONES).optional(),
        initial: z.boolean().optional(),
      }),
    )
    .min(1),
  keys: z
    .array(
      z.strictObject({
        id: IdSchema,
        /** Where the key hashes to: an integer from 0 to size - 1. */
        at: z.number(),
        label: z.string().optional(),
        tone: z.enum(TONES).optional(),
        initial: z.boolean().optional(),
      }),
    )
    .default([]),
  /** Whether nodes and keys are present before the first call. */
  initial: z.boolean().default(true),
});
export type RingContent = z.infer<typeof RingContent>;
export type NodeDecl = RingContent['nodes'][number];
export type KeyDecl = RingContent['keys'][number];

export const NODE_FIELDS = ['state', 'label', 'tone'] as const;
export const TOKEN_FIELDS = ['at', 'tone'] as const;
export const KEY_FIELDS = ['at', 'label', 'tone'] as const;

export const tokenId = (node: string, index: number) => `${node}.${index}`;

export function entitiesOf(content: RingContent): EntityDecl[] {
  const initial = (own1: boolean | undefined) => own1 ?? content.initial;
  const nodeLabel = (node: NodeDecl) => node.label ?? node.id;
  return [
    ...content.nodes.flatMap((node) => [
      { id: node.id, label: nodeLabel(node), initial: initial(node.initial) },
      // A token is always declared; it is drawn only while its node is in the ring.
      ...node.positions.map((_, index) => ({
        id: tokenId(node.id, index),
        label: `${nodeLabel(node)} token ${index + 1}`,
        initial: true,
      })),
    ]),
    ...content.keys.map((key) => ({
      id: key.id,
      label: key.label ?? key.id,
      initial: initial(key.initial),
    })),
  ];
}

/** What a ring is worked out from: which elements are present and what updates changed. */
export type Snapshot = Pick<ElementsState, 'present' | 'patches'>;

/** Elements state, and the state as it was before the call that is current began. */
export interface RingState extends ElementsState {
  before: (Snapshot & { call: string }) | undefined;
}

export const init = (entities: EntityDecl[]): RingState => ({
  present: entities.filter((entity) => entity.initial).map((entity) => entity.id),
  patches: {},
  focus: undefined,
  before: undefined,
});

/**
 * The reducer: the shared one, a note of the state at the start of each call (so the view can
 * say what the call changed), and a node that leaves takes the moved tokens with it.
 */
export function reduce(state: RingState, effect: Effect, call: { id: string }): RingState {
  const started: RingState =
    state.before?.call === call.id
      ? state
      : { ...state, before: { call: call.id, present: state.present, patches: state.patches } };
  const next: RingState = { ...started, ...reduceElements(started, effect) };
  if (effect.remove === undefined) return next;
  // Ids with a dot are derived: `node.n` is a token of `node`.
  const prefix = `${effect.remove}.`;
  return {
    ...next,
    patches: Object.fromEntries(
      Object.entries(next.patches).filter(([id]) => !id.startsWith(prefix)),
    ),
  };
}

// ---- the ring at one moment -------------------------------------------------------------------

export interface RingNode {
  id: string;
  label: string;
  /** Declared order: stable, so a node keeps its colour and its place in the legend. */
  order: number;
  present: boolean;
  state: NodeState;
}

export interface Token {
  id: string;
  node: string;
  index: number;
  at: number;
}

export interface Ring {
  size: number;
  replication: number;
  nodes: RingNode[];
  /** The tokens of the nodes that are in the ring, by position. */
  tokens: Token[];
}

const isState = (value: unknown): value is NodeState =>
  (NODE_STATES as readonly unknown[]).includes(value);

export function ringOf(content: RingContent, snapshot: Snapshot): Ring {
  const present = new Set(snapshot.present);
  const nodes = content.nodes.map((node, order): RingNode => {
    const patched = own(snapshot.patches, node.id)?.state;
    const patchedLabel = own(snapshot.patches, node.id)?.label;
    return {
      id: node.id,
      label: typeof patchedLabel === 'string' ? patchedLabel : (node.label ?? node.id),
      order,
      present: present.has(node.id),
      state: isState(patched) ? patched : node.state,
    };
  });
  const tokens: Token[] = [];
  content.nodes.forEach((node, order) => {
    if (!nodes[order]!.present) return;
    node.positions.forEach((declared, index) => {
      const id = tokenId(node.id, index);
      const patched = own(snapshot.patches, id)?.at;
      tokens.push({
        id,
        node: node.id,
        index,
        at: typeof patched === 'number' ? patched : declared,
      });
    });
  });
  tokens.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return { size: content.size, replication: content.replication, nodes, tokens };
}

export function keyAt(key: KeyDecl, snapshot: Snapshot): number {
  const patched = own(snapshot.patches, key.id)?.at;
  return typeof patched === 'number' ? patched : key.at;
}

export const healthy = (ring: Ring, nodeId: string) =>
  ring.nodes.find((node) => node.id === nodeId)?.state !== 'down';

// ---- who owns a key ---------------------------------------------------------------------------

export interface Visit {
  token: Token;
  /**
   * owner / replica: the node holds the key. skipped: the node is down. again: a further token
   * of a node that was already visited.
   */
  role: 'owner' | 'replica' | 'skipped' | 'again';
}

export interface Placement {
  at: number;
  /** The first healthy node at or after the key, or undefined when none is healthy. */
  owner: string | undefined;
  /** The next distinct healthy nodes: `replication - 1` of them, fewer if the ring is short. */
  replicas: string[];
  /** The tokens passed on the way, from the key to the last replica. */
  walk: Visit[];
  /** The first `replication` distinct nodes whatever their state: Dynamo's preference list. */
  preference: string[];
  /** True when a down node was skipped, so a stand-in holds the key for it. */
  hinted: boolean;
}

/** Where a key at `at` goes: a clockwise walk from the key, token by token. */
export function place(ring: Ring, at: number): Placement {
  const { tokens, replication } = ring;
  if (tokens.length === 0) {
    return { at, owner: undefined, replicas: [], walk: [], preference: [], hinted: false };
  }
  let start = tokens.findIndex((token) => token.at >= at);
  if (start === -1) start = 0;

  const chosen: string[] = [];
  const seen = new Set<string>();
  const preference: string[] = [];
  const walk: Visit[] = [];
  for (let step = 0; step < tokens.length; step += 1) {
    const token = tokens[(start + step) % tokens.length]!;
    if (preference.length < replication && !preference.includes(token.node)) {
      preference.push(token.node);
    }
    if (chosen.length >= replication) {
      // The walk is over; only the preference list is still being filled.
      if (preference.length >= replication) break;
      continue;
    }
    if (seen.has(token.node)) {
      walk.push({ token, role: 'again' });
    } else {
      seen.add(token.node);
      if (healthy(ring, token.node)) {
        chosen.push(token.node);
        walk.push({ token, role: chosen.length === 1 ? 'owner' : 'replica' });
      } else {
        walk.push({ token, role: 'skipped' });
      }
    }
  }
  // The walk ends at the last node that holds the key.
  let last = walk.length;
  while (last > 0 && !['owner', 'replica'].includes(walk[last - 1]!.role)) last -= 1;
  return {
    at,
    owner: chosen[0],
    replicas: chosen.slice(1),
    walk: chosen.length === 0 ? walk : walk.slice(0, last),
    preference,
    hinted: walk.some((visit) => visit.role === 'skipped'),
  };
}

/** Every node that holds the key: the owner first. */
export const holders = (placement: Placement): string[] =>
  placement.owner === undefined ? [] : [placement.owner, ...placement.replicas];

// ---- the arcs ---------------------------------------------------------------------------------

export interface Arc {
  token: Token;
  /** The arc runs clockwise from `from` (exclusive) to `to` (inclusive); `from` may be below 0. */
  from: number;
  to: number;
  length: number;
  /** The node that serves the arc now: the first healthy node from this token on. */
  owner: string | undefined;
  /** The node that holds the arc's token. It differs from `owner` while that node is down. */
  home: string;
}

export function arcsOf(ring: Ring): Arc[] {
  const { tokens, size } = ring;
  return tokens.map((token, index) => {
    const previous = tokens[(index - 1 + tokens.length) % tokens.length]!;
    const from =
      tokens.length === 1 ? token.at - size : index === 0 ? previous.at - size : previous.at;
    let owner: string | undefined;
    for (let step = 0; step < tokens.length; step += 1) {
      const candidate = tokens[(index + step) % tokens.length]!;
      if (healthy(ring, candidate.node)) {
        owner = candidate.node;
        break;
      }
    }
    return { token, from, to: token.at, length: token.at - from, owner, home: token.node };
  });
}

/** How much of the ring each node serves, as a fraction of its size. */
export function shares(ring: Ring): Map<string, number> {
  const out = new Map<string, number>(ring.nodes.map((node) => [node.id, 0]));
  for (const arc of arcsOf(ring)) {
    if (arc.owner !== undefined)
      out.set(arc.owner, (out.get(arc.owner) ?? 0) + arc.length / ring.size);
  }
  return out;
}

// ---- what a call changed ----------------------------------------------------------------------

export interface Change {
  key: string;
  /** owner: the node that serves the key changed. replicas: only the other holders changed. */
  kind: 'owner' | 'replicas';
  from: Placement;
  to: Placement;
}

/** The keys that are in the ring both before and after, and whose owner or replica set differs. */
export function changesOf(content: RingContent, before: Snapshot, after: Snapshot): Change[] {
  const was = ringOf(content, before);
  const now = ringOf(content, after);
  const changes: Change[] = [];
  for (const key of content.keys) {
    if (!before.present.includes(key.id) || !after.present.includes(key.id)) continue;
    const from = place(was, keyAt(key, before));
    const to = place(now, keyAt(key, after));
    if (from.owner !== to.owner) {
      changes.push({ key: key.id, kind: 'owner', from, to });
    } else if ([...holders(from)].sort().join() !== [...holders(to)].sort().join()) {
      changes.push({ key: key.id, kind: 'replicas', from, to });
    }
  }
  return changes;
}

/**
 * The stretches of the ring whose owner changed, as clockwise spans (from, to] in positions, so
 * the reader sees the arc that changed hands and not only the keys in it.
 */
export function changedSpans(
  content: RingContent,
  before: Snapshot,
  after: Snapshot,
): { from: number; to: number }[] {
  const was = ringOf(content, before);
  const now = ringOf(content, after);
  const points = [
    ...new Set([0, ...was.tokens.map((t) => t.at), ...now.tokens.map((t) => t.at), content.size]),
  ].sort((a, b) => a - b);
  const spans: { from: number; to: number }[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index]!;
    if (place(was, to % content.size).owner === place(now, to % content.size).owner) continue;
    const last = spans.at(-1);
    if (last !== undefined && last.to === points[index - 1]) last.to = to;
    else spans.push({ from: points[index - 1]!, to });
  }
  return spans;
}

// ---- problems the lint and the card both want -------------------------------------------------

/** Tokens that share a position: ownership of the arc between them is not defined. */
export function duplicatePositions(ring: Ring): Token[][] {
  const groups = new Map<number, Token[]>();
  for (const token of ring.tokens) groups.set(token.at, [...(groups.get(token.at) ?? []), token]);
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Whether `value` is a position in the space: an integer from 0 to size - 1. */
export const isPosition = (size: number, value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < size;

// ---- drawing helpers that are worth testing ---------------------------------------------------

/**
 * Angles (degrees, clockwise from the top) moved apart so that neighbours are at least `gap`
 * apart, going round the circle. Returns the new angle of each input, in input order. When the
 * labels cannot all fit (n * gap > 360) the angles are returned unchanged.
 */
export function spreadAngles(angles: number[], gap: number): number[] {
  const n = angles.length;
  if (n < 2 || n * gap > 360) return [...angles];
  const order = angles.map((_, index) => index).sort((a, b) => angles[a]! - angles[b]!);
  const work = order.map((index) => angles[index]!);
  for (let pass = 0; pass < 200; pass += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const next = j === 0 ? work[j]! + 360 : work[j]!;
      const space = next - work[i]!;
      if (space < gap - 1e-9) {
        const push = (gap - space) / 2;
        work[i] = work[i]! - push;
        work[j] = work[j]! + push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const out = [...angles];
  order.forEach((index, position) => {
    out[index] = work[position]!;
  });
  return out;
}

/** Levels (0 or 1) for marks on a track so that marks closer than `gap` degrees alternate. */
export function levels(angles: number[], gap: number): number[] {
  const order = angles.map((_, index) => index).sort((a, b) => angles[a]! - angles[b]!);
  const out = new Array<number>(angles.length).fill(0);
  let previous: number | undefined;
  for (const index of order) {
    if (previous !== undefined && angles[index]! - angles[previous]! < gap) {
      out[index] = out[previous] === 0 ? 1 : 0;
    }
    previous = index;
  }
  return out;
}

export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
