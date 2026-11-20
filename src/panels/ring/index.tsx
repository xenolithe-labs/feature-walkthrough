/**
 * ring: a hash space drawn as a ring, for consistent hashing, partition ownership and replicas.
 *
 * Elements: a node (`add` joins, `remove` leaves, `update` with `fields.state` is up, suspect or
 * down), a token of a node (`node.0`, `node.1`, ...: `update` with `fields.at` moves it), and a
 * key (`add`, `read` is a lookup and draws the walk from the key to its owner and replicas).
 * Everything else is worked out and never written: who owns each key, the replica set, the arc
 * each token owns, each node's share of the ring, and which keys changed owner in the call.
 */
import { useId, useMemo, type KeyboardEvent } from 'react';
import { markOf, touched, type CardSection, type PanelContext, type PanelType } from '../../core';
import type { Effect } from '../../core';
import { changesSection, toneOf, uniqueLabels } from '../_shared/changes';
import { useWidth } from '../_shared/hooks';
import { lintRing } from './lint';
import {
  RingContent,
  arcsOf,
  changedSpans,
  changesOf,
  entitiesOf,
  holders,
  init,
  keyAt,
  levels,
  percent,
  place,
  reduce,
  ringOf,
  shares,
  spreadAngles,
  tokenId,
  type Arc,
  type Change,
  type Placement,
  type Ring,
  type RingNode,
  type RingState,
  type Snapshot,
  type Token,
} from './model';
import { describeRing } from './describe';
import './ring.css';

// ---- geometry: a 450 square, the ring in the middle, labels outside --------------------------

const VIEW_W = 450;
const VIEW_H = 372;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2;
const BAND_IN = 122;
const BAND_OUT = 138;
const DOT = 146;
const CHANGED = 158;
const LABEL = 164;
const KEY_LABEL = 84;
const KEY_R = [108, 95];
const WALK_R = 70;
const TAU = Math.PI * 2;
/** Labels need this many degrees between them. */
const LABEL_GAP = 13;
/** More tokens than this and only the ones a call or the reader points at are labelled. */
const LABEL_MAX = 24;
const COLOURS = 6;
const PATTERNS = 6;

const angle = (size: number, at: number) => (at / size) * TAU - Math.PI / 2;
const point = (radius: number, theta: number): [number, number] => [
  CX + radius * Math.cos(theta),
  CY + radius * Math.sin(theta),
];
const fmt = (value: number) => Number(value.toFixed(2));
const at2 = ([x, y]: [number, number]) => `${fmt(x)} ${fmt(y)}`;

/** A stroke along a circle, clockwise from a0 to a1. A full turn is drawn as two halves. */
function arcPath(radius: number, a0: number, a1: number): string {
  if (a1 - a0 >= TAU - 1e-6) {
    return `${arcPath(radius, a0, a0 + Math.PI)} ${arcPath(radius, a0 + Math.PI, a0 + TAU)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${at2(point(radius, a0))} A ${radius} ${radius} 0 ${large} 1 ${at2(point(radius, a1))}`;
}

/** The part of the band between two angles. */
function sector(a0: number, a1: number): string {
  if (a1 - a0 >= TAU - 1e-6) {
    return `${sector(a0, a0 + Math.PI)} ${sector(a0 + Math.PI, a0 + TAU)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${at2(point(BAND_OUT, a0))}`,
    `A ${BAND_OUT} ${BAND_OUT} 0 ${large} 1 ${at2(point(BAND_OUT, a1))}`,
    `L ${at2(point(BAND_IN, a1))}`,
    `A ${BAND_IN} ${BAND_IN} 0 ${large} 0 ${at2(point(BAND_IN, a0))} Z`,
  ].join(' ');
}

const colourOf = (order: number) => order % COLOURS;
const patternOf = (order: number) => (order + Math.floor(order / COLOURS)) % PATTERNS;

function keys(select: () => void) {
  return (event: KeyboardEvent<Element>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select();
    }
  };
}

/** A short label for the ring: long names are cut, and a node with several tokens counts them. */
function tokenLabel(node: RingNode, token: Token, tokensOfNode: number): string {
  const name = node.label.length > 7 ? `${node.label.slice(0, 6)}…` : node.label;
  return tokensOfNode > 1 ? `${name}·${token.index + 1}` : name;
}

// ---- the pattern fills ------------------------------------------------------------------------

function Defs({ uid }: { uid: string }) {
  const ink = { stroke: 'var(--fw-ring-ink)', strokeWidth: 1.1, fill: 'none' } as const;
  const shapes = [
    null,
    <path key="d" d="M-1 1 L1 -1 M0 6 L6 0 M5 7 L7 5" {...ink} />,
    <circle key="o" cx="3" cy="3" r="1.15" style={{ fill: 'var(--fw-ring-ink)' }} />,
    <path key="h" d="M0 3 L6 3" {...ink} />,
    <path key="v" d="M3 0 L3 6" {...ink} />,
    <path key="g" d="M0 3 L6 3 M3 0 L3 6" {...ink} />,
  ];
  return (
    <defs>
      {Array.from({ length: COLOURS * PATTERNS }, (_, order) => order).map((order) => {
        const colour = order % COLOURS;
        const pattern = Math.floor(order / COLOURS) % PATTERNS;
        // order here is colour + COLOURS * (pattern shift); see styleOf.
        return (
          <pattern
            key={order}
            id={`${uid}-p${order}`}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
          >
            <rect width="6" height="6" style={{ fill: `var(--fw-ring-c${colour})` }} />
            {shapes[pattern]}
          </pattern>
        );
      })}
      <marker
        id={`${uid}-arrow`}
        viewBox="0 0 8 8"
        refX="6"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L8 4 L0 8 Z" style={{ fill: 'var(--fw-ring-walk)' }} />
      </marker>
    </defs>
  );
}

/** The pattern id of a node: its colour and its pattern, which together are unique to 36 nodes. */
const fillId = (uid: string, order: number) =>
  `${uid}-p${colourOf(order) + COLOURS * patternOf(order)}`;

// ---- the panel --------------------------------------------------------------------------------

interface View {
  content: RingContent;
  state: RingState;
  ring: Ring;
  /** The ring before the call, when the call changed something in this pane. */
  before: Ring | undefined;
  snapshotBefore: Snapshot | undefined;
  uid: string;
  current: ReturnType<typeof touched>;
  selected: string | undefined;
  toggle(id: string): void;
  placements: Map<string, Placement>;
  changes: Map<string, Change>;
}

const present = (view: View, id: string) => view.state.present.includes(id);
const nodeLabel = (ring: Ring, id: string | undefined) =>
  id === undefined ? 'nobody' : (ring.nodes.find((node) => node.id === id)?.label ?? id);

function describePlacement(ring: Ring, placement: Placement): string {
  if (placement.owner === undefined) return 'no healthy node';
  const replicas = placement.replicas.map((id) => nodeLabel(ring, id));
  return replicas.length === 0
    ? `owner ${nodeLabel(ring, placement.owner)}`
    : `owner ${nodeLabel(ring, placement.owner)}, replicas ${replicas.join(', ')}`;
}

function RingSvg({ view, compact }: { view: View; compact: boolean }) {
  const { content, ring, uid, current } = view;
  const { size } = content;
  const arcs = useMemo(() => arcsOf(ring), [ring]);
  const tokenCount = (node: string) => ring.tokens.filter((token) => token.node === node).length;
  const nodeOf = (id: string) => ring.nodes.find((node) => node.id === id)!;
  const selectedNode =
    view.selected === undefined
      ? undefined
      : (ring.nodes.find(
          (node) => node.id === view.selected || view.selected?.startsWith(`${node.id}.`),
        )?.id ?? undefined);

  const emphasised = (token: Token) =>
    selectedNode === token.node ||
    [current.added, current.updated, current.read, current.removed].some(
      (set) => set.has(token.id) || set.has(token.node),
    );
  const labelled = ring.tokens.filter(
    (token) => (ring.tokens.length <= LABEL_MAX && !compact) || emphasised(token),
  );
  const labelAngles = spreadAngles(
    labelled.map((token) => (token.at / size) * 360),
    LABEL_GAP,
  );

  // Keys keep their track and level whether or not they are in the ring yet.
  const keyAngles = content.keys.map((key) => (keyAt(key, view.state) / size) * 360);
  const keyLevels = levels(keyAngles, 9);

  const walkKeys = content.keys.filter(
    (key) => present(view, key.id) && (current.read.has(key.id) || view.selected === key.id),
  );
  // The keys a call or the reader points at are named inside the ring, spread so they do not touch.
  const pointedKeys = content.keys.filter((key) => {
    if (!present(view, key.id)) return false;
    const mark = markOf(key.id, current);
    return (
      walkKeys.includes(key) ||
      view.selected === key.id ||
      view.changes.has(key.id) ||
      mark === 'added' ||
      mark === 'updated'
    );
  });
  const keyLabelAngles = spreadAngles(
    pointedKeys.map((key) => (keyAt(key, view.state) / size) * 360),
    10,
  );
  const spans = view.snapshotBefore ? changedSpans(content, view.snapshotBefore, view.state) : [];

  return (
    <svg
      className="fw-ring-svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`Hash ring of size ${size}`}
    >
      <Defs uid={uid} />

      <circle className="fw-ring-disc" cx={CX} cy={CY} r={BAND_IN} />

      {arcs.map((arc) => {
        if (arc.length <= 0 || arc.owner === undefined) return null;
        const order = nodeOf(arc.owner).order;
        const dim = selectedNode !== undefined && selectedNode !== arc.owner;
        const a0 = angle(size, arc.from);
        const a1 = angle(size, arc.to);
        return (
          <g
            key={arc.token.id}
            className={`fw-ring-arc${dim ? ' is-dim' : ''}${arc.owner !== arc.home ? ' is-hinted' : ''}`}
            data-owner={arc.owner}
            data-from={arc.from}
            data-to={arc.to}
            onClick={() => view.toggle(arc.owner!)}
          >
            <path d={sector(a0, a1)} style={{ fill: `url(#${fillId(uid, order)})` }} />
            {arc.owner !== arc.home && (
              <path className="fw-ring-hint" d={arcPath((BAND_IN + BAND_OUT) / 2, a0, a1)} />
            )}
          </g>
        );
      })}
      {ring.tokens.length === 0 && (
        <circle className="fw-ring-empty" cx={CX} cy={CY} r={(BAND_IN + BAND_OUT) / 2} />
      )}
      <circle className="fw-ring-edge" cx={CX} cy={CY} r={BAND_IN} />
      <circle className="fw-ring-edge" cx={CX} cy={CY} r={BAND_OUT} />
      {ring.tokens.map((token) => {
        const a = angle(size, token.at);
        return (
          <line
            key={token.id}
            className="fw-ring-sep"
            x1={fmt(point(BAND_IN, a)[0])}
            y1={fmt(point(BAND_IN, a)[1])}
            x2={fmt(point(BAND_OUT, a)[0])}
            y2={fmt(point(BAND_OUT, a)[1])}
          />
        );
      })}

      {spans.map((span, index) => (
        <path
          key={index}
          className="fw-ring-changed"
          d={arcPath(CHANGED, angle(size, span.from), angle(size, span.to))}
          data-span={`${span.from}-${span.to}`}
        />
      ))}

      {walkKeys.map((key) => {
        const placement = view.placements.get(key.id);
        if (placement === undefined || placement.walk.length === 0) return null;
        const index = content.keys.indexOf(key);
        const a0 = angle(size, placement.at);
        const last = placement.walk.at(-1)!.token.at;
        const length = (((last - placement.at) % size) + size) % size;
        const a1 = a0 + (length / size) * TAU;
        const from = point(KEY_R[keyLevels[index]!]!, a0);
        const start = point(WALK_R, a0);
        let rank = 0;
        return (
          <g key={key.id} className="fw-ring-walk" data-walk={key.id}>
            <line
              className="fw-ring-spoke"
              x1={fmt(from[0])}
              y1={fmt(from[1])}
              x2={fmt(start[0])}
              y2={fmt(start[1])}
            />
            {length > 0 && (
              <path
                className="fw-ring-walk-arc"
                d={arcPath(WALK_R, a0, a1)}
                markerEnd={`url(#${uid}-arrow)`}
              />
            )}
            {placement.walk.map((visit) => {
              const a = angle(size, visit.token.at);
              const badge = point(WALK_R, a);
              const outer = point(DOT - 7, a);
              const holder = visit.role === 'owner' || visit.role === 'replica';
              if (holder) rank += 1;
              return (
                <g key={visit.token.id} data-visit={visit.role}>
                  <line
                    className="fw-ring-link"
                    x1={fmt(badge[0])}
                    y1={fmt(badge[1])}
                    x2={fmt(outer[0])}
                    y2={fmt(outer[1])}
                  />
                  {visit.role === 'again' ? (
                    <circle className="fw-ring-again" cx={fmt(badge[0])} cy={fmt(badge[1])} r={3} />
                  ) : (
                    <>
                      <circle
                        className={`fw-ring-badge is-${visit.role}`}
                        cx={fmt(badge[0])}
                        cy={fmt(badge[1])}
                        r={8}
                      />
                      <text
                        className="fw-ring-badge-text"
                        x={fmt(badge[0])}
                        y={fmt(badge[1])}
                        dy="0.35em"
                      >
                        {holder ? rank : '×'}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {view.before &&
        view.before.tokens
          .filter((token) => current.removed.has(token.node))
          .map((token) => {
            const [x, y] = point(DOT, angle(size, token.at));
            return (
              <circle key={token.id} className="fw-ring-ghost" cx={fmt(x)} cy={fmt(y)} r={6} />
            );
          })}

      {ring.tokens.map((token) => {
        const node = nodeOf(token.node);
        const a = angle(size, token.at);
        const [x, y] = point(DOT, a);
        const mark = markOf(token.id, current);
        const nodeMark = markOf(token.node, current);
        const drawn = mark === 'faded' && nodeMark !== 'faded' ? nodeMark : mark;
        const select = () => view.toggle(token.id);
        return (
          <g
            key={token.id}
            className={`fw-ring-token is-${drawn}${view.selected === token.id ? ' is-selected' : ''}${node.state === 'down' ? ' is-down' : ''}${node.state === 'suspect' ? ' is-suspect' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={view.selected === token.id}
            aria-label={`${node.label} token ${token.index + 1} at ${token.at}, ${node.state}`}
            onClick={select}
            onKeyDown={keys(select)}
          >
            <circle className="fw-ring-focus" cx={fmt(x)} cy={fmt(y)} r={11} />
            <circle
              className="fw-ring-hit"
              cx={fmt(x)}
              cy={fmt(y)}
              r={10}
              data-entity={token.id}
              data-mark={drawn}
            />
            <circle
              className="fw-ring-dot"
              cx={fmt(x)}
              cy={fmt(y)}
              r={6.5}
              style={{ fill: `url(#${fillId(uid, node.order)})` }}
            />
            {node.state === 'down' && (
              <path
                className="fw-ring-cross"
                d={`M ${fmt(x - 4)} ${fmt(y - 4)} L ${fmt(x + 4)} ${fmt(y + 4)} M ${fmt(x + 4)} ${fmt(y - 4)} L ${fmt(x - 4)} ${fmt(y + 4)}`}
              />
            )}
          </g>
        );
      })}

      {labelled.map((token, index) => {
        const node = nodeOf(token.node);
        const own = (token.at / size) * 360;
        const shown = labelAngles[index]!;
        const theta = (shown / 360) * TAU - Math.PI / 2;
        const [x, y] = point(LABEL, theta);
        const cos = Math.cos(theta);
        const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
        const [tx, ty] = point(DOT + 7, angle(size, token.at));
        return (
          <g key={token.id} className={`fw-ring-tag${node.state === 'down' ? ' is-down' : ''}`}>
            {Math.abs(shown - own) > 0.5 && (
              <line className="fw-ring-leader" x1={fmt(tx)} y1={fmt(ty)} x2={fmt(x)} y2={fmt(y)} />
            )}
            <text x={fmt(x)} y={fmt(y)} dy="0.35em" textAnchor={anchor}>
              {tokenLabel(node, token, tokenCount(token.node))}
            </text>
          </g>
        );
      })}

      {content.keys.map((key, index) => {
        const shown = present(view, key.id) || current.removed.has(key.id);
        const a = angle(size, keyAt(key, view.state));
        const [x, y] = point(KEY_R[keyLevels[index]!]!, a);
        const mark = markOf(key.id, current);
        const change = view.changes.get(key.id);
        const select = () => view.toggle(key.id);
        const placement = view.placements.get(key.id);
        const owner = placement === undefined ? undefined : describePlacement(ring, placement);
        const movedWords =
          change === undefined
            ? ''
            : change.kind === 'owner'
              ? `, moved from ${nodeLabel(ring, change.from.owner)} to ${nodeLabel(ring, change.to.owner)}`
              : ', replica set changed';
        return (
          <g
            key={key.id}
            className={`fw-ring-key ${shown ? `is-${mark}` : 'is-absent'}${view.selected === key.id ? ' is-selected' : ''}${change?.kind === 'owner' ? ' is-moved' : ''}${change?.kind === 'replicas' ? ' is-rereplicated' : ''}`}
            data-tone={toneOf(view.state.patches[key.id]?.tone, undefined)}
            role="button"
            tabIndex={shown ? 0 : -1}
            aria-hidden={shown ? undefined : true}
            aria-pressed={view.selected === key.id}
            aria-label={`key ${key.label ?? key.id} at ${keyAt(key, view.state)}${owner === undefined ? '' : `: ${owner}`}${movedWords}`}
            onClick={select}
            onKeyDown={keys(select)}
          >
            <circle className="fw-ring-focus" cx={fmt(x)} cy={fmt(y)} r={11} />
            <circle
              className="fw-ring-key-hit"
              cx={fmt(x)}
              cy={fmt(y)}
              r={9}
              data-entity={key.id}
              data-mark={shown ? mark : 'absent'}
            />
            {change?.kind === 'owner' ? (
              <path
                className="fw-ring-key-dot"
                d={`M ${fmt(x)} ${fmt(y - 8)} L ${fmt(x + 8)} ${fmt(y)} L ${fmt(x)} ${fmt(y + 8)} L ${fmt(x - 8)} ${fmt(y)} Z`}
              />
            ) : (
              <circle className="fw-ring-key-dot" cx={fmt(x)} cy={fmt(y)} r={5} />
            )}
            {change?.kind === 'replicas' && (
              <circle className="fw-ring-key-ring" cx={fmt(x)} cy={fmt(y)} r={8.5} />
            )}
          </g>
        );
      })}

      {pointedKeys.map((key, index) => {
        const own = (keyAt(key, view.state) / size) * 360;
        const shown = keyLabelAngles[index]!;
        const theta = (shown / 360) * TAU - Math.PI / 2;
        const [x, y] = point(KEY_LABEL, theta);
        const cos = Math.cos(theta);
        const anchor = cos > 0.3 ? 'end' : cos < -0.3 ? 'start' : 'middle';
        const track = KEY_R[keyLevels[content.keys.indexOf(key)]!]!;
        const [fx, fy] = point(track - 6, angle(size, keyAt(key, view.state)));
        return (
          <g key={key.id} className="fw-ring-key-tag" aria-hidden="true">
            {Math.abs(shown - own) > 0.5 && (
              <line className="fw-ring-leader" x1={fmt(fx)} y1={fmt(fy)} x2={fmt(x)} y2={fmt(y)} />
            )}
            <text
              className="fw-ring-key-label"
              x={fmt(x)}
              y={fmt(y)}
              dy="0.35em"
              textAnchor={anchor}
            >
              {key.label ?? key.id}
            </text>
          </g>
        );
      })}

      <g className="fw-ring-scale" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75].map((fraction) => {
          const [x, y] = point(BAND_IN - 9, angle(size, size * fraction));
          return (
            <text key={fraction} x={fmt(x)} y={fmt(y)} dy="0.35em">
              {Math.round(size * fraction)}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

function Legend({ view }: { view: View }) {
  const { ring, uid } = view;
  const share = shares(ring);
  const owned = new Map<string, number>();
  const held = new Map<string, number>();
  for (const [id, placement] of view.placements) {
    if (!present(view, id)) continue;
    if (placement.owner !== undefined)
      owned.set(placement.owner, (owned.get(placement.owner) ?? 0) + 1);
    for (const node of holders(placement)) held.set(node, (held.get(node) ?? 0) + 1);
  }
  return (
    <table className="fw-ring-table fw-ring-nodes">
      <caption>Nodes</caption>
      <thead>
        <tr>
          <th scope="col">Node</th>
          <th scope="col">State</th>
          <th scope="col" title="Share of the hash space the node serves">
            Share
          </th>
          <th scope="col" title="Keys the node owns">
            Owns
          </th>
          <th scope="col" title="Keys the node holds, as owner or replica">
            Holds
          </th>
        </tr>
      </thead>
      <tbody>
        {ring.nodes.map((node) => {
          const decl = view.content.nodes[node.order]!;
          const mark = markOf(node.id, view.current);
          const select = () => view.toggle(node.id);
          const positions = ring.tokens
            .filter((token) => token.node === node.id)
            .map((token) => token.at);
          return (
            <tr
              key={node.id}
              className={`fw-ring-row ${node.present ? `is-${mark}` : 'is-gone'}${view.selected === node.id ? ' is-selected' : ''}`}
              data-node={node.id}
              data-state={node.present ? node.state : 'absent'}
              data-tone={toneOf(view.state.patches[node.id]?.tone, decl.tone)}
            >
              <th scope="row">
                <button
                  type="button"
                  className="fw-ring-name"
                  data-entity={node.id}
                  data-mark={node.present ? mark : 'absent'}
                  aria-pressed={view.selected === node.id}
                  disabled={!node.present}
                  onClick={select}
                >
                  <svg className="fw-ring-swatch" width="26" height="14" aria-hidden="true">
                    <rect
                      x="0.75"
                      y="0.75"
                      width="24.5"
                      height="12.5"
                      rx="3"
                      style={{ fill: `url(#${fillId(uid, node.order)})` }}
                    />
                  </svg>
                  <span>
                    {node.label}
                    <small>{node.present ? `at ${positions.join(', ')}` : `not in the ring`}</small>
                  </span>
                </button>
              </th>
              <td className={`fw-ring-state is-${node.present ? node.state : 'absent'}`}>
                {node.present ? node.state : 'out'}
              </td>
              <td>{node.present ? percent(share.get(node.id) ?? 0) : '–'}</td>
              <td>{node.present ? (owned.get(node.id) ?? 0) : '–'}</td>
              <td>{node.present ? (held.get(node.id) ?? 0) : '–'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function KeyTable({ view }: { view: View }) {
  const { content, ring } = view;
  if (content.keys.length === 0) return null;
  return (
    <table className="fw-ring-table fw-ring-keys">
      <caption>Keys</caption>
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">At</th>
          <th scope="col">Owner</th>
          <th scope="col">Replicas</th>
        </tr>
      </thead>
      <tbody>
        {content.keys.map((key) => {
          const shown = present(view, key.id) || view.current.removed.has(key.id);
          const placement = view.placements.get(key.id);
          const change = view.changes.get(key.id);
          const mark = markOf(key.id, view.current);
          const standIn =
            placement?.owner !== undefined && placement.preference[0] !== placement.owner;
          return (
            <tr
              key={key.id}
              className={`fw-ring-row ${shown ? `is-${mark}` : 'is-absent'}${view.selected === key.id ? ' is-selected' : ''}${change?.kind === 'owner' ? ' is-moved' : ''}`}
              data-key={key.id}
              data-moved={change?.kind === 'owner' ? change.to.owner : undefined}
            >
              <th scope="row">
                <button
                  type="button"
                  className="fw-ring-name"
                  aria-pressed={view.selected === key.id}
                  tabIndex={shown ? 0 : -1}
                  onClick={() => view.toggle(key.id)}
                >
                  {key.label ?? key.id}
                </button>
              </th>
              <td>{keyAt(key, view.state)}</td>
              {/* The second line is always there, so a row keeps its height when a note appears. */}
              <td>
                {nodeLabel(ring, placement?.owner)}
                <small className={change?.kind === 'owner' ? 'fw-ring-moved' : 'fw-ring-note'}>
                  {change?.kind === 'owner'
                    ? `moved from ${nodeLabel(view.before ?? ring, change.from.owner)}`
                    : standIn
                      ? `stand-in for ${nodeLabel(ring, placement.preference[0])}`
                      : '\u00a0'}
                </small>
              </td>
              <td>
                {placement === undefined || placement.replicas.length === 0
                  ? '–'
                  : placement.replicas.map((id) => nodeLabel(ring, id)).join(', ')}
                <small className="fw-ring-moved">
                  {change?.kind === 'replicas' ? 'changed' : '\u00a0'}
                </small>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RingView({
  state,
  content,
  ctx,
}: {
  state: RingState;
  content: RingContent;
  ctx: PanelContext;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [plotRef, width] = useWidth<HTMLDivElement>();
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const ring = useMemo(() => ringOf(content, state), [content, state]);
  const snapshotBefore =
    state.before !== undefined && state.before.call === ctx.call.id && effects.length > 0
      ? state.before
      : undefined;
  const before = useMemo(
    () => (snapshotBefore === undefined ? undefined : ringOf(content, snapshotBefore)),
    [content, snapshotBefore],
  );
  const placements = useMemo(
    () => new Map(content.keys.map((key) => [key.id, place(ring, keyAt(key, state))])),
    [content, ring, state],
  );
  const changes = useMemo(
    () =>
      new Map(
        (snapshotBefore === undefined ? [] : changesOf(content, snapshotBefore, state)).map(
          (change) => [change.key, change],
        ),
      ),
    [content, snapshotBefore, state],
  );
  const moved = [...changes.values()].filter((change) => change.kind === 'owner').length;
  const selected = ctx.selection.id;
  const view: View = {
    content,
    state,
    ring,
    before,
    snapshotBefore,
    uid,
    current,
    selected,
    toggle: (id) => ctx.selection.select(selected === id ? undefined : id),
    placements,
    changes,
  };
  return (
    <div className="fw-ring">
      <div className="fw-ring-plot" ref={plotRef}>
        <RingSvg view={view} compact={width > 0 && width < 300} />
        <p className="fw-ring-key-help">
          {moved === 0
            ? 'A token owns the arc that ends at it. A key goes to the first token at or after it, clockwise.'
            : `${moved} ${moved === 1 ? 'key' : 'keys'} changed owner (diamonds). The bracket outside the ring marks the arc that changed hands.`}
        </p>
      </div>
      <div className="fw-ring-side">
        <Legend view={view} />
        <KeyTable view={view} />
      </div>
    </div>
  );
}

function cardSections({
  state,
  content,
  current,
  call,
  pane,
}: {
  state: RingState;
  content: RingContent;
  current: Effect[];
  call: { id: string };
  pane: { title: string };
}): CardSection[] {
  const labels = uniqueLabels(entitiesOf(content));
  const ring = ringOf(content, state);
  const snapshotBefore =
    state.before !== undefined && state.before.call === call.id && current.length > 0
      ? state.before
      : undefined;
  const changes = snapshotBefore === undefined ? [] : changesOf(content, snapshotBefore, state);
  const was = snapshotBefore === undefined ? ring : ringOf(content, snapshotBefore);
  const name = (ringOf_: Ring, id: string | undefined) => nodeLabel(ringOf_, id);

  const sections: CardSection[] = [...changesSection(pane.title, labels, current)];
  const moved = changes.filter((change) => change.kind === 'owner');
  if (moved.length > 0) {
    sections.push({
      id: 'moved',
      title: `${pane.title}: keys that changed owner`,
      kind: 'list',
      items: moved.map((change) => ({
        label: `${labels.get(change.key) ?? change.key}: ${name(was, change.from.owner)} to ${name(ring, change.to.owner)}`,
        entity: change.key,
        mark: 'moved',
      })),
    });
  }
  const replicas = changes.filter((change) => change.kind === 'replicas');
  if (replicas.length > 0) {
    sections.push({
      id: 'replicas',
      title: `${pane.title}: keys whose replicas changed`,
      kind: 'list',
      items: replicas.map((change) => ({
        label: `${labels.get(change.key) ?? change.key}: ${describePlacement(ring, change.to)}`,
        entity: change.key,
        mark: 'replicas',
      })),
    });
  }

  const share = shares(ring);
  const rows: { key: string; value: string }[] = [];
  const read = content.keys.filter(
    (key) => state.present.includes(key.id) && current.some((effect) => effect.read === key.id),
  );
  for (const key of read) {
    const placement = place(ring, keyAt(key, state));
    const path = placement.walk
      .map((visit) => {
        const node = nodeLabel(ring, visit.token.node);
        return visit.role === 'skipped'
          ? `${node} (down, skipped)`
          : visit.role === 'again'
            ? `${node} (again)`
            : node;
      })
      .join(' then ');
    rows.push({
      key: `lookup ${labels.get(key.id) ?? key.id} at ${keyAt(key, state)}`,
      value: `${describePlacement(ring, placement)}. Walk: ${path === '' ? 'none' : path}`,
    });
  }
  for (const node of ring.nodes.filter((item) => item.present)) {
    const owns = content.keys.filter(
      (key) => state.present.includes(key.id) && place(ring, keyAt(key, state)).owner === node.id,
    ).length;
    rows.push({
      key: node.label,
      value: `${node.state}, ${percent(share.get(node.id) ?? 0)} of the ring, owns ${owns} ${owns === 1 ? 'key' : 'keys'}`,
    });
  }
  if (rows.length > 0) {
    sections.push({ id: 'now', title: `${pane.title}: now`, kind: 'fields', rows });
  }
  return sections;
}

export const ringPanel: PanelType<RingContent, RingState> = {
  id: 'ring',
  schema: { content: RingContent },
  entities: entitiesOf,
  init: (content) => init(entitiesOf(content)),
  reduce: (state, effect, call) => reduce(state, effect, call),
  describe: describeRing,
  Component: RingView,
  cardSections,
  lint: lintRing,
};

export { tokenId };
export type { Arc };
