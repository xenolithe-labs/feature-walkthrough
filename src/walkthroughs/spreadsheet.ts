import { defineWalkthrough } from '../core';

/**
 * A spreadsheet recalculating after one cell changes.
 *
 * The sheet is small enough to check by hand:
 *   A3 = A1 * A2        A5 = A3 * A4        A7 = A3 + A5 + A6
 * Before: 20, 3, 60, 0.1, 6, 5, 71.   After A1 = 25: 25, 3, 75, 0.1, 7.5, 5, 87.5.
 */
export const spreadsheet = defineWalkthrough({
  id: 'spreadsheet',
  title: 'Spreadsheet: recalculating after one change',
  lead: 'Change one cell and a spreadsheet works out which other cells are now wrong, in what order to fix them, and which ones it can leave alone.',
  tags: ['dependency graph'],

  layout: {
    panes: [
      {
        id: 'sheet',
        panel: 'table',
        title: 'Sheet',
        content: {
          columns: [
            { id: 'cell', label: 'Cell', mono: true },
            { id: 'name', label: 'Name' },
            { id: 'formula', label: 'Formula', mono: true },
            { id: 'value', label: 'Value', mono: true },
          ],
          rows: [
            { id: 'A1', cells: { cell: 'A1', name: 'Price', formula: '', value: '20' } },
            { id: 'A2', cells: { cell: 'A2', name: 'Quantity', formula: '', value: '3' } },
            { id: 'A3', cells: { cell: 'A3', name: 'Subtotal', formula: '=A1*A2', value: '60' } },
            { id: 'A4', cells: { cell: 'A4', name: 'Tax rate', formula: '', value: '0.1' } },
            { id: 'A5', cells: { cell: 'A5', name: 'Tax', formula: '=A3*A4', value: '6' } },
            { id: 'A6', cells: { cell: 'A6', name: 'Shipping', formula: '', value: '5' } },
            { id: 'A7', cells: { cell: 'A7', name: 'Total', formula: '=A3+A5+A6', value: '71' } },
          ],
        },
      },
      {
        id: 'deps',
        panel: 'graph',
        title: 'Who depends on whom',
        content: {
          initial: true,
          direction: 'DOWN',
          nodes: [
            { id: 'A1', label: 'A1', sub: 'Price' },
            { id: 'A2', label: 'A2', sub: 'Quantity' },
            { id: 'A3', label: 'A3', sub: 'Subtotal' },
            { id: 'A4', label: 'A4', sub: 'Tax rate' },
            { id: 'A5', label: 'A5', sub: 'Tax' },
            { id: 'A6', label: 'A6', sub: 'Shipping' },
            { id: 'A7', label: 'A7', sub: 'Total' },
          ],
          edges: [
            { from: 'A1', to: 'A3' },
            { from: 'A2', to: 'A3' },
            { from: 'A3', to: 'A5' },
            { from: 'A4', to: 'A5' },
            { from: 'A3', to: 'A7' },
            { from: 'A5', to: 'A7' },
            { from: 'A6', to: 'A7' },
          ],
        },
      },
      {
        id: 'stages',
        panel: 'flow',
        title: 'Stages',
        content: {
          nodes: [
            { id: 'edit', label: 'Edit', sub: 'store the new value', kind: 'terminal' },
            { id: 'mark', label: 'Mark dirty', sub: 'follow the arrows' },
            { id: 'more', label: 'More dependents?', kind: 'decision' },
            { id: 'order', label: 'Order', sub: 'inputs before outputs' },
            { id: 'compute', label: 'Recompute', sub: 'one dirty cell at a time' },
            { id: 'left', label: 'Dirty cells left?', kind: 'decision' },
            { id: 'paint', label: 'Repaint', sub: 'only what changed', kind: 'terminal' },
          ],
          edges: [
            { from: 'edit', to: 'mark' },
            { from: 'mark', to: 'more' },
            { id: 'more.yes', from: 'more', to: 'mark', label: 'yes' },
            { from: 'more', to: 'order', label: 'no' },
            { from: 'order', to: 'compute' },
            { from: 'compute', to: 'left' },
            { id: 'left.yes', from: 'left', to: 'compute', label: 'yes' },
            { from: 'left', to: 'paint', label: 'no' },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'edit',
      title: 'Edit',
      text: 'The user types a new price.',
      calls: [
        {
          id: 'type',
          label: 'Type 25 into A1',
          text: 'A1 holds a plain value, so storing it is all there is to do for A1 itself. Everything computed from it is now out of date.',
          effects: {
            sheet: [{ update: 'A1', fields: { value: '25' } }],
            deps: [{ update: 'A1' }],
            stages: [{ read: 'edit' }],
          },
        },
      ],
    },
    {
      id: 'mark',
      title: 'Mark dirty',
      text: 'Starting from the changed cell, follow the arrows and flag every cell reached. Nothing is recomputed yet.',
      calls: [
        {
          id: 'mark-a3',
          label: 'A1 feeds A3: mark A3',
          text: 'A3 reads A1, so its value can no longer be trusted. It is flagged, not recomputed.',
          effects: {
            sheet: [{ read: 'A1' }, { update: 'A3', fields: { tone: 'warn' } }],
            deps: [{ read: 'A1' }, { read: 'A1.A3' }, { update: 'A3', fields: { tone: 'warn' } }],
            stages: [{ read: 'mark' }, { read: 'edit.mark' }],
          },
        },
        {
          id: 'mark-a5',
          label: 'A3 feeds A5: mark A5',
          text: 'The same rule applied again, one level further: whatever reads a dirty cell is dirty too.',
          effects: {
            sheet: [{ read: 'A3' }, { update: 'A5', fields: { tone: 'warn' } }],
            deps: [{ read: 'A3' }, { read: 'A3.A5' }, { update: 'A5', fields: { tone: 'warn' } }],
            stages: [{ read: 'mark' }, { read: 'more' }, { read: 'more.yes' }],
          },
        },
        {
          id: 'mark-a7',
          label: 'A3 also feeds A7: mark A7',
          text: 'A3 has a second dependent. A7 is flagged.',
          effects: {
            sheet: [{ read: 'A3' }, { update: 'A7', fields: { tone: 'warn' } }],
            deps: [{ read: 'A3' }, { read: 'A3.A7' }, { update: 'A7', fields: { tone: 'warn' } }],
            stages: [{ read: 'mark' }, { read: 'more' }, { read: 'more.yes' }],
          },
        },
        {
          id: 'mark-again',
          label: 'A5 feeds A7: already marked',
          text: 'A7 is reached a second time, through A5. It is already flagged, so the walk stops here instead of going round again. A2, A4 and A6 were never reached: they stay clean.',
          effects: {
            sheet: [{ read: 'A5' }, { read: 'A7' }],
            deps: [{ read: 'A5' }, { read: 'A5.A7' }, { read: 'A7' }],
            stages: [{ read: 'more' }, { read: 'more.order' }],
          },
        },
      ],
    },
    {
      id: 'order',
      title: 'Order',
      text: 'Decide the order in which to recompute the dirty cells.',
      calls: [
        {
          id: 'sort',
          label: 'Sort the dirty cells: A3, A5, A7',
          text: 'A cell can only be recomputed after every cell it reads is up to date. A5 reads A3, and A7 reads both, so the only safe order is A3, then A5, then A7. Computing A7 first would use the old subtotal and the old tax.',
          blocks: [
            {
              title: 'Order',
              text: '1. A3   reads A1, A2       (both clean)\n2. A5   reads A3, A4       (A3 done in 1)\n3. A7   reads A3, A5, A6   (A3 in 1, A5 in 2)',
            },
          ],
          effects: {
            sheet: [{ read: 'A3' }, { read: 'A5' }, { read: 'A7' }],
            deps: [
              { read: 'A3' },
              { read: 'A5' },
              { read: 'A7' },
              { read: 'A3.A5' },
              { read: 'A3.A7' },
              { read: 'A5.A7' },
            ],
            stages: [{ read: 'order' }],
          },
        },
      ],
    },
    {
      id: 'compute',
      title: 'Recompute',
      text: 'Work through the dirty cells in order. Each one reads its inputs, stores a new value and becomes clean.',
      calls: [
        {
          id: 'compute-a3',
          label: 'A3 = A1 × A2 = 75',
          text: '25 × 3 = 75. A3 is clean again.',
          effects: {
            sheet: [
              { read: 'A1', cells: ['value'] },
              { read: 'A2', cells: ['value'] },
              { update: 'A3', fields: { value: '75', tone: 'none' } },
            ],
            deps: [
              { read: 'A1' },
              { read: 'A2' },
              { read: 'A1.A3' },
              { read: 'A2.A3' },
              { update: 'A3', fields: { tone: 'none' } },
            ],
            stages: [{ read: 'compute' }, { read: 'order.compute' }],
          },
        },
        {
          id: 'compute-a5',
          label: 'A5 = A3 × A4 = 7.5',
          text: '75 × 0.1 = 7.5. It uses the new subtotal because A3 was done first.',
          effects: {
            sheet: [
              { read: 'A3', cells: ['value'] },
              { read: 'A4', cells: ['value'] },
              { update: 'A5', fields: { value: '7.5', tone: 'none' } },
            ],
            deps: [
              { read: 'A3' },
              { read: 'A4' },
              { read: 'A3.A5' },
              { read: 'A4.A5' },
              { update: 'A5', fields: { tone: 'none' } },
            ],
            stages: [{ read: 'compute' }, { read: 'left' }, { read: 'left.yes' }],
          },
        },
        {
          id: 'compute-a7',
          label: 'A7 = A3 + A5 + A6 = 87.5',
          text: '75 + 7.5 + 5 = 87.5. A7 was reached twice while marking but is computed once.',
          effects: {
            sheet: [
              { read: 'A3', cells: ['value'] },
              { read: 'A5', cells: ['value'] },
              { read: 'A6', cells: ['value'] },
              { update: 'A7', fields: { value: '87.5', tone: 'none' } },
            ],
            deps: [
              { read: 'A3' },
              { read: 'A5' },
              { read: 'A6' },
              { read: 'A3.A7' },
              { read: 'A5.A7' },
              { read: 'A6.A7' },
              { update: 'A7', fields: { tone: 'none' } },
            ],
            stages: [{ read: 'compute' }, { read: 'left' }, { read: 'left.yes' }],
          },
        },
      ],
    },
    {
      id: 'paint',
      title: 'Repaint',
      text: 'Show the result.',
      calls: [
        {
          id: 'repaint',
          label: 'Redraw the four cells that changed',
          text: 'One cell was edited and three were recomputed. The other three were never touched: not marked, not computed, not redrawn. On a sheet with a million cells, that is the whole point.',
          effects: {
            sheet: [
              { read: 'A1', cells: ['value'] },
              { read: 'A3', cells: ['value'] },
              { read: 'A5', cells: ['value'] },
              { read: 'A7', cells: ['value'] },
            ],
            deps: [{ read: 'A1' }, { read: 'A3' }, { read: 'A5' }, { read: 'A7' }],
            stages: [{ read: 'left' }, { read: 'left.paint' }, { read: 'paint' }],
          },
        },
      ],
    },
  ],
});
