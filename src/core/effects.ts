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

/**
 * The value a record holds under a key of its own. A plain `record[key]` also finds what every
 * object inherits, so an id such as "constructor" would come back as a function.
 */
export function own<T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The effects a call's config writes for a pane. */
export function writtenEffects(call: Call, paneId: string): Effect[] {
  return own(call.effects, paneId) ?? [];
}

/** All effects a call has on a pane: the panel's implicit ones, then the written ones. */
export function effectsOf(pane: ResolvedPane, call: Call): Effect[] {
  const implicit = pane.panel.implicit?.(call, pane.content) ?? [];
  const written = writtenEffects(call, pane.id);
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

/**
 * A copy of a record with one entry set. Built from entries, so a key such as "__proto__" becomes
 * an ordinary key instead of changing what the copy inherits from.
 */
function withEntry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T,
): Record<string, T> {
  return Object.fromEntries([
    ...Object.entries(record).filter(([name]) => name !== key),
    [key, value],
  ]);
}

/** Fields merged in the order they were last written: a field updated again moves to the end. */
function mergeFields(
  old: Readonly<Record<string, unknown>> | undefined,
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const written = new Set(Object.keys(fields));
  return Object.fromEntries([
    ...Object.entries(old ?? {}).filter(([name]) => !written.has(name)),
    ...Object.entries(fields),
  ]);
}

/** Pure reducer over ElementsState. */
export function reduceElements(state: ElementsState, effect: Effect): ElementsState {
  const { verb, id } = effectTarget(effect);
  switch (verb) {
    case 'add':
      return state.present.includes(id!) ? state : { ...state, present: [...state.present, id!] };
    case 'remove': {
      if (!state.present.includes(id!)) return state;
      const patches = Object.fromEntries(
        Object.entries(state.patches).filter(([name]) => name !== id),
      );
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
        patches: withEntry(state.patches, id!, mergeFields(own(state.patches, id!), effect.fields)),
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
