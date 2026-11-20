/**
 * sequence: lanes and the messages between them.
 *
 * Every call that has `from` and `to` is a message. It appears on its own
 * call, so authors write no effects for this panel. Lanes are elements too,
 * so a lane can be selected and shared with other panes by id.
 *
 * Content can add to that:
 *  - `styles`: how a message is drawn, by call id: "call" (the default), "reply" (dashed),
 *    "async" (open head) or "lost" (ends in a cross before the lane). A message from a lane
 *    to itself is drawn as a loop.
 *  - `fragments`: frames around a run of messages (`loop`, `alt`, `opt`, `par`), from one call
 *    id to another. `branches` say where each further alternative of an `alt` (or part of a
 *    `par`) starts. A frame appears with its first message.
 *  - `notes`: text on a lane, or across two lanes, that appears with the message it is `at`.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { z } from 'zod';
import {
  IdSchema,
  effectTarget,
  own,
  initElements,
  markOf,
  reduceElements,
  touched,
  type Call,
  type ElementsState,
  type Lane,
  type PanelContext,
  type PanelType,
  type Problem,
  type Walkthrough,
} from '../../core';
import { useWidth } from '../_shared/hooks';
import { revealScroll } from '../_shared/reveal';
import {
  CHAR,
  HEAD,
  ROW,
  TOP,
  crosses,
  fragmentRange,
  layoutSequence,
  messageShape,
  type MessageStyle,
} from './layout';
import { describeSequence } from './describe';
import './sequence.css';

const STYLES = ['call', 'reply', 'async', 'lost'] as const;

const SequenceContent = z
  .strictObject({
    /** Lane ids to show, in order. Defaults to every lane of the walkthrough. */
    lanes: z.array(IdSchema).min(1).optional(),
    /** How messages are drawn, by call id. A message not named here is a plain call. */
    styles: z.record(IdSchema, z.enum(STYLES)).optional(),
    /** Frames around a run of messages. */
    fragments: z
      .array(
        z.strictObject({
          id: IdSchema,
          kind: z.enum(['loop', 'alt', 'opt', 'par']),
          label: z.string().min(1),
          /** The call of the first message in the frame. */
          from: IdSchema,
          /** The call of the last message in the frame. */
          to: IdSchema,
          /** For alt and par: the call each further alternative starts at, with its label. */
          branches: z.array(z.strictObject({ at: IdSchema, label: z.string().min(1) })).optional(),
        }),
      )
      .optional(),
    /** Text on a lane (`over: "app"`) or across two lanes (`over: ["app", "as"]`). */
    notes: z
      .array(
        z.strictObject({
          id: IdSchema,
          /** The call of the message the note comes after. */
          at: IdSchema,
          over: z.union([IdSchema, z.tuple([IdSchema, IdSchema])]),
          text: z.string().min(1),
        }),
      )
      .optional(),
  })
  .default({});
type SequenceContent = z.infer<typeof SequenceContent>;

function isMessage(call: Call, content: SequenceContent): boolean {
  if (call.from === undefined || call.to === undefined) return false;
  if (content.lanes === undefined) return true;
  return content.lanes.includes(call.from) && content.lanes.includes(call.to);
}

function lanesOf(content: SequenceContent, all: readonly Lane[]): Lane[] {
  if (content.lanes === undefined) return [...all];
  return content.lanes.flatMap((id) => all.filter((lane) => lane.id === id));
}

function messagesOf(content: SequenceContent, walkthrough: Pick<Walkthrough, 'steps'>): Call[] {
  return walkthrough.steps.flatMap((step) => step.calls.filter((call) => isMessage(call, content)));
}

/** True when any effect of the call, in any pane, names the element. */
function touches(call: Call, id: string): boolean {
  return Object.values(call.effects ?? {}).some((effects) =>
    effects.some((effect) => effectTarget(effect).id === id),
  );
}

const MIN_GAP = 88;
const MAX_MIN_GAP = 150;

/**
 * The narrowest a lane may be: wide enough that the longest unbreakable word of a lane title
 * is not split in the middle, up to a ceiling, so long titles wrap between words instead.
 */
export function minLaneGap(titles: readonly string[]): number {
  const longest = Math.max(
    0,
    ...titles.flatMap((title) => title.split(/\s+/).map((w) => w.length)),
  );
  return Math.min(MAX_MIN_GAP, Math.max(MIN_GAP, Math.ceil(longest * CHAR) + 24));
}

function SequenceView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: SequenceContent;
  ctx: PanelContext;
}) {
  const lanes = useMemo(
    () => lanesOf(content, ctx.walkthrough.lanes),
    [content, ctx.walkthrough.lanes],
  );
  const messages = useMemo(() => messagesOf(content, ctx.walkthrough), [content, ctx.walkthrough]);
  const [frame, width] = useWidth<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement | null>(null);

  const floor = useMemo(() => minLaneGap(lanes.map((lane) => lane.title)), [lanes]);
  const gap = Math.max(floor, Math.floor(width / Math.max(lanes.length, 1)));
  const total = gap * lanes.length;
  const laneX = (id: string) => gap * lanes.findIndex((lane) => lane.id === id) + gap / 2;
  const layout = layoutSequence(
    messages.map((message) => ({ id: message.id, from: message.from!, to: message.to! })),
    content.fragments ?? [],
    (content.notes ?? []).filter((note) =>
      noteLanes(note.over).every((id) => laneIds(lanes).has(id)),
    ),
    { laneX, gap, total },
  );
  const height = layout.height;
  const rowY = (id: string) => layout.ys.get(id) ?? TOP;

  const present = new Set(state.present);
  const current = touched(ctx.current);
  const selected = ctx.selection.id;
  const currentIndex = messages.findIndex((message) => message.id === ctx.call.id);
  const currentY = currentIndex < 0 ? undefined : rowY(messages[currentIndex]!.id);
  // Messages a selected fragment holds.
  const held = new Set<string>();
  const chosen = (content.fragments ?? []).find((fragment) => fragment.id === selected);
  if (chosen !== undefined) {
    const range = fragmentRange(chosen, new Map(messages.map((m, position) => [m.id, position])));
    if (range !== undefined) {
      messages.slice(range[0], range[1] + 1).forEach((message) => held.add(message.id));
    }
  }

  // Keep the current message in view without moving the page.
  useEffect(() => {
    const box = scroller.current;
    if (box === null || currentY === undefined) return;
    const y = currentY - ROW / 2;
    if (y < box.scrollTop || y + ROW > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, y - box.clientHeight / 2);
    }
  }, [currentY]);

  // With more lanes than fit, the lanes of the current message may be out of sight sideways.
  useEffect(() => {
    const box = scroller.current;
    const message = messages[currentIndex];
    if (box === null || message === undefined) return;
    const ends = [laneX(message.from!), laneX(message.to!)];
    const start = Math.min(...ends) - gap / 2;
    const x = revealScroll(
      { scroll: box.scrollLeft, size: box.clientWidth },
      { start, size: Math.max(...ends) + gap / 2 - start },
      0,
    );
    if (x !== undefined) box.scrollLeft = x;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, gap]);

  const toggle = (id: string) => ctx.selection.select(selected === id ? undefined : id);
  const onKey = (id: string) => (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle(id);
    }
  };

  return (
    <div className="fw-seq" ref={frame}>
      <div className="fw-seq-scroll" ref={scroller}>
        <div
          className="fw-seq-lanes"
          style={{ gridTemplateColumns: `repeat(${lanes.length}, ${gap}px)`, width: total }}
        >
          {lanes.map((lane) => (
            <button
              key={lane.id}
              type="button"
              className={`fw-seq-lane${selected === lane.id ? ' is-selected' : ''}`}
              aria-pressed={selected === lane.id}
              data-entity={lane.id}
              onClick={() => toggle(lane.id)}
            >
              {lane.title}
            </button>
          ))}
        </div>
        <svg
          className="fw-seq-svg"
          width={total}
          height={height}
          role="group"
          aria-label={`${ctx.pane.title}: messages so far`}
        >
          {layout.frames.map((box) => {
            if (!present.has(box.id)) return null;
            const mark = markOf(box.id, current);
            const label = `${box.kind} [${box.label}]`;
            return (
              <g
                key={box.id}
                className={`fw-seq-frame is-${box.kind}${selected === box.id ? ' is-selected' : ''} is-${mark}`}
                data-entity={box.id}
                data-kind={box.kind}
                data-depth={box.depth}
              >
                <rect
                  className="fw-seq-box"
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                />
                {box.dividers.map(
                  (divider) =>
                    present.has(divider.at) && (
                      <g key={divider.at} className="fw-seq-divider" data-at={divider.at}>
                        <line x1={box.x} x2={box.x + box.width} y1={divider.y} y2={divider.y} />
                        <text x={box.x + 8} y={divider.y + 15}>
                          {`[${divider.label}]`}
                        </text>
                      </g>
                    ),
                )}
                <g
                  className="fw-seq-tab"
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === box.id}
                  aria-label={label}
                  onClick={() => toggle(box.id)}
                  onKeyDown={onKey(box.id)}
                >
                  <rect x={box.x} y={box.y} width={box.tab} height={HEAD - 4} />
                  <text x={box.x + 7} y={box.y + 12}>
                    {box.kind}
                  </text>
                  <text className="fw-seq-frame-label" x={box.x + box.tab + 8} y={box.y + 12}>
                    {`[${box.label}]`}
                  </text>
                </g>
              </g>
            );
          })}
          {lanes.map((lane) => (
            <line
              key={lane.id}
              className={`fw-seq-lifeline${selected === lane.id ? ' is-selected' : ''}`}
              x1={laneX(lane.id)}
              x2={laneX(lane.id)}
              y1={0}
              y2={height}
            />
          ))}
          {messages.map((message) => {
            if (!present.has(message.id)) return null;
            const y = rowY(message.id);
            const style = own(content.styles, message.id) ?? 'call';
            const shape = messageShape(
              style,
              laneX(message.from!),
              laneX(message.to!),
              y,
              message.label,
              total,
            );
            const self = message.from === message.to;
            const mark = markOf(message.id, current);
            const related =
              (selected !== undefined && touches(message, selected)) || held.has(message.id);
            const classes = [
              'fw-seq-message',
              `is-${mark}`,
              `is-${style}`,
              self ? 'is-self' : '',
              selected === message.id ? 'is-selected' : '',
              related ? 'is-related' : '',
            ]
              .filter(Boolean)
              .join(' ');
            const words = [STYLE_WORDS[style], self ? 'to itself' : '']
              .filter(Boolean)
              .concat(mark === 'idle' || mark === 'faded' ? [] : [mark]);

            return (
              <g
                key={message.id}
                className={classes}
                data-entity={message.id}
                data-mark={mark}
                data-style={style}
                role="button"
                tabIndex={0}
                aria-pressed={selected === message.id}
                aria-label={`${message.label}${words.length === 0 ? '' : ` (${words.join(', ')})`}`}
                onClick={() => toggle(message.id)}
                onKeyDown={onKey(message.id)}
              >
                <rect className="fw-seq-hit" x={0} y={y - ROW / 2} width={total} height={ROW} />
                <path className={`fw-seq-line${shape.dashed ? ' is-dashed' : ''}`} d={shape.line} />
                {shape.head !== undefined && (
                  <path
                    className={shape.head.kind === 'filled' ? 'fw-seq-head' : 'fw-seq-head is-open'}
                    d={shape.head.d}
                  />
                )}
                {shape.cross !== undefined && <path className="fw-seq-cross" d={shape.cross} />}
                <text
                  className="fw-seq-label"
                  x={shape.label.x}
                  y={shape.label.y}
                  textAnchor={shape.label.anchor}
                >
                  {shape.label.text}
                  {shape.label.text !== message.label && <title>{message.label}</title>}
                </text>
              </g>
            );
          })}
          {layout.notes.map((note) => {
            if (!present.has(note.id)) return null;
            const mark = markOf(note.id, current);
            return (
              <g
                key={note.id}
                className={`fw-seq-note is-${mark}${selected === note.id ? ' is-selected' : ''}`}
                data-entity={note.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected === note.id}
                aria-label={`Note: ${note.lines.join(' ')}`}
                onClick={() => toggle(note.id)}
                onKeyDown={onKey(note.id)}
              >
                <rect x={note.x} y={note.y} width={note.width} height={note.height} rx={3} />
                {note.lines.map((line, position) => (
                  <text key={position} x={note.x + 8} y={note.y + 15 + position * 14}>
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

const STYLE_WORDS: Record<MessageStyle, string> = {
  call: '',
  reply: 'reply',
  async: 'asynchronous',
  lost: 'lost, never arrives',
};

function noteLanes(over: string | readonly string[]): string[] {
  return typeof over === 'string' ? [over] : [...over];
}

function laneIds(lanes: readonly Lane[]): Set<string> {
  return new Set(lanes.map((lane) => lane.id));
}

export const sequencePanel: PanelType<SequenceContent, ElementsState> = {
  id: 'sequence',
  schema: { content: SequenceContent },
  entities: (content, walkthrough) => [
    ...lanesOf(content, walkthrough.lanes ?? []).map((lane) => ({
      id: lane.id,
      label: lane.title,
      initial: true,
    })),
    ...messagesOf(content, walkthrough).map((call) => ({ id: call.id, label: call.label })),
    ...(content.fragments ?? []).map((fragment) => ({
      id: fragment.id,
      label: `${fragment.kind} [${fragment.label}]`,
    })),
    ...(content.notes ?? []).map((note) => ({ id: note.id, label: `Note: ${note.text}` })),
  ],
  // A message appears on its own call, and brings along the frames that start there and the
  // notes that belong to it.
  implicit: (call, content) =>
    isMessage(call, content)
      ? [
          { add: call.id },
          ...(content.fragments ?? [])
            .filter((fragment) => fragment.from === call.id)
            .map((fragment) => ({ add: fragment.id })),
          ...(content.notes ?? [])
            .filter((note) => note.at === call.id)
            .map((note) => ({ add: note.id })),
        ]
      : [],
  init: (content, walkthrough) =>
    initElements(
      lanesOf(content, walkthrough.lanes ?? []).map((lane) => ({ id: lane.id, initial: true })),
    ),
  reduce: (state, effect) => reduceElements(state, effect),
  describe: describeSequence,
  Component: SequenceView,
  lint: (pane, walkthrough) => {
    const content = pane.content as SequenceContent;
    const known = new Set((walkthrough.lanes ?? []).map((lane) => lane.id));
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const base = ['layout', 'panes', index, 'content'];
    const problems: Problem[] = [];
    const add = (
      rule: string,
      path: (string | number)[],
      message: string,
      severity: 'error' | 'warning' = 'error',
    ) => problems.push({ severity, rule: `sequence/${rule}`, path: [...base, ...path], message });
    (content.lanes ?? []).forEach((id, position) => {
      if (!known.has(id)) {
        problems.push({
          severity: 'error',
          rule: 'sequence/unknown-lane',
          path: ['layout', 'panes', index, 'content', 'lanes', position],
          message: `lane "${id}" is not declared in the walkthrough`,
        });
      }
    });
    if (known.size === 0) {
      problems.push({
        severity: 'error',
        rule: 'sequence/no-lanes',
        path: ['layout', 'panes', index],
        message: 'a sequence pane needs the walkthrough to declare lanes',
      });
    }

    const messages = messagesOf(content, walkthrough);
    const position = new Map(messages.map((message, at) => [message.id, at]));
    const calls = new Map(
      walkthrough.steps.flatMap((step) => step.calls.map((call) => [call.id, call] as const)),
    );
    const shown = new Set(lanesOf(content, walkthrough.lanes ?? []).map((lane) => lane.id));
    /** Reports a call id that is not a message of this pane. */
    const message = (id: string, path: (string | number)[], what: string): boolean => {
      if (position.has(id)) return true;
      add(
        'unknown-call',
        path,
        calls.has(id)
          ? `${what} "${id}" is a call, but not a message of this pane (it needs "from" and "to" lanes this pane shows)`
          : `${what} "${id}" is not a call of the walkthrough`,
      );
      return false;
    };

    // Styles.
    for (const [id, style] of Object.entries(content.styles ?? {})) {
      if (!message(id, ['styles', id], 'the style names the call')) continue;
      const call = calls.get(id)!;
      if (style === 'lost' && call.from === call.to) {
        add(
          'lost-to-self',
          ['styles', id],
          `"${id}" goes from a lane to itself: a message to self cannot be lost`,
        );
      }
    }

    // Fragments.
    const ranges: { at: number; range: [number, number] }[] = [];
    (content.fragments ?? []).forEach((fragment, at) => {
      const from = message(fragment.from, ['fragments', at, 'from'], 'the fragment starts at');
      const to = message(fragment.to, ['fragments', at, 'to'], 'the fragment ends at');
      const range = from && to ? fragmentRange(fragment, position) : undefined;
      if (from && to && range === undefined) {
        add(
          'fragment-reversed',
          ['fragments', at],
          `fragment "${fragment.id}" ends at "${fragment.to}", which comes before its start "${fragment.from}"`,
        );
      }
      if (range !== undefined) ranges.push({ at, range });
      const branches = fragment.branches ?? [];
      if ((fragment.kind === 'loop' || fragment.kind === 'opt') && branches.length > 0) {
        add(
          'branches-not-allowed',
          ['fragments', at, 'branches'],
          `a ${fragment.kind} has one part: only alt and par take "branches"`,
        );
      }
      if (fragment.kind === 'alt' && branches.length === 0) {
        add(
          'alt-needs-branch',
          ['fragments', at],
          `alt "${fragment.id}" has no "branches": with one alternative it is an opt`,
          'warning',
        );
      }
      let previous = range?.[0] ?? -1;
      branches.forEach((branch, b) => {
        const path = ['fragments', at, 'branches', b, 'at'];
        if (!message(branch.at, path, 'the branch starts at')) return;
        const where = position.get(branch.at)!;
        if (range !== undefined && (where <= previous || where > range[1])) {
          add(
            'branch-order',
            path,
            where > range[1]
              ? `branch "${branch.at}" is after the end of fragment "${fragment.id}"`
              : `branch "${branch.at}" must come after the start of the fragment and after the branch before it`,
          );
        }
        previous = Math.max(previous, where);
      });
    });
    ranges.forEach((a, i) => {
      for (const b of ranges.slice(i + 1)) {
        if (!crosses(a.range, b.range)) continue;
        add(
          'fragment-overlap',
          ['fragments', b.at],
          `fragments "${content.fragments![a.at]!.id}" and "${content.fragments![b.at]!.id}" overlap without one holding the other`,
        );
      }
    });

    // Notes.
    (content.notes ?? []).forEach((note, at) => {
      message(note.at, ['notes', at, 'at'], 'the note is at');
      noteLanes(note.over).forEach((lane, l) => {
        if (shown.has(lane)) return;
        add(
          'unknown-lane',
          ['notes', at, 'over', ...(typeof note.over === 'string' ? [] : [l])],
          `the note is over lane "${lane}", which this pane does not show`,
        );
      });
    });
    return problems;
  },
};
