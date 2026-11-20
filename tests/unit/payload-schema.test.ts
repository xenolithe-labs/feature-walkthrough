import { describe, expect, it } from 'vitest';
import {
  createFolder,
  loadConfig,
  type ElementsState,
  type WalkthroughInput,
} from '../../src/core';
import { createRegistry } from '../../src/registry';

function config(effects: Record<string, Record<string, unknown>[]>, relations?: unknown[]) {
  return {
    id: 'mini',
    title: 'Mini',
    layout: {
      panes: [
        {
          id: 'body',
          panel: 'payload',
          content: {
            payloads: [
              { id: 'msg', title: 'Message', value: { to: 'a', items: [{ n: 1 }] } },
              { id: 'doc', title: 'Doc', value: { v: 1 }, raw: { text: 'v=1' }, initial: false },
            ],
          },
        },
        {
          id: 'model',
          panel: 'schema',
          content: {
            tables: [
              { id: 'user', label: 'user', columns: [{ id: 'id', key: 'PK' }] },
              { id: 'order', label: 'order', columns: [{ id: 'id' }, { id: 'user_id' }] },
            ],
            relations: relations ?? [
              { from: 'order.user_id', to: 'user.id' },
              { id: 'self', from: 'order', to: 'order' },
            ],
          },
        },
      ],
    },
    steps: [{ id: 's', title: 'S', calls: [{ id: 'c', label: 'C', effects }] }],
  } as WalkthroughInput;
}

const rules = (input: WalkthroughInput) =>
  loadConfig(input, createRegistry()).problems.map((problem) => problem.rule);

describe('payload', () => {
  it('accepts paths that exist and folds field changes into the patches', () => {
    const result = loadConfig(
      config({
        body: [
          { read: 'msg', paths: ['to', 'items.0.n'] },
          { update: 'msg', fields: { 'items.0.n': 2, tone: 'warn' } },
          { add: 'doc' },
        ],
      }),
      createRegistry(),
    );
    expect(result.problems).toEqual([]);
    const state = createFolder(result.walkthroughs[0]!).at(0, 0).body!.state as ElementsState;
    expect(state.present).toEqual(['msg', 'doc']);
    expect(state.patches.msg).toEqual({ 'items.0.n': 2, tone: 'warn' });
  });

  it('rejects a path that is not there', () => {
    expect(rules(config({ body: [{ read: 'msg', paths: ['items.1'] }] }))).toEqual([
      'payload/unknown-path',
    ]);
    expect(rules(config({ body: [{ update: 'msg', fields: { nope: 1 } }] }))).toEqual([
      'payload/unknown-path',
    ]);
  });

  it('checks a path against the value as changed by earlier effects', () => {
    const effects = [
      { update: 'msg', fields: { to: { name: 'a' } } },
      { read: 'msg', paths: ['to.name'] },
    ];
    expect(rules(config({ body: effects }))).toEqual([]);
  });

  it('warns when a field changes on a payload that also has raw text', () => {
    expect(rules(config({ body: [{ add: 'doc' }, { update: 'doc', fields: { v: 2 } }] }))).toEqual([
      'payload/raw-out-of-date',
    ]);
  });
});

describe('schema', () => {
  it('makes tables, columns and relations elements', () => {
    const effects = [
      { read: 'user' },
      { read: 'order.user_id' },
      { read: 'order.user_id:user.id' },
      { read: 'self' },
    ];
    expect(rules(config({ model: effects }))).toEqual([]);
  });

  it('rejects an effect on a column that does not exist', () => {
    expect(rules(config({ model: [{ read: 'user.email' }] }))).toEqual(['unknown-id']);
  });

  it('rejects a relation whose end is not a table or a column', () => {
    expect(rules(config({}, [{ from: 'order.user_id', to: 'customer' }]))).toEqual([
      'schema/unknown-end',
    ]);
  });
});
