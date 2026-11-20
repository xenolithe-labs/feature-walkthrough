import { describe, expect, it } from 'vitest';
import { loadConfig, stepChips } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { wrap } from './gen';

describe('step chips', () => {
  const config = () => ({
    ...wrap(
      'chips',
      [{ id: 'q', panel: 'sequence' }],
      [
        {
          id: 's',
          title: 'S',
          calls: [
            {
              id: 'k1',
              label: 'K1',
              from: 'client',
              to: 'gateway',
              annotations: { status: { status: 'fast' } },
            },
            {
              id: 'k2',
              label: 'K2',
              from: 'gateway',
              to: 'client',
              annotations: { status: { status: 'slow' } },
            },
          ],
        },
      ],
    ),
    annotations: {
      status: {
        statuses: { fast: { label: 'Done', tone: 'good' }, slow: { label: 'Done', tone: 'warn' } },
      },
    },
  });

  it('precondition: two statuses with the same label but different tones give two chips', () => {
    const w = loadConfig(config(), createRegistry()).walkthroughs[0]!;
    expect(stepChips(w, 0).map((c) => `${c.label}/${c.tone}`)).toEqual(['Done/good', 'Done/warn']);
  });

  // DEFECT: the step strip uses `chip.label` as the React key (src/shell/Walkthrough.tsx, the stepChips
  // map; the same in Card.tsx for the call's own chips), while stepChips deduplicates on tone and label
  // together, so two chips can share a key. React then warns and may drop or repeat one on re-render.
  it.fails(
    'chips of one step have unique labels, so that the label can serve as a React key',
    () => {
      const w = loadConfig(config(), createRegistry()).walkthroughs[0]!;
      const labels = stepChips(w, 0).map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    },
  );
});
