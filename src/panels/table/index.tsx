/**
 * table: rows of data, and what each call does to them.
 *
 * Rows are the elements. `update` with `fields` keyed by column id changes
 * cells and marks them; `read` marks a row, or only some of its cells when
 * the effect also lists `cells`. The field `tone` sets a lasting tone on the
 * row ("warn", "good", "muted", or "none" to clear it).
 *
 * Optional extras, none of which changes a table that does not use them: a `legend` that gives
 * cell values a tone and a name, `group` on rows (a header row for each run of one group), meter
 * columns (a bar and a number), and columns as elements named `col.<column>` that an effect can
 * read, to mark the whole column.
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
  own,
  writtenEffects,
} from '../../core';
import { TONES, changesSection, text, toneOf } from '../_shared/changes';
import { fieldProblems } from '../_shared/fields';
import { useRevealTouched } from '../_shared/reveal';
import {
  LEGEND_TONES,
  columnElement,
  groupRuns,
  legendFor,
  meterProblem,
  readMeter,
} from './model';
import './table.css';

const TableContent = z.strictObject({
  columns: z
    .array(
      z.strictObject({
        id: IdSchema,
        label: z.string(),
        /** Draw the column in a monospace font. */
        mono: z.boolean().optional(),
        /**
         * Draw the cells as a bar and a number. The cells must be numbers written as text; the
         * bar is full at `max`, and a number above `warn` is toned.
         */
        meter: z
          .strictObject({ max: z.number().positive(), warn: z.number().min(0).optional() })
          .optional(),
      }),
    )
    .min(1),
  rows: z.array(
    z.strictObject({
      id: IdSchema,
      cells: z.record(IdSchema, z.string()),
      tone: z.enum(TONES).optional(),
      /** Consecutive rows of one group get a header row that spans the table. */
      group: z.string().min(1).optional(),
      /** Present before the first call. Defaults to the pane's `initial`. */
      initial: z.boolean().optional(),
    }),
  ),
  /**
   * A cell whose text is one of these keys is drawn with its tone, and the legend is shown under
   * the table. A key is a cell value; a meter column ignores it.
   */
  legend: z
    .record(
      z.string().min(1),
      z.strictObject({ tone: z.enum(LEGEND_TONES).optional(), label: z.string().min(1) }),
    )
    .optional(),
  /** Whether rows are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
type TableContent = z.infer<typeof TableContent>;

/** Rows, then columns (always present: a column is marked, never added). */
function entitiesOf(content: TableContent) {
  const first = content.columns[0]!.id;
  return [
    ...content.rows.map((row) => ({
      id: row.id,
      label: own(row.cells, first) ?? row.id,
      initial: row.initial ?? content.initial,
    })),
    ...content.columns.map((column) => ({
      id: columnElement(column.id),
      label: column.label,
      initial: true,
    })),
  ];
}

const isColumn = (id: string) => id.startsWith('col.');

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
  // Columns are marked on their own, so a call that only marks a column does not fade the rows.
  const rowEffects = ctx.current.filter((effect) => !isColumn(effectTarget(effect).id));
  const current = touched(rowEffects);
  const hitColumns = new Set(
    ctx.current.flatMap((effect) => {
      const { verb, id } = effectTarget(effect);
      return verb !== 'focus' && isColumn(id) ? [id] : [];
    }),
  );
  const selected = ctx.selection.id;
  const toggle = (id: string) => ctx.selection.select(selected === id ? undefined : id);
  // Rows below the fold, or columns to the right of it, are brought into view when a call touches them.
  const scroller = useRevealTouched<HTMLDivElement>(ctx.call.id, { inset: 'thead' });
  const legend = content.legend === undefined ? [] : Object.entries(content.legend);

  return (
    <div className="fw-table-wrap">
      <div className="fw-table-scroll" ref={scroller}>
        <table className="fw-table">
          <caption className="fw-visually-hidden">{ctx.pane.title}</caption>
          <thead>
            <tr>
              {content.columns.map((column) => {
                const id = columnElement(column.id);
                const hit = hitColumns.has(id);
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={`${hit ? 'is-col-hit' : ''}${selected === id ? ' is-selected' : ''}`}
                    data-entity={id}
                    // Only when no row is marked: the header is always in view, so a mark on it
                    // would stop the pane from scrolling to the rows the call is about.
                    data-mark={hit && !current.any ? 'read' : undefined}
                    data-col-mark={hit ? 'read' : undefined}
                    aria-selected={selected === id}
                    tabIndex={0}
                    onClick={() => toggle(id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggle(id);
                      }
                    }}
                  >
                    {column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          {groupRuns(content.rows).map((run, runIndex) => (
            <tbody key={`${runIndex}:${run.group ?? ''}`}>
              {run.group !== undefined && (
                <tr className="fw-table-group">
                  <th colSpan={content.columns.length} scope="rowgroup">
                    {run.group}
                  </th>
                </tr>
              )}
              {run.rows.map((row) => {
                // A row is shown while it is present, and on the call that removes it.
                const shown = present.has(row.id) || current.removed.has(row.id);
                const patch = own(state.patches, row.id);
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
                    data-tone={shown ? toneOf(patch?.tone, row.tone) : undefined}
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
                      const id = columnElement(column.id);
                      const value = text(own(patch, column.id)) ?? own(row.cells, column.id) ?? '';
                      const bar =
                        column.meter === undefined ? undefined : readMeter(value, column.meter);
                      const named =
                        column.meter === undefined ? legendFor(content.legend, value) : undefined;
                      const cellClasses = [
                        column.mono ? 'is-mono' : '',
                        column.meter !== undefined ? 'is-meter' : '',
                        cells.updated.has(column.id)
                          ? 'is-cell-updated'
                          : cells.read.has(column.id)
                            ? 'is-cell-read'
                            : '',
                        hitColumns.has(id) ? 'is-col-hit' : '',
                        selected === id ? 'is-col-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <td
                          key={column.id}
                          className={cellClasses}
                          data-column={column.id}
                          data-cell-tone={named?.tone}
                          data-warn={bar?.warn ? 'true' : undefined}
                        >
                          {bar !== undefined ? (
                            <span className="fw-meter">
                              <span
                                className="fw-meter-bar"
                                role="meter"
                                aria-label={column.label}
                                aria-valuemin={0}
                                aria-valuemax={column.meter!.max}
                                aria-valuenow={bar.value}
                              >
                                <span
                                  className="fw-meter-fill"
                                  style={{ width: `${Math.round(bar.fraction * 1000) / 10}%` }}
                                />
                              </span>
                              <span className="fw-meter-value">{value.trim()}</span>
                            </span>
                          ) : (
                            <>
                              {value}
                              {named !== undefined && (
                                <span className="fw-visually-hidden"> ({named.label})</span>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {legend.length > 0 && (
        <ul className="fw-table-legend" aria-label="Legend">
          {legend.map(([value, entry]) => (
            <li key={value} data-cell-tone={entry.tone}>
              <span className="fw-legend-key">{value}</span> {entry.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const tablePanel: PanelType<TableContent, ElementsState> = {
  id: 'table',
  schema: { content: TableContent },
  entities: entitiesOf,
  // Only rows are present or absent; a column is always there to be marked, so it is not in the
  // state (lint rejects adding or removing one).
  init: (content) => initElements(entitiesOf(content).filter((entity) => !isColumn(entity.id))),
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
    const meters = new Map(
      content.columns.flatMap((column) =>
        column.meter === undefined ? [] : [[column.id, column.meter] as const],
      ),
    );
    const rowIds = new Set(content.rows.map((row) => row.id));
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const at = ['layout', 'panes', index, 'content'];
    const problems: Problem[] = [];
    if (columns.has('tone')) {
      problems.push({
        severity: 'error',
        rule: 'table/reserved-column',
        path: [...at, 'columns'],
        message: 'a column cannot have the id "tone": that field sets the tone of a row',
      });
    }
    content.columns.forEach((column, position) => {
      if (column.meter?.warn !== undefined && column.meter.warn > column.meter.max) {
        problems.push({
          severity: 'error',
          rule: 'table/bad-meter',
          path: [...at, 'columns', position, 'meter', 'warn'],
          message: `column "${column.id}" warns at ${column.meter.warn}, above its max of ${column.meter.max}`,
        });
      }
    });
    content.rows.forEach((row, position) => {
      for (const [key, value] of Object.entries(row.cells)) {
        const cellPath = [...at, 'rows', position, 'cells', key];
        if (!columns.has(key)) {
          problems.push({
            severity: 'error',
            rule: 'table/unknown-column',
            path: cellPath,
            message: `row "${row.id}" has a cell for column "${key}", which is not declared`,
          });
          continue;
        }
        const meter = meters.get(key);
        const bad = meter === undefined ? null : meterProblem(value, meter);
        if (bad !== null) {
          problems.push({
            severity: 'error',
            rule: 'table/bad-meter-value',
            path: cellPath,
            message: `row "${row.id}", column "${key}": ${bad}`,
          });
        }
      }
    });

    // Groups: a run of rows is one group, and a group that comes back later gets a second header.
    const seen = new Set<string>();
    const grouped = content.rows.some((row) => row.group !== undefined);
    for (const run of groupRuns(content.rows)) {
      const first = content.rows.indexOf(run.rows[0]!);
      if (run.group === undefined) {
        if (grouped) {
          problems.push({
            severity: 'warning',
            rule: 'table/ungrouped-row',
            path: [...at, 'rows', first],
            message: `row "${run.rows[0]!.id}" names no group, so it sits under the header above it`,
          });
        }
        continue;
      }
      if (seen.has(run.group)) {
        problems.push({
          severity: 'warning',
          rule: 'table/split-group',
          path: [...at, 'rows', first, 'group'],
          message: `group "${run.group}" comes back after other rows, so it gets a second header. Put its rows together`,
        });
      }
      seen.add(run.group);
    }

    if (content.legend !== undefined) {
      const used = new Set<string>();
      for (const row of content.rows) {
        for (const [key, value] of Object.entries(row.cells)) {
          if (!meters.has(key)) used.add(value);
        }
      }
      for (const step of walkthrough.steps) {
        for (const call of step.calls) {
          for (const effect of writtenEffects(call, pane.id)) {
            for (const [key, value] of Object.entries(effect.fields ?? {})) {
              if (!meters.has(key) && typeof value === 'string') used.add(value);
            }
          }
        }
      }
      for (const key of Object.keys(content.legend)) {
        if (!used.has(key)) {
          problems.push({
            severity: 'warning',
            rule: 'table/unused-legend',
            path: [...at, 'legend', key],
            message: `no cell is ever "${key}", so the legend entry is never drawn on a cell`,
          });
        }
      }
    }

    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        writtenEffects(call, pane.id).forEach((effect, e) => {
          const path = ['steps', s, 'calls', c, 'effects', pane.id, e];
          const { verb, id } = effectTarget(effect);
          if (isColumn(id)) {
            if (verb === 'add' || verb === 'remove' || verb === 'update') {
              problems.push({
                severity: 'error',
                rule: 'table/column-effect',
                path,
                message: `a column is always present and has no fields: use read to mark "${id}"`,
              });
            }
            return;
          }
          const keys = [
            ...Object.keys(effect.fields ?? {}).filter((key) => key !== 'tone'),
            ...(Array.isArray(effect.cells) ? (effect.cells as unknown[]) : []),
          ];
          for (const key of keys) {
            if (typeof key === 'string' && columns.has(key)) continue;
            problems.push({
              severity: 'error',
              rule: 'table/unknown-column',
              path,
              message: `column "${String(key)}" is not declared in pane "${pane.id}"`,
            });
          }
        });
      });
    });

    problems.push(
      // An unknown field is already reported as table/unknown-column, so it is not reported twice.
      ...fieldProblems(
        pane,
        walkthrough,
        (id) => (rowIds.has(id) ? [...columns, 'tone'] : isColumn(id) ? [] : undefined),
        (_id, field, value) => {
          const meter = meters.get(field);
          if (meter === undefined) return undefined;
          if (typeof value !== 'string') {
            return `the field "${field}" takes a number written as text`;
          }
          return meterProblem(value, meter);
        },
      ).filter((problem) => problem.rule !== 'table/unknown-field'),
    );
    return problems;
  },
};
