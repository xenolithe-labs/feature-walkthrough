/**
 * schema: tables with their columns, and the relations between them.
 *
 * For the shape of data rather than the data itself: database tables, object
 * types, message types. Tables, columns and relations are all elements, so a
 * call can mark the one column it reads or writes. A column's element id is
 * "<table>.<column>". A relation runs from a column (or a table) to a table
 * (or a column), and may point back at its own table.
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
} from '../../core';
import { TONES, changesSection, text, toneOf } from '../_shared/changes';
import './schema.css';

const ColumnSchema = z.strictObject({
  id: IdSchema,
  /** Defaults to the id. */
  label: z.string().optional(),
  type: z.string().optional(),
  /** A short badge in front of the name, such as "PK" or "FK". */
  key: z.string().max(4).optional(),
  note: z.string().optional(),
  initial: z.boolean().optional(),
});

const TableSchema = z.strictObject({
  id: IdSchema,
  label: z.string().min(1),
  sub: z.string().optional(),
  columns: z.array(ColumnSchema).default([]),
  tone: z.enum(TONES).optional(),
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
});

const SchemaContent = z.strictObject({
  tables: z.array(TableSchema).min(1),
  relations: z
    .array(
      z.strictObject({
        /** Defaults to "<from>:<to>". */
        id: IdSchema.optional(),
        /** A table id, or "<table>.<column>". */
        from: IdSchema,
        to: IdSchema,
        label: z.string().optional(),
        initial: z.boolean().optional(),
      }),
    )
    .default([]),
  /** Whether elements are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
type SchemaContent = z.infer<typeof SchemaContent>;

const relationId = (relation: { id?: string | undefined; from: string; to: string }) =>
  relation.id ?? `${relation.from}:${relation.to}`;

function entitiesOf(content: SchemaContent) {
  return [
    ...content.tables.flatMap((table) => {
      const initial = table.initial ?? content.initial;
      return [
        { id: table.id, label: table.label, initial },
        ...table.columns.map((column) => ({
          id: `${table.id}.${column.id}`,
          label: `${table.label}.${column.label ?? column.id}`,
          initial: column.initial ?? initial,
        })),
      ];
    }),
    ...content.relations.map((relation) => ({
      id: relationId(relation),
      label: relation.label ?? `${relation.from} → ${relation.to}`,
      initial: relation.initial ?? content.initial,
    })),
  ];
}

/** The table an end of a relation belongs to: the end itself, or the part before the dot. */
function tableOf(end: string, tables: ReadonlySet<string>): string | undefined {
  if (tables.has(end)) return end;
  const dot = end.lastIndexOf('.');
  const table = dot < 0 ? undefined : end.slice(0, dot);
  return table !== undefined && tables.has(table) ? table : undefined;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Route {
  d: string;
  /** The tip of the arrow and the direction it points in (1: rightwards, -1: leftwards). */
  tip: { x: number; y: number; direction: 1 | -1 };
  middle: { x: number; y: number };
}

/**
 * A curve from the side of one row to the side of another. Tables beside each
 * other are joined across the gap; rows above each other, or in the same
 * table, are joined by a loop on the right.
 */
function route(from: Rect, fromCard: Rect, to: Rect, toCard: Rect): Route {
  const sy = from.y + from.height / 2;
  const ey = to.y + to.height / 2;
  const GAP = 6;
  if (toCard.x >= fromCard.x + fromCard.width) {
    const sx = fromCard.x + fromCard.width;
    const ex = toCard.x - GAP;
    const bend = Math.max(24, (ex - sx) / 2);
    return {
      d: `M${sx},${sy} C${sx + bend},${sy} ${ex - bend},${ey} ${ex},${ey}`,
      tip: { x: toCard.x, y: ey, direction: 1 },
      middle: { x: (sx + ex) / 2, y: (sy + ey) / 2 },
    };
  }
  if (toCard.x + toCard.width <= fromCard.x) {
    const sx = fromCard.x;
    const ex = toCard.x + toCard.width + GAP;
    const bend = Math.max(24, (sx - ex) / 2);
    return {
      d: `M${sx},${sy} C${sx - bend},${sy} ${ex + bend},${ey} ${ex},${ey}`,
      tip: { x: toCard.x + toCard.width, y: ey, direction: -1 },
      middle: { x: (sx + ex) / 2, y: (sy + ey) / 2 },
    };
  }
  const sx = fromCard.x + fromCard.width;
  const ex = toCard.x + toCard.width + GAP;
  const out = Math.max(sx, ex) + Math.min(46, 18 + Math.abs(ey - sy) / 3);
  return {
    d: `M${sx},${sy} C${out},${sy} ${out},${ey} ${ex},${ey}`,
    tip: { x: toCard.x + toCard.width, y: ey, direction: -1 },
    middle: { x: (sx + ex) / 8 + (out * 3) / 4, y: (sy + ey) / 2 },
  };
}

function SchemaView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: SchemaContent;
  ctx: PanelContext;
}) {
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const tables = useMemo(() => new Set(content.tables.map((table) => table.id)), [content]);
  const shown = useMemo(() => {
    const ids = new Set<string>();
    for (const entity of entitiesOf(content)) {
      if (state.present.includes(entity.id) || current.removed.has(entity.id)) ids.add(entity.id);
    }
    return ids;
  }, [content, state.present, current]);

  const frame = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const register = (id: string) => (element: HTMLElement | null) => {
    if (element === null) elements.current.delete(id);
    else elements.current.set(id, element);
  };

  // Measure where each table and row ended up, so that the relations can be drawn over them.
  useLayoutEffect(() => {
    const root = frame.current;
    if (root === null || content.relations.length === 0) return;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const next: Record<string, Rect> = {};
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
  }, [content, state.patches, shown]);

  const selected = ctx.selection.id;
  const toggle = (id: string) => ctx.selection.select(selected === id ? undefined : id);
  const classOf = (id: string) =>
    `${shown.has(id) ? `is-${markOf(id, current)}` : 'is-absent'}${selected === id ? ' is-selected' : ''}`;

  return (
    <div className="fw-schema" ref={frame}>
      <div className="fw-schema-tables">
        {content.tables.map((table) => {
          const patch = state.patches[table.id];
          const visible = shown.has(table.id);
          return (
            <section
              key={table.id}
              ref={register(table.id)}
              className={`fw-schema-table ${classOf(table.id)}`}
              data-entity={table.id}
              data-mark={visible ? markOf(table.id, current) : 'absent'}
              data-tone={toneOf(patch?.tone, table.tone)}
              aria-hidden={visible ? undefined : true}
            >
              <button
                type="button"
                ref={register(`${table.id}#head`)}
                className="fw-schema-head"
                tabIndex={visible ? 0 : -1}
                aria-pressed={selected === table.id}
                onClick={() => toggle(table.id)}
              >
                <span className="fw-schema-label">{text(patch?.label) ?? table.label}</span>
                {table.sub !== undefined && (
                  <span className="fw-schema-sub">{text(patch?.sub) ?? table.sub}</span>
                )}
              </button>
              {table.columns.map((column) => {
                const id = `${table.id}.${column.id}`;
                if (!shown.has(id)) return null;
                const columnPatch = state.patches[id];
                const type = text(columnPatch?.type) ?? column.type;
                const note = text(columnPatch?.note) ?? column.note;
                return (
                  <button
                    type="button"
                    key={column.id}
                    ref={register(id)}
                    className={`fw-schema-column ${classOf(id)}`}
                    data-entity={id}
                    data-mark={markOf(id, current)}
                    tabIndex={visible ? 0 : -1}
                    aria-pressed={selected === id}
                    onClick={() => toggle(id)}
                  >
                    <span className="fw-schema-key">{column.key ?? ''}</span>
                    <span className="fw-schema-name">
                      {text(columnPatch?.label) ?? column.label ?? column.id}
                    </span>
                    {type !== undefined && <span className="fw-schema-type">{type}</span>}
                    {note !== undefined && <span className="fw-schema-note">{note}</span>}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      <svg className="fw-schema-relations" aria-hidden="true">
        {content.relations.map((relation) => {
          const id = relationId(relation);
          const fromTable = tableOf(relation.from, tables);
          const toTable = tableOf(relation.to, tables);
          if (fromTable === undefined || toTable === undefined) return null;
          if (![id, relation.from, relation.to, fromTable, toTable].every((x) => shown.has(x))) {
            return null;
          }
          const head = (end: string) => (tables.has(end) ? `${end}#head` : end);
          const from = rects[head(relation.from)];
          const to = rects[head(relation.to)];
          const fromCard = rects[fromTable];
          const toCard = rects[toTable];
          if (!from || !to || !fromCard || !toCard) return null;
          const { d, tip, middle } = route(from, fromCard, to, toCard);
          const back = tip.x - tip.direction * 9;
          return (
            <g
              key={id}
              className={`fw-schema-relation is-${markOf(id, current)}${selected === id ? ' is-selected' : ''}`}
              data-entity={id}
            >
              <path d={d} />
              <polygon points={`${tip.x},${tip.y} ${back},${tip.y - 4.5} ${back},${tip.y + 4.5}`} />
              {relation.label !== undefined && (
                <text x={middle.x} y={middle.y} textAnchor="middle" dominantBaseline="central">
                  {relation.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const schemaPanel: PanelType<SchemaContent, ElementsState> = {
  id: 'schema',
  schema: { content: SchemaContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: SchemaView,
  cardSections: ({ content, current, pane }) =>
    changesSection(
      pane.title,
      new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
      current,
    ),
  lint: (pane, walkthrough) => {
    const content = pane.content as SchemaContent;
    const tables = new Set(content.tables.map((table) => table.id));
    const ends = new Set([
      ...tables,
      ...content.tables.flatMap((table) => table.columns.map((c) => `${table.id}.${c.id}`)),
    ]);
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const problems: Problem[] = [];
    content.relations.forEach((relation, position) => {
      for (const end of ['from', 'to'] as const) {
        if (!ends.has(relation[end])) {
          problems.push({
            severity: 'error',
            rule: 'schema/unknown-end',
            path: ['layout', 'panes', index, 'content', 'relations', position, end],
            message: `relation "${relationId(relation)}" names "${relation[end]}", which is not a table or a "<table>.<column>" in this pane`,
          });
        }
      }
    });
    return problems;
  },
};
