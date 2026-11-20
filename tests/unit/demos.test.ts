import { describe, expect, it } from 'vitest';
import { createFolder, formatProblem, loadConfig, shapeOf } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { demos } from '../../src/walkthroughs';

describe('bundled demos', () => {
  const result = loadConfig(demos, createRegistry());

  it('lint clean, with no warnings', () => {
    expect(result.problems.map(formatProblem)).toEqual([]);
    expect(result.walkthroughs.length).toBeGreaterThan(0);
  });

  it('are plain JSON: the JSON form loads to the same walkthroughs', () => {
    const json: unknown = JSON.parse(JSON.stringify(demos));
    expect(json).toEqual(demos);
    const again = loadConfig(json, createRegistry());
    expect(again.problems).toEqual([]);
    expect(again.walkthroughs.map((item) => item.source)).toEqual(
      result.walkthroughs.map((item) => item.source),
    );
  });

  for (const walkthrough of result.walkthroughs) {
    it(`${walkthrough.id}: the fold equals a full recompute at every cursor`, () => {
      const folder = createFolder(walkthrough);
      const cursors = shapeOf(walkthrough).flatMap((count, s) =>
        Array.from({ length: count }, (_, c) => ({ s, c })),
      );
      for (const { s, c } of [...cursors, ...[...cursors].reverse()]) {
        expect(folder.at(s, c)).toEqual(folder.fromZero(s, c));
      }
    });
  }
});
