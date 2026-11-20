/**
 * An independent reference for what the fold must produce. It reads the raw
 * config and applies the documented meaning of every verb with Maps and Sets,
 * sharing no code with `reduceElements` or `createFolder`.
 */
import type { ResolvedWalkthrough } from '../../src/core';

export interface ModelPane {
  present: string[];
  patches: Record<string, Record<string, unknown>>;
  focus: string | undefined;
  value: unknown;
}

const VERBS = ['add', 'update', 'read', 'remove', 'focus', 'set'] as const;

export function modelAt(w: ResolvedWalkthrough, s: number, c: number): Record<string, ModelPane> {
  const out: Record<string, ModelPane> = {};
  for (const pane of w.panes) {
    const present: string[] = pane.entities.filter((e) => e.initial).map((e) => e.id);
    const patches = new Map<string, Map<string, unknown>>();
    let focus: string | undefined;
    let value: unknown;

    const apply = (effect: Record<string, unknown>) => {
      const verb = VERBS.find((v) => effect[v] !== undefined)!;
      const id = effect[verb] as string;
      if (verb === 'add') {
        if (!present.includes(id)) present.push(id);
      } else if (verb === 'remove') {
        const at = present.indexOf(id);
        if (at >= 0) {
          present.splice(at, 1);
          patches.delete(id);
          if (focus === id) focus = undefined;
        }
      } else if (verb === 'update') {
        const fields = effect.fields as Record<string, unknown> | undefined;
        if (fields !== undefined) {
          const mine = patches.get(id) ?? new Map<string, unknown>();
          for (const [key, v] of Object.entries(fields)) mine.set(key, v);
          patches.set(id, mine);
        }
      } else if (verb === 'focus') {
        focus = id;
      } else if (verb === 'set') {
        value = effect.set;
      }
      // The code panel brings any touched source to the front.
      if (pane.panel.id === 'code' && verb !== 'set' && verb !== 'remove') focus = id;
    };

    for (let si = 0; si <= s; si += 1) {
      const calls = w.steps[si]!.calls;
      const last = si === s ? c : calls.length - 1;
      for (let ci = 0; ci <= last; ci += 1) {
        const call = calls[ci]!;
        if (pane.panel.id === 'sequence' && call.from !== undefined && call.to !== undefined) {
          apply({ add: call.id });
        }
        for (const effect of call.effects?.[pane.id] ?? []) apply(effect);
      }
    }
    out[pane.id] = {
      present,
      patches: Object.fromEntries([...patches].map(([id, m]) => [id, Object.fromEntries(m)])),
      focus,
      value,
    };
  }
  return out;
}

/** The focus pane at a cursor, by scanning backwards for `show`. */
export function modelFocusPane(w: ResolvedWalkthrough, s: number, c: number): string | undefined {
  const focusIds = w.panes.filter((p) => p.role === 'focus').map((p) => p.id);
  let found: string | undefined;
  w.steps.forEach((step, si) =>
    step.calls.forEach((call, ci) => {
      if (si > s || (si === s && ci > c)) return;
      if (call.show !== undefined && focusIds.includes(call.show)) found = call.show;
    }),
  );
  return found ?? focusIds[0];
}

export function cursorsOf(w: ResolvedWalkthrough): { s: number; c: number }[] {
  return w.steps.flatMap((step, s) => step.calls.map((_, c) => ({ s, c })));
}
