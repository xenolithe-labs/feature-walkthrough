import { EFFECT_VERBS, type Call, type Effect, type EffectVerb } from './schema';
import type { EntityDecl, ResolvedPane } from './types';

/** The verb of an effect and, for every verb but `set`, the element it names. */
export function effectTarget(effect: Effect): { verb: EffectVerb; id: string | undefined } {
  for (const verb of EFFECT_VERBS) {
    const value = effect[verb];
    if (value === undefined) continue;
    return { verb, id: verb === 'set' ? undefined : (value as string) };
  }
  throw new Error('effect has no verb');
}

/** All effects a call has on a pane: the panel's implicit ones, then the written ones. */
export function effectsOf(pane: ResolvedPane, call: Call): Effect[] {
  const implicit = pane.panel.implicit?.(call, pane.content) ?? [];
  const written = call.effects?.[pane.id] ?? [];
  return implicit.length === 0 ? written : [...implicit, ...written];
}

/**
 * The state most panels need: which declared elements are present, what has
 * been patched onto them, what to centre on, and an optional free-form value.
 */
export interface ElementsState {
  /** Present element ids, in the order they appeared. */
  present: readonly string[];
  /** Fields merged onto elements by `update`. */
  patches: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  focus: string | undefined;
  value: unknown;
}

export function initElements(entities: EntityDecl[], value: unknown = undefined): ElementsState {
  return {
    present: entities.filter((entity) => entity.initial).map((entity) => entity.id),
    patches: {},
    focus: undefined,
    value,
  };
}

/** Pure reducer over ElementsState. */
export function reduceElements(state: ElementsState, effect: Effect): ElementsState {
  const { verb, id } = effectTarget(effect);
  switch (verb) {
    case 'add':
      return state.present.includes(id!) ? state : { ...state, present: [...state.present, id!] };
    case 'remove': {
      if (!state.present.includes(id!)) return state;
      const patches = { ...state.patches };
      delete patches[id!];
      return {
        ...state,
        present: state.present.filter((other) => other !== id),
        patches,
        focus: state.focus === id ? undefined : state.focus,
      };
    }
    case 'update':
      if (effect.fields === undefined) return state;
      return {
        ...state,
        patches: { ...state.patches, [id!]: { ...state.patches[id!], ...effect.fields } },
      };
    case 'focus':
      return { ...state, focus: id };
    case 'set':
      return { ...state, value: effect.set };
    case 'read':
      return state;
  }
}

export interface Touched {
  added: ReadonlySet<string>;
  updated: ReadonlySet<string>;
  read: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  /** True when the call touched anything in this pane. */
  any: boolean;
}

/** Sorts the current call's effects by what they do to which element. */
export function touched(current: Effect[]): Touched {
  const added = new Set<string>();
  const updated = new Set<string>();
  const read = new Set<string>();
  const removed = new Set<string>();
  for (const effect of current) {
    const { verb, id } = effectTarget(effect);
    if (id === undefined) continue;
    if (verb === 'add') added.add(id);
    else if (verb === 'update') updated.add(id);
    else if (verb === 'read') read.add(id);
    else if (verb === 'remove') removed.add(id);
  }
  return {
    added,
    updated,
    read,
    removed,
    any: added.size + updated.size + read.size + removed.size > 0,
  };
}

export type Mark = 'added' | 'updated' | 'read' | 'removed' | 'faded' | 'idle';

/**
 * How to draw one element at the cursor. The fade rule is the same in every
 * panel: when the current call touched something in this pane, everything it
 * did not touch fades.
 */
export function markOf(id: string, current: Touched): Mark {
  if (current.added.has(id)) return 'added';
  if (current.removed.has(id)) return 'removed';
  if (current.updated.has(id)) return 'updated';
  if (current.read.has(id)) return 'read';
  return current.any ? 'faded' : 'idle';
}
