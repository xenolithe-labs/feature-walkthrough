import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createFolder, loadConfig, type PanelContext } from '../../src/core';
import {
  estimateSize,
  fitZoom,
  framing,
  labelLines,
  READABLE_ZOOM,
} from '../../src/panels/_diagram/layout';
import { revealScroll } from '../../src/panels/_shared/reveal';
import { minLaneGap } from '../../src/panels/sequence';
import { createRegistry } from '../../src/registry';

/** Renders one pane of a synthetic walkthrough at a cursor, to markup. */
function render(config: unknown, paneId: string, s: number, c: number): string {
  const result = loadConfig(config, createRegistry());
  expect(result.problems).toEqual([]);
  const walkthrough = result.walkthroughs[0]!;
  const pane = walkthrough.panes.find((item) => item.id === paneId)!;
  const view = createFolder(walkthrough).at(s, c)[paneId]!;
  const ctx: PanelContext = {
    walkthrough,
    pane,
    call: walkthrough.steps[s]!.calls[c]!,
    current: view.current,
    selection: { id: undefined, select: () => {} },
    theme: 'light',
  };
  return renderToStaticMarkup(
    createElement(pane.panel.Component, { state: view.state, content: pane.content, ctx }),
  );
}

describe('revealScroll', () => {
  const view = { scroll: 100, size: 200 };

  it('leaves an item that is already visible alone', () => {
    expect(revealScroll(view, { start: 150, size: 40 })).toBeUndefined();
    expect(revealScroll(view, { start: 100, size: 200 })).toBeUndefined();
  });

  it('centres an item below or above the window', () => {
    expect(revealScroll(view, { start: 500, size: 40 })).toBe(500 - 80);
    expect(revealScroll(view, { start: 10, size: 40 })).toBe(0);
  });

  it('never scrolls before the start', () => {
    expect(revealScroll({ scroll: 50, size: 200 }, { start: 5, size: 40 })).toBe(0);
  });

  it('aligns an item taller than the window to its start', () => {
    expect(revealScroll(view, { start: 400, size: 600 })).toBe(392);
  });

  it('keeps clear of a sticky header that covers the top of the window', () => {
    // The item sits under a 30 px header: it counts as hidden.
    expect(
      revealScroll({ scroll: 100, size: 200, inset: 30 }, { start: 110, size: 10 }),
    ).toBeDefined();
    expect(
      revealScroll({ scroll: 100, size: 200, inset: 30 }, { start: 140, size: 10 }),
    ).toBeUndefined();
  });
});

describe('table rows that are not present yet', () => {
  const config = {
    id: 'rows',
    title: 'Rows',
    layout: {
      panes: [
        {
          id: 't',
          panel: 'table',
          content: {
            columns: [{ id: 'name', label: 'Name' }],
            initial: false,
            rows: [
              { id: 'late', cells: { name: 'late' }, tone: 'warn' },
              { id: 'good', cells: { name: 'good' }, tone: 'good' },
            ],
          },
        },
      ],
    },
    steps: [
      {
        id: 's',
        title: 'S',
        calls: [
          { id: 'c1', label: 'nothing yet', effects: { t: [{ add: 'good' }] } },
          { id: 'c2', label: 'adds', effects: { t: [{ add: 'late' }] } },
        ],
      },
    ],
  };

  it('do not show a tone marker before they exist', () => {
    const before = render(config, 't', 0, 0);
    // The row that is still absent carries no tone, so no border or bullet is drawn for it.
    const late = before.match(/<tr[^>]*data-entity="late"[^>]*>/)![0];
    expect(late).toContain('data-mark="absent"');
    expect(late).not.toContain('data-tone');
    expect(before.match(/<tr[^>]*data-entity="good"[^>]*>/)![0]).toContain('data-tone="good"');
  });

  it('show it from the call that adds them', () => {
    const after = render(config, 't', 0, 1);
    expect(after.match(/<tr[^>]*data-entity="late"[^>]*>/)![0]).toContain('data-tone="warn"');
  });
});

describe('node labels in diagrams', () => {
  it('wrap a long label between words instead of cutting it', () => {
    expect(labelLines('Value must be a known tidy label')).toBe(2);
    expect(labelLines('short')).toBe(1);
    expect(labelLines('x'.repeat(60))).toBe(3);
    expect(labelLines('word '.repeat(60))).toBe(3);
  });

  it('give a wrapped node more height and keep a short one as it was', () => {
    const short = estimateSize('short', 'a note');
    const long = estimateSize('Value must be a known tidy label', 'a note');
    expect(short.height).toBe(54);
    expect(long.width).toBe(270);
    expect(long.height).toBe(short.height + 16);
    expect(estimateSize('short').height).toBe(40);
    expect(estimateSize('x'.repeat(200)).height).toBe(24 + 16 * 3);
  });
});

describe('framing a big diagram', () => {
  it('computes the zoom fitView would choose', () => {
    expect(fitZoom({ width: 400, height: 200 }, { width: 800, height: 520 }, 24, 1.15)).toBeCloseTo(
      1.15,
    );
    expect(
      fitZoom({ width: 400, height: 2000 }, { width: 800, height: 520 }, 24, 1.15),
    ).toBeCloseTo(520 / 2048);
    expect(fitZoom({ width: 0, height: 0 }, { width: 800, height: 520 }, 24, 1.15)).toBe(1.15);
  });

  it('follows the call only when the whole diagram would be too small to read', () => {
    expect(framing(1, 3)).toBe('all');
    expect(framing(READABLE_ZOOM, 3)).toBe('all');
    expect(framing(READABLE_ZOOM - 0.01, 3)).toBe('touched');
    // Nothing touched: there is nothing to follow, so show the whole.
    expect(framing(0.2, 0)).toBe('all');
  });
});

describe('sequence lanes', () => {
  it('are wide enough not to split a long word of a title', () => {
    expect(minLaneGap(['A', 'B'])).toBe(88);
    expect(minLaneGap(['Server (WidgetDispatcher)'])).toBeGreaterThan(88);
    expect(minLaneGap(['x'.repeat(100)])).toBe(150);
    // Words that wrap do not widen the lane.
    expect(minLaneGap(['a long title made of short words'])).toBe(88);
  });
});
