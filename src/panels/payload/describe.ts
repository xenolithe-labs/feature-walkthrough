/**
 * What a reader sees in a payload pane, as text: the payloads that are shown, and for the ones
 * the current call touches the fields it marks with their values now.
 */
import { effectTarget, own, type Effect } from '../../core';
import { MOST, cap, clip, elements, hitOf, marked, show } from '../_shared/describe';
import { isRef, patched, splitPath } from './paths';

interface PayloadShape {
  payloads: { id: string; title: string; value: unknown }[];
}

function valueAt(value: unknown, path: string): unknown {
  let at = value;
  for (const key of splitPath(path)) {
    if (typeof at !== 'object' || at === null || isRef(at)) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

export function describePayload(
  state: unknown,
  content: PayloadShape,
  current: Effect[],
): string[] {
  const { present, patches } = elements(state);
  const hit = hitOf(current);
  const names = content.payloads
    .filter((payload) => present.includes(payload.id) || hit.removed.has(payload.id))
    .map((payload) => `${payload.id}${hit.has(payload.id) ? '*' : ''}`);
  const lines = [`payloads shown: ${names.length === 0 ? 'none' : cap(names)}`];

  for (const payload of content.payloads.filter((item) => hit.has(item.id)).slice(0, 4)) {
    const now = patched(payload.value, own(patches, payload.id));
    const paths = new Set<string>();
    for (const effect of current) {
      if (effectTarget(effect).id !== payload.id) continue;
      if (Array.isArray(effect.paths)) {
        for (const path of effect.paths) if (typeof path === 'string') paths.add(path);
      }
      if (effect.update !== undefined) {
        for (const path of Object.keys(effect.fields ?? {})) if (path !== 'tone') paths.add(path);
      }
    }
    if (paths.size === 0) {
      lines.push(
        `${payload.title}: whole payload ${hit.removed.has(payload.id) ? 'removed' : 'marked'}`,
      );
      continue;
    }
    for (const path of [...paths].slice(0, MOST)) {
      const value = valueAt(now, path);
      const text = isRef(value) ? (value.text ?? value.$ref) : clip(show(value), 60);
      lines.push(`${payload.title}.${path} = ${marked(text, true)}`);
    }
    if (paths.size > MOST) lines.push(`and ${paths.size - MOST} more fields marked`);
  }
  return lines;
}
