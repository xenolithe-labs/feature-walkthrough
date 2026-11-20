import { describe, expect, it } from 'vitest';
import {
  createFolder,
  loadConfig,
  type ElementsState,
  type WalkthroughInput,
} from '../../src/core';
import {
  columnElement,
  groupRuns,
  legendFor,
  meterNumber,
  meterProblem,
  readMeter,
} from '../../src/panels/table/model';
import { createRegistry } from '../../src/registry';

type Effects = Record<string, unknown>[];

function config(content: unknown, calls: Effects[] = [[]]): WalkthroughInput {
  return {
    id: 't',
    title: 'T',
    layout: { panes: [{ id: 'grid', panel: 'table', content }] },
    steps: [
      {
        id: 's1',
        title: 'S1',
        calls: calls.map((effects, index) => ({
          id: `c${index + 1}`,
          label: `Call ${index + 1}`,
          effects: { grid: effects } as never,
        })),
      },
    ],
  };
}

const content = {
  columns: [
    { id: 'part', label: 'Partition' },
    { id: 'b1', label: 'b1' },
    { id: 'lag', label: 'lag', meter: { max: 100, warn: 60 } },
  ],
  legend: { L: { tone: 'good', label: 'leader' }, F: { tone: 'muted', label: 'follower' } },
  rows: [
    { id: 'p0', group: 'orders', cells: { part: 'p0', b1: 'L', lag: '10' } },
    { id: 'p1', group: 'orders', cells: { part: 'p1', b1: 'F', lag: '70' } },
    { id: 'p2', group: 'payments', cells: { part: 'p2', b1: 'F', lag: '0' } },
  ],
};

const rules = (input: WalkthroughInput) =>
  loadConfig(input, createRegistry()).problems.map((problem) => problem.rule);

describe('table model', () => {
  it('reads a number written as text, and nothing else', () => {
    expect(meterNumber('12')).toBe(12);
    expect(meterNumber(' 3.5 ')).toBe(3.5);
    expect(meterNumber('-2')).toBe(-2);
    for (const bad of ['', ' ', 'abc', '1e3', '0x10', 'Infinity', '1,5', '12 ms', undefined]) {
      expect(meterNumber(bad)).toBeUndefined();
    }
  });

  it('draws a meter between 0 and max, and tones it above warn only', () => {
    const meter = { max: 200, warn: 100 };
    expect(readMeter('50', meter)).toEqual({ value: 50, fraction: 0.25, warn: false });
    expect(readMeter('100', meter)?.warn).toBe(false);
    expect(readMeter('101', meter)?.warn).toBe(true);
    expect(readMeter('200', meter)?.fraction).toBe(1);
    expect(readMeter('201', meter)).toBeUndefined();
    expect(readMeter('-1', meter)).toBeUndefined();
    expect(readMeter('x', meter)).toBeUndefined();
    expect(readMeter('5', { max: 10 })?.warn).toBe(false);
  });

  it('says why a meter cell cannot be drawn', () => {
    expect(meterProblem('5', { max: 10 })).toBeNull();
    expect(meterProblem('abc', { max: 10 })).toMatch(/not a number/);
    expect(meterProblem('11', { max: 10 })).toMatch(/above the meter's max of 10/);
    expect(meterProblem('-1', { max: 10 })).toMatch(/below 0/);
  });

  it('looks legend values up by own key only', () => {
    const legend = { L: { label: 'leader' } };
    expect(legendFor(legend, 'L')).toEqual({ label: 'leader' });
    expect(legendFor(legend, 'constructor')).toBeUndefined();
    expect(legendFor(legend, 'toString')).toBeUndefined();
    expect(legendFor(undefined, 'L')).toBeUndefined();
    expect(legendFor(legend, undefined)).toBeUndefined();
  });

  it('groups consecutive rows, and a group that returns is a new run', () => {
    const rows = [{ group: 'a' }, { group: 'a' }, { group: 'b' }, { group: 'a' }, {}];
    expect(groupRuns(rows).map((run) => [run.group, run.rows.length])).toEqual([
      ['a', 2],
      ['b', 1],
      ['a', 1],
      [undefined, 1],
    ]);
    expect(groupRuns([])).toEqual([]);
  });

  it('names a column as an element with a dot, which no row id can have', () => {
    expect(columnElement('lag')).toBe('col.lag');
  });
});

describe('table lint', () => {
  it('accepts legend, groups, meters and a column mark', () => {
    const input = config(content, [
      [{ read: 'col.b1' }, { update: 'p0', fields: { b1: 'F', lag: '80' } }],
    ]);
    expect(loadConfig(input, createRegistry()).problems).toEqual([]);
  });

  it('rejects a meter cell that is not a number, or is above max or below zero', () => {
    const bad = (cell: string) =>
      config({ columns: content.columns, rows: [{ id: 'p0', cells: { part: 'p0', lag: cell } }] });
    expect(rules(bad('lots'))).toEqual(['table/bad-meter-value']);
    expect(rules(bad('101'))).toEqual(['table/bad-meter-value']);
    expect(rules(bad('-3'))).toEqual(['table/bad-meter-value']);
    expect(rules(bad('100'))).toEqual([]);
  });

  it('rejects an update that writes a bad meter value, and one that is not text', () => {
    const update = (value: unknown) =>
      config(content, [[{ update: 'p0', fields: { lag: value } }]]);
    expect(rules(update('101'))).toEqual(['table/bad-field']);
    expect(rules(update('n/a'))).toEqual(['table/bad-field']);
    expect(rules(update(50))).toEqual(['table/bad-field']);
    expect(rules(update('50'))).toEqual([]);
  });

  it('rejects a warn threshold above max', () => {
    const columns = [{ id: 'a', label: 'A', meter: { max: 10, warn: 11 } }];
    expect(rules(config({ columns, rows: [] }))).toEqual(['table/bad-meter']);
  });

  it('keeps the existing rule for an unknown column, reported once', () => {
    expect(rules(config(content, [[{ update: 'p0', fields: { nope: 'x' } }]]))).toEqual([
      'table/unknown-column',
    ]);
  });

  it('a column is read, never added, removed or updated', () => {
    expect(rules(config(content, [[{ read: 'col.lag' }]]))).toEqual([]);
    expect(rules(config(content, [[{ remove: 'col.lag' }]]))).toContain('table/column-effect');
    expect(rules(config(content, [[{ add: 'col.lag' }]]))).toContain('table/column-effect');
    expect(rules(config(content, [[{ update: 'col.lag', fields: { tone: 'warn' } }]]))).toContain(
      'table/column-effect',
    );
    expect(rules(config(content, [[{ read: 'col.nope' }]]))).toEqual(['unknown-id']);
  });

  it('warns about a group that returns, a row without a group, and a legend entry never used', () => {
    const rows = [
      { id: 'a', group: 'x', cells: { part: 'a' } },
      { id: 'b', group: 'y', cells: { part: 'b' } },
      { id: 'c', group: 'x', cells: { part: 'c' } },
      { id: 'd', cells: { part: 'd' } },
    ];
    expect(rules(config({ columns: content.columns, rows }))).toEqual([
      'table/split-group',
      'table/ungrouped-row',
    ]);
    expect(
      rules(config({ columns: content.columns, rows: [], legend: { Z: { label: 'zed' } } })),
    ).toEqual(['table/unused-legend']);
    // A value that only a call writes counts as used.
    const written = config(
      {
        columns: content.columns,
        rows: [{ id: 'a', cells: { part: 'a' } }],
        legend: { Z: { label: 'zed' } },
      },
      [[{ update: 'a', fields: { b1: 'Z' } }]],
    );
    expect(rules(written)).toEqual([]);
  });

  it('does not take a legend key, or a column or row id, from the prototype', () => {
    const odd = config({
      columns: [{ id: 'constructor', label: 'C' }],
      rows: [{ id: 'toString', cells: { constructor: 'valueOf' } }],
      legend: { valueOf: { label: 'v' } },
    });
    expect(rules(odd)).toEqual([]);
  });

  it('existing tables, with none of the new content, are unchanged', () => {
    const plain = config({
      columns: [{ id: 'k', label: 'K' }],
      rows: [{ id: 'r', cells: { k: 'v' } }],
    });
    expect(loadConfig(plain, createRegistry()).problems).toEqual([]);
  });
});

describe('table state', () => {
  it('columns are not present or absent: only rows are in the state', () => {
    const loaded = loadConfig(config(content, [[{ read: 'col.lag' }]]), createRegistry());
    const state = createFolder(loaded.walkthroughs[0]!).at(0, 0).grid!.state as ElementsState;
    expect(state.present).toEqual(['p0', 'p1', 'p2']);
  });

  it('an update patches the cell, and the patched text is what the legend sees', () => {
    const loaded = loadConfig(
      config(content, [[{ update: 'p0', fields: { b1: 'F', lag: '80' } }]]),
      createRegistry(),
    );
    const state = createFolder(loaded.walkthroughs[0]!).at(0, 0).grid!.state as ElementsState;
    expect(state.patches.p0).toEqual({ b1: 'F', lag: '80' });
  });
});
