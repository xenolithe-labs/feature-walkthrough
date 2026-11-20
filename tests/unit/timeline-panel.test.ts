import { describe, expect, it } from 'vitest';
import { createFolder, loadConfig, type WalkthroughInput } from '../../src/core';
import {
  TimelineContent,
  evaluateLimit,
  instantShown,
  lateInstants,
  nowOf,
  revealed,
  spanDrawn,
  stagger,
  stateOf,
  type TimelineState,
} from '../../src/panels/timeline/model';
import { createRegistry } from '../../src/registry';

type Effects = Record<string, Record<string, unknown>[]>;

function config(content: unknown, calls: Effects[] = [{}]): WalkthroughInput {
  return {
    id: 't',
    title: 'T',
    layout: { panes: [{ id: 'tl', panel: 'timeline', content }] },
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

const base: Record<string, unknown> & { instants: unknown[]; spans: unknown[]; limits: unknown[] } =
  {
    axis: { unit: 's', to: 60, tick: 10 },
    rows: [{ id: 'w' }, { id: 'v' }],
    spans: [
      { id: 'run', row: 'w', from: 0, to: 25 },
      { id: 'next', row: 'v', from: 30, to: 50, kind: 'wait' },
    ],
    instants: [
      { id: 'h1', row: 'w', at: 5, kind: 'heartbeat' },
      { id: 'h2', row: 'w', at: 10, kind: 'heartbeat' },
      { id: 'h3', row: 'w', at: 24, kind: 'heartbeat' },
      { id: 'ev', row: 'v', at: 35 },
    ],
    limits: [
      { id: 'silence', row: 'w', after: 10, from: 'run', reset: 'heartbeat', label: 'timeout' },
      { id: 'deadline', row: 'w', after: 20, from: 'run' },
    ],
  };

const load = (value: WalkthroughInput) => loadConfig(value, createRegistry());
const rules = (value: WalkthroughInput) =>
  load(value).problems.map((problem) => `${problem.severity} ${problem.rule}`);

function at(content: unknown, calls: Effects[], c: number) {
  const w = load(config(content, calls)).walkthroughs[0]!;
  return {
    state: createFolder(w).at(0, c)['tl']!.state as TimelineState,
    parsed: TimelineContent.parse(w.panes[0]!.content),
  };
}
const moves = (...times: number[]): Effects[] =>
  times.map((time) => ({ tl: [{ update: 'now', fields: { at: time } }] }));

describe('timeline panel: what is visible at now', () => {
  const view = (time: number) => {
    const { state, parsed } = at(base, moves(time), 0);
    return { state, parsed, now: nowOf(parsed, state.patches) };
  };

  it('starts at the left edge, and a call moves now with one update', () => {
    expect(view(12).now).toBe(12);
    expect(nowOf(TimelineContent.parse(base), {})).toBe(0);
    expect(nowOf(TimelineContent.parse({ ...base, now: 7 }), {})).toBe(7);
  });

  it('instants appear when their time has come', () => {
    const { state, parsed, now } = view(10);
    expect(
      parsed.instants.filter((item) => instantShown(item, state, now)).map((item) => item.id),
    ).toEqual(['h1', 'h2']);
  });

  it('a span grows with now and is open until it ends', () => {
    const { state, parsed } = view(10);
    expect(spanDrawn(parsed.spans[0]!, state, 10)).toEqual({ from: 0, to: 10, open: true });
    expect(spanDrawn(parsed.spans[0]!, state, 30)).toEqual({ from: 0, to: 25, open: false });
    expect(spanDrawn(parsed.spans[1]!, state, 10)).toBeNull();
  });

  it('an element that is not present is not shown, whatever the time', () => {
    const content = { ...base, instants: [{ id: 'h1', row: 'w', at: 5, initial: false }] };
    const { state, parsed } = at(content, moves(20), 0);
    expect(instantShown(parsed.instants[0]!, state, 20)).toBe(false);
    const added = at(content, [...moves(20), { tl: [{ add: 'h1' }] }], 1);
    expect(instantShown(added.parsed.instants[0]!, added.state, 20)).toBe(true);
  });

  it('the call that moves now reveals what its move passed (not what was there at the start), and later calls do not', () => {
    const calls = moves(8, 12);
    const first = at(base, calls, 0);
    expect([...revealed(first.parsed, first.state, 'c1', 8)]).toEqual(['h1']);
    const second = at(base, calls, 1);
    expect([...revealed(second.parsed, second.state, 'c2', 12)]).toEqual(['h2']);
    expect([...revealed(second.parsed, second.state, 'c3', 12)]).toEqual([]);
  });

  it('remembers where now was even if a call moves it twice', () => {
    const { state, parsed } = at(
      base,
      [
        {
          tl: [
            { update: 'now', fields: { at: 6 } },
            { update: 'now', fields: { at: 12 } },
          ],
        },
      ],
      0,
    );
    expect([...revealed(parsed, state, 'c1', 12)]).toEqual(['h1', 'h2']);
  });
});

describe('timeline panel: limits', () => {
  const limit = (id: string, time: number, content: unknown = base) => {
    const { state, parsed } = at(content, moves(time), 0);
    return evaluateLimit(
      parsed,
      parsed.limits.find((item) => item.id === id)!,
      state,
      time,
    );
  };

  it('a silence limit follows the last heartbeat', () => {
    const view = limit('silence', 12);
    expect(view.status).toBe('pending');
    expect(view.limitAt).toBe(20);
    expect(view.segments).toEqual([{ from: 10, to: 20, kind: 'pending' }]);
  });

  it('runs out when no heartbeat comes in time: the gap crosses the limit', () => {
    const view = limit('silence', 22);
    expect(view.status).toBe('missed');
    expect(view.limitAt).toBe(20);
    expect(view.segments).toEqual([
      { from: 10, to: 20, kind: 'missed' },
      { from: 20, to: 22, kind: 'over' },
    ]);
  });

  it('a heartbeat that arrives after the limit is late, and the limit starts over', () => {
    const view = limit('silence', 24);
    expect(view.status).toBe('missed');
    expect(view.late).toEqual(['h3']);
    expect(view.segments[0]).toEqual({ from: 10, to: 20, kind: 'missed' });
    expect(view.segments[1]).toEqual({ from: 20, to: 24, kind: 'over' });
    expect(view.limitAt).toBe(34);
    const { state, parsed } = at(base, moves(24), 0);
    expect([...lateInstants(parsed, state, 24)]).toEqual(['h3']);
    expect(stateOf(parsed.instants[2]!, state.patches, lateInstants(parsed, state, 24))).toBe(
      'late',
    );
  });

  it('a heartbeat on time is not late', () => {
    expect(limit('silence', 10).late).toEqual([]);
    expect(limit('silence', 10).status).toBe('pending');
  });

  it('a limit that has not started is hidden', () => {
    const content = { ...base, limits: [{ id: 'later', row: 'v', after: 5, from: 'next' }] };
    expect(limit('later', 10, content).status).toBe('hidden');
  });

  it('a silence limit stops at "until": it held if the span ended first', () => {
    const content = {
      ...base,
      instants: [
        { id: 'h1', row: 'w', at: 5, kind: 'heartbeat' },
        { id: 'h2', row: 'w', at: 10, kind: 'heartbeat' },
        { id: 'h3', row: 'w', at: 20, kind: 'heartbeat' },
      ],
      limits: [
        { id: 'silence', row: 'w', after: 10, from: 'run', reset: 'heartbeat', until: 'run' },
      ],
    };
    // The span ends at 25, the last heartbeat is at 20: the limit would only run out at 30.
    expect(limit('silence', 24, content).status).toBe('pending');
    const closed = limit('silence', 26, content);
    expect(closed.status).toBe('met');
    expect(closed.limitAt).toBeNull();
    // Ending exactly when the limit runs out is a miss: the silence reached the limit.
    const edge = { ...content, spans: [{ id: 'run', row: 'w', from: 0, to: 30 }] };
    expect(limit('silence', 31, edge).status).toBe('missed');
  });

  it('a deadline is met when what it waits for ends in time, missed when not', () => {
    expect(limit('deadline', 10).status).toBe('pending');
    expect(limit('deadline', 10).limitAt).toBe(20);
    // `from` is a span, so its end is what has to happen by then: 25 is after 20.
    const missed = limit('deadline', 26);
    expect(missed.status).toBe('missed');
    expect(missed.segments).toEqual([
      { from: 0, to: 20, kind: 'missed' },
      { from: 20, to: 25, kind: 'over' },
    ]);
    const quick = { ...base, spans: [{ id: 'run', row: 'w', from: 0, to: 15 }] };
    expect(limit('deadline', 16, quick).status).toBe('met');
  });

  it('a deadline met by an instant that is late marks that instant late', () => {
    const content = {
      ...base,
      limits: [{ id: 'd', row: 'w', after: 10, from: 5, by: 'h3' }],
    };
    const view = limit('d', 24, content);
    expect(view.status).toBe('missed');
    expect(view.late).toEqual(['h3']);
  });

  it('a deadline with nothing to meet it runs out at now', () => {
    const content = { ...base, limits: [{ id: 'd', row: 'w', after: 10, from: 5 }] };
    expect(limit('d', 14, content).status).toBe('pending');
    expect(limit('d', 15, content).status).toBe('missed');
  });
});

describe('timeline panel: label levels', () => {
  it('puts a label that would overlap on a lower level, and keeps clear ones on the first', () => {
    expect(
      stagger([
        { x: 10, width: 30 },
        { x: 60, width: 30 },
      ]),
    ).toEqual([0, 0]);
    expect(
      stagger([
        { x: 10, width: 30 },
        { x: 20, width: 30 },
        { x: 30, width: 30 },
      ]),
    ).toEqual([0, 1, 2]);
    expect(
      stagger([
        { x: 10, width: 30 },
        { x: 20, width: 30 },
        { x: 70, width: 30 },
      ]),
    ).toEqual([0, 1, 0]);
  });
});

describe('timeline panel: lint', () => {
  it('accepts the base content', () => {
    expect(rules(config(base, moves(10, 20)))).toEqual([]);
  });

  it('timeline/duplicate-element, including the reserved id now', () => {
    expect(rules(config({ ...base, rows: [{ id: 'w' }, { id: 'w' }] }))).toContain(
      'error timeline/duplicate-element',
    );
    expect(rules(config({ ...base, rows: [{ id: 'now' }] }))).toContain(
      'error timeline/duplicate-element',
    );
  });

  it('timeline/unknown-row: an instant, a span and a limit', () => {
    expect(rules(config({ ...base, instants: [{ id: 'x', row: 'zz', at: 1 }] }))).toContain(
      'error timeline/unknown-row',
    );
    expect(rules(config({ ...base, spans: [{ id: 'x', row: 'zz', from: 1, to: 2 }] }))).toContain(
      'error timeline/unknown-row',
    );
    expect(
      rules(config({ ...base, limits: [{ id: 'x', row: 'zz', after: 1, from: 1 }] })),
    ).toContain('error timeline/unknown-row');
  });

  it('timeline/bad-span: a span that ends before it starts', () => {
    expect(rules(config({ ...base, spans: [{ id: 'x', row: 'w', from: 9, to: 3 }] }))).toContain(
      'error timeline/bad-span',
    );
  });

  it('timeline/out-of-axis: instants, spans, limits and now', () => {
    expect(rules(config({ ...base, instants: [{ id: 'x', row: 'w', at: 99 }] }))).toContain(
      'error timeline/out-of-axis',
    );
    expect(rules(config({ ...base, spans: [{ id: 'x', row: 'w', from: -1, to: 3 }] }))).toContain(
      'error timeline/out-of-axis',
    );
    expect(
      rules(config({ ...base, limits: [{ id: 'x', row: 'w', after: 1, from: 99 }] })),
    ).toContain('error timeline/out-of-axis');
    expect(rules(config({ ...base, now: 99 }))).toContain('error timeline/out-of-axis');
  });

  it('timeline/unknown-ref: a limit that names something that is not an instant or span', () => {
    for (const key of ['from', 'until', 'by']) {
      const limits = [
        {
          id: 'x',
          row: 'w',
          after: 1,
          from: 'run',
          reset: 'heartbeat',
          [key]: 'zz',
          ...(key === 'by' ? { reset: undefined } : {}),
        },
      ];
      expect(rules(config({ ...base, limits }))).toContain('error timeline/unknown-ref');
    }
    expect(
      rules(config({ ...base, limits: [{ id: 'x', row: 'w', after: 1, from: 'w' }] })),
    ).toContain('error timeline/unknown-ref');
  });

  it('timeline/bad-limit: until without reset, by with reset', () => {
    expect(
      rules(
        config({ ...base, limits: [{ id: 'x', row: 'w', after: 1, from: 'run', until: 'run' }] }),
      ),
    ).toContain('error timeline/bad-limit');
    expect(
      rules(
        config({
          ...base,
          limits: [{ id: 'x', row: 'w', after: 1, from: 'run', reset: 'heartbeat', by: 'h1' }],
        }),
      ),
    ).toContain('error timeline/bad-limit');
  });

  it('timeline/now-backwards', () => {
    expect(rules(config(base, moves(20, 10)))).toContain('error timeline/now-backwards');
    expect(rules(config(base, moves(20, 20)))).toEqual([]);
  });

  it('timeline/not-yet: touching what has not happened at that call', () => {
    expect(rules(config(base, [{ tl: [{ read: 'ev' }] }]))).toContain('error timeline/not-yet');
    expect(rules(config(base, [{ tl: [{ update: 'next', fields: { state: 'ok' } }] }]))).toContain(
      'error timeline/not-yet',
    );
    expect(
      rules(config(base, [{ tl: [{ update: 'now', fields: { at: 36 } }, { read: 'ev' }] }])),
    ).toEqual([]);
    // The order in the call counts.
    expect(
      rules(config(base, [{ tl: [{ read: 'ev' }, { update: 'now', fields: { at: 36 } }] }])),
    ).toContain('error timeline/not-yet');
  });

  it('timeline/unknown-field, bad-field, bad-tone', () => {
    const fields = (id: string, f: Record<string, unknown>) =>
      rules(
        config(base, [
          {
            tl: [
              { update: 'now', fields: { at: 30 } },
              { update: id, fields: f },
            ],
          },
        ]),
      );
    expect(fields('h1', { at: 3 })).toContain('error timeline/unknown-field');
    expect(fields('silence', { state: 'ok' })).toContain('error timeline/unknown-field');
    expect(fields('h1', { state: 'bad' })).toContain('error timeline/bad-field');
    expect(fields('h1', { label: 4 })).toContain('error timeline/bad-field');
    expect(fields('h1', { tone: 'red' })).toContain('error timeline/bad-tone');
    expect(fields('h1', { state: 'failed', tone: 'warn' })).toEqual([]);
    expect(rules(config(base, [{ tl: [{ update: 'now', fields: { at: 99 } }] }]))).toContain(
      'error timeline/bad-field',
    );
    expect(rules(config(base, [{ tl: [{ update: 'now', fields: { at: '9' } }] }]))).toContain(
      'error timeline/bad-field',
    );
  });

  it('timeline/unknown-key', () => {
    expect(rules(config(base, [{ tl: [{ read: 'run', paths: ['x'] }] }]))).toContain(
      'warning timeline/unknown-key',
    );
  });

  it('rejects an axis that ends before it starts', () => {
    expect(rules(config({ ...base, axis: { unit: 's', from: 10, to: 5, tick: 1 } }))).toContain(
      'error schema',
    );
  });
});
