import {
  loadConfig,
  type ResolvedWalkthrough,
  type Walkthrough,
  type WalkthroughInput,
} from '../../src/core';
import { createRegistry } from '../../src/registry';
import { analyse, designFindings, type Finding } from '../../src/review';

type Call = WalkthroughInput['steps'][number]['calls'][number];

/**
 * A small walkthrough that every design rule passes: it has a lead that says what was left out,
 * step texts, a text on every call with the values it changes, a pointer on every call, and two
 * panes that every call touches. The tests bend it into configs that break one rule.
 */
export function cleanConfig(): WalkthroughInput {
  return {
    id: 'clean',
    title: 'A value changes',
    lead: 'How one value changes in a table. Omitted: caching and retries.',
    lanes: [
      { id: 'client', title: 'Client' },
      { id: 'server', title: 'Server' },
    ],
    layout: {
      panes: [
        { id: 'wire', panel: 'sequence', title: 'Messages' },
        {
          id: 'data',
          panel: 'table',
          title: 'Values',
          content: {
            columns: [
              { id: 'name', label: 'Name' },
              { id: 'val', label: 'Value' },
            ],
            rows: [
              { id: 'a', cells: { name: 'alpha', val: '14' } },
              { id: 'b', cells: { name: 'beta', val: '9' }, initial: false },
            ],
          },
        },
      ],
    },
    steps: [
      {
        id: 'ask',
        title: 'Ask',
        text: 'The client asks for a value.',
        calls: [
          {
            id: 'get',
            label: 'GET /value',
            from: 'client',
            to: 'server',
            text: 'The client asks the server for the row alpha, which holds 14.',
            where: 'spec 1',
            effects: { data: [{ read: 'a' }] },
          },
          {
            id: 'add',
            label: 'Add a row',
            text: 'The server adds the row beta with the value 9, so two rows exist.',
            where: 'spec 2',
            effects: { data: [{ add: 'b' }] },
          },
        ],
      },
      {
        id: 'change',
        title: 'Change it',
        text: 'The value of alpha changes.',
        calls: [
          {
            id: 'set',
            label: 'Set alpha',
            text: 'Alpha changes from 14 to 15 after the update.',
            where: 'spec 3',
            effects: { data: [{ update: 'a', fields: { val: '15' } }] },
          },
          {
            id: 'compare',
            label: 'Read both',
            text: 'Both rows are read to compare 15 with 9.',
            where: 'spec 4',
            effects: { data: [{ read: 'a' }, { read: 'b' }] },
          },
        ],
      },
      {
        id: 'finish',
        title: 'Finish',
        text: 'The server answers.',
        calls: [
          {
            id: 'reply',
            label: 'Reply',
            from: 'server',
            to: 'client',
            text: 'The server replies with the new value, 15.',
            where: 'spec 5',
            effects: { data: [{ read: 'a' }] },
          },
        ],
      },
    ],
  };
}

/** Loads a config with the real panels, failing the test if it has an error. */
export function resolve(config: WalkthroughInput): ResolvedWalkthrough {
  const result = loadConfig(config, createRegistry());
  const errors = result.problems.filter((problem) => problem.severity === 'error');
  if (errors.length > 0 || result.walkthroughs[0] === undefined) {
    throw new Error(`the test config does not load: ${JSON.stringify(errors)}`);
  }
  return result.walkthroughs[0];
}

export function findings(config: WalkthroughInput): Finding[] {
  return designFindings(analyse(resolve(config)));
}

export function ruleIds(config: WalkthroughInput): string[] {
  return findings(config).map((finding) => finding.rule);
}

/** A copy of the clean config changed by `change`, which may edit it in place. */
export function bent(change: (config: Walkthrough) => void): WalkthroughInput {
  const copy = structuredClone(cleanConfig()) as Walkthrough;
  change(copy);
  return copy as unknown as WalkthroughInput;
}

export const callAt = (config: Walkthrough, step: number, call: number): Call =>
  config.steps[step]!.calls[call] as Call;
