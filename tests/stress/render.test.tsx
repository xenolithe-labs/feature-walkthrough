import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadConfig, formatProblem } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { HOSTILE_TEXT, hasNonStringRefText, mutate, randomWalkthrough, wrap } from './gen';
import { renderAll, renderEverything } from './render';

const registry = createRegistry();

function loaded(config: unknown) {
  const result = loadConfig(config, registry);
  expect(result.problems.filter((p) => p.severity === 'error').map(formatProblem)).toEqual([]);
  return result.walkthroughs[0]!;
}

describe('server rendering of generated configs', () => {
  it('every non-diagram panel renders at every cursor with nothing logged', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const w = loaded(randomWalkthrough(seed, { steps: 4, calls: 4 }));
        expect(renderEverything(w), `seed ${seed}`).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it('renders with a selection that exists in no pane and with one in a hidden pane', () => {
    const w = loaded(randomWalkthrough(7));
    expect(renderEverything(w, 'does-not-exist')).toEqual([]);
    expect(renderEverything(w, 'c0_0')).toEqual([]);
  });
});

describe('hostile text is data', () => {
  const text = (i: number) => HOSTILE_TEXT[i % HOSTILE_TEXT.length]!;

  it('labels, cells, source lines, payload values and notes never become markup', () => {
    const config = wrap(
      'hostile',
      [
        {
          id: 'table',
          panel: 'table',
          content: {
            columns: HOSTILE_TEXT.map((t, i) => ({ id: `c${i}`, label: t })),
            rows: [
              { id: 'r', cells: Object.fromEntries(HOSTILE_TEXT.map((t, i) => [`c${i}`, t])) },
            ],
          },
        },
        {
          id: 'code',
          panel: 'code',
          content: { sources: [{ id: 's', title: text(0), text: HOSTILE_TEXT.join('\n') }] },
        },
        {
          id: 'payload',
          panel: 'payload',
          content: {
            payloads: [
              {
                id: 'p',
                title: text(1),
                sub: text(2),
                value: Object.fromEntries(HOSTILE_TEXT.map((t, i) => [`k${i}`, t])),
                raw: { label: text(3), text: HOSTILE_TEXT.join('\n') },
              },
            ],
          },
        },
        {
          id: 'boxes',
          panel: 'boxes',
          content: { boxes: HOSTILE_TEXT.map((t, i) => ({ id: `b${i}`, label: t, sub: t })) },
        },
        {
          id: 'schema',
          panel: 'schema',
          content: {
            tables: [
              {
                id: 't',
                label: text(0),
                columns: HOSTILE_TEXT.map((t, i) => ({ id: `c${i}`, label: t, note: t, type: t })),
              },
            ],
          },
        },
      ],
      [
        {
          id: 's',
          title: text(4),
          text: text(5),
          calls: [{ id: 'k', label: text(6), text: text(7), where: text(8) }],
        },
      ],
      { title: text(0), lead: text(5) },
    );
    const w = loaded(config);
    const { html, complaints } = renderAll(w);
    expect(complaints).toEqual([]);
    // Every angle bracket in the config text comes back escaped.
    expect(html).not.toMatch(/<script|<img src=x|<svg onload/);
  });
});

describe('random mutations of valid configs', () => {
  it('loadConfig reports problems or loads; it never throws, and what loads folds and renders', () => {
    let loadedCount = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (a, b) => {
          const mutated = mutate(randomWalkthrough(a, { steps: 3, calls: 3 }), b);
          const result = loadConfig(mutated, registry);
          if (!result.ok) {
            expect(result.problems.some((p) => p.severity === 'error')).toBe(true);
            return;
          }
          // Pinned separately as an expected failure; keep it from masking new findings here.
          if (hasNonStringRefText(mutated)) return;
          loadedCount += 1;
          for (const w of result.walkthroughs) {
            expect(renderEverything(w), `seeds ${a}/${b}`).toEqual([]);
          }
        },
      ),
      { numRuns: 400 * Number(process.env.STRESS_RUNS ?? 1) },
    );
    expect(
      loadedCount,
      'some mutations should survive lint, or the property is vacuous',
    ).toBeGreaterThan(5);
  });

  it('arbitrary JSON is rejected without throwing', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const result = loadConfig(value, registry);
        expect(result.ok).toBe(false);
        expect(result.problems.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });
});
