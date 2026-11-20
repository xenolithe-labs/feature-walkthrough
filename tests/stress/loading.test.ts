import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeHash, encodeHash } from '../../src/core';
import { injectConfig, MARKER } from '../../cli/inject';
import { HOSTILE_TEXT, wrap } from './gen';

// ---------------------------------------------------------------------------
describe('URL hash', () => {
  const shape = [3, 1, 4];
  const index = [
    { id: 'first', shape },
    { id: 'second', shape: [2] },
  ];
  const at = (hash: string) => decodeHash(hash, index);

  it('decodes a plain cursor, one-based in the URL', () => {
    expect(at('#w=first&s=3&c=2')).toEqual({ w: 'first', s: 2, c: 1 });
  });

  it.each([
    ['', { w: 'first', s: 0, c: 0 }],
    ['#', { w: 'first', s: 0, c: 0 }],
    ['#w=first&s=abc&c=xyz', { w: 'first', s: 0, c: 0 }],
    ['#w=first&s=-5&c=-5', { w: 'first', s: 0, c: 0 }],
    ['#w=first&s=0&c=0', { w: 'first', s: 0, c: 0 }],
    ['#w=first&s=99999&c=99999', { w: 'first', s: 2, c: 3 }],
    ['#w=first&s=1e9&c=1e9', { w: 'first', s: 2, c: 3 }],
    ['#w=first&s=2.9&c=1', { w: 'first', s: 1, c: 0 }],
    ['#w=first&s=0x3&c=1', { w: 'first', s: 2, c: 0 }],
    ['#w=first&s=%203%20&c=1', { w: 'first', s: 2, c: 0 }],
    ['#w=first&s=1&s=3&c=1', { w: 'first', s: 0, c: 0 }],
    ['#w=nope&s=3&c=3', { w: 'first', s: 0, c: 0 }],
    ['#w=second&s=2&c=9', { w: 'second', s: 0, c: 1 }],
  ])('%s opens at the nearest valid place', (hash, expected) => {
    expect(at(hash)).toEqual(expected);
  });

  it('keeps a selection only for a known walkthrough, and does not check that the element exists', () => {
    expect(at('#w=first&sel=ghost')).toEqual({ w: 'first', s: 0, c: 0, sel: 'ghost' });
    expect(at('#w=nope&sel=ghost')).toEqual({ w: 'first', s: 0, c: 0 });
  });

  it('a walkthrough list with nothing in it decodes to nothing', () => {
    expect(decodeHash('#w=a', [])).toBeUndefined();
  });

  // DEFECT: toInt maps Infinity to 0, so a number too big to be finite lands on step 1 while
  // 99999 lands on the last step (src/core/cursor.ts toInt)
  it('precondition: a large finite number clamps to the last call', () => {
    expect(at('#w=first&s=99999999999999999999&c=1')).toMatchObject({ s: 2 });
  });
  it('a number too large for a double (1e999) clamps to the last call too', () => {
    expect(at('#w=first&s=1e999&c=1e999')).toEqual({ w: 'first', s: 2, c: 3 });
  });
  it('"Infinity" clamps to the last call too', () => {
    expect(at('#w=first&s=Infinity&c=Infinity')).toEqual({ w: 'first', s: 2, c: 3 });
  });

  it('decode never throws and always lands inside the shape, for any string', () => {
    fc.assert(
      fc.property(fc.string(), (hash) => {
        const cursor = at(hash)!;
        const target = index.find((w) => w.id === cursor.w)!;
        expect(cursor.s).toBeGreaterThanOrEqual(0);
        expect(cursor.s).toBeLessThan(target.shape.length);
        expect(cursor.c).toBeGreaterThanOrEqual(0);
        expect(cursor.c).toBeLessThan(target.shape[cursor.s]!);
      }),
      { numRuns: 500 },
    );
  });

  it('encode then decode returns the cursor, for ids and selections with every awkward character', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('first', 'second'),
        fc.nat(5),
        fc.nat(5),
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        (w, s, c, sel) => {
          const target = index.find((item) => item.id === w)!;
          const s2 = Math.min(s, target.shape.length - 1);
          const c2 = Math.min(c, target.shape[s2]! - 1);
          const cursor = { w, s: s2, c: c2, ...(sel === undefined ? {} : { sel }) };
          expect(at(encodeHash(cursor))).toEqual(cursor);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
describe('building a page: injectConfig', () => {
  const page = `<html><body><div id="root"></div>${MARKER}</body></html>`;

  /** Runs the injected script the way a browser would and returns the global it sets. */
  function run(config: unknown): unknown {
    const html = injectConfig(page, config);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts, 'exactly one script element, whatever the config says').toHaveLength(1);
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(scripts[0]![1]!, sandbox);
    return sandbox.window.__FEATURE_WALKTHROUGH__;
  }
  const roundTrip = (config: unknown) => JSON.parse(JSON.stringify(config)) as unknown;

  it('every hostile string comes back byte for byte, and cannot end or start a script element', () => {
    const config = wrap(
      'inject',
      [
        {
          id: 'g',
          panel: 'graph',
          content: { nodes: HOSTILE_TEXT.map((t, i) => ({ id: `n${i}`, label: t, sub: t })) },
        },
      ],
      [
        {
          id: 's',
          title: HOSTILE_TEXT[4]!,
          text: HOSTILE_TEXT.join('\n'),
          calls: [{ id: 'k', label: HOSTILE_TEXT[0]!, text: HOSTILE_TEXT[3]! }],
        },
      ],
    );
    expect(run(config)).toEqual(roundTrip(config));
    expect(injectConfig(page, config)).not.toMatch(/<\/script>.*<\/script>/s);
  });

  it('the line and paragraph separators, a lone surrogate, comment openers and the marker itself survive', () => {
    const nasty = [
      ' ',
      ' ',
      '\ud800',
      '<!--',
      '-->',
      MARKER,
      '<!--fw-config--><!--fw-config-->',
      '</SCRIPT >',
      '\\u003c',
      '\\',
      '`${1}`',
    ];
    const config = { nasty, nested: { [MARKER]: MARKER, '</script>': 1 } };
    expect(run(config)).toEqual(roundTrip(config));
    expect(injectConfig(page, config).split(MARKER).length, 'the marker never reappears').toBe(1);
  });

  it('dollar sequences are not read as replacement patterns', () => {
    const config = { s: ['$&', "$'", '$`', '$$', '$1', '$<name>'] };
    expect(run(config)).toEqual(config);
  });

  it('a 5 MB string and 100 KB labels are carried whole', () => {
    const big = 'x'.repeat(5_000_000);
    const config = { big, label: 'é'.repeat(100_000) };
    const started = performance.now();
    const out = run(config) as typeof config;
    expect(out.big.length).toBe(5_000_000);
    expect(out.label.length).toBe(100_000);
    expect(performance.now() - started, 'ms').toBeLessThan(2000);
  });

  it('precondition: a config without the key "__proto__" survives the round trip', () => {
    const config = { a: { b: 1, c: [1, 2, { d: null }] } };
    expect(run(config)).toEqual(config);
  });

  // DEFECT: the config is written as a JavaScript object literal, where "__proto__": value sets the
  // prototype instead of creating a key, so the built page sees a different config from the one
  // `lint` checked and from `?src=` (cli/inject.ts, JSON.stringify output used as source text)
  it('a key named "__proto__" survives the round trip', () => {
    const config = JSON.parse('{"payload": {"__proto__": {"x": 1}, "y": 2}}') as unknown;
    expect(JSON.stringify(run(config))).toBe(JSON.stringify(config));
  });
});

// ---------------------------------------------------------------------------
describe('command line: lint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-stress-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function lint(name: string, content: string | Buffer) {
    const file = join(dir, name);
    writeFileSync(file, content);
    const started = performance.now();
    const result = spawnSync('node_modules/.bin/tsx', ['cli/index.ts', 'lint', file], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    return { ...result, ms: Math.round(performance.now() - started), file };
  }

  const ok = () =>
    wrap(
      'cli',
      [{ id: 'g', panel: 'graph', content: { nodes: [{ id: 'a', label: 'A' }] } }],
      [{ id: 's', title: 'S', calls: [{ id: 'k', label: 'K' }] }],
    );

  it('a valid file exits 0', () => {
    const r = lint('ok.json', JSON.stringify(ok()));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(': ok (1 walkthrough(s))');
  });

  it('invalid JSON exits 1 with one "cannot read" line and no stack trace', () => {
    const r = lint('bad.json', '{"id": ');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cannot read');
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });

  it('an empty file and a file holding only null exit 1 cleanly', () => {
    for (const content of ['', 'null', '[]', '"text"', '{"walkthroughs": 5}']) {
      const r = lint('odd.json', content);
      expect(r.status, `${JSON.stringify(content)}: ${r.stderr}`).toBe(1);
      expect(r.stderr).not.toMatch(/\n\s+at /);
    }
    // Starts the command line twice: seconds on a busy machine.
  }, 30_000);

  // DEFECT: read() passes the text to JSON.parse with the BOM still on it. The viewer's ?src= path
  // (fetch().json()) strips it, so the same file loads in the browser and fails in `lint`
  // (cli/index.ts read). The BOM is what many Windows editors put at the start of a UTF-8 file.
  it('a file with a UTF-8 byte order mark is read like any other', () => {
    const r = lint(
      'bom.json',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(ok()))]),
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it('a problem line carries the file, the rule and the path', () => {
    const config = ok();
    config.layout.panes[0]!.panel = 'hologram';
    const r = lint('rule.json', JSON.stringify(config));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error unknown-panel at layout.panes[0].panel');
  });

  it('a 20 MB file lints in a reasonable time and exits 0', () => {
    const line =
      'const value = compute(0, 1, 2, 3, 4); // a line of plausible source text 0123456789';
    const text = Array.from({ length: Math.ceil(20_000_000 / (line.length + 1)) }, () => line).join(
      '\n',
    );
    const config = wrap(
      'cli-big',
      [{ id: 'c', panel: 'code', content: { sources: [{ id: 'big', title: 'big', text }] } }],
      [
        {
          id: 's',
          title: 'S',
          calls: [{ id: 'k', label: 'K', effects: { c: [{ read: 'big', lines: [[1, 10]] }] } }],
        },
      ],
    );
    const json = JSON.stringify(config);
    expect(json.length).toBeGreaterThan(20_000_000);
    const r = lint('big.json', json);
    expect(r.status, r.stderr.slice(0, 300)).toBe(0);
    // Measured at roughly 0.6 s locally; the budget is generous so a slow machine does not flake.
    expect(r.ms, 'ms for a 20 MB file').toBeLessThan(15_000);
  }, 60_000);

  it('a 20 MB file made of many small rows lints in a reasonable time', () => {
    const rows = Array.from({ length: 120_000 }, (_, i) => ({
      id: `r${i}`,
      cells: { a: `value number ${i} `.repeat(4) },
    }));
    const config = wrap(
      'cli-rows',
      [{ id: 't', panel: 'table', content: { columns: [{ id: 'a', label: 'A' }], rows } }],
      [{ id: 's', title: 'S', calls: [{ id: 'k', label: 'K', effects: { t: [{ read: 'r5' }] } }] }],
    );
    const json = JSON.stringify(config);
    const r = lint('rows.json', json);
    expect(r.status, r.stderr.slice(0, 300)).toBe(0);
    expect(r.ms, `ms for ${(json.length / 1e6).toFixed(1)} MB in 120,000 rows`).toBeLessThan(
      30_000,
    );
  }, 90_000);

  // DEFECT: the same loadConfig throw as in lint.test.tsx surfaces here as an uncaught exception:
  // `check()` wraps only the file read, not loadConfig (cli/index.ts check)
  const twoPanes = (firstPane: string) =>
    wrap(
      'cli-proto',
      [
        { id: firstPane, panel: 'graph', content: { nodes: [{ id: 'a', label: 'A' }] } },
        { id: 'other', panel: 'graph', content: { nodes: [{ id: 'b', label: 'B' }] } },
      ],
      [
        {
          id: 's',
          title: 'S',
          calls: [{ id: 'k', label: 'K', effects: { other: [{ add: 'b' }] } }],
        },
      ],
    );

  it('precondition: the same two-pane file with an ordinary first pane name lints clean', () => {
    const r = lint('pane.json', JSON.stringify(twoPanes('first')));
    expect(r.status, r.stderr.slice(0, 300)).toBe(0);
  });
  it('a valid config with a pane named "constructor" lints clean instead of crashing', () => {
    const r = lint('constructor.json', JSON.stringify(twoPanes('constructor')));
    expect(r.status, r.stderr.slice(0, 300)).toBe(0);
  });
});
