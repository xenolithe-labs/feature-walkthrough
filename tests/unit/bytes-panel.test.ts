import { describe, expect, it } from 'vitest';
import {
  createFolder,
  loadConfig,
  type ElementsState,
  type WalkthroughInput,
} from '../../src/core';
import {
  BytesContent,
  bytesOfField,
  describeTotal,
  fitWidth,
  hexBytes,
  judgeValue,
  layout,
  measure,
  numeric,
  placeCursor,
  whereIs,
  type FrameDecl,
} from '../../src/panels/bytes/model';
import { createRegistry } from '../../src/registry';

type Effects = Record<string, Record<string, unknown>[]>;

function config(
  content: unknown,
  calls: Effects[] = [{}],
  extraPanes: WalkthroughInput['layout']['panes'] = [],
): WalkthroughInput {
  return {
    id: 'b',
    title: 'B',
    layout: { panes: [{ id: 'bytes', panel: 'bytes', content }, ...extraPanes] },
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

const load = (value: WalkthroughInput) => loadConfig(value, createRegistry());
const rules = (value: WalkthroughInput) =>
  load(value).problems.map((problem) => `${problem.severity} ${problem.rule}`);
const parse = (frame: unknown): FrameDecl =>
  BytesContent.parse({ frames: [frame] }).frames[0] as FrameDecl;

/** An IPv4-like header in 32-bit rows: a 4-bit version and IHL, then a 16-bit field that straddles. */
const bits = {
  id: 'h',
  title: 'H',
  unit: 'bits',
  fields: [
    { id: 'ver', size: 4, value: 4 },
    { id: 'ihl', size: 4, value: 5 },
    { id: 'tos', size: 8, value: 0 },
    { id: 'len', size: 16, value: 40 },
    { id: 'id', size: 16, value: '0xabcd' },
    { id: 'flags', size: 3, value: '0b010' },
    { id: 'frag', size: 13, value: 0 },
    { id: 'big', size: 48 },
  ],
};

describe('bytes panel: geometry', () => {
  it('derives offsets and the total from the sizes', () => {
    const geometry = measure(parse(bits));
    expect(geometry.fields.map((field) => [field.id, field.offset])).toEqual([
      ['ver', 0],
      ['ihl', 4],
      ['tos', 8],
      ['len', 16],
      ['id', 32],
      ['flags', 48],
      ['frag', 51],
      ['big', 64],
    ]);
    expect(geometry.total).toBe(112);
  });

  it('puts fields in rows of 32 bits and splits none that fit', () => {
    const drawn = layout(parse(bits));
    expect(drawn.rows).toBe(4);
    const piece = (field: string) => drawn.pieces.filter((item) => item.field === field);
    expect(piece('ihl')).toMatchObject([{ row: 0, col: 4, span: 4, parts: 1 }]);
    expect(piece('frag')).toMatchObject([{ row: 1, col: 19, span: 13 }]);
    // 48 bits starting at 64 fill row 2 and half of row 3.
    expect(piece('big')).toMatchObject([
      { row: 2, col: 0, span: 32, part: 0, parts: 2, skip: 0 },
      { row: 3, col: 0, span: 16, part: 1, parts: 2, skip: 32 },
    ]);
  });

  it('draws a field that straddles a row boundary in two pieces that share its id', () => {
    const wide = parse({
      id: 'h',
      title: 'H',
      unit: 'bits',
      fields: [
        { id: 'a', size: 24 },
        { id: 'b', size: 16 },
        { id: 'c', size: 24 },
      ],
    });
    const pieces = layout(wide).pieces;
    expect(pieces.filter((piece) => piece.field === 'b')).toMatchObject([
      { row: 0, col: 24, span: 8, part: 0, parts: 2, from: 24 },
      { row: 1, col: 0, span: 8, part: 1, parts: 2, from: 32, skip: 8 },
    ]);
  });

  it('draws the same frame at 16 bits a row, where a 32-bit field straddles', () => {
    const frame = parse({
      id: 'h',
      title: 'H',
      unit: 'bits',
      fields: [
        { id: 'port', size: 16 },
        { id: 'seq', size: 32 },
      ],
    });
    expect(layout(frame, 32).rows).toBe(2);
    const narrow = layout(frame, 16);
    expect(narrow.rows).toBe(3);
    expect(narrow.pieces.filter((piece) => piece.field === 'seq')).toMatchObject([
      { row: 1, col: 0, span: 16, part: 0, parts: 2 },
      { row: 2, col: 0, span: 16, part: 1, parts: 2 },
    ]);
  });

  it('halves the row until a column has room, never below 8 and only while even', () => {
    expect(fitWidth(32, 0, 11)).toBe(32);
    expect(fitWidth(32, 480, 11)).toBe(32);
    expect(fitWidth(32, 300, 11)).toBe(16);
    expect(fitWidth(32, 100, 11)).toBe(8);
    expect(fitWidth(16, 150, 22)).toBe(8);
  });

  it('draws a variable field of unknown size open to the end of its row', () => {
    const frame = parse({
      id: 'h',
      title: 'H',
      unit: 'bits',
      fields: [
        { id: 'a', size: 8 },
        { id: 'rest', variable: true },
      ],
    });
    expect(measure(frame).total).toBeNull();
    expect(layout(frame).pieces[1]).toMatchObject({ kind: 'open', row: 0, col: 8, span: 24 });
  });

  it('replaces the middle rows of a long variable field by one gap and keeps later offsets', () => {
    const frame = parse({
      id: 'h',
      title: 'H',
      unit: 'bytes',
      width: 16,
      fields: [
        { id: 'head', size: 4 },
        { id: 'body', size: 100, variable: true },
        { id: 'tail', size: 4 },
      ],
    });
    // body covers bytes 4..103: row 0 (12 bytes), rows 1..5 (80 bytes), row 6 (8 bytes).
    const drawn = layout(frame);
    const body = drawn.pieces.filter((piece) => piece.field === 'body');
    expect(body).toMatchObject([
      { kind: 'cells', row: 0, col: 4, span: 12 },
      { kind: 'gap', row: 1, hidden: 80 },
      { kind: 'cells', row: 2, col: 0, span: 8 },
    ]);
    // tail is really at byte 104, column 8 of what was row 6 and is now row 2.
    expect(drawn.pieces.at(-1)).toMatchObject({ field: 'tail', row: 2, col: 8, from: 104 });
    expect(measure(frame).fields.at(-1)).toMatchObject({ offset: 104 });
    expect(drawn.rows).toBe(3);
  });

  it('does not elide a variable field that only has one full row in the middle', () => {
    const frame = parse({
      id: 'h',
      title: 'H',
      unit: 'bytes',
      fields: [{ id: 'body', size: 40, variable: true }],
    });
    expect(layout(frame).pieces.map((piece) => piece.kind)).toEqual(['cells', 'cells', 'cells']);
  });

  it('places a cursor in a row, at the end, and inside a gap', () => {
    const frame = parse({
      id: 'h',
      title: 'H',
      unit: 'bytes',
      fields: [
        { id: 'head', size: 4 },
        { id: 'body', size: 100, variable: true },
      ],
    });
    const drawn = layout(frame);
    expect(placeCursor(drawn, 2, 104)).toEqual({ row: 0, col: 2, edge: 'start' });
    expect(placeCursor(drawn, 20, 104)).toEqual({ row: 1, col: 0, edge: 'start' });
    expect(placeCursor(drawn, 100, 104)).toEqual({ row: 2, col: 4, edge: 'start' });
    expect(placeCursor(drawn, 104, 104)).toEqual({ row: 2, col: 7, edge: 'end' });
    expect(placeCursor(drawn, 105, 104)).toBeUndefined();
  });

  it('measures segments by their text and counts the separators', () => {
    const frame = parse({
      id: 'j',
      title: 'J',
      unit: 'segments',
      fields: [
        { id: 'a', value: 'abc' },
        { id: 'b', value: '' },
        { id: 'c', value: 'de' },
      ],
    });
    expect(measure(frame).fields.map((field) => [field.offset, field.size])).toEqual([
      [0, 3],
      [4, 0],
      [5, 2],
    ]);
    expect(measure(frame).total).toBe(7);
    const changed = measure(frame, (field) => (field.id === 'b' ? 'xyz' : undefined));
    expect(changed.total).toBe(10);
  });
});

describe('bytes panel: values', () => {
  it('reads numbers, hex, binary and hex bytes', () => {
    expect(numeric('bits', 443)).toBe(443n);
    expect(numeric('bits', '0x01bb')).toBe(443n);
    expect(numeric('bits', '0b101')).toBe(5n);
    expect(numeric('bits', '443')).toBe(443n);
    expect(numeric('bits', 'SYN')).toBeUndefined();
    expect(numeric('bits', -1)).toBeUndefined();
    expect(numeric('bits', 1.5)).toBeUndefined();
    expect(numeric('bytes', '00 00 12')).toBe(18n);
    expect(hexBytes('0x16 03_03')).toEqual([0x16, 3, 3]);
    expect(hexBytes('123')).toBeUndefined();
    expect(hexBytes('zz')).toBeUndefined();
  });

  it('judges a value against its size, with numbers wider than 53 bits', () => {
    expect(judgeValue('bits', 16, '0xffff', 'v')).toBeNull();
    expect(judgeValue('bits', 16, '0x10000', 'v')).toMatch(/does not fit 16 bits/);
    expect(judgeValue('bits', 1, 2, 'v')).toMatch(/does not fit 1 bit\b/);
    expect(judgeValue('bits', 64, '0xffffffffffffffff', 'v')).toBeNull();
    expect(judgeValue('bits', 64, '0x10000000000000000', 'v')).toMatch(/does not fit/);
    expect(judgeValue('bits', 8, 'opaque text', 'v')).toBeNull();
    expect(judgeValue('bytes', 3, '16 03 03', 'v')).toBeNull();
    expect(judgeValue('bytes', 3, '16 03', 'v')).toMatch(/2 bytes but the field is 3/);
    expect(judgeValue('bytes', 2, 'xyz', 'v')).toMatch(/hex digits/);
    expect(judgeValue('bytes', 2, 0x10000, 'v')).toMatch(/does not fit 2 bytes/);
    expect(judgeValue('bits', 8, true, 'v')).toMatch(/text or a number/);
  });

  it('turns a number into padded bytes for a hex view', () => {
    const frame = parse({ id: 'h', title: 'H', unit: 'bytes', fields: [{ id: 'n', size: 3 }] });
    expect(bytesOfField(frame.fields[0]!, 18)).toEqual([0, 0, 18]);
    expect(bytesOfField(frame.fields[0]!, 'ab cd ef')).toEqual([0xab, 0xcd, 0xef]);
    expect(bytesOfField(frame.fields[0]!, undefined)).toBeUndefined();
  });

  it('says where a field is and how long a frame is', () => {
    expect(whereIs('bits', 110, 1)).toBe('bit 110');
    expect(whereIs('bits', 96, 32)).toBe('bits 96–127');
    expect(whereIs('bytes', 4, 4)).toBe('bytes 4–7');
    expect(whereIs('bytes', 160, null)).toBe('byte 160 onwards');
    expect(describeTotal('bits', 160, 11)).toBe('20 bytes (160 bits)');
    expect(describeTotal('bits', 12, 2)).toBe('12 bits');
    expect(describeTotal('segments', 295, 5)).toBe('295 characters in 5 segments');
    expect(describeTotal('bytes', null, 3)).toBe('length not fixed');
  });
});

describe('bytes panel: lint', () => {
  const frame = (extra: Record<string, unknown> = {}, fields?: unknown[]) => ({
    id: 'h',
    title: 'H',
    unit: 'bits',
    fields: fields ?? [
      { id: 'a', size: 16, value: 1 },
      { id: 'b', size: 16, value: '0xffff' },
    ],
    ...extra,
  });
  const content = (frames: unknown[], initial = true) => ({ frames, initial });

  it('accepts a consistent frame', () => {
    expect(load(config(content([frame({ length: 32 })]))).problems).toEqual([]);
  });

  it('checks a declared length against the sum of the sizes', () => {
    expect(rules(config(content([frame({ length: 40 })])))).toContain(
      'error bytes/length-mismatch',
    );
  });

  it('warns that a length cannot be checked when the last field has no size', () => {
    const open = frame({ length: 40 }, [
      { id: 'a', size: 16 },
      { id: 'rest', variable: true },
    ]);
    expect(rules(config(content([open])))).toContain('warning bytes/length-unknown');
  });

  it('needs a size, or variable, and only the last field may be without one', () => {
    expect(rules(config(content([frame({}, [{ id: 'a' }])])))).toContain(
      'error bytes/size-missing',
    );
    const middle = frame({}, [
      { id: 'a', variable: true },
      { id: 'b', size: 8 },
    ]);
    expect(rules(config(content([middle])))).toContain('error bytes/unsized-not-last');
  });

  it('refuses a value that does not fit its size, declared or updated', () => {
    const bad = frame({}, [{ id: 'a', size: 4, value: 16 }]);
    expect(rules(config(content([bad])))).toContain('error bytes/bad-value');
    const good = content([frame({}, [{ id: 'a', size: 4, value: 15 }])]);
    expect(rules(config(good, [{ bytes: [{ update: 'h.a', fields: { value: 16 } }] }]))).toContain(
      'error bytes/bad-field',
    );
    expect(rules(config(good, [{ bytes: [{ update: 'h.a', fields: { value: 7 } }] }]))).toEqual([]);
  });

  it('checks hex in a bytes frame against its byte count', () => {
    const bytes = (value: string) =>
      content([{ id: 'h', title: 'H', unit: 'bytes', fields: [{ id: 'a', size: 3, value }] }]);
    expect(rules(config(bytes('16 03 03')))).toEqual([]);
    expect(rules(config(bytes('16 03')))).toContain('error bytes/bad-value');
    expect(rules(config(bytes('16 03 zz')))).toContain('error bytes/bad-value');
  });

  it('allows 8 or 16 bytes a row', () => {
    const wide = (width: number) =>
      content([{ id: 'h', title: 'H', unit: 'bytes', width, fields: [{ id: 'a', size: 2 }] }]);
    expect(rules(config(wide(8)))).toEqual([]);
    expect(rules(config(wide(12)))).toContain('error bytes/bad-width');
  });

  it('refuses duplicate frames and fields, and a field called cursor', () => {
    expect(rules(config(content([frame(), frame()])))).toContain('error bytes/duplicate-frame');
    const twice = frame({}, [
      { id: 'a', size: 8 },
      { id: 'a', size: 8 },
    ]);
    expect(rules(config(content([twice])))).toContain('error bytes/duplicate-field');
    const reserved = frame({}, [{ id: 'cursor', size: 8 }]);
    expect(rules(config(content([reserved])))).toContain('error bytes/reserved-field');
  });

  it('warns about a fixed field that would fill a screen', () => {
    const long = frame({}, [{ id: 'a', size: 1000 }]);
    expect(rules(config(content([long])))).toContain('warning bytes/long-field');
    const variable = frame({}, [{ id: 'a', size: 1000, variable: true }]);
    expect(rules(config(content([variable])))).not.toContain('warning bytes/long-field');
  });

  it('checks that a field that counts holds the right count, at every call', () => {
    const counting = (value: number) =>
      content([
        frame({}, [
          { id: 'len', size: 8, value, counts: { of: 'body' } },
          { id: 'body', size: 5 },
        ]),
      ]);
    expect(rules(config(counting(5)))).toEqual([]);
    expect(rules(config(counting(6)))).toContain('error bytes/count-mismatch');
    expect(
      rules(config(counting(5), [{ bytes: [{ update: 'h.len', fields: { value: 4 } }] }])),
    ).toContain('error bytes/count-mismatch');
    // In words of 32 bits, over a range.
    const words = content([
      frame({}, [
        { id: 'off', size: 4, value: 2, counts: { of: { from: 'off', to: 'rest' }, per: 32 } },
        { id: 'rest', size: 60 },
      ]),
    ]);
    expect(rules(config(words))).toEqual([]);
    const wrong = content([
      frame({}, [
        { id: 'off', size: 4, value: 3, counts: { of: { from: 'off', to: 'rest' }, per: 32 } },
        { id: 'rest', size: 60 },
      ]),
    ]);
    expect(rules(config(wrong))).toContain('error bytes/count-mismatch');
  });

  it('rejects a count of something that is not there, backwards, or in a segments frame', () => {
    const missing = content([frame({}, [{ id: 'n', size: 8, counts: { of: 'nope' } }])]);
    expect(rules(config(missing))).toContain('error bytes/bad-counts');
    const backwards = content([
      frame({}, [
        { id: 'a', size: 8 },
        { id: 'n', size: 8, counts: { of: { from: 'n', to: 'a' } } },
      ]),
    ]);
    expect(rules(config(backwards))).toContain('error bytes/bad-counts');
    const segments = content([
      { id: 'h', title: 'H', unit: 'segments', fields: [{ id: 'n', counts: { of: 'n' } }] },
    ]);
    expect(rules(config(segments))).toContain('error bytes/bad-counts');
  });

  it('checks segment sizes against their text, declared and updated', () => {
    const segments = (size: number) =>
      content([
        { id: 'j', title: 'J', unit: 'segments', fields: [{ id: 'a', size, value: 'abcd' }] },
      ]);
    expect(rules(config(segments(4)))).toEqual([]);
    expect(rules(config(segments(5)))).toContain('error bytes/size-mismatch');
    expect(
      rules(config(segments(4), [{ bytes: [{ update: 'j.a', fields: { value: 'abc' } }] }])),
    ).toContain('error bytes/bad-field');
  });

  it('keeps the cursor inside the frame', () => {
    expect(rules(config(content([frame({ cursor: { at: 33 } })])))).toContain(
      'error bytes/cursor-range',
    );
    const ok = content([frame({ cursor: { at: 0 } })]);
    expect(rules(config(ok, [{ bytes: [{ update: 'h.cursor', fields: { at: 32 } }] }]))).toEqual(
      [],
    );
    expect(rules(config(ok, [{ bytes: [{ update: 'h.cursor', fields: { at: 33 } }] }]))).toContain(
      'error bytes/bad-field',
    );
    expect(rules(config(ok, [{ bytes: [{ update: 'h.cursor', fields: { at: null } }] }]))).toEqual(
      [],
    );
    expect(rules(config(ok, [{ bytes: [{ update: 'h.cursor', fields: { at: 1.5 } }] }]))).toContain(
      'error bytes/bad-field',
    );
  });

  it('checks that a frame inside another exists, comes later, fits and does not loop', () => {
    const outer = frame({}, [
      { id: 'hdr', size: 8 },
      { id: 'body', size: 32, variable: true },
    ]);
    const inner = (inside: string, extra: Record<string, unknown> = {}) => ({
      id: 'in',
      title: 'In',
      unit: 'bytes',
      inside,
      fields: [{ id: 'x', size: 2 }],
      ...extra,
    });
    expect(rules(config(content([outer, inner('h.body')])))).toEqual([]);
    expect(rules(config(content([outer, inner('nope.body')])))).toContain(
      'error bytes/unknown-inside',
    );
    expect(rules(config(content([inner('h.body'), outer])))).toContain('error bytes/inside-order');
    const big = inner('h.body', { fields: [{ id: 'x', size: 5 }] });
    expect(rules(config(content([outer, big])))).toContain('error bytes/inside-size');
    expect(rules(config(content([inner('in.x')])))).toContain('error bytes/inside-cycle');
    const a = inner('b.x', { id: 'a' });
    const b = inner('a.x', { id: 'b' });
    expect(rules(config(content([a, b])))).toContain('error bytes/inside-cycle');
  });

  it('checks a link against the elements of every pane', () => {
    const linked = (target: string) =>
      content([frame({}, [{ id: 'a', size: 8, link: { $ref: target, text: 'decoded' } }])]);
    const payload = {
      id: 'p',
      panel: 'payload',
      content: { payloads: [{ id: 'decoded', title: 'D', value: { a: 1 } }] },
    };
    expect(rules(config(linked('decoded'), [{}], [payload]))).toEqual([]);
    expect(rules(config(linked('nope'), [{}], [payload]))).toContain('error bytes/unknown-ref');
  });

  it('knows which fields an element takes, and what a tone is', () => {
    const base = content([frame({ cursor: { at: 0 } })]);
    const update = (id: string, fields: Record<string, unknown>) =>
      rules(config(base, [{ bytes: [{ update: id, fields }] }]));
    expect(update('h.a', { value: 2, decoded: 'two', tone: 'good' })).toEqual([]);
    expect(update('h.a', { size: 8 })).toContain('error bytes/unknown-field');
    expect(update('h.a', { tone: 'loud' })).toContain('error bytes/bad-tone');
    expect(update('h.a', { decoded: 5 })).toContain('error bytes/bad-field');
    expect(update('h', { title: 'T', sub: 'S', tone: 'muted' })).toEqual([]);
    expect(update('h', { unit: 'bytes' })).toContain('error bytes/unknown-field');
    expect(update('h.cursor', { label: 'here' })).toEqual([]);
    expect(update('h.cursor', { to: 3 })).toContain('error bytes/unknown-field');
  });

  it('keeps fields with their frame: no touching them while it is absent, no adding them', () => {
    const base = content([frame()], false);
    expect(rules(config(base, [{ bytes: [{ read: 'h.a' }] }]))).toContain(
      'error bytes/absent-frame',
    );
    expect(rules(config(base, [{ bytes: [{ add: 'h' }] }, { bytes: [{ read: 'h.a' }] }]))).toEqual(
      [],
    );
    expect(
      rules(
        config(base, [
          { bytes: [{ add: 'h' }] },
          { bytes: [{ remove: 'h' }] },
          { bytes: [{ update: 'h.a', fields: { value: 3 } }] },
        ]),
      ),
    ).toContain('error bytes/absent-frame');
    expect(rules(config(base, [{ bytes: [{ add: 'h.a' }] }]))).toContain(
      'error bytes/field-presence',
    );
    const started = content([frame()]);
    expect(rules(config(started, [{ bytes: [{ remove: 'h.a' }] }]))).toContain(
      'error bytes/field-presence',
    );
  });

  it('warns about an effect key it ignores', () => {
    const base = content([frame()]);
    expect(rules(config(base, [{ bytes: [{ read: 'h.a', paths: ['x'] }] }]))).toContain(
      'warning bytes/unknown-key',
    );
  });
});

describe('bytes panel: elements and the reducer', () => {
  const content = {
    initial: false,
    frames: [
      {
        id: 'h',
        title: 'H',
        unit: 'bits',
        cursor: { at: null },
        fields: [
          { id: 'a', size: 16, value: 1 },
          { id: 'b', size: 16, value: 2 },
        ],
      },
      { id: 'k', title: 'K', unit: 'bytes', fields: [{ id: 'a', size: 1 }], initial: true },
    ],
  };

  const states = (calls: Effects[]) => {
    const result = load(config(content, calls));
    expect(result.problems).toEqual([]);
    const walkthrough = result.walkthroughs[0]!;
    const folder = createFolder(walkthrough);
    return calls.map((_, index) => folder.at(0, index).bytes!.state as ElementsState);
  };

  it('declares frames, derived field ids and the cursor, with fields always present', () => {
    const pane = load(config(content)).walkthroughs[0]!.panes[0]!;
    expect(pane.entities.map((entity) => [entity.id, entity.initial])).toEqual([
      ['h', false],
      ['h.a', true],
      ['h.b', true],
      ['h.cursor', true],
      ['k', true],
      ['k.a', true],
    ]);
  });

  it('adds a frame and applies changes to its fields', () => {
    const [first, second] = states([
      { bytes: [{ add: 'h' }] },
      { bytes: [{ update: 'h.a', fields: { value: 9, decoded: 'nine' } }] },
    ]);
    expect(first!.present).toContain('h');
    expect(second!.patches['h.a']).toEqual({ value: 9, decoded: 'nine' });
  });

  it('drops what was changed on a frame when it is removed, so adding it again starts clean', () => {
    const [, , removed, again] = states([
      { bytes: [{ add: 'h' }] },
      {
        bytes: [
          { update: 'h.a', fields: { value: 9 } },
          { update: 'h.cursor', fields: { at: 16 } },
          { update: 'h', fields: { title: 'T' } },
        ],
      },
      { bytes: [{ remove: 'h' }] },
      { bytes: [{ add: 'h' }] },
    ]);
    expect(removed!.present).not.toContain('h');
    expect(removed!.patches).toEqual({});
    expect(again!.patches).toEqual({});
  });

  it('keeps the changes of other frames when one is removed', () => {
    const [, , removed] = states([
      { bytes: [{ add: 'h' }] },
      { bytes: [{ update: 'k.a', fields: { value: 7 } }] },
      { bytes: [{ remove: 'h' }] },
    ]);
    expect(removed!.patches['k.a']).toEqual({ value: 7 });
  });

  it('moves a cursor with one update', () => {
    const [, moved, again] = states([
      { bytes: [{ add: 'h' }] },
      { bytes: [{ update: 'h.cursor', fields: { at: 16 } }] },
      { bytes: [{ update: 'h.cursor', fields: { at: 32 } }] },
    ]);
    expect(moved!.patches['h.cursor']).toEqual({ at: 16 });
    expect(again!.patches['h.cursor']).toEqual({ at: 32 });
  });

  it('resolves ids like constructor as ordinary ids', () => {
    const odd = {
      frames: [
        { id: 'constructor', title: 'C', unit: 'bits', fields: [{ id: 'toString', size: 8 }] },
      ],
    };
    const result = load(config(odd, [{ bytes: [{ read: 'constructor.toString' }] }]));
    expect(result.problems).toEqual([]);
    const state = createFolder(result.walkthroughs[0]!).at(0, 0).bytes!.state as ElementsState;
    expect(state.present).toContain('constructor');
  });
});
