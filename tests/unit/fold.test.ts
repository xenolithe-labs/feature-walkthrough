import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildCard,
  createFolder,
  loadConfig,
  markOf,
  shapeOf,
  stepChips,
  touched,
  type ElementsState,
  type ResolvedWalkthrough,
} from '../../src/core';
import { baseConfig, testRegistry } from '../helpers/registry';

function load(config: unknown): ResolvedWalkthrough {
  const result = loadConfig(config, testRegistry());
  expect(result.problems).toEqual([]);
  return result.walkthroughs[0]!;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe('fold', () => {
  const walkthrough = load(baseConfig());
  const folder = createFolder(walkthrough);
  const things = (s: number, c: number) => folder.at(s, c).things!.state as ElementsState;

  it('starts from the initial elements and adds per call', () => {
    expect(things(0, 0).present).toEqual(['seed', 'a']);
    expect(things(0, 1).present).toEqual(['seed', 'a', 'b']);
  });

  it('applies update, focus and remove', () => {
    expect(things(1, 0).patches).toEqual({ a: { state: 'used' } });
    expect(things(1, 0).focus).toBe('a');
    expect(things(1, 1).present).toEqual(['seed', 'a', 'c']);
    expect(things(1, 2)).toEqual(things(1, 1));
  });

  it('gives the current call’s effects per pane', () => {
    expect(folder.at(0, 0).things!.current).toEqual([{ read: 'seed' }, { add: 'a' }]);
    expect(folder.at(1, 2).things!.current).toEqual([]);
  });

  it('includes the effects a panel implies', () => {
    expect(folder.at(0, 0).log!.current).toEqual([{ add: 'ask' }]);
    expect((folder.at(1, 0).log!.state as ElementsState).present).toEqual([
      'ask',
      'answer',
      'change',
    ]);
  });

  it('gives the same answer going back as going forward', () => {
    const forward = shapeOf(walkthrough).flatMap((count, s) =>
      Array.from({ length: count }, (_, c) => folder.at(s, c)),
    );
    const fresh = createFolder(walkthrough);
    const backward = shapeOf(walkthrough)
      .flatMap((count, s) => Array.from({ length: count }, (_, c) => ({ s, c })))
      .reverse()
      .map(({ s, c }) => fresh.at(s, c))
      .reverse();
    expect(backward).toEqual(forward);
  });

  it('carries the visible focus pane forward from the last `show`', () => {
    expect(folder.focusPane(0, 0)).toBe('log');
    expect(folder.focusPane(0, 1)).toBe('log');
    expect(folder.focusPane(1, 0)).toBe('other');
    expect(folder.focusPane(1, 2)).toBe('other');
  });

  it('rejects a cursor that is not in the walkthrough', () => {
    expect(() => folder.at(5, 0)).toThrow(RangeError);
    expect(() => folder.fromZero(0, 9)).toThrow(RangeError);
  });

  it('never changes a state it was given', () => {
    const frozen = createFolder(walkthrough);
    for (const [s, count] of shapeOf(walkthrough).entries()) {
      for (let c = 0; c < count; c += 1) deepFreeze(frozen.at(s, c));
    }
    expect(() => frozen.at(1, 2)).not.toThrow();
    expect(frozen.at(1, 2)).toEqual(frozen.fromZero(1, 2));
  });
});

describe('fold equals a full recompute at every cursor', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const effect = fc.oneof(
    fc.constantFrom(...ids).map((id) => ({ add: id })),
    fc.constantFrom(...ids).map((id) => ({ remove: id })),
    fc.constantFrom(...ids).map((id) => ({ read: id })),
    fc.constantFrom(...ids).map((id) => ({ focus: id })),
    fc
      .tuple(fc.constantFrom(...ids), fc.integer())
      .map(([id, n]) => ({ update: id, fields: { n } })),
    fc.integer().map((n) => ({ set: n })),
  );
  const steps = fc.array(
    fc.array(fc.array(effect, { maxLength: 4 }), { minLength: 1, maxLength: 4 }),
    {
      minLength: 1,
      maxLength: 5,
    },
  );

  it('in any visiting order', () => {
    fc.assert(
      fc.property(
        steps,
        fc.array(fc.nat(100), { minLength: 1, maxLength: 30 }),
        (generated, visits) => {
          // The reducer tolerates effects on absent elements, so this builds the
          // resolved walkthrough directly instead of going through lint.
          const base = load(baseConfig());
          const walkthrough: ResolvedWalkthrough = {
            ...base,
            steps: generated.map((calls, s) => ({
              id: `s${s}`,
              title: `Step ${s}`,
              calls: calls.map((effects, c) => ({
                id: `s${s}c${c}`,
                label: 'call',
                effects: { things: effects },
              })),
            })),
          };
          const folder = createFolder(walkthrough);
          const cursors = shapeOf(walkthrough).flatMap((count, s) =>
            Array.from({ length: count }, (_, c) => ({ s, c })),
          );
          for (const visit of visits) {
            const { s, c } = cursors[visit % cursors.length]!;
            expect(folder.at(s, c)).toEqual(folder.fromZero(s, c));
          }
        },
      ),
    );
  });
});

describe('marks', () => {
  it('fades what the current call did not touch', () => {
    const current = touched([
      { add: 'a' },
      { read: 'b' },
      { update: 'c' },
      { remove: 'd' },
      { focus: 'e' },
    ]);
    expect(markOf('a', current)).toBe('added');
    expect(markOf('b', current)).toBe('read');
    expect(markOf('c', current)).toBe('updated');
    expect(markOf('d', current)).toBe('removed');
    expect(markOf('e', current)).toBe('faded');
  });

  it('fades nothing when the call touched nothing in the pane', () => {
    expect(markOf('a', touched([]))).toBe('idle');
    expect(markOf('a', touched([{ focus: 'a' }, { set: 1 }]))).toBe('idle');
  });
});

describe('card', () => {
  const config = baseConfig();
  Object.assign(config.steps[0]!.calls[0]!, {
    where: 'RFC 0000 §1',
    blocks: [{ title: 'Note', text: 'extra' }],
    annotations: { mark: { level: 'must' } },
  });
  Object.assign(config.steps[0]!.calls[1]!, { annotations: { mark: { level: 'must' } } });
  const walkthrough = load(config);
  const folder = createFolder(walkthrough);

  it('puts call blocks first, then panel sections, then annotation sections', () => {
    const card = buildCard(walkthrough, 0, 0, folder.at(0, 0));
    expect(card.position).toEqual({ step: 1, steps: 2, call: 1, calls: 2 });
    expect(card.title).toBe('Ask');
    expect(card.stepTitle).toBe('Step one');
    expect(card.from?.title).toBe('Client');
    expect(card.to?.title).toBe('Server');
    expect(card.where).toBe('RFC 0000 §1');
    expect(card.sections.map((section) => section.id)).toEqual([
      'request',
      'block-0',
      'things:present',
      'other:present',
      'mark:level',
    ]);
    expect(card.chips).toEqual([{ label: 'must', tone: 'warn' }]);
  });

  it('keeps the language of a response block', () => {
    const card = buildCard(walkthrough, 0, 1, folder.at(0, 1));
    expect(card.sections[0]).toEqual({
      id: 'response',
      title: 'Response',
      kind: 'code',
      lang: 'json',
      text: '{"ok":true}',
    });
  });

  it('lists each distinct chip of a step once', () => {
    expect(stepChips(walkthrough, 0)).toEqual([{ label: 'must', tone: 'warn' }]);
    expect(stepChips(walkthrough, 1)).toEqual([]);
  });
});
