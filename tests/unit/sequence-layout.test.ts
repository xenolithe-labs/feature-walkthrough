import { describe, expect, it } from 'vitest';
import { createFolder, loadConfig, type ElementsState } from '../../src/core';
import {
  DIVIDER,
  HEAD,
  ROW,
  TAIL,
  TOP,
  crosses,
  fragmentRange,
  layoutSequence,
  messageShape,
  wrapText,
  type Fragment,
  type Message,
  type Note,
} from '../../src/panels/sequence/layout';
import { createRegistry } from '../../src/registry';
import { renderPane } from '../stress/render';

const lanes = ['a', 'b', 'c'];
const ground = {
  laneX: (id: string) => (lanes.includes(id) ? 100 * lanes.indexOf(id) + 50 : NaN),
  gap: 100,
  total: 300,
};
const msgs: Message[] = [
  { id: 'm1', from: 'a', to: 'b' },
  { id: 'm2', from: 'b', to: 'c' },
  { id: 'm3', from: 'c', to: 'b' },
  { id: 'm4', from: 'b', to: 'a' },
  { id: 'm5', from: 'a', to: 'a' },
];
const frag = (over: Partial<Fragment> & Pick<Fragment, 'id' | 'from' | 'to'>): Fragment => ({
  kind: 'loop',
  label: 'again',
  ...over,
});

describe('sequence layout', () => {
  it('without fragments or notes, rows are one ROW apart from the top', () => {
    const layout = layoutSequence(msgs, [], [], ground);
    expect([...layout.ys.values()]).toEqual(msgs.map((_, i) => TOP + i * ROW + ROW / 2));
    expect(layout.frames).toEqual([]);
    expect(layout.notes).toEqual([]);
  });

  it('makes room for a frame heading and a foot, and the frame encloses its messages', () => {
    const layout = layoutSequence(msgs, [frag({ id: 'f', from: 'm2', to: 'm3' })], [], ground);
    const box = layout.frames[0]!;
    const plain = layoutSequence(msgs, [], [], ground);
    expect(layout.ys.get('m1')).toBe(plain.ys.get('m1'));
    expect(layout.ys.get('m2')).toBe(plain.ys.get('m2')! + HEAD);
    expect(layout.ys.get('m4')).toBe(plain.ys.get('m4')! + HEAD + TAIL);
    expect(box.y).toBe(TOP + ROW);
    expect(box.y + box.height).toBe(layout.ys.get('m3')! + ROW / 2 + TAIL);
    // It spans the lanes of its messages (b and c), with some air.
    expect(box.x).toBeLessThan(150);
    expect(box.x + box.width).toBeGreaterThan(250);
    expect(layout.height).toBe(plain.height + HEAD + TAIL);
  });

  it('is the same wherever the cursor is: a layout depends on the config only', () => {
    const fragments = [frag({ id: 'f', from: 'm2', to: 'm3' })];
    expect(layoutSequence(msgs, fragments, [], ground)).toEqual(
      layoutSequence(msgs, fragments, [], ground),
    );
  });

  it('puts a divider above the first message of each branch, for alt and par', () => {
    const alt = frag({
      id: 'alt',
      kind: 'alt',
      from: 'm1',
      to: 'm4',
      branches: [{ at: 'm3', label: 'no' }],
    });
    const layout = layoutSequence(msgs, [alt], [], ground);
    const box = layout.frames[0]!;
    expect(box.dividers).toHaveLength(1);
    const divider = box.dividers[0]!;
    expect(divider.at).toBe('m3');
    const plain = layoutSequence(msgs, [frag({ id: 'alt', from: 'm1', to: 'm4' })], [], ground);
    expect(layout.ys.get('m3')).toBe(plain.ys.get('m3')! + DIVIDER);
    expect(divider.y).toBeLessThan(layout.ys.get('m3')! - ROW / 2);
    expect(divider.y).toBeGreaterThan(layout.ys.get('m2')! + ROW / 2 - 1);
  });

  it('nests: an inner frame sits inside an outer one, below its heading and narrower', () => {
    const outer = frag({ id: 'outer', kind: 'alt', from: 'm1', to: 'm4', label: 'o' });
    const inner = frag({ id: 'inner', from: 'm1', to: 'm2', label: 'i' });
    const layout = layoutSequence(msgs, [inner, outer], [], ground);
    const o = layout.frames.find((box) => box.id === 'outer')!;
    const i = layout.frames.find((box) => box.id === 'inner')!;
    expect(o.depth).toBe(0);
    expect(i.depth).toBe(1);
    expect(i.y).toBeGreaterThanOrEqual(o.y + HEAD);
    expect(i.y + i.height).toBeLessThan(o.y + o.height);
    expect(i.x).toBeGreaterThanOrEqual(o.x);
    expect(i.x + i.width).toBeLessThanOrEqual(o.x + o.width);
    // The inner frame is first in the list, but the outer one is drawn first (behind).
    expect(layout.frames.map((box) => box.id)).toEqual(['outer', 'inner']);
  });

  it('nests two frames that cover the same messages, the first written outermost', () => {
    const layout = layoutSequence(
      msgs,
      [frag({ id: 'one', from: 'm1', to: 'm2' }), frag({ id: 'two', from: 'm1', to: 'm2' })],
      [],
      ground,
    );
    const [one, two] = layout.frames;
    expect(one!.depth).toBe(0);
    expect(two!.depth).toBe(1);
    expect(two!.y + two!.height).toBeLessThan(one!.y + one!.height);
  });

  it('leaves out a frame whose range makes no sense', () => {
    const layout = layoutSequence(
      msgs,
      [frag({ id: 'back', from: 'm3', to: 'm1' }), frag({ id: 'gone', from: 'm1', to: 'zz' })],
      [],
      ground,
    );
    expect(layout.frames).toEqual([]);
  });

  it('keeps a frame inside the diagram, and wide enough for its heading', () => {
    const layout = layoutSequence(
      msgs,
      [frag({ id: 'f', from: 'm5', to: 'm5', label: 'a rather long label here' })],
      [],
      ground,
    );
    const box = layout.frames[0]!;
    expect(box.x).toBeGreaterThanOrEqual(2);
    expect(box.x + box.width).toBeLessThanOrEqual(ground.total - 2);
    expect(box.width).toBeGreaterThan(box.tab + 20 * 7);
  });

  it('gives a note its own space after its message, so nothing overlaps', () => {
    const note: Note = { id: 'n', at: 'm2', over: 'b', text: 'waits for the answer' };
    const layout = layoutSequence(msgs, [], [note], ground);
    const box = layout.notes[0]!;
    expect(box.y).toBeGreaterThan(layout.ys.get('m2')! + ROW / 2 - 1);
    expect(box.y + box.height).toBeLessThan(layout.ys.get('m3')! - ROW / 2 + 1);
    expect(box.lines.join(' ')).toBe(note.text);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(ground.total);
  });

  it('spans two lanes for a note over both', () => {
    const note: Note = { id: 'n', at: 'm1', over: ['a', 'c'], text: 'x' };
    const box = layoutSequence(msgs, [], [note], ground).notes[0]!;
    expect(box.x).toBeLessThanOrEqual(50);
    expect(box.x + box.width).toBeGreaterThanOrEqual(250);
  });

  it('wraps a long note into more lines, and a frame holds its notes', () => {
    const note: Note = {
      id: 'n',
      at: 'm2',
      over: 'a',
      text: 'one two three four five six seven eight nine',
    };
    const layout = layoutSequence(msgs, [frag({ id: 'f', from: 'm2', to: 'm2' })], [note], ground);
    const box = layout.notes[0]!;
    expect(box.lines.length).toBeGreaterThan(1);
    const frame = layout.frames[0]!;
    expect(frame.y + frame.height).toBeGreaterThan(box.y + box.height);
    expect(frame.x).toBeLessThanOrEqual(box.x);
    expect(frame.x + frame.width).toBeGreaterThanOrEqual(box.x + box.width);
  });

  it('ignores a note at an unknown call or over an unknown lane', () => {
    const layout = layoutSequence(
      msgs,
      [],
      [
        { id: 'n1', at: 'zz', over: 'a', text: 'x' },
        { id: 'n2', at: 'm1', over: 'nope', text: 'x' },
      ],
      ground,
    );
    expect(layout.notes).toEqual([]);
  });

  it('wrapText breaks at spaces and keeps a long word whole', () => {
    expect(wrapText('aa bb cc', 5)).toEqual(['aa bb', 'cc']);
    expect(wrapText('abcdefghij kl', 4)).toEqual(['abcdefghij', 'kl']);
    expect(wrapText('a\nb', 10)).toEqual(['a', 'b']);
  });

  it('fragmentRange and crosses', () => {
    const index = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]);
    expect(fragmentRange({ from: 'b', to: 'c' }, index)).toEqual([1, 2]);
    expect(fragmentRange({ from: 'c', to: 'b' }, index)).toBeUndefined();
    expect(fragmentRange({ from: 'b', to: 'zz' }, index)).toBeUndefined();
    expect(crosses([0, 2], [1, 3])).toBe(true);
    expect(crosses([1, 3], [0, 2])).toBe(true);
    expect(crosses([0, 3], [1, 2])).toBe(false);
    expect(crosses([0, 1], [2, 3])).toBe(false);
    expect(crosses([0, 2], [0, 3])).toBe(false);
    expect(crosses([0, 2], [2, 3])).toBe(true);
  });
});

describe('message shapes', () => {
  const draw = (style: Parameters<typeof messageShape>[0], x1 = 50, x2 = 250, label = 'hello') =>
    messageShape(style, x1, x2, 100, label, 300);

  it('a call is solid with a filled head', () => {
    const shape = draw('call');
    expect(shape.dashed).toBe(false);
    expect(shape.head?.kind).toBe('filled');
    expect(shape.cross).toBeUndefined();
  });

  it('a reply is dashed with an open head', () => {
    const shape = draw('reply');
    expect(shape.dashed).toBe(true);
    expect(shape.head?.kind).toBe('open');
  });

  it('an asynchronous message is solid with an open head', () => {
    const shape = draw('async');
    expect(shape.dashed).toBe(false);
    expect(shape.head?.kind).toBe('open');
  });

  it('every style differs from every other in dash, head or cross: not colour alone', () => {
    const signature = (style: Parameters<typeof draw>[0]) => {
      const shape = draw(style);
      return `${shape.dashed}|${shape.head?.kind}|${shape.cross !== undefined}`;
    };
    const all = (['call', 'reply', 'async', 'lost'] as const).map(signature);
    expect(new Set(all).size).toBe(4);
  });

  it('a lost message stops short of the lane and ends in a cross', () => {
    const right = draw('lost', 50, 250);
    expect(right.head).toBeUndefined();
    const end = Number(/H ([\d.]+)/.exec(right.line)![1]);
    expect(end).toBeGreaterThan(50);
    expect(end).toBeLessThan(250 - 10);
    expect(right.cross).toContain(`M ${end - 5}`);
    const left = draw('lost', 250, 50);
    const leftEnd = Number(/H ([\d.]+)/.exec(left.line)![1]);
    expect(leftEnd).toBeLessThan(250);
    expect(leftEnd).toBeGreaterThan(50 + 10);
  });

  it('a lost message to a lane next door still stops short', () => {
    const shape = messageShape('lost', 50, 90, 100, 'x', 300);
    const end = Number(/H ([\d.]+)/.exec(shape.line)![1]);
    expect(end).toBeGreaterThan(50);
    expect(end).toBeLessThan(90);
  });

  it('arrows point the way the message goes', () => {
    expect(draw('call', 50, 250).head!.d.startsWith('M 248 100')).toBe(true);
    expect(draw('call', 250, 50).head!.d.startsWith('M 52 100')).toBe(true);
  });

  it('a message to self is a loop on the lane, whatever its style', () => {
    for (const style of ['call', 'reply', 'async'] as const) {
      const shape = draw(style, 50, 50, 'think');
      expect(shape.line.startsWith('M 50 92 H 76 V 108')).toBe(true);
      expect(shape.head).toBeDefined();
    }
    expect(draw('reply', 50, 50).dashed).toBe(true);
    expect(draw('async', 50, 50).head?.kind).toBe('open');
    expect(draw('call', 50, 50).head?.kind).toBe('filled');
    // A lost message to self has nowhere to go: it is drawn as a call (lint refuses it).
    expect(draw('lost', 50, 50).cross).toBeUndefined();
  });

  it('puts the label of a message to self beside the loop, on the side with room', () => {
    const right = messageShape('call', 50, 50, 100, 'think', 300);
    expect(right.label.anchor).toBe('start');
    expect(right.label.x).toBeGreaterThan(76);
    // On the last lane the right side is too narrow: the label goes to the left instead.
    const last = messageShape('call', 250, 250, 100, 'think about it carefully', 300);
    expect(last.label.anchor).toBe('end');
    expect(last.label.x).toBeLessThan(250);
  });

  it('cuts a label that fits nowhere', () => {
    const shape = messageShape('call', 20, 20, 100, 'x'.repeat(80), 60);
    expect(shape.label.text.length).toBeLessThan(80);
    expect(shape.label.text.endsWith('…')).toBe(true);
  });

  it('keeps a long label of an ordinary message inside the diagram', () => {
    const shape = draw('call', 50, 250, 'y'.repeat(100));
    expect(shape.label.text.length * 7.25).toBeLessThanOrEqual(300);
  });
});

function config(content: Record<string, unknown>, calls?: Record<string, unknown>[]) {
  return {
    id: 'w',
    title: 'W',
    lanes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ],
    layout: { panes: [{ id: 'seq', panel: 'sequence', content }] },
    steps: [
      {
        id: 's',
        title: 'S',
        calls: calls ?? [
          { id: 'm1', label: 'one', from: 'a', to: 'b' },
          { id: 'm2', label: 'two', from: 'b', to: 'c' },
          { id: 'm3', label: 'three', from: 'c', to: 'b' },
          { id: 'm4', label: 'four', from: 'b', to: 'a' },
          { id: 'm5', label: 'self', from: 'a', to: 'a' },
          { id: 'x', label: 'no lanes' },
        ],
      },
    ],
  };
}
const load = (content: Record<string, unknown>, calls?: Record<string, unknown>[]) =>
  loadConfig(config(content, calls), createRegistry());
const rules = (content: Record<string, unknown>, calls?: Record<string, unknown>[]) =>
  load(content, calls).problems.map((problem) => problem.rule);

describe('sequence lint', () => {
  it('accepts fragments, notes and styles that fit', () => {
    expect(
      rules({
        styles: { m3: 'reply', m2: 'lost', m4: 'async' },
        fragments: [
          {
            id: 'f1',
            kind: 'alt',
            label: 'ok',
            from: 'm1',
            to: 'm4',
            branches: [{ at: 'm3', label: 'else' }],
          },
          { id: 'f2', kind: 'loop', label: 'n times', from: 'm2', to: 'm2' },
        ],
        notes: [{ id: 'n1', at: 'm1', over: ['a', 'b'], text: 'hi' }],
      }),
    ).toEqual([]);
  });

  it('sequence/unknown-call: a fragment, branch, note or style that names no message', () => {
    const at = (content: Record<string, unknown>) =>
      load(content).problems.map((problem) => `${problem.rule}@${problem.path.join('.')}`);
    expect(
      at({ fragments: [{ id: 'f', kind: 'loop', label: 'l', from: 'nope', to: 'm2' }] }),
    ).toEqual(['sequence/unknown-call@layout.panes.0.content.fragments.0.from']);
    expect(
      at({ fragments: [{ id: 'f', kind: 'loop', label: 'l', from: 'm1', to: 'nope' }] }),
    ).toEqual(['sequence/unknown-call@layout.panes.0.content.fragments.0.to']);
    expect(
      at({
        fragments: [
          {
            id: 'f',
            kind: 'alt',
            label: 'l',
            from: 'm1',
            to: 'm3',
            branches: [{ at: 'nope', label: 'b' }],
          },
        ],
      }),
    ).toEqual(['sequence/unknown-call@layout.panes.0.content.fragments.0.branches.0.at']);
    expect(at({ notes: [{ id: 'n', at: 'nope', over: 'a', text: 't' }] })).toEqual([
      'sequence/unknown-call@layout.panes.0.content.notes.0.at',
    ]);
    expect(at({ styles: { nope: 'reply' } })).toEqual([
      'sequence/unknown-call@layout.panes.0.content.styles.nope',
    ]);
    // A call that is no message (no lanes) is not a message either.
    expect(rules({ notes: [{ id: 'n', at: 'x', over: 'a', text: 't' }] })).toEqual([
      'sequence/unknown-call',
    ]);
  });

  it('sequence/unknown-call: a call outside this pane’s lanes', () => {
    expect(
      rules({ lanes: ['a', 'b'], notes: [{ id: 'n', at: 'm2', over: 'a', text: 't' }] }),
    ).toEqual(['sequence/unknown-call']);
  });

  it('sequence/fragment-reversed: the end comes before the start', () => {
    expect(
      rules({ fragments: [{ id: 'f', kind: 'loop', label: 'l', from: 'm3', to: 'm1' }] }),
    ).toEqual(['sequence/fragment-reversed']);
  });

  it('sequence/fragment-overlap: overlapping without nesting', () => {
    const f = (id: string, from: string, to: string) => ({ id, kind: 'loop', label: id, from, to });
    expect(rules({ fragments: [f('a1', 'm1', 'm3'), f('a2', 'm2', 'm4')] })).toEqual([
      'sequence/fragment-overlap',
    ]);
    expect(rules({ fragments: [f('a1', 'm1', 'm4'), f('a2', 'm2', 'm3')] })).toEqual([]);
    expect(rules({ fragments: [f('a1', 'm1', 'm2'), f('a2', 'm3', 'm4')] })).toEqual([]);
    expect(rules({ fragments: [f('a1', 'm1', 'm2'), f('a2', 'm1', 'm2')] })).toEqual([]);
    expect(rules({ fragments: [f('a1', 'm1', 'm2'), f('a2', 'm2', 'm3')] })).toEqual([
      'sequence/fragment-overlap',
    ]);
  });

  it('sequence/branch-order: branches inside the frame, after its start and in order', () => {
    const alt = (branches: { at: string; label: string }[]) => ({
      fragments: [{ id: 'f', kind: 'alt', label: 'l', from: 'm1', to: 'm3', branches }],
    });
    expect(rules(alt([{ at: 'm1', label: 'b' }]))).toEqual(['sequence/branch-order']);
    expect(rules(alt([{ at: 'm4', label: 'b' }]))).toEqual(['sequence/branch-order']);
    expect(
      rules(
        alt([
          { at: 'm3', label: 'b' },
          { at: 'm2', label: 'c' },
        ]),
      ),
    ).toEqual(['sequence/branch-order']);
    expect(
      rules(
        alt([
          { at: 'm2', label: 'b' },
          { at: 'm3', label: 'c' },
        ]),
      ),
    ).toEqual([]);
  });

  it('sequence/branches-not-allowed: only alt and par have branches', () => {
    for (const kind of ['loop', 'opt']) {
      expect(
        rules({
          fragments: [
            {
              id: 'f',
              kind,
              label: 'l',
              from: 'm1',
              to: 'm3',
              branches: [{ at: 'm2', label: 'b' }],
            },
          ],
        }),
      ).toEqual(['sequence/branches-not-allowed']);
    }
    expect(
      rules({
        fragments: [
          {
            id: 'f',
            kind: 'par',
            label: 'l',
            from: 'm1',
            to: 'm3',
            branches: [{ at: 'm2', label: 'b' }],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('sequence/alt-needs-branch: an alt with one alternative is a warning', () => {
    const problems = load({
      fragments: [{ id: 'f', kind: 'alt', label: 'l', from: 'm1', to: 'm2' }],
    }).problems;
    expect(problems.map((p) => [p.rule, p.severity])).toEqual([
      ['sequence/alt-needs-branch', 'warning'],
    ]);
  });

  it('sequence/lost-to-self: a message to self cannot be lost', () => {
    expect(rules({ styles: { m5: 'lost' } })).toEqual(['sequence/lost-to-self']);
    expect(rules({ styles: { m5: 'async' } })).toEqual([]);
  });

  it('sequence/unknown-lane: a note over a lane the pane does not show', () => {
    expect(rules({ notes: [{ id: 'n', at: 'm1', over: 'zz', text: 't' }] })).toEqual([
      'sequence/unknown-lane',
    ]);
    expect(
      rules({ lanes: ['a', 'b'], notes: [{ id: 'n', at: 'm1', over: ['a', 'c'], text: 't' }] }),
    ).toEqual(['sequence/unknown-lane']);
  });

  it('shares ids with the rest of the walkthrough: a clash is the core duplicate-id rule', () => {
    const clash = (content: Record<string, unknown>) =>
      rules(content).filter((rule) => rule === 'duplicate-id');
    expect(
      clash({ fragments: [{ id: 'm1', kind: 'loop', label: 'l', from: 'm1', to: 'm2' }] }),
    ).toHaveLength(1);
    expect(clash({ notes: [{ id: 'a', at: 'm1', over: 'a', text: 't' }] })).toHaveLength(1);
    expect(
      clash({
        fragments: [{ id: 'x1', kind: 'loop', label: 'l', from: 'm1', to: 'm2' }],
        notes: [{ id: 'x1', at: 'm1', over: 'a', text: 't' }],
      }),
    ).toHaveLength(1);
  });

  it('refuses a style or a fragment kind that does not exist', () => {
    expect(rules({ styles: { m1: 'wavy' } })).toEqual(['schema']);
    expect(
      rules({ fragments: [{ id: 'f', kind: 'while', label: 'l', from: 'm1', to: 'm2' }] }),
    ).toEqual(['schema']);
  });
});

describe('sequence panel', () => {
  const content = {
    styles: { m2: 'lost', m3: 'reply', m4: 'async' },
    fragments: [
      {
        id: 'f',
        kind: 'alt',
        label: 'fine',
        from: 'm2',
        to: 'm4',
        branches: [{ at: 'm4', label: 'not fine' }],
      },
    ],
    notes: [{ id: 'n', at: 'm3', over: ['b', 'c'], text: 'note text' }],
  };
  const walkthrough = () => {
    const loaded = load(content);
    expect(loaded.problems).toEqual([]);
    return loaded.walkthroughs[0]!;
  };

  it('lists fragments and notes as elements, so they can be selected and shared', () => {
    const ids = walkthrough().panes[0]!.entities.map((entity) => entity.id);
    expect(ids).toEqual(['a', 'b', 'c', 'm1', 'm2', 'm3', 'm4', 'm5', 'f', 'n']);
  });

  it('a frame appears with its first message, a note with its own', () => {
    const w = walkthrough();
    const folder = createFolder(w);
    const present = (c: number) => (folder.at(0, c).seq!.state as ElementsState).present;
    expect(present(0)).not.toContain('f');
    expect(present(1)).toEqual(['a', 'b', 'c', 'm1', 'm2', 'f']);
    expect(present(2)).toEqual(['a', 'b', 'c', 'm1', 'm2', 'f', 'm3', 'n']);
  });

  it('draws nothing for what has not appeared, and positions stay put as things appear', () => {
    const w = walkthrough();
    const folder = createFolder(w);
    const at = (c: number) => renderPane(w, w.panes[0]!, 0, c, folder);
    const y = (out: string, id: string) =>
      new RegExp(`data-entity="${id}"[\\s\\S]*?<rect class="fw-seq-hit"[^>]* y="([\\d.]+)"`).exec(
        out,
      )![1];
    expect(at(0)).not.toContain('fw-seq-frame');
    expect(at(1)).toContain('data-kind="alt"');
    expect(at(1)).not.toContain('Note:');
    expect(at(2)).toContain('Note: note text');
    expect(y(at(1), 'm2')).toBe(y(at(3), 'm2'));
    expect(y(at(2), 'm3')).toBe(y(at(3), 'm3'));
  });

  it('draws the divider of a branch once its message is there', () => {
    const w = walkthrough();
    const folder = createFolder(w);
    expect(renderPane(w, w.panes[0]!, 0, 2, folder)).not.toContain('[not fine]');
    expect(renderPane(w, w.panes[0]!, 0, 3, folder)).toContain('[not fine]');
  });

  it('names the style of a message for a screen reader, not only by its drawing', () => {
    const w = walkthrough();
    const out = renderPane(w, w.panes[0]!, 0, 3, createFolder(w));
    expect(out).toContain('aria-label="two (lost, never arrives)"');
    expect(out).toContain('aria-label="three (reply)"');
    expect(out).toContain('aria-label="four (asynchronous, added)"');
    expect(out).toContain('data-style="lost"');
    expect(out).toContain('fw-seq-cross');
  });

  it('every frame and note is reachable by keyboard and has a name', () => {
    const w = walkthrough();
    const out = renderPane(w, w.panes[0]!, 0, 4, createFolder(w));
    expect(out).toMatch(
      /role="button" tabindex="0" aria-pressed="false" aria-label="alt \[fine\]"/,
    );
    expect(out).toMatch(
      /role="button" tabindex="0" aria-pressed="false" aria-label="Note: note text"/,
    );
  });

  it('a message to self gets a loop, and says so', () => {
    const w = walkthrough();
    const folder = createFolder(w);
    const out = renderPane(w, w.panes[0]!, 0, 4, folder);
    expect(out).toContain('aria-label="self (to itself');
    expect(out).toContain('is-self');
  });

  it('selecting a frame highlights the messages it holds', () => {
    const w = walkthrough();
    const out = renderPane(w, w.panes[0]!, 0, 4, createFolder(w), 'f');
    const related = [...out.matchAll(/data-entity="(m\d)"/g)].length;
    expect(related).toBeGreaterThan(0);
    expect(out.match(/is-related/g)).toHaveLength(3);
  });
});
