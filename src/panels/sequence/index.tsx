/**
 * sequence: lanes and the messages between them.
 *
 * Every call that has `from` and `to` is a message. It appears on its own
 * call, so authors write no effects for this panel. Lanes are elements too,
 * so a lane can be selected and shared with other panes by id.
 */
import { useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';
import {
  IdSchema,
  effectTarget,
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
import './sequence.css';

const SequenceContent = z
  .strictObject({
    /** Lane ids to show, in order. Defaults to every lane of the walkthrough. */
    lanes: z.array(IdSchema).min(1).optional(),
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
const ROW = 46;
const TOP = 30;
const BOTTOM = 18;
const CHAR = 7.25;

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
  const height = TOP + messages.length * ROW + BOTTOM;
  const laneX = (id: string) => gap * lanes.findIndex((lane) => lane.id === id) + gap / 2;
  const rowY = (index: number) => TOP + index * ROW + ROW / 2;

  const present = new Set(state.present);
  const current = touched(ctx.current);
  const selected = ctx.selection.id;
  const currentIndex = messages.findIndex((message) => message.id === ctx.call.id);

  // Keep the current message in view without moving the page.
  useEffect(() => {
    const box = scroller.current;
    if (box === null || currentIndex < 0) return;
    const y = TOP + currentIndex * ROW;
    if (y < box.scrollTop || y + ROW > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, y - box.clientHeight / 2);
    }
  }, [currentIndex]);

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
          {messages.map((message, index) => {
            if (!present.has(message.id)) return null;
            const y = rowY(index);
            const x1 = laneX(message.from!);
            const x2 = laneX(message.to!);
            const self = message.from === message.to;
            const mark = markOf(message.id, current);
            const related = selected !== undefined && touches(message, selected);
            const classes = [
              'fw-seq-message',
              `is-${mark}`,
              selected === message.id ? 'is-selected' : '',
              related ? 'is-related' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const room = Math.max(4, Math.floor((total - 12) / CHAR));
            const label =
              message.label.length > room ? `${message.label.slice(0, room - 1)}…` : message.label;
            const half = (label.length * CHAR) / 2;
            const centre = self ? x1 + 34 + half : (x1 + x2) / 2;
            const labelX = Math.min(Math.max(centre, half + 6), total - half - 6);

            const direction = x2 >= x1 ? 1 : -1;
            const tip = self ? x1 + 2 : x2 - direction * 2;
            const head = self
              ? `${tip},${y + 8} ${tip + 9},${y + 3.5} ${tip + 9},${y + 12.5}`
              : `${tip},${y} ${tip - direction * 9},${y - 4.5} ${tip - direction * 9},${y + 4.5}`;

            return (
              <g
                key={message.id}
                className={classes}
                data-entity={message.id}
                data-mark={mark}
                role="button"
                tabIndex={0}
                aria-pressed={selected === message.id}
                aria-label={`${message.label}${mark === 'idle' || mark === 'faded' ? '' : ` (${mark})`}`}
                onClick={() => toggle(message.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle(message.id);
                  }
                }}
              >
                <rect className="fw-seq-hit" x={0} y={y - ROW / 2} width={total} height={ROW} />
                {self ? (
                  <path
                    className="fw-seq-line"
                    d={`M ${x1} ${y - 8} H ${x1 + 26} V ${y + 8} H ${x1 + 4}`}
                  />
                ) : (
                  <line className="fw-seq-line" x1={x1} x2={x2 - direction * 6} y1={y} y2={y} />
                )}
                <polygon className="fw-seq-head" points={head} />
                <text
                  className="fw-seq-label"
                  x={labelX}
                  y={self ? y + 4 : y - 8}
                  textAnchor="middle"
                >
                  {label}
                  {label !== message.label && <title>{message.label}</title>}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
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
  ],
  implicit: (call, content) => (isMessage(call, content) ? [{ add: call.id }] : []),
  init: (content, walkthrough) =>
    initElements(
      lanesOf(content, walkthrough.lanes ?? []).map((lane) => ({ id: lane.id, initial: true })),
    ),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: SequenceView,
  lint: (pane, walkthrough) => {
    const content = pane.content as SequenceContent;
    const known = new Set((walkthrough.lanes ?? []).map((lane) => lane.id));
    const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const problems: Problem[] = [];
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
    return problems;
  },
};
