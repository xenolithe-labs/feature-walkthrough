/**
 * timeline: rows along a shared time axis, for heartbeats, timeouts, retries and leases.
 *
 * Time is a number with a unit that the content declares. Elements:
 *   - an instant (a heartbeat, an event) and a span (an attempt, a timer, a backoff wait, a
 *     lease) on a row. They are shown when their time has come, so stepping through the calls
 *     plays time forward;
 *   - a limit on a row, drawn on the axis: a silence limit (no more than `after` without a
 *     heartbeat) or a deadline. The panel works out whether it held, so a missed heartbeat
 *     shows as the gap that crossed the limit, and an instant that came after it is late;
 *   - the `now` marker: `update` with `fields.at` moves it forward. Everything after it is
 *     hidden, and what the move brought into view is marked as added for that call.
 * `read`, `update` with `fields` (`state`, `label`, `tone`), `add` and `remove` work as in other
 * panels. Every element has its place on the axis, so nothing moves as time passes.
 */
import { useMemo, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  effectTarget,
  initElements,
  markOf,
  own,
  touched,
  writtenEffects,
  type CardSection,
  type Effect,
  type Mark,
  type PanelContext,
  type PanelType,
  type Problem,
  type Touched,
} from '../../core';
import { changesSection, text, toneOf, uniqueLabels } from '../_shared/changes';
import { fieldProblems } from '../_shared/fields';
import { useWidth } from '../_shared/hooks';
import { useRevealTouched } from '../_shared/reveal';
import {
  NOW,
  STATES,
  TimelineContent,
  entitiesOf,
  evaluateLimit,
  instantShown,
  lateInstants,
  nowOf,
  reduce,
  refTime,
  revealed,
  spanDrawn,
  stagger,
  stateOf,
  timeText,
  type LimitDecl,
  type LimitView,
  type State,
  type TimelineState,
} from './model';
import { describeTimeline } from './describe';
import './timeline.css';

const EFFECT_KEYS = ['add', 'update', 'read', 'remove', 'focus', 'fields'];
const FIELDS = {
  now: ['at'],
  row: ['label', 'tone'],
  instant: ['state', 'label', 'tone'],
  span: ['state', 'label', 'tone'],
  limit: ['label', 'tone'],
} as const;
const LABEL = 112;
const PAD = 18;
const GLYPH: Record<State, string> = { ok: '✓', late: '!', missed: '?', failed: '✕', retried: '↻' };

interface Shared {
  content: TimelineContent;
  state: TimelineState;
  now: number;
  current: Touched;
  /** The call moved "now": nothing fades, and what it revealed counts as added. */
  moved: boolean;
  fresh: ReadonlySet<string>;
  late: ReadonlySet<string>;
  selected: string | undefined;
  plotPx: number;
  pct(time: number): number;
  toggle(id: string): void;
}

function markFor(shared: Shared, id: string): Mark {
  if (shared.fresh.has(id)) return 'added';
  const mark = markOf(id, shared.current);
  return shared.moved && mark === 'faded' ? 'idle' : mark;
}

function keys(select: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select();
    }
  };
}

function Button({
  shared,
  id,
  shown,
  className,
  label,
  style,
  children,
  data,
}: {
  shared: Shared;
  id: string;
  shown: boolean;
  className: string;
  label: string;
  style?: CSSProperties;
  children?: ReactNode;
  data?: Record<string, string | undefined>;
}) {
  const visible = shown || shared.current.removed.has(id);
  const mark = markFor(shared, id);
  const patch = own(shared.state.patches, id);
  const select = () => shared.toggle(id);
  return (
    <div
      className={`${className} ${visible ? `is-${mark}` : 'is-absent'}${shared.selected === id ? ' is-selected' : ''}`}
      style={style}
      data-entity={id}
      data-mark={visible ? mark : 'absent'}
      data-tone={toneOf(patch?.tone, undefined)}
      {...Object.fromEntries(
        Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]),
      )}
      role="button"
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      aria-pressed={shared.selected === id}
      aria-label={label}
      onClick={select}
      onKeyDown={keys(select)}
    >
      {children}
    </div>
  );
}

const nameOf = (shared: Shared, id: string, declared: string | undefined) =>
  text(own(shared.state.patches, id)?.label) ?? declared ?? id;

function limitWords(shared: Shared, limit: LimitDecl, view: LimitView): string {
  const { content } = shared;
  if (view.status === 'hidden') return 'not started';
  if (view.status === 'met') return 'held';
  if (view.status === 'missed') {
    return view.limitAt === null ? 'ran out' : `ran out at ${timeText(content, view.limitAt)}`;
  }
  return `runs out at ${timeText(content, view.limitAt ?? 0)}`;
}

function Row({
  row,
  shared,
  levelsFor,
}: {
  row: TimelineContent['rows'][number];
  shared: Shared;
  levelsFor: Map<string, number>;
}) {
  const { content, state, now } = shared;
  const instants = content.instants.filter((item) => item.row === row.id);
  const spans = content.spans.filter((item) => item.row === row.id);
  const limits = content.limits.filter((item) => item.row === row.id);
  const levels = instants.map((item) => levelsFor.get(item.id) ?? 0);
  const rows = Math.max(0, ...levels) + 1;
  const top = 6 + rows * 13;
  const height = top + 46 + limits.length * 20 + 6;
  const name = nameOf(shared, row.id, row.label);
  return (
    <div
      className="fw-tl-row"
      style={{ height, '--top': `${top}px` } as CSSProperties}
      data-row={row.id}
    >
      <Button
        shared={shared}
        id={row.id}
        shown={state.present.includes(row.id)}
        className="fw-tl-rowlabel"
        label={`row ${name}`}
      >
        <span className="fw-tl-name">{name}</span>
        {row.sub === undefined ? null : <span className="fw-tl-sub">{row.sub}</span>}
      </Button>
      <div className="fw-tl-track">
        <div className="fw-tl-plot">
          {spans.map((span) => {
            const drawn = spanDrawn(span, state, now);
            const spanState = stateOf(span, state.patches, shared.late);
            const left = shared.pct(drawn?.from ?? span.from);
            const right = shared.pct(drawn?.to ?? span.to);
            const label = nameOf(shared, span.id, span.label);
            const words = `${span.kind} ${label}, from ${timeText(content, span.from)} to ${timeText(content, span.to)}${spanState === undefined ? '' : `, ${spanState}`}`;
            return (
              <Button
                key={span.id}
                shared={shared}
                id={span.id}
                shown={drawn !== null}
                className="fw-tl-span"
                label={words}
                style={{ left: `${left}%`, width: `${Math.max(right - left, 0)}%` }}
                data={{
                  kind: span.kind,
                  state: spanState,
                  open: drawn?.open ? 'true' : undefined,
                  narrow:
                    ((right - left) / 100) * shared.plotPx < label.length * 6.4 + 14
                      ? 'true'
                      : undefined,
                }}
              >
                <span>{label}</span>
              </Button>
            );
          })}
          {instants.map((item, index) => {
            const shown = instantShown(item, state, now);
            const itemState = stateOf(item, state.patches, shared.late);
            const label = nameOf(shared, item.id, item.label);
            return (
              <Button
                key={item.id}
                shared={shared}
                id={item.id}
                shown={shown}
                className="fw-tl-instant"
                label={`${item.kind} ${label} at ${timeText(content, item.at)}${itemState === undefined ? '' : `, ${itemState}`}`}
                style={{ left: `${shared.pct(item.at)}%`, '--lv': levels[index] } as CSSProperties}
                data={{ kind: item.kind, state: itemState }}
              >
                <span className="fw-tl-marker" aria-hidden="true">
                  {itemState === undefined ? '' : GLYPH[itemState]}
                </span>
                <span className="fw-tl-ilabel">{label}</span>
              </Button>
            );
          })}
          {limits.map((limit, lane) => {
            const view = evaluateLimit(content, limit, state, now);
            const name = nameOf(shared, limit.id, limit.label);
            const shown = view.status !== 'hidden';
            const first = view.segments[0];
            const lastSegment = view.segments.at(-1);
            const anchor =
              first === undefined
                ? (refTime(content, limit.from, 'start') ?? content.axis.from)
                : first.from;
            const flip = shared.pct(anchor) > 55;
            const words = limitWords(shared, limit, view);
            return (
              <div
                key={limit.id}
                className="fw-tl-limitlane"
                style={{ top: `calc(var(--top) + 46px + ${lane * 20}px)` }}
                data-status={view.status}
              >
                {view.segments.map((segment, index) => (
                  <span
                    key={index}
                    className="fw-tl-seg"
                    data-kind={segment.kind}
                    aria-hidden="true"
                    style={{
                      left: `${shared.pct(segment.from)}%`,
                      width: `${Math.max(shared.pct(segment.to) - shared.pct(segment.from), 0)}%`,
                    }}
                  />
                ))}
                {view.limitAt === null || !shown ? null : (
                  <span
                    className="fw-tl-flag"
                    data-status={view.status}
                    aria-hidden="true"
                    style={{ left: `${shared.pct(view.limitAt)}%` }}
                  />
                )}
                <Button
                  shared={shared}
                  id={limit.id}
                  shown={shown}
                  className={`fw-tl-limit${flip ? ' is-flipped' : ''}`}
                  label={`limit ${name}: ${limit.after} ${content.axis.unit}, ${words}`}
                  style={
                    flip
                      ? { right: `${100 - shared.pct(lastSegment?.to ?? anchor)}%` }
                      : { left: `${shared.pct(anchor)}%` }
                  }
                  data={{ status: view.status }}
                >
                  <span>
                    {view.status === 'missed' ? '✕ ' : view.status === 'met' ? '✓ ' : ''}
                    {name}
                    {view.status === 'pending' && view.limitAt !== null
                      ? `, due ${timeText(content, view.limitAt)}`
                      : ''}
                  </span>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineView({
  state,
  content,
  ctx,
}: {
  state: TimelineState;
  content: TimelineContent;
  ctx: PanelContext;
}) {
  const [outer, width] = useWidth<HTMLDivElement>();
  const scroll = useRevealTouched<HTMLDivElement>(ctx.call.id);
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const { axis } = content;
  const units = axis.to - axis.from;
  const now = nowOf(content, state.patches);
  const plotPx = Math.max(width - LABEL - PAD * 2, units * axis.pxPerUnit);
  const pct = (time: number) =>
    ((Math.min(Math.max(time, axis.from), axis.to) - axis.from) / units) * 100;
  const selected = ctx.selection.id;
  const shared: Shared = {
    content,
    state,
    now,
    current,
    moved: state.moved?.call === ctx.call.id,
    fresh: revealed(content, state, ctx.call.id, now),
    late: lateInstants(content, state, now),
    selected,
    plotPx,
    pct,
    toggle: (id) => ctx.selection.select(selected === id ? undefined : id),
  };

  // Labels that would overlap go on a second or third level.
  const levelsFor = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of content.rows) {
      const items = content.instants.filter((item) => item.row === row.id);
      const levels = stagger(
        items.map((item) => ({
          x: ((item.at - axis.from) / units) * plotPx,
          width: (item.label ?? item.id).length * 6.6 + 6,
        })),
      );
      items.forEach((item, index) => out.set(item.id, Math.min(levels[index]!, 2)));
    }
    return out;
  }, [content, axis.from, units, plotPx]);

  const ticks: number[] = [];
  for (let at = axis.from; at <= axis.to + 1e-9; at += axis.tick) ticks.push(Number(at.toFixed(6)));
  const nowShown = true;
  return (
    <div className="fw-tl" ref={outer}>
      <div className="fw-tl-scroll" ref={scroll}>
        <div
          className="fw-tl-inner"
          style={
            {
              width: `${LABEL + PAD * 2 + plotPx}px`,
              '--label': `${LABEL}px`,
              '--pad': `${PAD}px`,
            } as CSSProperties
          }
        >
          <div className="fw-tl-overlay" aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className="fw-tl-grid" style={{ left: `${pct(tick)}%` }} />
            ))}
            <span className="fw-tl-future" style={{ left: `${pct(now)}%` }} />
            <span className="fw-tl-nowline" style={{ left: `${pct(now)}%` }} />
          </div>
          <div className="fw-tl-axis">
            <div className="fw-tl-unit">time ({axis.unit})</div>
            <div className="fw-tl-track">
              <div className="fw-tl-plot">
                {ticks.map((tick) => (
                  <span key={tick} className="fw-tl-tick" style={{ left: `${pct(tick)}%` }}>
                    {tick}
                  </span>
                ))}
                <Button
                  shared={shared}
                  id={NOW}
                  shown={nowShown}
                  className="fw-tl-now"
                  label={`now: ${timeText(content, now)}`}
                  style={{ left: `${pct(now)}%` }}
                >
                  now {Number.isInteger(now) ? now : Number(now.toFixed(2))}
                </Button>
              </div>
            </div>
          </div>
          {content.rows.map((row) => (
            <Row key={row.id} row={row} shared={shared} levelsFor={levelsFor} />
          ))}
        </div>
      </div>
    </div>
  );
}

function cardSections({
  state,
  content,
  current,
  pane,
}: {
  state: TimelineState;
  content: TimelineContent;
  current: Effect[];
  pane: { title: string };
}): CardSection[] {
  const labels = uniqueLabels(entitiesOf(content));
  const now = nowOf(content, state.patches);
  const rows = [{ key: 'now', value: timeText(content, now) }];
  const late = lateInstants(content, state, now);
  for (const limit of content.limits) {
    const view = evaluateLimit(content, limit, state, now);
    if (view.status === 'hidden') continue;
    const words =
      view.status === 'met'
        ? 'held'
        : view.status === 'missed'
          ? `ran out${view.limitAt === null ? '' : ` at ${timeText(content, view.limitAt)}`}`
          : `${timeText(content, view.limitAt ?? 0)} is the limit`;
    rows.push({ key: labels.get(limit.id) ?? limit.id, value: `${view.status}: ${words}` });
  }
  for (const id of late) rows.push({ key: labels.get(id) ?? id, value: 'late' });
  return [
    ...changesSection(pane.title, labels, current),
    { id: 'time', title: `${pane.title}: now`, kind: 'fields' as const, rows },
  ];
}

export const timelinePanel: PanelType<TimelineContent, TimelineState> = {
  id: 'timeline',
  schema: { content: TimelineContent },
  entities: entitiesOf,
  init: (content) => ({
    ...initElements(entitiesOf(content)),
    start: content.now ?? content.axis.from,
    moved: undefined,
  }),
  reduce,
  describe: describeTimeline,
  Component: TimelineView,
  cardSections,
  lint: (pane, walkthrough) => {
    const content = pane.content as TimelineContent;
    const paneIndex = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const where = ['layout', 'panes', paneIndex, 'content'];
    const { axis } = content;
    const problems: Problem[] = [];
    const error = (rule: string, path: (string | number)[], message: string) =>
      problems.push({ severity: 'error', rule: `timeline/${rule}`, path, message });

    const kinds = new Map<string, 'now' | 'row' | 'instant' | 'span' | 'limit'>([[NOW, 'now']]);
    const declare = (
      id: string,
      kind: 'row' | 'instant' | 'span' | 'limit',
      path: (string | number)[],
    ) => {
      if (kinds.has(id)) {
        error(
          'duplicate-element',
          path,
          id === NOW
            ? `"${NOW}" is the time marker of every timeline`
            : `"${id}" is declared twice in this pane`,
        );
      } else {
        kinds.set(id, kind);
      }
    };
    content.rows.forEach((row, i) => declare(row.id, 'row', [...where, 'rows', i]));
    content.instants.forEach((item, i) => declare(item.id, 'instant', [...where, 'instants', i]));
    content.spans.forEach((item, i) => declare(item.id, 'span', [...where, 'spans', i]));
    content.limits.forEach((item, i) => declare(item.id, 'limit', [...where, 'limits', i]));
    const rowIds = new Set(content.rows.map((row) => row.id));

    const inAxis = (time: number, path: (string | number)[], what: string) => {
      if (time < axis.from || time > axis.to) {
        error(
          'out-of-axis',
          path,
          `${what} is ${time}, outside the axis (${axis.from} to ${axis.to} ${axis.unit})`,
        );
      }
    };
    const checkRow = (row: string, path: (string | number)[], what: string) => {
      if (!rowIds.has(row))
        error(
          'unknown-row',
          [...path, 'row'],
          `${what} is on row "${row}", which is not in this pane`,
        );
    };
    if (content.now !== undefined) inAxis(content.now, [...where, 'now'], 'now');
    content.instants.forEach((item, i) => {
      const path = [...where, 'instants', i];
      checkRow(item.row, path, `instant "${item.id}"`);
      inAxis(item.at, [...path, 'at'], `instant "${item.id}"`);
    });
    content.spans.forEach((item, i) => {
      const path = [...where, 'spans', i];
      checkRow(item.row, path, `span "${item.id}"`);
      if (item.to < item.from) {
        error(
          'bad-span',
          path,
          `span "${item.id}" ends (${item.to}) before it starts (${item.from})`,
        );
      }
      inAxis(item.from, [...path, 'from'], `span "${item.id}" start`);
      inAxis(item.to, [...path, 'to'], `span "${item.id}" end`);
    });
    content.limits.forEach((limit, i) => {
      const path = [...where, 'limits', i];
      checkRow(limit.row, path, `limit "${limit.id}"`);
      const point = (ref: number | string, key: string) => {
        if (typeof ref === 'number') {
          inAxis(ref, [...path, key], `limit "${limit.id}" ${key}`);
        } else if (kinds.get(ref) !== 'instant' && kinds.get(ref) !== 'span') {
          error(
            'unknown-ref',
            [...path, key],
            `limit "${limit.id}" ${key} names "${ref}", which is not an instant or a span in this pane`,
          );
        }
      };
      point(limit.from, 'from');
      if (limit.until !== undefined) point(limit.until, 'until');
      if (limit.by !== undefined) point(limit.by, 'by');
      if (limit.reset === undefined && limit.until !== undefined) {
        error(
          'bad-limit',
          [...path, 'until'],
          `limit "${limit.id}" has "until" but no "reset": only a silence limit stops at "until"`,
        );
      }
      if (limit.reset !== undefined && limit.by !== undefined) {
        error(
          'bad-limit',
          [...path, 'by'],
          `limit "${limit.id}" has both "reset" and "by": a silence limit has no "by"`,
        );
      }
      if (limit.reset === undefined && limit.by === undefined && typeof limit.from !== 'string') {
        // a deadline from a bare time with nothing that can meet it still works: it runs out.
      }
    });

    // Walk the calls with the time marker: it only moves forward, and a call may only touch what
    // has already happened.
    let now = content.now ?? axis.from;
    const timeOf = (id: string): number | undefined => {
      const kind = kinds.get(id);
      if (kind === 'instant') return content.instants.find((item) => item.id === id)!.at;
      if (kind === 'span') return content.spans.find((item) => item.id === id)!.from;
      if (kind === 'limit') {
        const limit = content.limits.find((item) => item.id === id)!;
        return refTime(content, limit.from, 'start');
      }
      return undefined;
    };
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        writtenEffects(call, pane.id).forEach((effect, e) => {
          const at = ['steps', s, 'calls', c, 'effects', pane.id, e];
          for (const key of Object.keys(effect)) {
            if (!EFFECT_KEYS.includes(key)) {
              problems.push({
                severity: 'warning',
                rule: 'timeline/unknown-key',
                path: [...at, key],
                message: `an effect on a timeline takes ${EFFECT_KEYS.join(', ')}; "${key}" is ignored`,
              });
            }
          }
          const { verb, id } = effectTarget(effect);
          if (id === NOW && verb === 'update') {
            const moveTo = effect.fields?.at;
            if (typeof moveTo === 'number') {
              if (moveTo < now) {
                error(
                  'now-backwards',
                  [...at, 'fields', 'at'],
                  `now cannot go back: it is ${now} ${axis.unit} and this moves it to ${moveTo}`,
                );
              } else {
                now = moveTo;
              }
            }
          } else if (verb === 'read' || verb === 'update') {
            const time = id === undefined ? undefined : timeOf(id);
            if (time !== undefined && time > now) {
              error(
                'not-yet',
                [...at, verb],
                `"${id}" is at ${time} ${axis.unit}, but now is ${now} ${axis.unit} in this call: move now first`,
              );
            }
          }
        });
      });
    });

    problems.push(
      ...fieldProblems(
        pane,
        walkthrough,
        (id) => {
          const kind = kinds.get(id);
          return kind === undefined ? undefined : FIELDS[kind];
        },
        (id, field, value) => {
          if (field === 'state') {
            return typeof value === 'string' && (STATES as readonly string[]).includes(value)
              ? null
              : `a state is one of: ${STATES.join(', ')}`;
          }
          if (field === 'at' && id === NOW) {
            return typeof value === 'number' && value >= axis.from && value <= axis.to
              ? null
              : `now is a number from ${axis.from} to ${axis.to} (${axis.unit}); got ${JSON.stringify(value)}`;
          }
          return undefined;
        },
      ),
    );
    return problems;
  },
};
