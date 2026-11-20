/**
 * bus: channels that hold an ordered row of events, and what attaches to them.
 *
 * For event-driven systems: a Kafka topic with partitions, a queue, an EventBridge bus. Elements:
 *   - a channel, an event, a producer, a consumer and a rule's target: `add` publishes or shows,
 *     `read` marks (delivered, matched, invoked), `update` with `fields` changes `state` (an
 *     event's `state` is `delivered`, `acked`, `failed` or `dead`), `remove` takes it away;
 *   - a cursor, a group's committed offset in one partition: `update` with `fields.at` moves it,
 *     `fields.owner` hands the partition to another consumer (a rebalance), and the lag is
 *     worked out from the end of the partition, never written;
 *   - a rule, with an event pattern: the panel works out which rules match the events a call
 *     touches, so the reader sees which rule matched and which did not.
 * Every event has a slot that keeps its place, so nothing moves when one is published.
 */
import { useMemo, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  effectTarget,
  initElements,
  markOf,
  own,
  reduceElements,
  touched,
  writtenEffects,
  type CardSection,
  type Effect,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
  type Touched,
} from '../../core';
import { changesSection, text, toneOf, uniqueLabels } from '../_shared/changes';
import { fieldProblems } from '../_shared/fields';
import { useRevealTouched } from '../_shared/reveal';
import {
  BusContent,
  EVENT_STATES,
  committedAt,
  elementsOf,
  endOffset,
  entitiesOf,
  eventState,
  lagOf,
  laneEvents,
  lanesOf,
  matchingRules,
  offsetOf,
  ownerOf,
  patternProblems,
  type ChannelDecl,
  type CursorDecl,
  type EventDecl,
  type RuleDecl,
} from './model';
import './bus.css';

const EFFECT_KEYS = ['add', 'update', 'read', 'remove', 'focus', 'fields'];
const FIELDS = {
  channel: ['label', 'tone'],
  event: ['state', 'label', 'tone'],
  producer: ['state', 'label', 'tone'],
  consumer: ['state', 'label', 'tone'],
  target: ['state', 'label', 'tone'],
  rule: ['state', 'label', 'tone'],
  cursor: ['at', 'owner', 'tone'],
} as const;
const GLYPH = { delivered: '▸', acked: '✓', failed: '✕', dead: '☠' } as const;

interface Shared {
  content: BusContent;
  state: ElementsState;
  present: ReadonlySet<string>;
  current: Touched;
  selected: string | undefined;
  /** The events of each channel that the current call touched. */
  subjects: ReadonlyMap<string, EventDecl[]>;
  toggle(id: string): void;
}

/** Enter and Space select; the arrow keys keep moving through the walkthrough. */
function keys(select: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select();
    }
  };
}

function Item({
  id,
  shared,
  kind,
  label,
  className,
  children,
  extra,
  style,
  hidden = false,
}: {
  id: string;
  shared: Shared;
  kind: string;
  label: string;
  className: string;
  children: ReactNode;
  extra?: string;
  style?: CSSProperties;
  hidden?: boolean;
}) {
  const shown = !hidden && (shared.present.has(id) || shared.current.removed.has(id));
  const mark = markOf(id, shared.current);
  // State a reader needs at every call is never faded: only events and rules take part.
  const drawn = mark === 'faded' && !['event', 'rule'].includes(kind) ? 'idle' : mark;
  const patch = own(shared.state.patches, id);
  const select = () => shared.toggle(id);
  return (
    <div
      className={`${className} ${shown ? `is-${drawn}` : 'is-absent'}${shared.selected === id ? ' is-selected' : ''}`}
      style={style}
      data-entity={id}
      data-kind={kind}
      data-mark={shown ? drawn : 'absent'}
      data-tone={toneOf(patch?.tone, undefined)}
      role="button"
      tabIndex={shown ? 0 : -1}
      aria-hidden={shown ? undefined : true}
      aria-pressed={shared.selected === id}
      aria-label={`${kind} ${label}${extra === undefined ? '' : `, ${extra}`}`}
      onClick={select}
      onKeyDown={keys(select)}
    >
      {children}
    </div>
  );
}

const labelOf = (shared: Shared, id: string, declared: string | undefined) =>
  text(own(shared.state.patches, id)?.label) ?? declared ?? id;

function Party({
  shared,
  id,
  kind,
  declared,
  sub,
  group,
}: {
  shared: Shared;
  id: string;
  kind: 'producer' | 'consumer' | 'target';
  declared: string | undefined;
  sub: string | undefined;
  group?: string | undefined;
}) {
  const name = labelOf(shared, id, declared);
  const state = text(own(shared.state.patches, id)?.state);
  const second = [group, state ?? sub].filter((part) => part !== undefined).join(' · ');
  return (
    <Item
      id={id}
      shared={shared}
      kind={kind}
      label={name}
      className="fw-bus-party"
      extra={second === '' ? undefined : second}
    >
      <span className="fw-bus-name">{name}</span>
      {second === '' ? null : <span className="fw-bus-sub">{second}</span>}
    </Item>
  );
}

function EventChip({
  event,
  channel,
  shared,
  column,
  row,
}: {
  event: EventDecl;
  channel: ChannelDecl;
  shared: Shared;
  column: number;
  row: number;
}) {
  const state = eventState(event, shared.state.patches);
  const name = labelOf(shared, event.id, event.label);
  const offset = channel.kind === 'topic' ? offsetOf(channel, event) : undefined;
  const where = offset === undefined ? '' : `, offset ${offset}`;
  return (
    <Item
      id={event.id}
      shared={shared}
      kind="event"
      label={name}
      className="fw-bus-event"
      style={{ gridColumn: column, gridRow: row }}
      extra={`${state ?? 'published'}${where}`}
    >
      <span className="fw-bus-event-name" data-state={state}>
        {name}
      </span>
      {state === undefined ? null : (
        <span className="fw-bus-glyph" data-state={state} aria-hidden="true">
          {GLYPH[state]}
        </span>
      )}
    </Item>
  );
}

function Cursor({
  cursor,
  channel,
  shared,
  column,
  row,
}: {
  cursor: CursorDecl;
  channel: ChannelDecl;
  shared: Shared;
  column: number;
  row: number;
}) {
  const at = committedAt(cursor, shared.state.patches);
  const owner = ownerOf(cursor, shared.state.patches);
  const lag = lagOf(channel, cursor, shared.state);
  const end = endOffset(channel, cursor.partition, shared.state.present);
  const group = cursor.group ?? cursor.id;
  const ownerName = owner === null ? 'no owner' : owner;
  const words = `${group}${cursor.partition === undefined ? '' : ` ${cursor.partition}`}: committed offset ${at}, end ${end}, lag ${lag}, ${owner === null ? 'no owner' : `owner ${owner}`}`;
  return (
    <Item
      id={cursor.id}
      shared={shared}
      kind="cursor"
      label={group}
      className="fw-bus-cursor"
      style={{ gridColumn: column, gridRow: row }}
      extra={words}
    >
      <span>
        {ownerName} <span className="fw-bus-lag" data-lag={lag > 0 ? 'some' : 'none'}>lag {lag}</span>
      </span>
    </Item>
  );
}

function Lanes({ channel, shared }: { channel: ChannelDecl; shared: Shared }) {
  const topic = channel.kind === 'topic';
  const lanes = lanesOf(channel);
  const longest = Math.max(1, ...lanes.map((lane) => laneEvents(channel, lane).length));
  const slots = longest + (topic ? 1 : 0);
  let row = 1;
  const cells: ReactNode[] = [];
  for (const lane of lanes) {
    const events = laneEvents(channel, lane);
    const cursors = channel.cursors.filter((cursor) => cursor.partition === lane);
    const eventRow = row;
    if (lane !== undefined) {
      cells.push(
        <div key={`n-${lane}`} className="fw-bus-lane" style={{ gridColumn: 1, gridRow: eventRow }}>
          {lane}
        </div>,
      );
    }
    events.forEach((event, index) => {
      cells.push(
        <EventChip
          key={event.id}
          event={event}
          channel={channel}
          shared={shared}
          column={index + 2}
          row={eventRow}
        />,
      );
    });
    if (events.length === 0) {
      cells.push(
        <div key={`e-${lane ?? ''}`} className="fw-bus-empty" style={{ gridColumn: 2, gridRow: eventRow }} />,
      );
    }
    row += 1;
    if (topic) {
      for (let index = 0; index < slots; index += 1) {
        cells.push(
          <div
            key={`o-${lane ?? ''}-${index}`}
            className="fw-bus-offset"
            style={{ gridColumn: index + 2, gridRow: row }}
            aria-hidden="true"
          >
            {index}
          </div>,
        );
      }
      row += 1;
      for (const cursor of cursors) {
        const at = committedAt(cursor, shared.state.patches);
        cells.push(
          <Cursor
            key={cursor.id}
            cursor={cursor}
            channel={channel}
            shared={shared}
            column={Math.min(Math.max(at, 0), slots - 1) + 2}
            row={row}
          />,
        );
        row += 1;
      }
    }
  }
  const style = { '--n': slots } as CSSProperties;
  return (
    <div className="fw-bus-scroll">
      <div className="fw-bus-grid" style={style} data-partitioned={channel.partitions !== undefined || undefined}>
        {cells}
      </div>
    </div>
  );
}

function matchLine(rule: RuleDecl, channel: ChannelDecl, shared: Shared): string | undefined {
  const subjects = shared.subjects.get(channel.id) ?? [];
  if (subjects.length === 0) return undefined;
  const matched = subjects.filter((event) => matchingRules(channel, event).includes(rule));
  return matched.length === 0 ? 'no match' : `matches ${matched.map((event) => event.label ?? event.id).join(', ')}`;
}

function Rule({ rule, channel, shared }: { rule: RuleDecl; channel: ChannelDecl; shared: Shared }) {
  const line = matchLine(rule, channel, shared);
  const name = labelOf(shared, rule.id, rule.label);
  const pattern = rule.pattern === undefined ? 'every event' : JSON.stringify(rule.pattern);
  return (
    <div className="fw-bus-rule-row">
      <Item
        id={rule.id}
        shared={shared}
        kind="rule"
        label={name}
        className="fw-bus-rule"
        extra={`pattern ${pattern}${line === undefined ? '' : `, ${line}`}`}
      >
        <span className="fw-bus-name">{name}</span>
        <code className="fw-bus-pattern" title={pattern}>
          {pattern}
        </code>
        {line === undefined ? null : (
          <span className="fw-bus-match" data-match={line === 'no match' ? 'no' : 'yes'}>
            {line === 'no match' ? '✕ ' : '✓ '}
            {line}
          </span>
        )}
      </Item>
      {rule.targets.length === 0 ? null : (
        <span className="fw-bus-arrow" aria-hidden="true">
          {'→'}
        </span>
      )}
      {rule.targets.map((target) => (
        <Party
          key={target.id}
          shared={shared}
          id={target.id}
          kind="target"
          declared={target.label}
          sub={target.sub}
        />
      ))}
    </div>
  );
}

function Channel({ channel, shared }: { channel: ChannelDecl; shared: Shared }) {
  const name = labelOf(shared, channel.id, channel.label);
  return (
    <section className="fw-bus-channel" data-channel={channel.id} data-kind={channel.kind}>
      <header className="fw-bus-head">
        <Item
          id={channel.id}
          shared={shared}
          kind="channel"
          label={name}
          className="fw-bus-title"
          extra={channel.kind}
        >
          <span className="fw-bus-name">{name}</span>
          <span className="fw-bus-kind">{channel.kind}</span>
        </Item>
        {channel.producers.map((producer) => (
          <Party
            key={producer.id}
            shared={shared}
            id={producer.id}
            kind="producer"
            declared={producer.label}
            sub={producer.sub}
          />
        ))}
        {channel.producers.length === 0 ? null : (
          <span className="fw-bus-arrow" aria-hidden="true">
            {'→'}
          </span>
        )}
      </header>
      <Lanes channel={channel} shared={shared} />
      {channel.consumers.length === 0 ? null : (
        <div className="fw-bus-parties" role="group" aria-label={`consumers of ${name}`}>
          <span className="fw-bus-caption">consumers</span>
          {channel.consumers.map((consumer) => (
            <Party
              key={consumer.id}
              shared={shared}
              id={consumer.id}
              kind="consumer"
              declared={consumer.label}
              sub={consumer.sub}
              group={consumer.group}
            />
          ))}
        </div>
      )}
      {channel.rules.length === 0 ? null : (
        <div className="fw-bus-rules" role="group" aria-label={`rules of ${name}`}>
          <span className="fw-bus-caption">rules</span>
          {channel.rules.map((rule) => (
            <Rule key={rule.id} rule={rule} channel={channel} shared={shared} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The events of each channel that the current call added, read or updated. */
function subjectsOf(content: BusContent, current: Touched): Map<string, EventDecl[]> {
  const out = new Map<string, EventDecl[]>();
  for (const channel of content.channels) {
    out.set(
      channel.id,
      channel.events.filter(
        (event) =>
          current.added.has(event.id) || current.read.has(event.id) || current.updated.has(event.id),
      ),
    );
  }
  return out;
}

function BusView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: BusContent;
  ctx: PanelContext;
}) {
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const present = useMemo(() => new Set(state.present), [state.present]);
  const subjects = useMemo(() => subjectsOf(content, current), [content, current]);
  const selected = ctx.selection.id;
  const ref = useRevealTouched<HTMLDivElement>(ctx.call.id);
  const shared: Shared = {
    content,
    state,
    present,
    current,
    selected,
    subjects,
    toggle: (id) => ctx.selection.select(selected === id ? undefined : id),
  };
  return (
    <div className="fw-bus" ref={ref}>
      {content.channels.map((channel) => (
        <Channel key={channel.id} channel={channel} shared={shared} />
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
  content: BusContent;
  current: Effect[];
  pane: { title: string };
}): CardSection[] {
  const labels = uniqueLabels(entitiesOf(content));
  const rows: { key: string; value: string }[] = [];
  const touchedNow = touched(current);
  const subjects = subjectsOf(content, touchedNow);
  for (const channel of content.channels) {
    for (const cursor of channel.cursors) {
      if (!state.present.includes(cursor.id)) continue;
      const owner = ownerOf(cursor, state.patches);
      const end = endOffset(channel, cursor.partition, state.present);
      rows.push({
        key: `${cursor.group ?? cursor.id}${cursor.partition === undefined ? '' : ` ${cursor.partition}`}`,
        value: `${owner === null ? 'no owner' : `owner ${owner}`}, committed ${committedAt(cursor, state.patches)} of ${end}, lag ${lagOf(channel, cursor, state)}`,
      });
    }
    const events = subjects.get(channel.id) ?? [];
    if (events.length === 0) continue;
    for (const rule of channel.rules) {
      if (!state.present.includes(rule.id)) continue;
      const matched = events.filter((event) => matchingRules(channel, event).includes(rule));
      rows.push({
        key: `rule ${rule.label ?? rule.id}`,
        value: matched.length === 0 ? 'no match' : `matches ${matched.map((event) => event.label ?? event.id).join(', ')}`,
      });
    }
  }
  return [
    ...changesSection(pane.title, labels, current),
    ...(rows.length === 0
      ? []
      : [{ id: 'now', title: `${pane.title}: now`, kind: 'fields' as const, rows }]),
  ];
}

export const busPanel: PanelType<BusContent, ElementsState> = {
  id: 'bus',
  schema: { content: BusContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: BusView,
  cardSections,
  lint: (pane, walkthrough) => {
    const content = pane.content as BusContent;
    const paneIndex = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    const where = ['layout', 'panes', paneIndex, 'content'];
    const problems: Problem[] = [];
    const error = (rule: string, path: (string | number)[], message: string) =>
      problems.push({ severity: 'error', rule: `bus/${rule}`, path, message });

    const located = elementsOf(content);
    const byId = new Map<string, (typeof located)[number]>();
    for (const item of located) {
      if (byId.has(item.id)) {
        error('duplicate-element', where, `"${item.id}" is declared twice in this pane`);
      } else {
        byId.set(item.id, item);
      }
    }

    content.channels.forEach((channel, c) => {
      const at = [...where, 'channels', c];
      const partitions = channel.partitions ?? [];
      if (channel.kind !== 'topic' && partitions.length > 0) {
        error('partitions-not-topic', [...at, 'partitions'], `only a topic has partitions; "${channel.id}" is a ${channel.kind}`);
      }
      const checkPartition = (partition: string | undefined, path: (string | number)[], what: string) => {
        if (partitions.length === 0) {
          if (partition !== undefined) {
            error('unknown-partition', path, `${what} names partition "${partition}", but "${channel.id}" has no partitions`);
          }
        } else if (partition === undefined || !partitions.includes(partition)) {
          error(
            'unknown-partition',
            path,
            `${what} must name one of the partitions of "${channel.id}": ${partitions.join(', ')}`,
          );
        }
      };
      channel.events.forEach((event, e) =>
        checkPartition(event.partition, [...at, 'events', e, 'partition'], `event "${event.id}"`),
      );
      channel.cursors.forEach((cursor, k) => {
        const path = [...at, 'cursors', k];
        if (channel.kind !== 'topic') {
          error('cursor-not-topic', path, `"${cursor.id}": only a topic has a committed offset; "${channel.id}" is a ${channel.kind}`);
          return;
        }
        checkPartition(cursor.partition, [...path, 'partition'], `cursor "${cursor.id}"`);
        const size = laneEvents(channel, cursor.partition).length;
        if (cursor.at < 0 || cursor.at > size) {
          error('offset-out-of-range', [...path, 'at'], `cursor "${cursor.id}" is at ${cursor.at}; the partition has ${size} events, so the offset is 0 to ${size}`);
        }
        if (cursor.owner !== null && !channel.consumers.some((consumer) => consumer.id === cursor.owner)) {
          error('unknown-owner', [...path, 'owner'], `cursor "${cursor.id}" is owned by "${cursor.owner}", which is not a consumer of "${channel.id}"`);
        }
      });
      channel.rules.forEach((rule, r) => {
        const path = [...at, 'rules', r];
        if (channel.kind !== 'bus') {
          error('rule-not-bus', path, `"${rule.id}": rules belong on a bus; "${channel.id}" is a ${channel.kind}`);
        }
        if (rule.pattern !== undefined) {
          for (const issue of patternProblems(rule.pattern)) {
            error('bad-pattern', [...path, 'pattern', ...issue.path], `rule "${rule.id}": ${issue.message}`);
          }
        }
      });
    });

    // Events reach a channel in the order they are declared, which is what gives a topic its
    // offsets. Walk the calls and make sure that no call publishes one before an earlier one.
    const everPresent = new Set(located.filter((item) => item.initial).map((item) => item.id));
    const eventsById = new Map(
      content.channels.flatMap((channel) =>
        channel.events.map((event) => [event.id, { event, channel }] as const),
      ),
    );
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        const effects = writtenEffects(call, pane.id);
        effects.forEach((effect, e) => {
          for (const key of Object.keys(effect)) {
            if (!EFFECT_KEYS.includes(key)) {
              problems.push({
                severity: 'warning',
                rule: 'bus/unknown-key',
                path: ['steps', s, 'calls', c, 'effects', pane.id, e, key],
                message: `an effect on a bus takes ${EFFECT_KEYS.join(', ')}; "${key}" is ignored`,
              });
            }
          }
          const { verb, id } = effectTarget(effect);
          const found = id === undefined ? undefined : eventsById.get(id);
          if (verb === 'add') everPresent.add(id);
          if (verb !== 'add' || found === undefined) return;
          const lane = laneEvents(found.channel, found.event.partition);
          const earlier = lane.slice(0, lane.indexOf(found.event));
          const missing = earlier.find((other) => !everPresent.has(other.id));
          if (missing !== undefined) {
            error(
              'out-of-order',
              ['steps', s, 'calls', c, 'effects', pane.id, e, 'add'],
              `"${id}" is declared after "${missing.id}" in ${found.event.partition ?? `"${found.channel.id}"`}, so its offset is later; publish "${missing.id}" first`,
            );
          }
        });

        // A target invoked by a call that publishes an event its rule does not match.
        const events = effects.flatMap((effect) => {
          const { verb, id } = effectTarget(effect);
          const found = id === undefined ? undefined : eventsById.get(id);
          return found !== undefined && verb !== 'remove' && verb !== 'focus' ? [found] : [];
        });
        if (events.length === 0) return;
        effects.forEach((effect, e) => {
          const { verb, id } = effectTarget(effect);
          const item = id === undefined ? undefined : byId.get(id);
          if (item?.kind !== 'target' || item.rule === undefined || verb === 'remove' || verb === 'focus') return;
          const rule = item.rule;
          const sameChannel = events.filter((found) => found.channel === item.channel);
          if (sameChannel.length === 0) return;
          if (!sameChannel.some((found) => matchingRules(found.channel, found.event).includes(rule))) {
            problems.push({
              severity: 'warning',
              rule: 'bus/unmatched-delivery',
              path: ['steps', s, 'calls', c, 'effects', pane.id, e, verb],
              message: `"${id}" belongs to rule "${rule.id}", which does not match ${sameChannel.map((found) => `"${found.event.id}"`).join(', ')}`,
            });
          }
        });
      });
    });

    const kindOf = (id: string) => byId.get(id)?.kind;
    problems.push(
      ...fieldProblems(
        pane,
        walkthrough,
        (id) => {
          const kind = kindOf(id);
          return kind === undefined ? undefined : FIELDS[kind];
        },
        (id, field, value) => {
          const item = byId.get(id);
          if (item === undefined) return undefined;
          if (field === 'state' && item.kind === 'event') {
            return typeof value === 'string' && (EVENT_STATES as readonly string[]).includes(value)
              ? null
              : `an event state is one of: ${EVENT_STATES.join(', ')}`;
          }
          const cursor = item.channel.cursors.find((other) => other.id === id);
          if (field === 'at') {
            const size = laneEvents(item.channel, cursor?.partition).length;
            return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= size
              ? null
              : `a committed offset is a whole number from 0 to ${size} (the events in the partition); got ${JSON.stringify(value)}`;
          }
          if (field === 'owner') {
            return value === null ||
              (typeof value === 'string' && item.channel.consumers.some((consumer) => consumer.id === value))
              ? null
              : `an owner is a consumer of "${item.channel.id}", or null; got ${JSON.stringify(value)}`;
          }
          return undefined;
        },
      ),
    );
    return problems;
  },
};
