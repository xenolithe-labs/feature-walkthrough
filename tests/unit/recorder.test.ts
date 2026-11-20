import { describe, expect, it } from 'vitest';
import { checkLines, stripHooks, Recorder } from '../../src';
import { createFolder, formatProblem, loadConfig, shapeOf } from '../../src/core';
import { createRegistry } from '../../src/registry';

const SOURCE = `function sum(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i];
  }
  return total;
}`;

function recorder(steps?: 'manual' | 'frames') {
  return new Recorder({
    id: 'sum',
    title: 'Sum',
    source: { title: 'sum.js', lang: 'js', text: SOURCE },
    ...(steps === undefined ? {} : { steps }),
  });
}

function lint(config: unknown) {
  return loadConfig(config, createRegistry());
}

describe('line numbers are checked against the shown source', () => {
  it('accepts a line that contains the snippet, and a range', () => {
    expect(checkLines(SOURCE, 2, 'let total')).toEqual([2, 2]);
    expect(checkLines(SOURCE, [3, 5], 'total += items[i]')).toEqual([3, 5]);
  });

  it('refuses a line that does not, and says where the snippet is', () => {
    expect(() => checkLines(SOURCE, 3, 'let total')).toThrow(
      /line 3 is "for \(let i = 0; i < items.length; i\+\+\) \{", which does not contain "let total"; it is on line 2/,
    );
    expect(() => checkLines(SOURCE, 3, 'nowhere at all')).toThrow(/not anywhere in the source/);
  });

  it('refuses lines past the end, backwards ranges and an empty snippet', () => {
    expect(() => checkLines(SOURCE, 99, 'x')).toThrow(/past the end/);
    expect(() => checkLines(SOURCE, [4, 2], 'x')).toThrow(/expected a line number/);
    expect(() => checkLines(SOURCE, 0, 'x')).toThrow(/expected a line number/);
    expect(() => checkLines(SOURCE, 1, '')).toThrow(/cannot be empty/);
  });

  it('makes the recorder throw, so a wrong number cannot reach a reader', () => {
    const rec = recorder();
    expect(() => rec.at(4, 'let total')).toThrow(/does not contain/);
  });

  it('refuses part of a line that is not on the line', () => {
    const rec = recorder();
    expect(() => rec.at(2, 'let total', { expr: 'items' })).toThrow(/does not contain "items"/);
  });
});

describe('stripHooks', () => {
  it('removes statements that start a line with rec., on one line or several', () => {
    const text = [
      'function f(x) {',
      "  rec.at(2, 'a (b)', {",
      "    text: 'a ) in a string',",
      '  });',
      '  return x;',
      "  rec.tone('x', 1);",
      '}',
    ].join('\n');
    expect(stripHooks(text)).toBe('function f(x) {\n  return x;\n}');
  });

  it('keeps lines that only mention rec, and honours other hook names', () => {
    expect(stripHooks('const recorded = 1;\nrecord.x();')).toBe('const recorded = 1;\nrecord.x();');
    expect(stripHooks('t.at(1);\nrec.at(1);\nx;', ['t'])).toBe('rec.at(1);\nx;');
  });

  it('says so when a statement never ends', () => {
    expect(() => stripHooks("rec.at(1, 'x'")).toThrow(/never ends/);
  });
});

describe('tracking an array', () => {
  function run(body: (rec: Recorder, items: number[]) => void, initial = [5, 6, 7]) {
    const rec = recorder();
    const items = rec.array('items', initial, { pointers: ['i'] });
    body(rec, items);
    return rec.finish();
  }
  const effects = (config: ReturnType<Recorder['finish']>, call = 0) =>
    config.steps.flatMap((step) => step.calls)[call]!.effects as Record<string, unknown[]>;

  it('records a read as a compare and a write as an update, without being told', () => {
    const config = run((rec, items) => {
      rec.at(4, 'total += items[i]');
      void (items[1]! + items[2]!);
      items[0] = 9;
    });
    expect(effects(config).items).toEqual([
      { read: 'items.1' },
      { read: 'items.2' },
      { update: 'items.0', fields: { value: 9 } },
    ]);
  });

  it('folds repeats: the same cell read twice is one read, and a write to it covers a read', () => {
    const config = run((rec, items) => {
      rec.at(4, 'total += items[i]');
      void items[1];
      void items[1];
      items[2] = items[2]! + 1;
      void items[2];
    });
    expect(effects(config).items).toEqual([
      { read: 'items.1' },
      { read: 'items.2' },
      { update: 'items.2', fields: { value: 8 } },
    ]);
  });

  it('treats work before the first at() as setup: it changes the starting values', () => {
    const config = run((rec, items) => {
      items[0] = 1;
      items.push(2);
      rec.at(2, 'let total');
    });
    const panes = config.layout.panes;
    const content = panes.find((pane) => pane.id === 'items')!.content as {
      arrays: { cells: number[] }[];
    };
    expect(content.arrays[0]!.cells).toEqual([1, 6, 7, 2]);
    expect(effects(config).items).toBeUndefined();
  });

  it('grows with push and shrinks with pop, adding and removing the cells', () => {
    const config = run((rec, items) => {
      rec.at(2, 'let total');
      items.push(8);
      rec.at(3, 'for (let i = 0');
      items.pop();
    });
    expect(effects(config, 0).items).toEqual([
      { add: 'items.3' },
      { update: 'items.3', fields: { value: 8 } },
    ]);
    expect(effects(config, 1).items).toEqual([{ read: 'items.3' }, { remove: 'items.3' }]);
    const content = config.layout.panes.find((pane) => pane.id === 'items')!.content as {
      arrays: { cells: number[]; length?: number }[];
    };
    expect(content.arrays[0]!.length).toBe(4);
    expect(lint(config).problems.map(formatProblem)).toEqual([]);
  });

  it('refuses a write that would leave a gap, and values that are not text or numbers', () => {
    run((rec, items) => {
      rec.at(2, 'let total');
      expect(() => {
        items[9] = 1;
      }).toThrow(/gap/);
      expect(() => {
        (items as unknown[])[0] = { a: 1 };
      }).toThrow(/strings or numbers/);
    });
  });

  it('is silent inside silently()', () => {
    const config = run((rec, items) => {
      rec.at(2, 'let total');
      rec.silently(() => items[0]);
    });
    expect(effects(config).items).toBeUndefined();
  });

  it('adds a pointer on first use, then moves it, and reads it when it stays', () => {
    const config = run((rec) => {
      rec.at(2, 'let total');
      rec.point('i', 0);
      rec.at(3, 'for (let i = 0');
      rec.point('i', 1);
      rec.at(3, 'for (let i = 0');
      rec.point('i', 1);
    });
    expect(effects(config, 0).items).toEqual([{ add: 'i' }, { update: 'i', fields: { at: 0 } }]);
    expect(effects(config, 1).items).toEqual([{ update: 'i', fields: { at: 1 } }]);
    expect(effects(config, 2).items).toEqual([{ read: 'i' }]);
    expect(lint(config).problems.map(formatProblem)).toEqual([]);
  });

  it('refuses a pointer or variable that was not declared', () => {
    const rec = recorder();
    rec.array('items', [1], { pointers: ['i'] });
    rec.at(2, 'let total');
    expect(() => rec.point('j', 0)).toThrow(/not a pointer/);
    expect(() => rec.set('total', 1)).toThrow(/not a variable/);
  });
});

describe('steps and calls', () => {
  it('makes one call per at(), and steps where the author says', () => {
    const rec = recorder();
    rec.step('Set up');
    rec.at(2, 'let total');
    rec.step('Round {n}');
    rec.at(3, 'for (let i = 0');
    rec.at(4, 'total += items[i]');
    rec.step('Round {n}');
    rec.at(3, 'for (let i = 0');
    const config = rec.finish();
    expect(config.steps.map((step) => [step.title, step.calls.length])).toEqual([
      ['Set up', 1],
      ['Round 1', 2],
      ['Round 2', 1],
    ]);
  });

  it('starts a step on its own when none was started, and refuses an empty step', () => {
    const rec = recorder();
    rec.at(2, 'let total');
    expect(rec.finish().steps[0]!.title).toBe('Run');
    const empty = recorder();
    empty.step('One');
    expect(() => empty.step('Two')).toThrow(/has no calls/);
  });

  it('puts the code pointer, a run count and the marked line on every call', () => {
    const rec = recorder();
    rec.at(3, 'for (let i = 0');
    rec.at(3, 'for (let i = 0', { expr: true });
    const calls = rec.finish().steps[0]!.calls;
    expect(calls[0]!.effects!.code).toEqual([
      { update: 'source', fields: { at: 3, badge: '' } },
      { read: 'source', lines: [3] },
    ]);
    expect(calls[1]!.effects!.code).toEqual([
      { update: 'source', fields: { at: 3, badge: 'run 2' } },
      { read: 'source', lines: [3], expr: 'for (let i = 0' },
    ]);
  });

  it('refuses to record before the first at()', () => {
    const rec = recorder();
    expect(() => rec.say('hello')).toThrow(/no call is open/);
  });

  it('runs a text function once the call is open, without recording what it reads', () => {
    const rec = recorder();
    const items = rec.array('items', [4, 5]);
    rec.at(2, 'let total');
    rec.at(3, 'for (let i = 0', { text: () => `first is ${items[0]}` });
    const config = rec.finish();
    expect(config.steps[0]!.calls[1]!.text).toBe('first is 4');
    expect(config.steps[0]!.calls[1]!.effects!.items).toBeUndefined();
  });
});

describe('function calls', () => {
  function recursive(mode: 'manual' | 'frames') {
    const rec = recorder(mode);
    rec.stack('stack');
    rec.enter('sum', { n: 2 });
    rec.at(2, 'let total');
    rec.at(3, 'for (let i = 0');
    rec.enter('sum', { n: 1 });
    rec.at(2, 'let total');
    rec.leave(1);
    rec.at(6, 'return total');
    rec.leave(3);
    return rec.finish();
  }

  it('fills one box per depth, and takes a returned frame off in the next call', () => {
    const config = recursive('manual');
    const calls = config.steps.flatMap((step) => step.calls);
    expect(calls[0]!.effects!.stack).toEqual([
      { add: 'stack.0' },
      { update: 'stack.0', fields: { label: 'sum(2)', sub: '' } },
    ]);
    expect(calls[1]!.effects!.stack).toEqual([
      { add: 'stack.1' },
      { update: 'stack.1', fields: { label: 'sum(1)', sub: '' } },
    ]);
    expect(calls[2]!.effects!.stack).toEqual([
      { update: 'stack.1', fields: { tone: 'good', sub: 'returns 1' } },
    ]);
    // The popped frame goes at the start of the next call; the caller's own return joins it.
    expect(calls[3]!.effects!.stack).toEqual([
      { remove: 'stack.1' },
      { update: 'stack.0', fields: { tone: 'good', sub: 'returns 3' } },
    ]);
    const boxes = (
      config.layout.panes.find((pane) => pane.id === 'stack')!.content as {
        boxes: { parent?: string }[];
      }
    ).boxes;
    expect(boxes.map((box) => box.parent)).toEqual([undefined, 'stack.0']);
    expect(lint(config).problems.map(formatProblem)).toEqual([]);
  });

  it('shows the depth on the code line', () => {
    const calls = recursive('manual').steps.flatMap((step) => step.calls);
    const badge = (call: number) =>
      (calls[call]!.effects!.code![0] as { fields: { badge: string } }).fields.badge;
    expect(badge(0)).toBe('depth 1');
    expect(badge(2)).toBe('depth 2');
  });

  it('groups calls into steps by function call when asked', () => {
    const config = recursive('frames');
    expect(config.steps.map((step) => step.title)).toEqual(['sum(2)', 'sum(1)', 'Back in sum(2)']);
  });

  it('refuses leave() with nothing to leave', () => {
    const rec = recorder();
    rec.at(2, 'let total');
    expect(() => rec.leave()).toThrow(/no function call open/);
  });
});

describe('the output', () => {
  it('is plain JSON that loads with no recorder, and steps through in either direction', () => {
    const rec = recorder();
    const items = rec.array('items', [1, 2, 3], {
      pointers: ['i'],
      ranges: [{ id: 'rest', from: 'i', to: 2, dim: true }],
    });
    rec.vars('vars', { total: 0 });
    rec.step('Add them up');
    rec.at(2, 'let total');
    let total = 0;
    for (let i = 0; i < items.length; i += 1) {
      rec.at(4, 'total += items[i]', { expr: true });
      rec.point('i', i);
      total += items[i]!;
      rec.set('total', total);
    }
    rec.at(6, 'return total');
    const config = rec.finish();

    const json: unknown = JSON.parse(JSON.stringify(config));
    expect(json).toEqual(config);
    const result = lint(json);
    expect(result.problems.map(formatProblem)).toEqual([]);
    const walkthrough = result.walkthroughs[0]!;
    const folder = createFolder(walkthrough);
    const shape = shapeOf(walkthrough);
    for (let s = 0; s < shape.length; s += 1) {
      for (let c = 0; c < shape[s]!; c += 1) expect(folder.at(s, c)).toEqual(folder.fromZero(s, c));
    }
    expect(total).toBe(6);
  });

  it('fails on a recording with nothing in it', () => {
    expect(() => recorder().finish()).toThrow(/nothing was recorded/);
  });
});
