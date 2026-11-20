import { effectTarget, type CardSection, type Effect } from '../../core';

const VERB_MARK = { add: 'added', update: 'updated', read: 'read', remove: 'removed' } as const;

/** A card section that lists what the current call did to a pane's elements. */
export function changesSection(
  title: string,
  labels: ReadonlyMap<string, string | undefined>,
  current: readonly Effect[],
): CardSection[] {
  const items: Extract<CardSection, { kind: 'list' }>['items'] = [];
  const seen = new Set<string>();
  for (const effect of current) {
    const { verb, id } = effectTarget(effect);
    if (id === undefined || verb === 'focus') continue;
    const key = `${verb}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ label: labels.get(id) ?? id, entity: id, mark: VERB_MARK[verb] });
  }
  return items.length === 0 ? [] : [{ id: 'changes', title, kind: 'list', items }];
}

/** A patched field as text, or undefined when it is not text. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A tone from a patch or the declaration. "none" clears a tone set earlier. */
export function toneOf(patched: unknown, declared: string | undefined): string | undefined {
  const tone = text(patched) ?? declared;
  return tone === 'none' || tone === '' ? undefined : tone;
}

export const TONES = ['muted', 'warn', 'good', 'none'] as const;

/**
 * Card labels by element id, where two elements that would share a label get their ids added.
 * The card keys its list by label, so a repeated label would repeat a key.
 */
export function uniqueLabels(
  entities: readonly { id: string; label?: string | undefined }[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    const label = entity.label ?? entity.id;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Map(
    entities.map((entity) => {
      const label = entity.label ?? entity.id;
      return [entity.id, (counts.get(label) ?? 0) > 1 ? `${label} (${entity.id})` : label];
    }),
  );
}
