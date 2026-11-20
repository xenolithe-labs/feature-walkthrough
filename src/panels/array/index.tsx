/**
 * array: cells in a row with their indexes, the pointers into them, and the ranges over them.
 *
 * For linear data: an array being searched or sorted, a queue, a stack, a string. Elements:
 *   - a cell, `<array>.<index>`: `read` marks a compare, `update` with `fields.value` marks a
 *     write (a swap is two writes), and `add` / `remove` grow and shrink a queue or stack;
 *   - a pointer, such as `lo` or `i`: `update` with `fields.at` moves it (an index, one step
 *     past either end, or `null` for nothing), so the author never clears the old position;
 *   - a range, such as the active window: `update` with `fields.from` and `fields.to` moves it,
 *     or it follows the pointers named in its content.
 * Pointers and ranges have their own track under or over the cells, so nothing moves when one
 * appears or disappears.
 */
import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import {
  effectTarget,
  initElements,
  markOf,
  reduceElements,
  touched,
  type CardSection,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
  type Touched,
} from '../../core';
import { changesSection, text, toneOf } from '../_shared/changes';
import {
  ArrayContent,
  arrayOf,
  cellId,
  cellValue,
  describePointer,
  entitiesOf,
  pointerAt,
  rangeBounds,
  slotCount,
  type ArrayDecl,
  type PointerDecl,
  type RangeDecl,
} from './model';
import './array.css';

const EFFECT_KEYS = ['add', 'update', 'read', 'remove', 'focus', 'fields'];
const CELL_FIELDS = ['value', 'tone'];
const POINTER_FIELDS = ['at', 'label', 'tone'];
const RANGE_FIELDS = ['from', 'to', 'label', 'tone'];

interface Shared {
  content: ArrayContent;
  state: ElementsState;
  present: ReadonlySet<string>;
  current: Touched;
  selected: string | undefined;
  toggle(id: string): void;
}

/**
 * Enter and Space select. The arrow keys are left alone: they move through the walkthrough, here
 * as everywhere on the page. Tab reaches each shown cell, pointer and range.
 */
function keys(select: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select();
    }
  };
}

function Cell({
  array,
  index,
  shared,
  row,
  dim,
}: {
  array: ArrayDecl;
  index: number;
  shared: Shared;
  row: number;
  dim: boolean;
}) {
  const id = cellId(array.id, index);
  const shown = shared.present.has(id) || shared.current.removed.has(id);
  const mark = markOf(id, shared.current);
  const value = cellValue(array, index, shared.state.patches);
  const select = () => shared.toggle(id);
  const label = `${array.id}[${index}]`;
  return (
    <div
      className={`fw-array-cell ${shown ? `is-${mark}` : 'is-absent'}${shared.selected === id ? ' is-selected' : ''}`}
      style={{ gridColumn: index + 1, gridRow: row }}
      data-entity={id}
      data-mark={shown ? mark : 'absent'}
      data-tone={toneOf(shared.state.patches[id]?.tone, undefined)}
      data-dim={dim && shown ? true : undefined}
      role="button"
      tabIndex={shown ? 0 : -1}
      aria-hidden={shown ? undefined : true}
      aria-pressed={shared.selected === id}
      aria-label={`${label} = ${String(value) === '' ? 'empty' : value}`}
      onClick={select}
      onKeyDown={keys(select)}
    >
      {String(value)}
    </div>
  );
}

function Pointer({
  pointer,
  size,
  shared,
  row,
}: {
  pointer: PointerDecl;
  size: number;
  shared: Shared;
  row: number;
}) {
  const at = pointerAt(pointer, shared.state.patches);
  const shown = shared.present.has(pointer.id) || shared.current.removed.has(pointer.id);
  const placed = shown && at !== null;
  const mark = markOf(pointer.id, shared.current);
  const patch = shared.state.patches[pointer.id];
  const label = text(patch?.label) ?? pointer.label ?? pointer.id;
  const off = at !== null && (at < 0 || at >= size);
  const column = at === null ? 1 : Math.min(Math.max(at, 0), Math.max(size - 1, 0)) + 1;
  const select = () => shared.toggle(pointer.id);
  // Never fade a pointer: it is state the reader needs at every call.
  const drawn = mark === 'faded' ? 'idle' : mark;
  return (
    <div
      className={`fw-array-pointer is-${pointer.side} ${placed ? `is-${drawn}` : 'is-absent'}${shared.selected === pointer.id ? ' is-selected' : ''}`}
      style={{ gridColumn: column, gridRow: row }}
      data-entity={pointer.id}
      data-mark={placed ? drawn : 'absent'}
      data-tone={toneOf(patch?.tone, pointer.tone)}
      data-off={off ? (at! < 0 ? 'before' : 'after') : undefined}
      role="button"
      tabIndex={placed ? 0 : -1}
      aria-hidden={placed ? undefined : true}
      aria-pressed={shared.selected === pointer.id}
      aria-label={`pointer ${label}: ${describePointer(shared.content, pointer, shared.state)}`}
      onClick={select}
      onKeyDown={keys(select)}
    >
      {off ? `${label} = ${at}` : label}
    </div>
  );
}

function Range({
  range,
  size,
  shared,
  row,
}: {
  range: RangeDecl;
  size: number;
  shared: Shared;
  row: number;
}) {
  const bounds = rangeBounds(shared.content, range, shared.state);
  const shown = shared.present.has(range.id) || shared.current.removed.has(range.id);
  // An empty range (from is past to) has no cells to span, so it draws nothing.
  const drawable = shown && bounds !== null && bounds.from <= bounds.to && size > 0;
  const from = bounds === null ? 0 : Math.min(Math.max(bounds.from, 0), size - 1);
  const to = bounds === null ? 0 : Math.min(Math.max(bounds.to, 0), size - 1);
  const mark = markOf(range.id, shared.current);
  const drawn = mark === 'faded' ? 'idle' : mark;
  const patch = shared.state.patches[range.id];
  const label = text(patch?.label) ?? range.label ?? range.id;
  const select = () => shared.toggle(range.id);
  const words = !shown
    ? 'not shown'
    : bounds === null || bounds.from > bounds.to
      ? 'empty'
      : `indexes ${bounds.from} to ${bounds.to}`;
  return (
    <div
      className={`fw-array-range ${drawable ? `is-${drawn}` : 'is-absent'}${shared.selected === range.id ? ' is-selected' : ''}`}
      style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: row }}
      data-entity={range.id}
      data-mark={drawable ? drawn : 'absent'}
      data-tone={toneOf(patch?.tone, range.tone)}
      role="button"
      tabIndex={drawable ? 0 : -1}
      aria-hidden={drawable ? undefined : true}
      aria-pressed={shared.selected === range.id}
      aria-label={`range ${label}: ${words}`}
      onClick={select}
      onKeyDown={keys(select)}
    >
      <span>{label}</span>
    </div>
  );
}

function ArrayRow({ array, shared }: { array: ArrayDecl; shared: Shared }) {
  const { content, state } = shared;
  const size = slotCount(array);
  const mine = <T extends { array?: string | undefined }>(items: T[]) =>
    items.filter((item) => arrayOf(content, item)?.id === array.id);
  const ranges = mine(content.ranges);
  const pointers = mine(content.pointers);
  const above = pointers.filter((pointer) => pointer.side === 'above');
  const below = pointers.filter((pointer) => pointer.side === 'below');

  // Rows from the top: one track per range, one per pointer over the cells, the cells, the
  // indexes, and one track per pointer under them.
  const cellRow = ranges.length + above.length + 1;
  const indexRow = cellRow + 1;

  // The cells outside every dimming range that is drawn are dimmed.
  const dimming = ranges.filter((range) => range.dim && shared.present.has(range.id));
  const windows = dimming.map((range) => rangeBounds(content, range, state));
  const dimmed = (index: number) =>
    windows.length > 0 &&
    windows.every((bounds) => bounds === null || index < bounds.from || index > bounds.to);

  const style = { '--n': size } as CSSProperties;
  return (
    <div className="fw-array" data-array={array.id}>
      <div className="fw-array-name">{array.label ?? array.id}</div>
      <div className="fw-array-scroll">
        <div
          className="fw-array-grid"
          style={style}
          role="group"
          aria-label={array.label ?? array.id}
        >
          {ranges.map((range, position) => (
            <Range key={range.id} range={range} size={size} shared={shared} row={position + 1} />
          ))}
          {above.map((pointer, position) => (
            <Pointer
              key={pointer.id}
              pointer={pointer}
              size={size}
              shared={shared}
              row={ranges.length + position + 1}
            />
          ))}
          {Array.from({ length: size }, (_, index) => (
            <Cell
              key={index}
              array={array}
              index={index}
              shared={shared}
              row={cellRow}
              dim={dimmed(index)}
            />
          ))}
          {Array.from({ length: size }, (_, index) => (
            <div
              key={index}
              className="fw-array-index"
              style={{ gridColumn: index + 1, gridRow: indexRow }}
              aria-hidden="true"
            >
              {index}
            </div>
          ))}
          {below.map((pointer, position) => (
            <Pointer
              key={pointer.id}
              pointer={pointer}
              size={size}
              shared={shared}
              row={indexRow + position + 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ArrayView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: ArrayContent;
  ctx: PanelContext;
}) {
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const present = useMemo(() => new Set(state.present), [state.present]);
  const selected = ctx.selection.id;
  const shared: Shared = {
    content,
    state,
    present,
    current,
    selected,
    toggle: (id) => ctx.selection.select(selected === id ? undefined : id),
  };
  return (
    <div className="fw-arrays">
      {content.arrays.map((array) => (
        <ArrayRow key={array.id} array={array} shared={shared} />
      ))}
    </div>
  );
}

function cardSections({
  state,
  content,
  current,
  pane,
}: {
  state: ElementsState;
  content: ArrayContent;
  current: Parameters<typeof touched>[0];
  pane: { title: string };
}): CardSection[] {
  const labels = new Map(entitiesOf(content).map((entity) => [entity.id, entity.label]));
  const rows: { key: string; value: string }[] = [];
  for (const pointer of content.pointers) {
    if (!state.present.includes(pointer.id) || pointerAt(pointer, state.patches) === null) continue;
    rows.push({
      key: text(state.patches[pointer.id]?.label) ?? pointer.label ?? pointer.id,
      value: describePointer(content, pointer, state),
    });
  }
  for (const range of content.ranges) {
    if (!state.present.includes(range.id)) continue;
    const bounds = rangeBounds(content, range, state);
    rows.push({
      key: range.label ?? range.id,
      value:
        bounds === null
          ? 'not set'
          : bounds.from > bounds.to
            ? 'empty'
            : `indexes ${bounds.from} to ${bounds.to}`,
    });
  }
  return [
    ...changesSection(pane.title, labels, current),
    ...(rows.length === 0
      ? []
      : [{ id: 'where', title: `${pane.title}: now`, kind: 'fields' as const, rows }]),
  ];
}

export const arrayPanel: PanelType<ArrayContent, ElementsState> = {
  id: 'array',
  schema: { content: ArrayContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: ArrayView,
  cardSections,
  lint: (pane, walkthrough) => {
    const content = pane.content as ArrayContent;
    const paneIndex = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const where = ['layout', 'panes', paneIndex, 'content'];
    const problems: Problem[] = [];
    const arrays = new Set(content.arrays.map((array) => array.id));
    const pointers = new Map(content.pointers.map((pointer) => [pointer.id, pointer]));

    const checkArray = (
      kind: string,
      item: { id: string; array?: string | undefined },
      at: (string | number)[],
    ) => {
      if (item.array !== undefined && !arrays.has(item.array)) {
        problems.push({
          severity: 'error',
          rule: 'array/unknown-array',
          path: [...at, 'array'],
          message: `${kind} "${item.id}" names array "${item.array}", which is not in this pane`,
        });
        return undefined;
      }
      const array = arrayOf(content, item);
      if (array === undefined) {
        problems.push({
          severity: 'error',
          rule: 'array/ambiguous-array',
          path: at,
          message: `${kind} "${item.id}" must name its array: this pane has ${content.arrays.length}`,
        });
      }
      return array;
    };
    const checkIndex = (value: unknown, size: number, path: (string | number)[], what: string) => {
      if (value === null || value === undefined) return;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < -1 || value > size) {
        problems.push({
          severity: 'error',
          rule: 'array/index-out-of-range',
          path,
          message: `${what} must be an integer from -1 to ${size} (one past either end is allowed); got ${JSON.stringify(value)}`,
        });
      }
    };

    content.pointers.forEach((pointer, position) => {
      const array = checkArray('pointer', pointer, [...where, 'pointers', position]);
      if (array !== undefined) {
        checkIndex(
          pointer.at,
          slotCount(array),
          [...where, 'pointers', position, 'at'],
          `pointer "${pointer.id}" at`,
        );
      }
    });
    content.ranges.forEach((range, position) => {
      const at = [...where, 'ranges', position];
      const array = checkArray('range', range, at);
      const ends = { from: range.from, to: range.to };
      for (const [key, value] of Object.entries(ends)) {
        if (typeof value === 'string') {
          const pointer = pointers.get(value);
          if (pointer === undefined) {
            problems.push({
              severity: 'error',
              rule: 'array/unknown-pointer',
              path: [...at, key],
              message: `range "${range.id}" follows "${value}", which is not a pointer in this pane`,
            });
          } else if (array !== undefined && arrayOf(content, pointer)?.id !== array.id) {
            problems.push({
              severity: 'error',
              rule: 'array/pointer-other-array',
              path: [...at, key],
              message: `range "${range.id}" follows pointer "${value}", which points into another array`,
            });
          }
        } else if (array !== undefined) {
          checkIndex(value, slotCount(array), [...at, key], `range "${range.id}" ${key}`);
        }
      }
      if (
        typeof range.from === 'number' &&
        typeof range.to === 'number' &&
        range.from > range.to + 1
      ) {
        problems.push({
          severity: 'error',
          rule: 'array/bad-range',
          path: at,
          message: `range "${range.id}" runs from ${range.from} to ${range.to}; an empty range is from = to + 1`,
        });
      }
    });

    const kinds = new Map<string, { fields: string[]; size: number; kind: string }>();
    for (const array of content.arrays) {
      for (let index = 0; index < slotCount(array); index += 1) {
        kinds.set(cellId(array.id, index), { fields: CELL_FIELDS, size: 0, kind: 'cell' });
      }
    }
    for (const pointer of content.pointers) {
      const size = slotCount(arrayOf(content, pointer) ?? content.arrays[0]!);
      kinds.set(pointer.id, { fields: POINTER_FIELDS, size, kind: 'pointer' });
    }
    for (const range of content.ranges) {
      const size = slotCount(arrayOf(content, range) ?? content.arrays[0]!);
      kinds.set(range.id, { fields: RANGE_FIELDS, size, kind: 'range' });
    }

    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        (call.effects?.[pane.id] ?? []).forEach((effect, e) => {
          for (const key of Object.keys(effect)) {
            if (EFFECT_KEYS.includes(key)) continue;
            problems.push({
              severity: 'warning',
              rule: 'array/unknown-key',
              path: ['steps', s, 'calls', c, 'effects', pane.id, e, key],
              message: `an effect on an array takes ${EFFECT_KEYS.join(', ')}; "${key}" is ignored`,
            });
          }
          const { verb, id } = effectTarget(effect);
          const kind = id === undefined ? undefined : kinds.get(id);
          if (kind === undefined || verb !== 'update') return;
          const at = ['steps', s, 'calls', c, 'effects', pane.id, e, 'fields'];
          for (const [key, value] of Object.entries(effect.fields ?? {})) {
            if (!kind.fields.includes(key)) {
              problems.push({
                severity: 'error',
                rule: 'array/unknown-field',
                path: [...at, key],
                message: `a ${kind.kind} has no field "${key}". Fields: ${kind.fields.join(', ')}`,
              });
            } else if (kind.kind === 'cell' && key === 'value') {
              if (typeof value !== 'string' && typeof value !== 'number') {
                problems.push({
                  severity: 'error',
                  rule: 'array/bad-value',
                  path: [...at, key],
                  message: `the value of a cell is a string or a number; got ${JSON.stringify(value)}`,
                });
              }
            } else if (key === 'at') {
              checkIndex(value, kind.size, [...at, key], `"${id}" at`);
            } else if (key === 'from' || key === 'to') {
              if (typeof value === 'string') {
                if (!pointers.has(value)) {
                  problems.push({
                    severity: 'error',
                    rule: 'array/unknown-pointer',
                    path: [...at, key],
                    message: `"${value}" is not a pointer in this pane`,
                  });
                }
              } else {
                checkIndex(value, kind.size, [...at, key], `"${id}" ${key}`);
              }
            }
          }
        });
      });
    });
    return problems;
  },
};
