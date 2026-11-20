/**
 * Configs that are valid under the contract but hard, and invalid configs the lint
 * should describe cleanly. Every `it.fails` names the defect it pins; the passing
 * `it` next to it proves the fixture is sound, so a typo cannot make an expected
 * failure pass for the wrong reason.
 */
import { describe, expect, it } from 'vitest';
import { createFolder, formatPath, loadConfig, type ElementsState } from '../../src/core';
import { patched, setPath } from '../../src/panels/payload/paths';
import { createRegistry } from '../../src/registry';
import { wrap } from './gen';
import { renderAll, renderPane } from './render';

const registry = createRegistry();
const call = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, ...extra });
const steps = (calls: Record<string, unknown>[]) => [
  { id: 's', title: 'S', calls: calls as never },
];
const load = (config: unknown) => loadConfig(config, registry);
const errors = (config: unknown) => load(config).problems.filter((p) => p.severity === 'error');
const where = (config: unknown) => errors(config).map((p) => `${p.rule} @ ${formatPath(p.path)}`);

const graph = (content: unknown, calls = [call('k')]) =>
  wrap('w', [{ id: 'g', panel: 'graph', content: content as never }], steps(calls));
const A = { id: 'a', label: 'A' };
const B = { id: 'b', label: 'B' };

// ---------------------------------------------------------------------------
describe('prototype-named ids: a config that passes the contract must not break the engine', () => {
  const tableWith = (paneId: string) =>
    wrap(
      'w',
      [
        {
          id: paneId,
          panel: 'table',
          content: { columns: [{ id: 'c', label: 'C' }], rows: [{ id: 'r', cells: { c: 'x' } }] },
        },
        { id: 'seq', panel: 'sequence' },
      ],
      steps([call('k', { from: 'client', to: 'gateway', effects: { seq: [] } })]),
    );

  it('precondition: an ordinary pane name loads', () => {
    expect(load(tableWith('ledger')).ok).toBe(true);
  });

  // DEFECT: call.effects?.[pane.id] finds Object.prototype members, so effectsOf returns the Object
  // function and lint throws "all.forEach is not a function" (src/core/effects.ts:17, lint.ts checkCalls)
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    it.fails(`a pane named "${name}" does not make loadConfig throw`, () => {
      expect(() => load(tableWith(name))).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
describe('status annotation ids', () => {
  const withStatus = (status: string) => ({
    ...wrap(
      'w',
      [{ id: 'q', panel: 'sequence' }],
      steps([call('k', { from: 'client', to: 'gateway', annotations: { status: { status } } })]),
    ),
    annotations: { status: { statuses: { ok: { label: 'OK' } } } },
  });

  it('an undefined status is reported', () => {
    expect(where(withStatus('nope'))).toEqual([
      'status/unknown @ steps[0].calls[0].annotations.status.status',
    ]);
  });

  // DEFECT: config.statuses[data.status] reads Object.prototype (src/annotations/status/index.ts:35, :67)
  it.fails('a status named "constructor" is reported as undefined, like any other', () => {
    expect(where(withStatus('constructor'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('table cells and rows that share a name with Object.prototype', () => {
  const table = (columns: string[], rows: { id: string; cells: Record<string, string> }[]) =>
    wrap(
      'w',
      [
        {
          id: 't',
          panel: 'table',
          content: { columns: columns.map((id) => ({ id, label: id })), rows },
        },
      ],
      steps([call('k')]),
    );

  it('precondition: ordinary names render the cell text', () => {
    const w = load(table(['name', 'qty'], [{ id: 'row', cells: { name: 'bolt' } }]))
      .walkthroughs[0]!;
    const { html, complaints } = renderAll(w);
    expect(complaints).toEqual([]);
    expect(html).toContain('>bolt<');
  });

  it('precondition: both configs used by the expected failures below pass lint', () => {
    const column = table(['constructor', 'd'], [{ id: 'r', cells: { d: 'x' } }]);
    const row = table(['name'], [{ id: 'constructor', cells: { name: 'real value' } }]);
    expect(load(column).ok).toBe(true);
    expect(load(row).ok).toBe(true);
  });

  // DEFECT: row.cells[column.id] reads Object.prototype when a row omits that cell (src/panels/table/index.tsx:146)
  it.fails('a column named "constructor" with a row that omits it renders an empty cell', () => {
    const w = load(table(['constructor', 'd'], [{ id: 'r', cells: { d: 'x' } }])).walkthroughs[0]!;
    expect(renderAll(w).complaints).toEqual([]);
  });

  // DEFECT: state.patches[row.id] returns the Object function for a row called "constructor"; its
  // `name` property ("Object") shows up as the cell text (src/panels/table/index.tsx:106, :146)
  it.fails(
    'a row named "constructor" does not show the text "Object" in a column named "name"',
    () => {
      const w = load(table(['name'], [{ id: 'constructor', cells: { name: 'real value' } }]))
        .walkthroughs[0]!;
      const { html } = renderAll(w);
      expect(html).toContain('real value');
      expect(html).not.toContain('>Object<');
    },
  );

  it('precondition for the row case: the same table with another row id shows the real value', () => {
    const w = load(table(['name'], [{ id: 'other', cells: { name: 'real value' } }]))
      .walkthroughs[0]!;
    expect(renderAll(w).html).toContain('real value');
  });
});

// ---------------------------------------------------------------------------
describe('code line ranges', () => {
  const code = (text: string, effects: Record<string, unknown>[]) =>
    wrap(
      'w',
      [{ id: 'c', panel: 'code', content: { sources: [{ id: 's', title: 'S', text }] } }],
      steps(effects.map((e, i) => call(`k${i}`, { effects: { c: [e] } }))),
    );

  it('a line past the end names the call, the line and the length', () => {
    expect(where(code('a\nb', [{ read: 's', lines: [3] }]))).toEqual([
      'code/line-out-of-range @ steps[0].calls[0].effects.c[0].lines',
    ]);
  });

  it('ranges at the boundaries are accepted: first line, last line, whole file, one line', () => {
    const text = Array.from({ length: 50 }, (_, i) => `l${i + 1}`).join('\n');
    const config = code(text, [
      { read: 's', lines: [1] },
      { read: 's', lines: [50] },
      { read: 's', lines: [[1, 50]] },
      { read: 's', lines: [[7, 7]] },
    ]);
    expect(load(config).ok).toBe(true);
  });

  it('a line is valid against the text a replacement installed, and not against the old one', () => {
    const long = Array.from({ length: 10 }, (_, i) => `n${i}`).join('\n');
    const grows = code('a\nb', [{ update: 's', fields: { text: long }, lines: [10] }]);
    expect(load(grows).ok).toBe(true);
    const shrinks = code(long, [
      { update: 's', fields: { text: 'one' } },
      { read: 's', lines: [2] },
    ]);
    expect(where(shrinks)).toEqual([
      'code/line-out-of-range @ steps[0].calls[1].effects.c[0].lines',
    ]);
  });

  const hugeRange = () => code('a\nb', [{ read: 's', lines: [[1, 200_000]] }]);

  it('precondition: a modest out-of-range range is reported cleanly', () => {
    expect(where(code('a\nb', [{ read: 's', lines: [[1, 500]] }]))).toEqual([
      'code/line-out-of-range @ steps[0].calls[0].effects.c[0].lines',
    ]);
  });

  // DEFECT: Math.max(0, ...expand(lines)) overflows the stack for ranges of ~125k lines or more,
  // so loadConfig throws instead of reporting line-out-of-range (src/panels/code/index.tsx:161)
  it.fails('a huge range is reported, not thrown (spread of 200,000 numbers)', () => {
    expect(where(hugeRange())).toEqual([
      'code/line-out-of-range @ steps[0].calls[0].effects.c[0].lines',
    ]);
  });

  // DEFECT: expand() materialises every line of every range before checking any bound, so a range
  // like [1, 4e9] allocates until the engine gives up. Not run here: it takes seconds and memory.
  // The 200,000 case above is the same cause.

  // DEFECT (lint quality): a reversed range expands to nothing, so the call marks no lines and lint is silent
  it.fails('a reversed range [5, 3] is reported', () => {
    expect(
      errors(code('a\nb\nc\nd\ne\nf', [{ read: 's', lines: [[5, 3]] }])).length,
    ).toBeGreaterThan(0);
  });

  it('precondition for the reversed range: it loads, and marks nothing', () => {
    const w = load(code('a\nb\nc\nd\ne\nf', [{ read: 's', lines: [[5, 3]] }])).walkthroughs[0]!;
    expect(renderAll(w).html).not.toContain('data-mark=');
  });

  it('precondition for remove: a text replacement followed by a read of its tail is fine', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `n${i}`).join('\n');
    const config = code('a\nb\nc', [
      { update: 's', fields: { text: twenty } },
      { read: 's', lines: [15] },
    ]);
    expect(load(config).ok).toBe(true);
  });

  // DEFECT: lint tracks line counts across `fields.text` but not across `remove`, while the reducer
  // drops the patch on remove. Lint accepts line 15 of a source that is 3 lines long at that call
  // (src/panels/code/index.tsx lint: `length` map is never reset)
  it.fails(
    'a line past the original text is rejected after the source was removed and re-added',
    () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `n${i}`).join('\n');
      const config = code('a\nb\nc', [
        { update: 's', fields: { text: twenty } },
        { remove: 's' },
        { add: 's' },
        { read: 's', lines: [15] },
      ]);
      expect(errors(config).length).toBeGreaterThan(0);
    },
  );

  it('precondition: the reducer really resets the text on remove and re-add', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `n${i}`).join('\n');
    const w = load(
      code('a\nb\nc', [{ update: 's', fields: { text: twenty } }, { remove: 's' }, { add: 's' }]),
    ).walkthroughs[0]!;
    const state = createFolder(w).at(0, 2).c!.state as ElementsState;
    expect(state.patches).toEqual({});
  });

  // DEFECT: CodeView never reads state.present, so `remove` on a source changes nothing on screen
  // (src/panels/code/index.tsx CodeView)
  const removedSource = () =>
    load(
      wrap(
        'w',
        [
          {
            id: 'c',
            panel: 'code',
            content: { sources: [{ id: 's', title: 'S', text: 'visible text' }] },
          },
        ],
        steps([call('k', { effects: { c: [{ remove: 's' }] } }), call('k2')]),
      ),
    ).walkthroughs[0]!;

  it('precondition: after the remove the folder says the source is gone, and on the removing call it is still drawn', () => {
    const w = removedSource();
    expect((createFolder(w).at(0, 1).c!.state as ElementsState).present).toEqual([]);
    expect(renderPane(w, w.panes[0]!, 0, 0)).toContain('visible text');
  });
  it.fails('a removed source is no longer shown at the next call', () => {
    const w = removedSource();
    expect(renderPane(w, w.panes[0]!, 0, 1)).not.toContain('visible text');
  });
});

// ---------------------------------------------------------------------------
describe('payload', () => {
  const payload = (
    value: unknown,
    calls: Record<string, unknown>[] = [call('k')],
    extra: Record<string, unknown> = {},
  ) =>
    wrap(
      'w',
      [
        {
          id: 'p',
          panel: 'payload',
          content: { payloads: [{ id: 'd', title: 'D', value, ...extra }] },
        },
      ],
      steps(calls),
    );
  const upd = (fields: Record<string, unknown>) =>
    call('u', { effects: { p: [{ update: 'd', fields }] } });

  it('paths through arrays and nested objects resolve', () => {
    const config = payload({ entries: [{ hash: 'a' }, { hash: 'b' }], tree: { l: { r: 'x' } } }, [
      call('k', {
        effects: { p: [{ read: 'd', paths: ['entries.1.hash', 'tree.l.r', 'entries.0'] }] },
      }),
    ]);
    expect(load(config).ok).toBe(true);
  });

  it('a path through a leaf, past the end of an array, or into a missing key is reported with its own path', () => {
    const config = payload({ a: 1, list: [1] }, [
      call('k', { effects: { p: [{ read: 'd', paths: ['a.b', 'list.1', 'zz'] }] } }),
    ]);
    expect(where(config)).toEqual([
      'payload/unknown-path @ steps[0].calls[0].effects.p[0].paths[0]',
      'payload/unknown-path @ steps[0].calls[0].effects.p[0].paths[1]',
      'payload/unknown-path @ steps[0].calls[0].effects.p[0].paths[2]',
    ]);
  });

  it('a key that contains a dot cannot be addressed (documented): lint says so, but cannot express it', () => {
    expect(where(payload({ 'a.b': 1 }, [upd({ 'a.b': 2 })]))).toEqual([
      'payload/unknown-path @ steps[0].calls[0].effects.p[0].fields.a.b',
    ]);
  });

  it('a value that is itself a leaf (string, number, null, array) is accepted', () => {
    for (const value of ['text', 0, null, [], {}, [[]], true]) {
      expect(load(payload(value)).ok, JSON.stringify(value)).toBe(true);
    }
  });

  it('raw together with an update is a warning that names the field, not an error', () => {
    const result = load(payload({ a: 1 }, [upd({ a: 2 })], { raw: { text: '{"a":1}' } }));
    expect(result.ok).toBe(true);
    expect(result.problems.map((p) => `${p.rule} @ ${formatPath(p.path)}`)).toEqual([
      'payload/raw-out-of-date @ steps[0].calls[0].effects.p[0].fields',
    ]);
  });

  // DEFECT (lint quality): a "$ref" that names no element anywhere is accepted; clicking it selects
  // an id that exists in no pane (src/panels/payload/index.tsx lint has no $ref check)
  it('precondition: a $ref to an element of the same walkthrough is accepted', () => {
    expect(load(payload({ link: { $ref: 'd', text: 'self' } })).ok).toBe(true);
  });
  it.fails('a $ref to an id that no pane has is reported', () => {
    expect(
      errors(payload({ link: { $ref: 'nowhere', text: 'dead link' } })).length,
    ).toBeGreaterThan(0);
  });

  // DEFECT (lint quality): extra keys next to "$ref" are silently dropped from the display
  // because isRef() makes the whole object a leaf (src/panels/payload/paths.ts:isRef)
  it.fails(
    'an object with $ref and other keys is reported instead of silently losing the keys',
    () => {
      expect(
        load(payload({ a: { $ref: 'd', text: 't', hidden: 'lost' } })).problems.length,
      ).toBeGreaterThan(0);
    },
  );

  describe('a $ref whose "text" is not a string passes lint and then breaks rendering', () => {
    const rendered = (config: unknown) => renderAll(load(config).walkthroughs[0]!);

    it('precondition: the same shapes with string text load and render', () => {
      expect(
        load(
          payload({ a: { b: { c: { $ref: 'd', text: 'five' } } }, link: { $ref: 'd', text: 'x' } }),
        ).ok,
      ).toBe(true);
      expect(
        rendered(payload({ a: { b: { c: { $ref: 'd', text: 'five' } } } })).complaints,
      ).toEqual([]);
    });

    it('precondition: the configs used by the expected failures below pass lint', () => {
      const objectText = payload({ link: { $ref: 'd', text: {} } });
      const nestedNumber = payload({ a: { b: { c: { $ref: 'd', text: 5 } } } });
      const viaUpdate = payload({ a: { b: { c: { $ref: 'd', text: 'ok' } } } }, [
        call('k0'),
        call('k1', {
          effects: { p: [{ update: 'd', fields: { a: { b: { c: { $ref: 'd', text: 5 } } } } }] },
        }),
      ]);
      for (const config of [objectText, nestedNumber, viaUpdate]) {
        expect(load(config).ok, JSON.stringify(load(config).problems)).toBe(true);
      }
    });

    // DEFECT: Leaf renders ref.text as a React child, which throws for an object (payload/index.tsx Leaf)
    it.fails('text: {} does not blank the page', () => {
      expect(() => rendered(payload({ link: { $ref: 'd', text: {} } }))).not.toThrow();
    });

    // DEFECT: fitsOneLine calls shown.includes on a number (payload/index.tsx fitsOneLine)
    it.fails('text: 5 inside a nested object does not throw a TypeError', () => {
      expect(() => rendered(payload({ a: { b: { c: { $ref: 'd', text: 5 } } } }))).not.toThrow();
    });

    // The same data arriving through `update` breaks only from that call on.
    it('precondition: call 0 of an update-introduced bad ref renders fine', () => {
      const config = payload({ a: { b: { c: { $ref: 'd', text: 'ok' } } } }, [
        call('k0'),
        call('k1', {
          effects: { p: [{ update: 'd', fields: { a: { b: { c: { $ref: 'd', text: 5 } } } } }] },
        }),
      ]);
      const w = load(config).walkthroughs[0]!;
      expect(() =>
        renderAll({ ...w, steps: [{ ...w.steps[0]!, calls: [w.steps[0]!.calls[0]!] }] }),
      ).not.toThrow();
    });
    it.fails('an update that installs text: 5 does not throw at its own call', () => {
      const config = payload({ a: { b: { c: { $ref: 'd', text: 'ok' } } } }, [
        call('k0'),
        call('k1', {
          effects: { p: [{ update: 'd', fields: { a: { b: { c: { $ref: 'd', text: 5 } } } } }] },
        }),
      ]);
      expect(() => rendered(config)).not.toThrow();
    });
  });

  describe('keys that are special to JavaScript objects', () => {
    const value = () => JSON.parse('{"__proto__": "kept?", "a": 1}') as unknown;

    it('precondition: the key is a real own property and the value loads', () => {
      expect(Object.keys(value() as object)).toEqual(['__proto__', 'a']);
      expect(load(payload(value())).ok).toBe(true);
    });

    // DEFECT: setPath copies members with copy[name] = ..., and for name "__proto__" that assigns
    // the prototype instead of creating a key, so the member vanishes (payload/paths.ts:setPath)
    it.fails('patching one field keeps a sibling key named "__proto__"', () => {
      const after = setPath(value(), 'a', 2) as Record<string, unknown>;
      expect(Object.keys(after).sort()).toEqual(['__proto__', 'a']);
    });

    // DEFECT: the same assignment makes `fields: { "__proto__": ... }` a silent no-op although lint
    // found the path (hasPath uses Object.entries and succeeds)
    it.fails('updating a field named "__proto__" changes it', () => {
      const after = patched(
        value(),
        JSON.parse('{"__proto__": "changed"}') as Record<string, unknown>,
      ) as Record<string, unknown>;
      expect(Object.getOwnPropertyDescriptor(after, '__proto__')?.value).toBe('changed');
    });
  });

  it('a top-level key called "tone" cannot be updated: `fields.tone` is the row tone (contract trap)', () => {
    const w = load(payload({ tone: 'a' }, [upd({ tone: 'b' })])).walkthroughs[0]!;
    const state = createFolder(w).at(0, 0).p!.state as ElementsState;
    // The patch is stored, but patched() skips "tone", so the visible value stays 'a'.
    expect(state.patches.d).toEqual({ tone: 'b' });
    expect(patched({ tone: 'a' }, state.patches.d)).toEqual({ tone: 'a' });
  });

  it('precondition for remove: a path that exists only because of a patch is accepted while the patch lives', () => {
    expect(
      load(
        payload({ a: 1 }, [
          upd({ a: { b: 2 } }),
          call('r', { effects: { p: [{ read: 'd', paths: ['a.b'] }] } }),
        ]),
      ).ok,
    ).toBe(true);
  });

  // DEFECT: payload lint, like code lint, keeps its simulated value across `remove`, while the
  // reducer resets patches. A path that only existed through a patch passes lint after remove + add
  it.fails(
    'a path that only existed through a patch is rejected after the payload was removed and re-added',
    () => {
      const config = payload({ a: 1 }, [
        upd({ a: { b: 2 } }),
        call('x', { effects: { p: [{ remove: 'd' }] } }),
        call('y', { effects: { p: [{ add: 'd' }] } }),
        call('r', { effects: { p: [{ read: 'd', paths: ['a.b'] }] } }),
      ]);
      expect(errors(config).length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
describe('lint quality: one cause should give one clear problem with the right path', () => {
  it('a graph edge to an absent node is one problem at the edge end, even when calls use the edge', () => {
    const config = graph({ nodes: [A], edges: [{ from: 'a', to: 'zz' }] }, [
      call('k', { effects: { g: [{ add: 'a' }, { add: 'a.zz' }] } }),
    ]);
    expect(where(config)).toEqual(['graph/unknown-node @ layout.panes[0].content.edges[0].to']);
  });

  it('an effect on an unknown pane and one on an unknown id are two problems, each at its own path', () => {
    const config = graph({ nodes: [A] }, [
      call('k', { effects: { nope: [{ add: 'a' }], g: [{ add: 'b' }] } }),
    ]);
    expect(where(config)).toEqual([
      'unknown-pane @ steps[0].calls[0].effects.nope',
      'unknown-id @ steps[0].calls[0].effects.g[0].add',
    ]);
  });

  it('a pane whose panel is not registered is one problem even when calls have effects on it', () => {
    const config = wrap(
      'w',
      [{ id: 'g', panel: 'nopanel' }],
      steps([call('k', { effects: { g: [{ add: 'x' }] } })]),
    );
    expect(where(config)).toEqual(['unknown-panel @ layout.panes[0].panel']);
  });

  it('a duplicate call id across steps is reported once at the second', () => {
    const config = wrap(
      'w',
      [{ id: 'g', panel: 'graph', content: { nodes: [A] } }],
      [
        { id: 's1', title: 'S', calls: [call('k')] },
        { id: 's2', title: 'S', calls: [call('k')] },
      ],
    );
    expect(where(config)).toEqual(['duplicate-id @ steps[1].calls[0].id']);
  });

  it('duplicate walkthrough ids in a collection are reported once, at the second id', () => {
    const one = () =>
      wrap('same', [{ id: 'g', panel: 'graph', content: { nodes: [A] } }], steps([call('k')]));
    expect(where({ walkthroughs: [one(), one()] })).toEqual(['duplicate-id @ walkthroughs[1].id']);
  });

  it('a collection with one broken member is not ok, so the viewer lists problems and shows none of them, though the good one still resolves', () => {
    const good = wrap(
      'good',
      [{ id: 'g', panel: 'graph', content: { nodes: [A] } }],
      steps([call('k')]),
    );
    const bad = wrap('bad', [{ id: 'g', panel: 'nopanel' }], steps([call('k')]));
    const result = load({ walkthroughs: [good, bad] });
    expect(result.ok).toBe(false);
    expect(result.walkthroughs.map((w) => w.id)).toEqual(['good']);
  });

  // DEFECT (lint quality): a box cycle reports every box that hangs below the cycle as being "inside
  // itself", though only the two in the loop are (src/panels/boxes/index.tsx lint)
  it.fails(
    'a two-box cycle with a bystander child is exactly two problems, none about the bystander',
    () => {
      const boxes = [
        { id: 'x', label: 'X', parent: 'y' },
        { id: 'y', label: 'Y', parent: 'x' },
        { id: 'z', label: 'Z', parent: 'x' },
      ];
      const config = wrap(
        'w',
        [{ id: 'b', panel: 'boxes', content: { boxes } }],
        steps([call('k')]),
      );
      const found = where(config);
      expect(found).toHaveLength(2);
      expect(found.join('\n')).not.toContain('boxes[2]');
    },
  );

  it('precondition for the cycle: a plain two-box loop is one problem per box in the loop', () => {
    const boxes = [
      { id: 'x', label: 'X', parent: 'y' },
      { id: 'y', label: 'Y', parent: 'x' },
    ];
    const config = wrap('w', [{ id: 'b', panel: 'boxes', content: { boxes } }], steps([call('k')]));
    expect(where(config)).toHaveLength(2);
  });

  // DEFECT (lint quality): duplicate element ids point at `content`, not at the element, so a pane
  // with 500 rows gives no hint which one (src/core/lint.ts resolvePanes)
  it('precondition: parallel edges without ids are reported as duplicate-id', () => {
    const config = graph({
      nodes: [A, B],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    });
    expect(errors(config).map((p) => p.rule)).toEqual(['duplicate-id']);
  });
  it.fails('a duplicate element id is reported at the element that repeats it', () => {
    const config = graph({
      nodes: [A, B],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    });
    expect(errors(config)[0]!.path.length).toBeGreaterThan(4);
  });

  // DEFECT (lint quality): when two panes share an id, the second is dropped silently and effects on
  // the id are checked against the first, so one cause yields a second, misleading unknown-id
  it('precondition: duplicate pane ids are reported at the second pane', () => {
    const config = wrap(
      'w',
      [
        { id: 'g', panel: 'graph', content: { nodes: [A] } },
        { id: 'g', panel: 'graph', content: { nodes: [B] } },
      ],
      steps([call('k')]),
    );
    expect(where(config)).toEqual(['duplicate-id @ layout.panes[1].id']);
  });
  it.fails('duplicate pane ids with an effect on the second pane stay one problem', () => {
    const config = wrap(
      'w',
      [
        { id: 'g', panel: 'graph', content: { nodes: [A] } },
        { id: 'g', panel: 'graph', content: { nodes: [B] } },
      ],
      steps([call('k', { effects: { g: [{ add: 'b' }] } })]),
    );
    expect(where(config)).toHaveLength(1);
  });

  it('ids at the edge of the pattern load: dots, colons, dashes, underscores, leading digits, one-character', () => {
    const ids = ['a', '0', '9z', 'a.b', 'a:b', 'a-b', 'a_b', 'A.B:c-d_e', 'x'.repeat(2000)];
    const nodes = ids.map((id) => ({ id, label: id }));
    const edges = [
      { from: ids[3]!, to: ids[4]! },
      { from: ids[5]!, to: ids[6]!, id: 'e1' },
    ];
    const config = graph({ nodes, edges }, [
      call('k', { effects: { g: ids.map((id) => ({ add: id })) } }),
    ]);
    expect(errors(config)).toEqual([]);
  });

  it.each(['', '.a', '-a', ':a', '_a', 'a b', 'a/b', 'é', 'a\n', '\u0000', 'a‮'])(
    'the id %j is rejected by the pattern with one schema problem',
    (id) => {
      const found = where(graph({ nodes: [{ id, label: 'X' }] }));
      expect(found).toEqual(['schema @ layout.panes[0].content.nodes[0].id']);
    },
  );

  it('a prefix id never matches its longer sibling: "a" and "a.b" and "a.b.c" are three elements', () => {
    const nodes = ['a', 'a.b', 'a.b.c'].map((id) => ({ id, label: id }));
    const config = graph({ nodes }, [
      call('k', { effects: { g: [{ add: 'a' }, { add: 'a.b' }] } }),
      call('j', { effects: { g: [{ remove: 'a' }] } }),
    ]);
    const w = load(config).walkthroughs[0]!;
    expect((createFolder(w).at(0, 1).g!.state as ElementsState).present).toEqual(['a.b']);
  });

  it('a schema table called "a.b" and a column "b" of table "a" collide, and say so once', () => {
    const tables = [
      { id: 'a', label: 'A', columns: [{ id: 'b' }] },
      { id: 'a.b', label: 'AB' },
    ];
    expect(
      where(wrap('w', [{ id: 's', panel: 'schema', content: { tables } }], steps([call('k')]))),
    ).toEqual(['duplicate-id @ layout.panes[0].content']);
  });

  it('a relation id that equals a column id collides and says so once', () => {
    const tables = [{ id: 'a', label: 'A', columns: [{ id: 'b' }] }];
    const relations = [{ id: 'a.b', from: 'a', to: 'a' }];
    expect(
      where(
        wrap(
          'w',
          [{ id: 's', panel: 'schema', content: { tables, relations } }],
          steps([call('k')]),
        ),
      ),
    ).toEqual(['duplicate-id @ layout.panes[0].content']);
  });

  it('schema relations between columns of one table, in both directions between two tables, and to a column added later all load', () => {
    const tables = [
      {
        id: 'users',
        label: 'U',
        columns: [{ id: 'id' }, { id: 'manager_id' }, { id: 'late', initial: false }],
      },
      { id: 'orders', label: 'O', columns: [{ id: 'user_id' }] },
    ];
    const relations = [
      { from: 'users.manager_id', to: 'users.id' },
      { from: 'orders.user_id', to: 'users.id' },
      { from: 'users.id', to: 'orders.user_id' },
      { from: 'orders', to: 'users.late' },
    ];
    const config = wrap(
      'w',
      [{ id: 's', panel: 'schema', content: { tables, relations } }],
      steps([call('k', { effects: { s: [{ add: 'users.late' }] } })]),
    );
    expect(errors(config)).toEqual([]);
  });

  it('a hand-written step summary that is wrong is reported with the verb in the path', () => {
    const config = wrap(
      'w',
      [{ id: 'g', panel: 'graph', content: { nodes: [A] } }],
      [{ id: 's', title: 'S', summary: { g: { add: ['a'] } }, calls: [call('k')] }],
    );
    expect(where(config)).toEqual(['summary-mismatch @ steps[0].summary.g.add']);
  });

  // DEFECT (lint quality, mild): trailing newline counts as an extra empty line
  it('a trailing newline makes one more addressable line (documented by this test)', () => {
    const config = wrap(
      'w',
      [{ id: 'c', panel: 'code', content: { sources: [{ id: 's', title: 'S', text: 'a\nb\n' }] } }],
      steps([call('k', { effects: { c: [{ read: 's', lines: [3] }] } })]),
    );
    expect(load(config).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('graph content the layout cannot honour', () => {
  // DEFECT: pinned() needs both x and y on every node; a node with only x is laid out by ELK and
  // its x is dropped without any lint message (src/panels/_diagram/layout.ts withElk)
  it('precondition: a partial pin loads without a problem', () => {
    const config = graph({ nodes: [{ ...A, x: 500 }, B], edges: [{ from: 'a', to: 'b' }] });
    expect(load(config).problems).toEqual([]);
  });
});
