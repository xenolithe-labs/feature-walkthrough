/**
 * boxes: boxes within boxes, with optional arrows between them.
 *
 * For anything that nests: components, modules, call frames, scopes. The
 * nesting is laid out by the page itself, so the text stays readable at any
 * width. Absent boxes keep their place, so nothing moves when one appears.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  IdSchema,
  initElements,
  markOf,
  reduceElements,
  touched,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
  type Touched,
  own,
} from '../../core';
import { exitPoint, type Box } from '../_diagram/Diagram';
import { fieldProblems } from '../_shared/fields';
import { TONES, changesSection, text, toneOf } from '../_shared/changes';
import { useRevealTouched } from '../_shared/reveal';
import './boxes.css';

const BoxSchema = z.strictObject({
  id: IdSchema,
  label: z.string().min(1),
  sub: z.string().optional(),
  /** The box this one sits inside. */
  parent: IdSchema.optional(),
  tone: z.enum(TONES).optional(),
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
});
type BoxDecl = z.infer<typeof BoxSchema>;

const BoxesContent = z.strictObject({
  boxes: z.array(BoxSchema).min(1),
  edges: z
    .array(
      z.strictObject({
        /** Defaults to "<from>.<to>". */
        id: IdSchema.optional(),
        from: IdSchema,
        to: IdSchema,
        label: z.string().optional(),
        initial: z.boolean().optional(),
      }),
    )
    .default([]),
  /** How the children of a box are arranged. */
  direction: z.enum(['row', 'column']).default('row'),
  /** Whether elements are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
type BoxesContent = z.infer<typeof BoxesContent>;

const edgeId = (edge: { id?: string | undefined; from: string; to: string }) =>
  edge.id ?? `${edge.from}.${edge.to}`;

function entitiesOf(content: BoxesContent) {
  return [
    ...content.boxes.map((box) => ({
      id: box.id,
      label: box.label,
      initial: box.initial ?? content.initial,
    })),
    ...content.edges.map((edge) => ({
      id: edgeId(edge),
      label: edge.label ?? `${edge.from} → ${edge.to}`,
      initial: edge.initial ?? content.initial,
    })),
  ];
}

interface Shared {
  children: Map<string | undefined, BoxDecl[]>;
  state: ElementsState;
  shown: ReadonlySet<string>;
  current: Touched;
  selected: string | undefined;
  toggle(id: string): void;
  register(id: string, element: HTMLDivElement | null): void;
}

function BoxView({ box, shared }: { box: BoxDecl; shared: Shared }) {
  const patch = own(shared.state.patches, box.id);
  const visible = shared.shown.has(box.id);
  const mark = markOf(box.id, shared.current);
  const children = shared.children.get(box.id) ?? [];
  const label = text(patch?.label) ?? box.label;
  const sub = text(patch?.sub) ?? box.sub;
  return (
    <div
      ref={(element) => shared.register(box.id, element)}
      className={`fw-box ${visible ? `is-${mark}` : 'is-absent'}${shared.selected === box.id ? ' is-selected' : ''}`}
      data-entity={box.id}
      data-mark={visible ? mark : 'absent'}
      data-tone={toneOf(patch?.tone, box.tone)}
      role="button"
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      aria-pressed={shared.selected === box.id}
      aria-label={sub === undefined ? label : `${label}: ${sub}`}
      onClick={(event) => {
        event.stopPropagation();
        shared.toggle(box.id);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          shared.toggle(box.id);
        }
      }}
    >
      <div className="fw-box-head">
        <span className="fw-box-label">{label}</span>
        {sub !== undefined && <span className="fw-box-sub">{sub}</span>}
      </div>
      {children.length > 0 && (
        <div className="fw-box-children">
          {children.map((child) => (
            <BoxView key={child.id} box={child} shared={shared} />
          ))}
        </div>
      )}
    </div>
  );
}

type Rects = Record<string, Box>;

function BoxesView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: BoxesContent;
  ctx: PanelContext;
}) {
  const children = useMemo(() => {
    const map = new Map<string | undefined, BoxDecl[]>();
    for (const box of content.boxes) {
      const list = map.get(box.parent) ?? [];
      list.push(box);
      map.set(box.parent, list);
    }
    return map;
  }, [content]);

  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const shown = useMemo(() => {
    const ids = new Set<string>();
    for (const entity of entitiesOf(content)) {
      if (state.present.includes(entity.id) || current.removed.has(entity.id)) ids.add(entity.id);
    }
    return ids;
  }, [content, state.present, current]);

  const frame = useRevealTouched<HTMLDivElement>(ctx.call.id);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [rects, setRects] = useState<Rects>({});

  // Measure where each box ended up, so that the arrows can be drawn over them.
  useLayoutEffect(() => {
    const root = frame.current;
    if (root === null || content.edges.length === 0) return;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const next: Rects = {};
      for (const [id, element] of elements.current) {
        const box = element.getBoundingClientRect();
        next[id] = {
          x: Math.round(box.left - origin.left + root.scrollLeft),
          y: Math.round(box.top - origin.top + root.scrollTop),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      }
      setRects((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [content, state.patches, frame]);

  const selected = ctx.selection.id;
  const shared: Shared = {
    children,
    state,
    shown,
    current,
    selected,
    toggle: (id) => ctx.selection.select(selected === id ? undefined : id),
    register: (id, element) => {
      if (element === null) elements.current.delete(id);
      else elements.current.set(id, element);
    },
  };

  return (
    <div className="fw-boxes" data-direction={content.direction} ref={frame}>
      <div className="fw-box-children">
        {(children.get(undefined) ?? []).map((box) => (
          <BoxView key={box.id} box={box} shared={shared} />
        ))}
      </div>
      <svg className="fw-boxes-edges" aria-hidden="true">
        {content.edges.map((edge) => {
          const id = edgeId(edge);
          const from = rects[edge.from];
          const to = rects[edge.to];
          if (from === undefined || to === undefined) return null;
          if (!shown.has(id) || !shown.has(edge.from) || !shown.has(edge.to)) return null;
          const start = exitPoint(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
          const end = exitPoint(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
          const length = Math.hypot(end.x - start.x, end.y - start.y);
          if (length < 12) return null;
          const ux = (end.x - start.x) / length;
          const uy = (end.y - start.y) / length;
          const base = { x: end.x - ux * 10, y: end.y - uy * 10 };
          return (
            <g
              key={id}
              className={`fw-boxes-edge is-${markOf(id, current)}${selected === id ? ' is-selected' : ''}`}
              data-entity={id}
            >
              <line x1={start.x} y1={start.y} x2={base.x} y2={base.y} />
              <polygon
                points={`${end.x},${end.y} ${base.x - uy * 4.5},${base.y + ux * 4.5} ${base.x + uy * 4.5},${base.y - ux * 4.5}`}
              />
              {edge.label !== undefined && (
                <text
                  x={(start.x + end.x) / 2}
                  y={(start.y + end.y) / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const boxesPanel: PanelType<BoxesContent, ElementsState> = {
  id: 'boxes',
  schema: { content: BoxesContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: BoxesView,
  cardSections: ({ content, current, pane }) =>
    changesSection(
      pane.title,
      new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
      current,
    ),
  lint: (pane, walkthrough) => {
    const content = pane.content as BoxesContent;
    const byId = new Map(content.boxes.map((box) => [box.id, box]));
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const at = ['layout', 'panes', index, 'content'];
    const problems: Problem[] = [];
    content.boxes.forEach((box, position) => {
      if (box.parent === undefined) return;
      if (!byId.has(box.parent)) {
        problems.push({
          severity: 'error',
          rule: 'boxes/unknown-parent',
          path: [...at, 'boxes', position, 'parent'],
          message: `box "${box.id}" names parent "${box.parent}", which is not in this pane`,
        });
        return;
      }
      // A box is in a loop when following parents leads back to the box itself. A box that only
      // sits inside a loop is not reported: fixing the loop fixes it.
      const seen = new Set<string>();
      for (let up = byId.get(box.parent); up !== undefined; up = byId.get(up.parent ?? '')) {
        if (up.id === box.id) {
          problems.push({
            severity: 'error',
            rule: 'boxes/cycle',
            path: [...at, 'boxes', position, 'parent'],
            message: `box "${box.id}" ends up inside itself`,
          });
          break;
        }
        if (seen.has(up.id)) break;
        seen.add(up.id);
      }
    });
    content.edges.forEach((edge, position) => {
      for (const end of ['from', 'to'] as const) {
        if (!byId.has(edge[end])) {
          problems.push({
            severity: 'error',
            rule: 'boxes/unknown-box',
            path: [...at, 'edges', position, end],
            message: `edge "${edgeId(edge)}" names box "${edge[end]}", which is not in this pane`,
          });
        }
      }
    });
    problems.push(
      ...fieldProblems(pane, walkthrough, (id) => (byId.has(id) ? ['label', 'sub', 'tone'] : [])),
    );
    return problems;
  },
};
