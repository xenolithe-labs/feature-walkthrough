import { describe, expect, it } from 'vitest';
import {
  createFolder,
  loadConfig,
  type ElementsState,
  type WalkthroughInput,
} from '../../src/core';
import {
  BusContent,
  committedAt,
  endOffset,
  lagOf,
  matchingRules,
  offsetOf,
  ownerOf,
  patternMatches,
  patternProblems,
} from '../../src/panels/bus/model';
import { createRegistry } from '../../src/registry';

type Effects = Record<string, Record<string, unknown>[]>;

function config(content: unknown, calls: Effects[] = [{}]): WalkthroughInput {
  return {
    id: 'b',
    title: 'B',
    layout: { panes: [{ id: 'bus', panel: 'bus', content }] },
    steps: [
      {
        id: 's1',
        title: 'S1',
        calls: calls.map((effects, index) => ({
          id: `c${index + 1}`,
          label: `Call ${index + 1}`,
          effects: effects as never,
        })),
      },
    ],
  };
}

const topic = {
  channels: [
    {
      id: 't',
      kind: 'topic',
      partitions: ['p0', 'p1'],
      events: [
        { id: 'a', partition: 'p0' },
        { id: 'b', partition: 'p0' },
        { id: 'c', partition: 'p1' },
        { id: 'd', partition: 'p0' },
      ],
      producers: [{ id: 'prod' }],
      consumers: [{ id: 'k1', group: 'g' }, { id: 'k2' }],
      cursors: [{ id: 'g-p0', partition: 'p0', group: 'g', owner: 'k1', at: 0 }],
    },
  ],
};

const bus = {
  channels: [
    {
      id: 'eb',
      kind: 'bus',
      events: [
        { id: 'e1', data: { source: 'shop', type: 'OrderPlaced', amount: 120 } },
        { id: 'e2', data: { source: 'shop', type: 'OrderCancelled' } },
      ],
      rules: [
        {
          id: 'r-placed',
          pattern: { type: ['OrderPlaced'] },
          targets: [{ id: 'fn' }],
        },
        { id: 'r-shop', pattern: { source: [{ prefix: 'sh' }] }, targets: [{ id: 'queue' }] },
      ],
    },
  ],
};

const load = (value: WalkthroughInput) => loadConfig(value, createRegistry());
const rules = (value: WalkthroughInput) =>
  load(value).problems.map((problem) => `${problem.severity} ${problem.rule}`);

function stateAt(content: unknown, calls: Effects[], c: number) {
  const w = load(config(content, calls)).walkthroughs[0]!;
  return {
    state: createFolder(w).at(0, c)['bus']!.state as ElementsState,
    parsed: BusContent.parse(w.panes[0]!.content),
  };
}

describe('bus panel: elements', () => {
  it('declares every element, and events start absent', () => {
    const pane = load(config(topic)).walkthroughs[0]!.panes[0]!;
    expect(pane.entities.map((entity) => entity.id)).toEqual([
      't',
      'a',
      'b',
      'c',
      'd',
      'prod',
      'k1',
      'k2',
      'g-p0',
    ]);
    expect(pane.entities.filter((entity) => entity.initial).map((entity) => entity.id)).toEqual([
      't',
      'prod',
      'k1',
      'k2',
      'g-p0',
    ]);
  });

  it('the reducer is the shared one: add publishes, remove takes away', () => {
    const { state } = stateAt(topic, [{ bus: [{ add: 'a' }] }, { bus: [{ remove: 'a' }] }], 0);
    expect(state.present).toContain('a');
    expect(
      stateAt(topic, [{ bus: [{ add: 'a' }] }, { bus: [{ remove: 'a' }] }], 1).state.present,
    ).not.toContain('a');
  });
});

describe('bus panel: derived values', () => {
  const calls: Effects[] = [
    { bus: [{ add: 'a' }, { add: 'b' }, { add: 'c' }] },
    { bus: [{ update: 'g-p0', fields: { at: 1 } }] },
    { bus: [{ add: 'd' }] },
    { bus: [{ update: 'g-p0', fields: { owner: 'k2' } }] },
    { bus: [{ update: 'g-p0', fields: { owner: null } }] },
  ];
  const at = (c: number) => {
    const { state, parsed } = stateAt(topic, calls, c);
    const channel = parsed.channels[0]!;
    return { state, channel, cursor: channel.cursors[0]! };
  };

  it('offsets are the position in the partition', () => {
    const { channel } = at(0);
    expect(channel.events.map((event) => offsetOf(channel, event))).toEqual([0, 1, 0, 2]);
  });

  it('the end of a partition is one past the last present event, so it moves when one is published', () => {
    const first = at(0);
    expect(endOffset(first.channel, 'p0', first.state.present)).toBe(2);
    expect(endOffset(first.channel, 'p1', first.state.present)).toBe(1);
    const later = at(2);
    expect(endOffset(later.channel, 'p0', later.state.present)).toBe(3);
  });

  it('lag is the end minus the committed offset, and one update moves the offset', () => {
    expect(lagOf(at(0).channel, at(0).cursor, at(0).state)).toBe(2);
    const moved = at(1);
    expect(committedAt(moved.cursor, moved.state.patches)).toBe(1);
    expect(lagOf(moved.channel, moved.cursor, moved.state)).toBe(1);
    const grown = at(2);
    expect(lagOf(grown.channel, grown.cursor, grown.state)).toBe(2);
  });

  it('lag is never negative', () => {
    const { channel, cursor, state } = at(0);
    expect(lagOf(channel, { ...cursor, at: 9 }, state)).toBe(0);
  });

  it('a rebalance changes the owner and keeps the committed offset', () => {
    const moved = at(3);
    expect(ownerOf(moved.cursor, moved.state.patches)).toBe('k2');
    expect(committedAt(moved.cursor, moved.state.patches)).toBe(1);
    const none = at(4);
    expect(ownerOf(none.cursor, none.state.patches)).toBeNull();
    expect(ownerOf(at(0).cursor, at(0).state.patches)).toBe('k1');
  });
});

describe('bus panel: event patterns', () => {
  const data = { source: 'shop', detail: { type: 'a', n: 3 }, tags: ['x', 'y'] };
  it.each([
    [{ source: ['shop'] }, true],
    [{ source: ['other', 'shop'] }, true],
    [{ source: ['other'] }, false],
    [{ source: ['shop'], detail: { type: ['b'] } }, false],
    [{ source: ['shop'], detail: { type: ['a'], n: [3] } }, true],
    [{ source: [{ prefix: 'sh' }] }, true],
    [{ source: [{ prefix: 'x' }] }, false],
    [{ source: [{ 'anything-but': ['shop'] }] }, false],
    [{ source: [{ 'anything-but': 'other' }] }, true],
    [{ missing: [{ exists: false }] }, true],
    [{ missing: [{ exists: true }] }, false],
    [{ source: [{ exists: true }] }, true],
    [{ tags: ['y'] }, true],
    [{ detail: ['a'] }, false],
    [{}, true],
  ])('%j matches: %s', (pattern, expected) => {
    expect(patternMatches(pattern, data)).toBe(expected);
  });

  it('a field named like an inherited property is not found', () => {
    expect(patternMatches({ constructor: [{ exists: false }] }, {})).toBe(true);
  });

  it('works out which rules match an event', () => {
    const channel = BusContent.parse(bus).channels[0]!;
    expect(matchingRules(channel, channel.events[0]!).map((rule) => rule.id)).toEqual([
      'r-placed',
      'r-shop',
    ]);
    expect(matchingRules(channel, channel.events[1]!).map((rule) => rule.id)).toEqual(['r-shop']);
  });

  it('reports what it cannot evaluate', () => {
    expect(
      patternProblems({ a: [{ suffix: 'x' }], b: 'x', c: [], d: { e: [{ prefix: 4 }] } }),
    ).toHaveLength(4);
    expect(patternProblems({ a: ['x', 1, null, true, { prefix: 'p' }, { exists: true }] })).toEqual(
      [],
    );
  });
});

describe('bus panel: lint', () => {
  const channel = topic.channels[0]!;
  const withChannel = (changes: Record<string, unknown>) => ({
    channels: [{ ...channel, ...changes }],
  });

  it('accepts the base content', () => {
    expect(rules(config(topic))).toEqual([]);
    expect(rules(config(bus))).toEqual([]);
  });

  it('bus/duplicate-element: one id twice, even across channels', () => {
    expect(rules(config(withChannel({ producers: [{ id: 'a' }] })))).toContain(
      'error bus/duplicate-element',
    );
  });

  it('bus/unknown-partition: an event, a cursor, a missing or surplus partition', () => {
    const bad = (events: unknown) => rules(config(withChannel({ events })));
    expect(bad([{ id: 'a', partition: 'p9' }])).toContain('error bus/unknown-partition');
    expect(bad([{ id: 'a' }])).toContain('error bus/unknown-partition');
    expect(
      rules(
        config(withChannel({ cursors: [{ id: 'g-p0', partition: 'zz', owner: null, at: 0 }] })),
      ),
    ).toContain('error bus/unknown-partition');
    expect(
      rules(
        config({ channels: [{ id: 'q', kind: 'queue', events: [{ id: 'm', partition: 'p0' }] }] }),
      ),
    ).toContain('error bus/unknown-partition');
  });

  it('bus/partitions-not-topic', () => {
    expect(rules(config({ channels: [{ id: 'q', kind: 'queue', partitions: ['p0'] }] }))).toContain(
      'error bus/partitions-not-topic',
    );
  });

  it('bus/cursor-not-topic', () => {
    expect(
      rules(config({ channels: [{ id: 'q', kind: 'queue', cursors: [{ id: 'cur' }] }] })),
    ).toContain('error bus/cursor-not-topic');
  });

  it('bus/offset-out-of-range: declared and updated', () => {
    expect(
      rules(
        config(withChannel({ cursors: [{ id: 'g-p0', partition: 'p0', owner: null, at: 4 }] })),
      ),
    ).toContain('error bus/offset-out-of-range');
    const update = rules(config(topic, [{ bus: [{ update: 'g-p0', fields: { at: 4 } }] }]));
    expect(update).toContain('error bus/bad-field');
    expect(rules(config(topic, [{ bus: [{ update: 'g-p0', fields: { at: 3 } }] }]))).toEqual([]);
  });

  it('bus/unknown-owner: declared and updated', () => {
    expect(
      rules(
        config(withChannel({ cursors: [{ id: 'g-p0', partition: 'p0', owner: 'ghost', at: 0 }] })),
      ),
    ).toContain('error bus/unknown-owner');
    expect(
      rules(config(topic, [{ bus: [{ update: 'g-p0', fields: { owner: 'ghost' } }] }])),
    ).toContain('error bus/bad-field');
  });

  it('bus/rule-not-bus', () => {
    expect(rules(config(withChannel({ rules: [{ id: 'r' }] })))).toContain(
      'error bus/rule-not-bus',
    );
  });

  it('bus/bad-pattern', () => {
    const bad = {
      channels: [{ id: 'eb', kind: 'bus', rules: [{ id: 'r', pattern: { type: 'OrderPlaced' } }] }],
    };
    expect(rules(config(bad))).toContain('error bus/bad-pattern');
  });

  it('bus/out-of-order: a later event cannot be published first', () => {
    expect(rules(config(topic, [{ bus: [{ add: 'b' }] }]))).toContain('error bus/out-of-order');
    expect(rules(config(topic, [{ bus: [{ add: 'a' }, { add: 'b' }] }]))).toEqual([]);
    // Another partition is independent.
    expect(rules(config(topic, [{ bus: [{ add: 'c' }] }]))).toEqual([]);
  });

  it('bus/unmatched-delivery: a call that invokes a target whose rule does not match', () => {
    const ok = [{ bus: [{ add: 'e1' }, { read: 'fn' }, { read: 'queue' }] }];
    expect(rules(config(bus, ok))).toEqual([]);
    const bad: Effects[] = [{ bus: [{ add: 'e1' }, { add: 'e2' }, { read: 'fn' }] }];
    // e1 is in the same call and matches, so it is fine; only a call with e2 alone is not.
    expect(rules(config(bus, bad))).toEqual([]);
    const alone = [{ bus: [{ add: 'e1' }] }, { bus: [{ add: 'e2' }, { read: 'fn' }] }];
    expect(rules(config(bus, alone))).toEqual(['warning bus/unmatched-delivery']);
  });

  it('bus/unknown-field, bad-field, bad-tone: lag is derived and cannot be written', () => {
    const fields = (id: string, f: Record<string, unknown>) =>
      rules(config(topic, [{ bus: [{ update: id, fields: f }] }]));
    expect(fields('g-p0', { lag: 3 })).toContain('error bus/unknown-field');
    expect(fields('k1', { state: 4 })).toContain('error bus/bad-field');
    expect(fields('k1', { tone: 'red' })).toContain('error bus/bad-tone');
    expect(fields('a', { state: 'maybe' })).toContain('error bus/bad-field');
    expect(fields('k1', { state: 'stopped', tone: 'warn' })).toEqual([]);
  });

  it('bus/unknown-key: an effect key the panel ignores', () => {
    expect(rules(config(topic, [{ bus: [{ read: 'k1', paths: ['x'] }] }]))).toContain(
      'warning bus/unknown-key',
    );
  });
});
