/**
 * table: rows of data, and what each call does to them.
 *
 * Rows are the elements. `update` with `fields` keyed by column id changes
 * cells and marks them; `read` marks a row, or only some of its cells when
 * the effect also lists `cells`. The field `tone` sets a lasting tone on the
 * row ("warn", "good", "muted", or "none" to clear it).
 */
import { z } from 'zod';
import {
  IdSchema,
  effectTarget,
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
import './table.css';

const TableContent = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        id: IdSchema,
        label: z.string(),
        /** Draw the column in a monospace font. */
        mono: z.boolean().optional(),
      }),
    )
    .min(1),
  rows: z.array(
    z.strictObject({
      id: IdSchema,
      cells: z.record(IdSchema, z.string()),
      tone: z.enum(TONES).optional(),
      /** Present before the first call. Defaults to the pane's `initial`. */
      initial: z.boolean().optional(),
    }),
  ),
  /** Whether rows are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
type TableContent = z.infer<typeof TableContent>;

function entitiesOf(content: TableContent) {
  const first = content.columns[0]!.id;
  return content.rows.map((row) => ({
    id: row.id,
    label: row.cells[first] ?? row.id,
    initial: row.initial ?? content.initial,
  }));
}

/** The cells of a row that the current call changed or read. */
function touchedCells(current: PanelContext['current'], rowId: string) {
  const updated = new Set<string>();
  const read = new Set<string>();
  for (const effect of current) {
    const { verb, id } = effectTarget(effect);
    if (id !== rowId) continue;
    if (verb === 'update') {
      for (const key of Object.keys(effect.fields ?? {})) updated.add(key);
    } else if (verb === 'read' && Array.isArray(effect.cells)) {
      for (const key of effect.cells) if (typeof key === 'string') read.add(key);
    }
  }
  return { updated, read };
}

function TableView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: TableContent;
  ctx: PanelContext;
}) {
  const present = new Set(state.present);
  const current = touched(ctx.current);
  const selected = ctx.selection.id;
  const toggle = (id: string) => ctx.selection.select(selected === id ? undefined : id);

  return (
    <div className="fw-table-scroll">
      <table className="fw-table">
        <caption className="fw-visually-hidden">{ctx.pane.title}</caption>
        <thead>
          <tr>
            {content.columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {content.rows.map((row) => {
            // A row is shown while it is present, and on the call that removes it.
            const shown = present.has(row.id) || current.removed.has(row.id);
            const patch = state.patches[row.id];
            const mark = markOf(row.id, current);
            const cells = touchedCells(ctx.current, row.id);
            const narrowed = mark === 'read' && cells.read.size > 0;
            const classes = [
              shown ? `is-${narrowed ? 'idle' : mark}` : 'is-absent',
              selected === row.id ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <tr
                key={row.id}
                className={classes}
                data-entity={row.id}
                data-mark={shown ? mark : 'absent'}
                data-tone={toneOf(patch?.tone, row.tone)}
                aria-hidden={shown ? undefined : true}
                aria-selected={selected === row.id}
                tabIndex={shown ? 0 : -1}
                onClick={() => toggle(row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle(row.id);
                  }
                }}
              >
                {content.columns.map((column) => {
                  const cellMark = cells.updated.has(column.id)
                    ? ' is-cell-updated'
                    : cells.read.has(column.id)
                      ? ' is-cell-read'
                      : '';
                  return (
                    <td
                      key={column.id}
                      className={`${column.mono ? 'is-mono' : ''}${cellMark}`}
                      data-column={column.id}
                    >
                      {text(patch?.[column.id]) ?? row.cells[column.id] ?? ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const tablePanel: PanelType<TableContent, ElementsState> = {
  id: 'table',
  schema: { content: TableContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: TableView,
  cardSections: ({ content, current, pane }) =>
    changesSection(
      pane.title,
      new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
      current,
    ),
  lint: (pane, walkthrough) => {
    const content = pane.content as TableContent;
    const columns = new Set(content.columns.map((column) => column.id));
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const problems: Problem[] = [];
    if (columns.has('tone')) {
      problems.push({
        severity: 'error',
        rule: 'table/reserved-column',
        path: ['layout', 'panes', index, 'content', 'columns'],
        message: 'a column cannot have the id "tone": that field sets the tone of a row',
      });
    }
    content.rows.forEach((row, position) => {
      for (const key of Object.keys(row.cells)) {
        if (!columns.has(key)) {
          problems.push({
            severity: 'error',
            rule: 'table/unknown-column',
            path: ['layout', 'panes', index, 'content', 'rows', position, 'cells', key],
            message: `row "${row.id}" has a cell for column "${key}", which is not declared`,
          });
        }
      }
    });
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        (call.effects?.[pane.id] ?? []).forEach((effect, e) => {
          const keys = [
            ...Object.keys(effect.fields ?? {}).filter((key) => key !== 'tone'),
            ...(Array.isArray(effect.cells) ? (effect.cells as unknown[]) : []),
          ];
          for (const key of keys) {
            if (typeof key === 'string' && columns.has(key)) continue;
            problems.push({
              severity: 'error',
              rule: 'table/unknown-column',
              path: ['steps', s, 'calls', c, 'effects', pane.id, e],
              message: `column "${String(key)}" is not declared in pane "${pane.id}"`,
            });
          }
        });
      });
    });
    return problems;
  },
};
