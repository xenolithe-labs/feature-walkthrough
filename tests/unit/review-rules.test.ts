import { describe, expect, it } from 'vitest';
import type { Walkthrough } from '../../src/core';
import { designRules } from '../../src/review';
import { bent, cleanConfig, findings, ruleIds } from '../helpers/review';

/** n distinct words, so that two texts are never the same by accident. */
const words = (count: number, tag = 'w') =>
  `${Array.from({ length: count }, (_, i) => `${tag}${i}`).join(' ')}.`;

type Step = Walkthrough['steps'][number];
type Call = Step['calls'][number];

const call = (id: string, text: string, extra: Partial<Call> = {}): Call => ({
  id,
  label: `Call ${id}`,
  text,
  where: `spec ${id}`,
  effects: { data: [{ read: 'a' }] },
  ...extra,
});

/** Appends calls to the last step. */
const append = (config: Walkthrough, ...more: Call[]) => {
  config.steps[config.steps.length - 1]!.calls.push(...more);
};

/** Adds a second table pane, to be a third or fourth view. */
const extraPane = (config: Walkthrough, id: string, role: 'fixed' | 'focus' = 'fixed') => {
  config.layout.panes.push({
    id,
    panel: 'flow',
    title: id,
    role,
    content: { nodes: [{ id: 'n1', label: 'One' }], edges: [] },
  });
};

describe('the clean walkthrough', () => {
  it('has no design finding at all', () => {
    expect(findings(cleanConfig())).toEqual([]);
  });

  it('every rule has an id, a source and a summary', () => {
    const ids = designRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of designRules) {
      expect(rule.id).toMatch(/^design\/[a-z-]+$/);
      expect(rule.source).toContain('walkthrough-design');
      expect(rule.summary.length).toBeGreaterThan(10);
    }
  });
});

describe('text rules', () => {
  it('design/text-too-long: over about 40 words', () => {
    const long = bent((c) => (c.steps[0]!.calls[0]!.text = words(50)));
    expect(ruleIds(long)).toContain('design/text-too-long');
    const finding = findings(long).find((item) => item.rule === 'design/text-too-long')!;
    expect(finding).toMatchObject({ severity: 'warning', call: 'ask.get', group: 'design' });
    expect(finding.path).toEqual(['steps', 0, 'calls', 0, 'text']);
    expect(finding.message).toContain('50 words');
  });

  it('design/text-too-long: four sentences that add up to a lot', () => {
    const many = bent((c) => {
      c.steps[0]!.calls[0]!.text = `${words(10, 'a')} ${words(10, 'b').replace('b0', 'The')} ${words(10, 'c').replace('c0', 'Then')} ${words(10, 'd').replace('d0', 'Last')}`;
    });
    expect(ruleIds(many)).toContain('design/text-too-long');
  });

  it('design/text-too-long: not at 40 words, and not for a trailing prediction question', () => {
    expect(ruleIds(bent((c) => (c.steps[0]!.calls[0]!.text = words(40))))).not.toContain(
      'design/text-too-long',
    );
    const withQuestion = bent((c) => {
      c.steps[0]!.calls[0]!.text = `${words(38)} Which side will it keep after this one?`;
    });
    expect(ruleIds(withQuestion)).not.toContain('design/text-too-long');
  });

  it('design/text-crowded: most calls near the ceiling', () => {
    const crowded = bent((c) => {
      for (const step of c.steps) {
        step.calls.forEach((item, index) => (item.text = words(36, `s${step.id}${index}`)));
      }
      append(c, call('extra', words(36, 'x')));
    });
    expect(ruleIds(crowded)).toContain('design/text-crowded');
    expect(ruleIds(crowded)).not.toContain('design/text-too-long');
  });

  it('design/text-crowded: not when only a few calls are long, or there are few calls', () => {
    const few = bent((c) => {
      append(c, call('x1', words(36, 'x')), call('x2', 'Short one with 15 and 16.'));
    });
    expect(ruleIds(few)).not.toContain('design/text-crowded');
    const small = bent((c) =>
      c.steps[0]!.calls.forEach((item, i) => (item.text = words(36, `t${i}`))),
    );
    expect(ruleIds(small)).not.toContain('design/text-crowded');
  });

  it('design/text-missing: a call with no text', () => {
    const missing = bent((c) => delete c.steps[1]!.calls[0]!.text);
    expect(findings(missing).filter((item) => item.rule === 'design/text-missing')).toHaveLength(1);
    expect(ruleIds(bent((c) => (c.steps[1]!.calls[0]!.text = '   ')))).toContain(
      'design/text-missing',
    );
  });

  it('design/text-missing: many calls without text become one finding', () => {
    const many = bent((c) => {
      append(c, ...Array.from({ length: 8 }, (_, i) => call(`m${i}`, '')));
    });
    const found = findings(many).filter((item) => item.rule === 'design/text-missing');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('8 of 13 calls');
  });

  it('design/text-duplicate: the same text on two calls, however it is spaced or cased', () => {
    const same = bent((c) => {
      c.steps[1]!.calls[1]!.text = 'Alpha changes from 14 to 15 after the update.';
      c.steps[1]!.calls[0]!.text = 'ALPHA changes  from 14 to 15 after the update.';
    });
    expect(ruleIds(same)).toContain('design/text-duplicate');
  });

  it('design/text-duplicate: a short repeat is not a duplicate', () => {
    const short = bent((c) => {
      c.steps[1]!.calls[0]!.text = 'Done.';
      c.steps[1]!.calls[1]!.text = 'Done.';
    });
    expect(ruleIds(short)).not.toContain('design/text-duplicate');
  });

  it('design/text-forward-reference: "as we will see"', () => {
    const ahead = bent((c) => {
      c.steps[0]!.calls[0]!.text = 'The client asks for alpha, 14, which, as we will see, changes.';
    });
    expect(ruleIds(ahead)).toContain('design/text-forward-reference');
    expect(
      ruleIds(bent((c) => (c.steps[0]!.calls[0]!.text = 'Alpha is 14; it changes later to 15.'))),
    ).not.toContain('design/text-forward-reference');
  });

  it('design/text-narrates-layout: arrows, highlights and colours', () => {
    for (const text of [
      'An arrow goes from the client to the server with 14.',
      'The highlighted row shows alpha at 14.',
      'The green row is alpha, at 14.',
    ]) {
      const narrated = bent((c) => (c.steps[0]!.calls[0]!.text = text));
      expect(ruleIds(narrated)).toContain('design/text-narrates-layout');
    }
  });

  it('design/text-narrates-layout: a direction in the data is not layout', () => {
    const data = bent((c) => {
      c.steps[0]!.calls[0]!.text =
        'The search moves to the right of 14, and the red value 9 is skipped.';
    });
    expect(ruleIds(data)).not.toContain('design/text-narrates-layout');
  });

  it('design/label-long: a name of more than ten words', () => {
    const long = bent((c) => (c.steps[0]!.calls[0]!.label = words(11, 'l').replace('.', '')));
    expect(ruleIds(long)).toContain('design/label-long');
    expect(
      ruleIds(bent((c) => (c.steps[0]!.calls[0]!.label = 'POST /token with the verifier'))),
    ).not.toContain('design/label-long');
  });
});

describe('shape rules', () => {
  it('design/step-text-missing: some steps have no text, or none does', () => {
    const some = bent((c) => delete c.steps[1]!.text);
    expect(
      findings(some).find((item) => item.rule === 'design/step-text-missing')!.message,
    ).toContain('1 of 3 steps');
    const none = bent((c) => c.steps.forEach((step) => delete step.text));
    expect(
      findings(none).find((item) => item.rule === 'design/step-text-missing')!.message,
    ).toContain('no step has a text');
  });

  it('design/step-title-repeated: two steps with one title', () => {
    const repeated = bent((c) => (c.steps[2]!.title = ' ask '));
    expect(ruleIds(repeated)).toContain('design/step-title-repeated');
  });

  it('design/step-shape: a step with seven calls, or too few or too many steps', () => {
    const big = bent((c) => {
      append(c, ...Array.from({ length: 6 }, (_, i) => call(`b${i}`, words(8, `b${i}`))));
    });
    expect(findings(big).find((item) => item.rule === 'design/step-shape')!.message).toContain(
      '"finish" (7 calls)',
    );
    const six = bent((c) =>
      append(c, ...Array.from({ length: 5 }, (_, i) => call(`b${i}`, words(8, `b${i}`)))),
    );
    expect(ruleIds(six)).not.toContain('design/step-shape');

    const flat = bent((c) => {
      c.steps = [
        {
          ...c.steps[0]!,
          calls: Array.from({ length: 8 }, (_, i) => call(`f${i}`, words(8, `f${i}`))),
        },
      ];
      c.steps[0]!.calls.forEach((item) => delete item.from);
    });
    const flatMessages = findings(flat)
      .filter((item) => item.rule === 'design/step-shape')
      .map((item) => item.message);
    expect(flatMessages.some((message) => message.includes('8 calls'))).toBe(true);
    expect(flatMessages.some((message) => message.includes('typically 3 to 7 steps'))).toBe(true);

    const many = bent((c) => {
      c.steps = Array.from({ length: 9 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        text: `Purpose of step ${i}.`,
        calls: [call(`c${i}`, words(8, `c${i}`))],
      }));
    });
    expect(findings(many).find((item) => item.rule === 'design/step-shape')!.message).toContain(
      '9 steps',
    );
  });

  it('design/call-touches-nothing: no effect, a focus only, and not a message', () => {
    const none = bent((c) => delete c.steps[1]!.calls[1]!.effects);
    expect(findings(none).find((item) => item.rule === 'design/call-touches-nothing')!.call).toBe(
      'change.compare',
    );
    const focus = bent((c) => (c.steps[1]!.calls[1]!.effects = { data: [{ focus: 'a' }] }));
    expect(
      findings(focus).find((item) => item.rule === 'design/call-touches-nothing')!.message,
    ).toContain('only centres a pane');
    const message = bent((c) => delete c.steps[0]!.calls[0]!.effects);
    expect(ruleIds(message)).not.toContain('design/call-touches-nothing');
  });

  it('design/call-without-where: only where some calls have one', () => {
    const some = bent((c) => delete c.steps[1]!.calls[0]!.where);
    expect(findings(some).filter((item) => item.rule === 'design/call-without-where')).toHaveLength(
      1,
    );
    const none = bent((c) => c.steps.forEach((s) => s.calls.forEach((item) => delete item.where)));
    expect(ruleIds(none)).not.toContain('design/call-without-where');
  });

  it('design/scope-not-stated: nothing about what was left out, or a version', () => {
    const silent = bent((c) => (c.lead = 'How one value changes in a table.'));
    expect(ruleIds(silent)).toContain('design/scope-not-stated');
    const dated = bent((c) => (c.lead = 'How one value changes. Checked against spec v2.1.'));
    expect(ruleIds(dated)).not.toContain('design/scope-not-stated');
    const inStep = bent((c) => {
      c.lead = 'How one value changes.';
      c.steps[0]!.text = 'Ignoring retries, the client asks.';
    });
    expect(ruleIds(inStep)).not.toContain('design/scope-not-stated');
  });
});

describe('pane rules', () => {
  it('design/pane-never-touched: a pane nothing touches', () => {
    const idle = bent((c) => extraPane(c, 'spare'));
    const found = findings(idle).find((item) => item.rule === 'design/pane-never-touched')!;
    expect(found.path).toEqual(['layout', 'panes', 2]);
    expect(found.message).toContain('"spare"');
  });

  it('design/pane-never-touched: a read counts as touching', () => {
    const read = bent((c) => {
      extraPane(c, 'spare');
      c.steps[2]!.calls[0]!.effects = { data: [{ read: 'a' }], spare: [{ read: 'n1' }] };
    });
    expect(ruleIds(read)).not.toContain('design/pane-never-touched');
  });

  it('design/pane-idle-after-start: touched only by the first call', () => {
    const early = bent((c) => {
      extraPane(c, 'spare');
      c.steps[0]!.calls[0]!.effects = { data: [{ read: 'a' }], spare: [{ read: 'n1' }] };
    });
    expect(ruleIds(early)).toContain('design/pane-idle-after-start');
    expect(ruleIds(early)).not.toContain('design/pane-never-touched');
  });

  it('design/focus-pane-never-shown: a focus pane no call shows', () => {
    const hidden = bent((c) => {
      extraPane(c, 'first', 'focus');
      extraPane(c, 'second', 'focus');
      for (const step of c.steps)
        for (const item of step.calls)
          item.effects = { ...item.effects, first: [{ read: 'n1' }], second: [{ read: 'n1' }] };
    });
    const found = findings(hidden).filter((item) => item.rule === 'design/focus-pane-never-shown');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('"second"');
    const shown = bent((c) => {
      extraPane(c, 'first', 'focus');
      extraPane(c, 'second', 'focus');
      c.steps[2]!.calls[0]!.show = 'second';
      for (const step of c.steps)
        for (const item of step.calls)
          item.effects = { ...item.effects, first: [{ read: 'n1' }], second: [{ read: 'n1' }] };
    });
    expect(ruleIds(shown)).not.toContain('design/focus-pane-never-shown');
  });

  it('design/too-many-panes: four fixed panes, not three', () => {
    const four = bent((c) => {
      extraPane(c, 'p3');
      extraPane(c, 'p4');
      for (const step of c.steps)
        for (const item of step.calls)
          item.effects = { ...item.effects, p3: [{ read: 'n1' }], p4: [{ read: 'n1' }] };
    });
    expect(findings(four).find((item) => item.rule === 'design/too-many-panes')!.message).toContain(
      '4 panes',
    );
    const three = bent((c) => {
      extraPane(c, 'p3');
      for (const step of c.steps)
        for (const item of step.calls) item.effects = { ...item.effects, p3: [{ read: 'n1' }] };
    });
    expect(ruleIds(three)).not.toContain('design/too-many-panes');
  });

  it('design/show-flips: the focus pane changes on most calls and goes back', () => {
    const flip = (alternate: boolean) =>
      bent((c) => {
        extraPane(c, 'f1', 'focus');
        extraPane(c, 'f2', 'focus');
        let n = 0;
        for (const step of c.steps) {
          for (const item of step.calls) {
            item.effects = { ...item.effects, f1: [{ read: 'n1' }], f2: [{ read: 'n1' }] };
            n += 1;
            if (alternate || n === 1) item.show = n % 2 === 1 ? 'f1' : 'f2';
          }
        }
        append(
          c,
          call('e1', words(8, 'e1'), { show: 'f1' }),
          call('e2', words(8, 'e2'), { show: 'f2' }),
          call('e3', words(8, 'e3'), { show: 'f1' }),
        );
      });
    expect(ruleIds(flip(true))).toContain('design/show-flips');
    expect(ruleIds(flip(false))).not.toContain('design/show-flips');
  });

  it('design/element-never-shown: a row that starts absent and is never added', () => {
    const never = bent((c) => {
      c.steps[0]!.calls[1]!.effects = { data: [{ read: 'a' }] };
      c.steps[1]!.calls[1]!.effects = { data: [{ read: 'a' }] };
    });
    const found = findings(never).find((item) => item.rule === 'design/element-never-shown')!;
    expect(found.message).toContain('"b"');
    expect(ruleIds(cleanConfig())).not.toContain('design/element-never-shown');
  });

  it('design/element-flash: removed in the call after it was added', () => {
    const flash = bent((c) => {
      c.steps[1]!.calls[0]!.effects = { data: [{ remove: 'b' }] };
      c.steps[1]!.calls[1]!.effects = { data: [{ read: 'a' }] };
    });
    expect(findings(flash).find((item) => item.rule === 'design/element-flash')).toMatchObject({
      severity: 'info',
      call: 'change.set',
    });
    const later = bent((c) => {
      c.steps[2]!.calls[0]!.effects = { data: [{ remove: 'b' }] };
    });
    expect(findings(later).filter((item) => item.rule === 'design/element-flash')).toEqual([]);
    expect(ruleIds(later)).not.toContain('design/element-flash');
  });
});

describe('value rules', () => {
  it('design/value-change-unstated: a table cell changes and the text has neither value', () => {
    const silent = bent((c) => (c.steps[1]!.calls[0]!.text = 'Alpha is updated by the server.'));
    const found = findings(silent).find((item) => item.rule === 'design/value-change-unstated')!;
    expect(found.message).toContain('data.a.val: "14" to "15"');
    expect(found.call).toBe('change.set');
  });

  it('design/value-change-unstated: either value is enough, and so is a number in a longer value', () => {
    for (const text of [
      'Alpha becomes 15 now.',
      'Alpha was 14 before.',
      'Alpha is 15 and so on.',
    ]) {
      const told = bent((c) => (c.steps[1]!.calls[0]!.text = text));
      expect(ruleIds(told)).not.toContain('design/value-change-unstated');
    }
    const longer = bent((c) => {
      c.steps[1]!.calls[0]!.effects = { data: [{ update: 'a', fields: { val: 'Cart (15)' } }] };
      c.steps[1]!.calls[0]!.text = 'The title shows 15 after the update.';
    });
    expect(ruleIds(longer)).not.toContain('design/value-change-unstated');
  });

  it('design/value-change-unstated: a word value, and filling an empty cell, are not checked', () => {
    const word = bent((c) => {
      c.steps[1]!.calls[0]!.effects = { data: [{ update: 'a', fields: { val: 'done' } }] };
      c.steps[1]!.calls[0]!.text = 'Alpha is updated by the server.';
    });
    expect(ruleIds(word)).not.toContain('design/value-change-unstated');
    const empty = bent((c) => {
      const table = c.layout.panes[1]!.content as { rows: { cells: Record<string, string> }[] };
      table.rows[0]!.cells.val = '';
      c.steps[1]!.calls[0]!.text = 'Alpha is updated by the server.';
    });
    expect(ruleIds(empty)).not.toContain('design/value-change-unstated');
  });

  it('design/value-change-unstated: left alone when the same element is updated in another pane', () => {
    const twoPanes = (second: boolean) =>
      bent((c) => {
        c.layout.panes.push({
          id: 'echo',
          panel: 'table',
          role: 'fixed',
          title: 'Echo',
          content: {
            columns: [
              { id: 'name', label: 'Name' },
              { id: 'val', label: 'Value' },
            ],
            rows: [{ id: 'a', cells: { name: 'alpha', val: '14' } }],
          },
        });
        c.steps[1]!.calls[0]!.text = 'Alpha is updated by the server.';
        c.steps[1]!.calls[0]!.effects = {
          data: [{ update: 'a', fields: { val: '15' } }],
          ...(second
            ? { echo: [{ update: 'a', fields: { val: '15' } }] }
            : { echo: [{ read: 'a' }] }),
        };
        for (const step of c.steps) {
          for (const item of step.calls) {
            if (item.effects?.echo === undefined)
              item.effects = { ...item.effects, echo: [{ read: 'a' }] };
          }
        }
      });
    expect(ruleIds(twoPanes(false))).toContain('design/value-change-unstated');
    expect(ruleIds(twoPanes(true))).not.toContain('design/value-change-unstated');
  });

  it('design/value-change-unstated: an array value that is overwritten', () => {
    const arrayConfig = (text: string) => ({
      id: 'arr',
      title: 'Arrays',
      lead: 'Omitted: everything else.',
      layout: {
        panes: [
          { id: 'cells', panel: 'array', content: { arrays: [{ id: 'xs', cells: [12, 19, 23] }] } },
          { id: 'other', panel: 'array', content: { arrays: [{ id: 'ys', cells: [31, 46, 58] }] } },
        ],
      },
      steps: [
        {
          id: 's1',
          title: 'One',
          text: 'Swap.',
          calls: [
            {
              id: 'c1',
              label: 'Write',
              text: 'Look at the cells.',
              effects: { cells: [{ read: 'xs.0' }], other: [{ read: 'ys.0' }] },
            },
          ],
        },
        {
          id: 's2',
          title: 'Two',
          text: 'Write.',
          calls: [
            {
              id: 'c2',
              label: 'Overwrite',
              text,
              effects: { cells: [{ update: 'xs.1', fields: { value: 99 } }] },
            },
          ],
        },
        {
          id: 's3',
          title: 'Three',
          text: 'Done.',
          calls: [
            {
              id: 'c3',
              label: 'Look',
              text: 'Nothing else changes in the other array.',
              effects: { other: [{ read: 'ys.1' }] },
            },
          ],
        },
      ],
    });
    expect(ruleIds(arrayConfig('The second cell is overwritten.') as never)).toContain(
      'design/value-change-unstated',
    );
    expect(ruleIds(arrayConfig('The second cell goes from 19 to 99.') as never)).not.toContain(
      'design/value-change-unstated',
    );
  });

  it('design/text-names-absent and -untouched: a backticked name', () => {
    const absent = bent((c) => {
      c.steps[0]!.calls[0]!.text = 'The client asks for `beta` while the row alpha holds 14.';
    });
    const found = findings(absent).find((item) => item.rule === 'design/text-names-absent')!;
    expect(found).toMatchObject({ severity: 'warning', call: 'ask.get' });
    expect(found.message).toContain('"beta"');

    const untouched = bent((c) => {
      c.steps[2]!.calls[0]!.text = 'The server replies; `beta` stays at 9 as alpha reads 15.';
    });
    expect(
      findings(untouched).find((item) => item.rule === 'design/text-names-untouched')!.message,
    ).toContain('"beta"');
    expect(ruleIds(untouched)).not.toContain('design/text-names-absent');
  });

  it('design/text-names-*: a touched element, a lane, a label and a value are not flagged', () => {
    const fine = bent((c) => {
      c.steps[2]!.calls[0]!.text = 'The `server` replies with `alpha`, which is 15.';
      c.steps[0]!.calls[0]!.text = 'The `client` asks for `alpha`, which holds 14, in the row `a`.';
    });
    expect(ruleIds(fine)).not.toContain('design/text-names-absent');
    expect(ruleIds(fine)).not.toContain('design/text-names-untouched');
    const code = bent(
      (c) => (c.steps[0]!.calls[0]!.text = 'The client sends `GET /value` and reads 14.'),
    );
    expect(ruleIds(code)).not.toContain('design/text-names-untouched');
  });

  const arrayRules = (cells: unknown[]) =>
    ruleIds({
      id: 'arr',
      title: 'Arrays',
      lead: 'Omitted: everything else.',
      layout: {
        panes: [{ id: 'cells', panel: 'array', content: { arrays: [{ id: 'xs', cells }] } }],
      },
      steps: [
        {
          id: 's1',
          title: 'One',
          text: 'Look.',
          calls: [
            {
              id: 'c1',
              label: 'Look',
              text: 'Read the first cell.',
              effects: { cells: [{ read: 'xs.0' }] },
            },
          ],
        },
        {
          id: 's2',
          title: 'Two',
          text: 'Look.',
          calls: [
            {
              id: 'c2',
              label: 'Again',
              text: 'Read the second cell.',
              effects: { cells: [{ read: 'xs.1' }] },
            },
          ],
        },
        {
          id: 's3',
          title: 'Three',
          text: 'Look.',
          calls: [
            {
              id: 'c3',
              label: 'Last',
              text: 'Read the third cell.',
              effects: { cells: [{ read: 'xs.2' }] },
            },
          ],
        },
      ],
    } as never);

  it('design/values-equal-indexes: 0, 1, 2 are positions, 12, 19, 23 are not', () => {
    expect(arrayRules([0, 1, 2, 3])).toContain('design/values-equal-indexes');
    expect(arrayRules([1, 2, 3, 4])).not.toContain('design/values-equal-indexes');
    expect(arrayRules([12, 19, 23, 31])).not.toContain('design/values-equal-indexes');
  });

  it('design/values-repeat: a value twice in one array, rows that read the same in a table', () => {
    expect(arrayRules([12, 19, 12, 31])).toContain('design/values-repeat');
    expect(arrayRules([12, 19, 23, 31])).not.toContain('design/values-repeat');
    const rows = bent((c) => {
      const table = c.layout.panes[1]!.content as { rows: { cells: Record<string, string> }[] };
      table.rows[1]!.cells.name = 'Alpha';
    });
    expect(ruleIds(rows)).toContain('design/values-repeat');
  });
});

describe('severity and robustness', () => {
  it('lists warnings before infos, and each in the order of the calls', () => {
    const noisy = bent((c) => {
      c.lead = 'No scope here.';
      c.steps[2]!.calls[0]!.text = '';
      c.steps[0]!.calls[1]!.text = '';
    });
    const list = findings(noisy);
    const severities = list.map((item) => item.severity);
    expect(severities).toEqual(
      [...severities].sort((a, b) => (a === b ? 0 : a === 'warning' ? -1 : 1)),
    );
    const missing = list.filter((item) => item.rule === 'design/text-missing');
    expect(missing.map((item) => item.call)).toEqual(['ask.add', 'finish.reply']);
  });

  it('puts the prefix of a collection on every path', async () => {
    const { reviewConfig } = await import('../../src/review');
    const { createRegistry } = await import('../../src/registry');
    const config = bent((c) => (c.steps[1]!.calls[0]!.text = ''));
    const review = await reviewConfig(
      'x.json',
      { walkthroughs: [cleanConfig(), config] },
      createRegistry(),
    );
    const found = review.walkthroughs[1]!.findings!.find(
      (item) => item.rule === 'design/text-missing',
    )!;
    expect(found.path.slice(0, 3)).toEqual(['walkthroughs', 1, 'steps']);
    expect(found.at).toBe('walkthroughs[1].steps[1].calls[0].text');
  });
});
