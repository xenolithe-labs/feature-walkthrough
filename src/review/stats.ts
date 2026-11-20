import type { Analysis } from './analysis';
import type { Stats } from './schema';
import { overCeiling } from './rules/text';

const round = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) =>
  values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** The shape of a walkthrough in numbers. */
export function statsOf({ walkthrough, calls, elements }: Analysis): Stats {
  const sizes = walkthrough.steps.map((step) => step.calls.length);
  const words = calls.map((item) => item.stats.words);
  const longest = calls.reduce<(typeof calls)[number] | undefined>(
    (best, item) => (best === undefined || item.stats.words > best.stats.words ? item : best),
    undefined,
  );
  const touchedCounts = calls.map((item) => {
    const ids = new Set<string>();
    for (const [pane, touch] of Object.entries(item.touches)) {
      for (const id of [...touch.added, ...touch.updated, ...touch.read, ...touch.removed]) {
        ids.add(`${pane}\u0000${id}`);
      }
    }
    return ids.size;
  });
  return {
    steps: walkthrough.steps.length,
    calls: calls.length,
    callsPerStep: { min: Math.min(...sizes), max: Math.max(...sizes), mean: mean(sizes) },
    words: {
      total: words.reduce((sum, value) => sum + value, 0),
      mean: mean(words),
      median: median(words),
      longest: { words: longest?.stats.words ?? 0, call: longest?.key ?? null },
      overCeiling: calls.filter((item) => overCeiling(item.stats)).length,
      withoutText: calls.filter((item) => item.text === '').length,
    },
    panes: walkthrough.panes.length,
    elements: [...elements.values()].reduce((sum, pane) => sum + pane.size, 0),
    touchedPerCall: {
      mean: mean(touchedCounts),
      max: Math.max(0, ...touchedCounts),
      zero: touchedCounts.filter((count) => count === 0).length,
    },
    perPane: walkthrough.panes.map((pane) => ({
      pane: pane.id,
      panel: pane.panel.id,
      role: pane.role,
      elements: elements.get(pane.id)?.size ?? 0,
      callsTouching: calls.filter((item) => item.touches[pane.id]?.any === true).length,
      callsChanging: calls.filter((item) => {
        const touch = item.touches[pane.id];
        return (
          touch !== undefined && touch.added.size + touch.updated.size + touch.removed.size > 0
        );
      }).length,
    })),
  };
}
