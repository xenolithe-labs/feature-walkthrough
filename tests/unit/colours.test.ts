import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addTokens, tokensFor } from '../../cli/highlight';
import { demoColours } from '../../scripts/demo-colours';
import { formatProblem, loadConfig, type WalkthroughInput } from '../../src/core';
import { pieces, tokensMatch, type Tokens } from '../../src/panels/code/tokens';
import { createRegistry } from '../../src/registry';
import { demos, plainDemos } from '../../src/walkthroughs';

const TEXT = 'const a = 1;\nreturn a; // done';

describe('colour tokens', () => {
  it('spell out the text they colour, in two themes', async () => {
    const tokens = (await tokensFor(TEXT, 'js'))!;
    expect(tokensMatch(TEXT, tokens)).toBe(true);
    expect(tokens.palette.length).toBeGreaterThan(1);
    for (const [light, dark] of tokens.palette) {
      expect(light).toMatch(/^#[0-9a-f]{6,8}$/i);
      expect(dark).toMatch(/^#[0-9a-f]{6,8}$/i);
    }
  });

  it('are not made for a language the highlighter does not know', async () => {
    expect(await tokensFor(TEXT, 'no-such-language')).toBeUndefined();
  });

  it('do not match another text, a missing line, or a colour outside the palette', () => {
    const tokens: Tokens = { palette: [['#000000', '#ffffff']], lines: [[['ab', 0]], [['c', 0]]] };
    expect(tokensMatch('ab\nc', tokens)).toBe(true);
    expect(tokensMatch('ab\nd', tokens)).toBe(false);
    expect(tokensMatch('ab', tokens)).toBe(false);
    expect(tokensMatch('ab\nc', { ...tokens, lines: [[['ab', 1]], [['c', 0]]] })).toBe(false);
  });
});

describe('cutting a line into pieces', () => {
  const coloured = [
    ['if ', 0],
    ['(x', 1],
    [' < y)', 2],
  ] as const;

  it('keeps colours when nothing is marked, and joins neighbours of one colour', () => {
    expect(
      pieces(
        'abcd',
        [
          ['ab', 0],
          ['cd', 0],
        ],
        [],
      ),
    ).toEqual([{ text: 'abcd', colour: 0, mark: undefined }]);
  });

  it('cuts a marked expression across colour boundaries without losing a character', () => {
    const result = pieces('if (x < y)', coloured, [[4, 9, 'read']]);
    expect(result.map((piece) => piece.text).join('')).toBe('if (x < y)');
    expect(result).toEqual([
      { text: 'if ', colour: 0, mark: undefined },
      { text: '(', colour: 1, mark: undefined },
      { text: 'x', colour: 1, mark: 'read' },
      { text: ' < y', colour: 2, mark: 'read' },
      { text: ')', colour: 2, mark: undefined },
    ]);
  });

  it('works without colours, and drops a span that overlaps an earlier one', () => {
    expect(
      pieces('abcdef', undefined, [
        [1, 4, 'read'],
        [3, 5, 'updated'],
      ]),
    ).toEqual([
      { text: 'a', colour: undefined, mark: undefined },
      { text: 'bcd', colour: undefined, mark: 'read' },
      { text: 'ef', colour: undefined, mark: undefined },
    ]);
  });
});

describe('colouring a config', () => {
  const config = (lang?: string, tokens?: unknown) =>
    ({
      id: 'mini',
      title: 'Mini',
      layout: {
        panes: [
          {
            id: 'src',
            panel: 'code',
            content: { sources: [{ id: 'main', title: 'main', lang, text: TEXT, tokens }] },
          },
        ],
      },
      steps: [{ id: 's', title: 'S', calls: [{ id: 'c', label: 'C' }] }],
    }) as WalkthroughInput;

  it('adds colours to a source that names a known language, and the result lints clean', async () => {
    const input = config('js');
    expect(await addTokens(input)).toEqual({ coloured: 1, unknown: [] });
    const result = loadConfig(input, createRegistry());
    expect(result.problems.map(formatProblem)).toEqual([]);
  });

  it('leaves alone a source with no language, an unknown one, or colours already', async () => {
    expect(await addTokens(config())).toEqual({ coloured: 0, unknown: [] });
    expect(await addTokens(config('nope'))).toEqual({ coloured: 0, unknown: ['nope'] });
    const given = { palette: [], lines: [] };
    const input = config('js', given);
    expect(await addTokens(input)).toEqual({ coloured: 0, unknown: [] });
  });

  it('refuses colours that do not spell out the text', () => {
    const stale = { palette: [['#000000', '#ffffff']], lines: [[['other text', 0]]] };
    const rules = loadConfig(config('js', stale), createRegistry()).problems.map((p) => p.rule);
    expect(rules).toEqual(['code/tokens-mismatch']);
  });
});

describe('the bundled demos', () => {
  it('have up-to-date colours (run "pnpm colours")', async () => {
    const stored: unknown = JSON.parse(
      readFileSync('src/walkthroughs/colours.generated.json', 'utf8'),
    );
    expect(stored).toEqual(await demoColours(plainDemos));
  });

  it('get their colours applied', () => {
    const all = 'walkthroughs' in demos ? demos.walkthroughs : [demos];
    const sources = all.flatMap((walkthrough) =>
      walkthrough.layout.panes
        .filter((pane) => pane.panel === 'code')
        .flatMap((pane) => (pane.content as { sources: { tokens?: unknown }[] }).sources),
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.tokens !== undefined)).toBe(true);
  });
});
