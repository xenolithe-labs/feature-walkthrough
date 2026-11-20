import { touched, type Call, type Effect, type ResolvedPane } from '../core';

/** How many items a generic line lists before it says "and n more". */
const MOST = 12;

function clip(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(clip(value));
  if (value === null || typeof value !== 'object') return String(value);
  return clip(JSON.stringify(value));
}

function list(items: string[], limit = MOST): string {
  return items.length > limit
    ? `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`
    : items.join(', ');
}

/**
 * A description of a pane from its element state alone, for a panel that has no `describe`: which
 * elements are present, and the fields calls have written to them. State that does not keep
 * elements the usual way is shown as clipped JSON.
 */
export function describeGeneric(pane: ResolvedPane, state: unknown, current: Effect[]): string[] {
  const hit = touched(current);
  const mark = (id: string) =>
    hit.added.has(id) || hit.updated.has(id) || hit.read.has(id) || hit.removed.has(id)
      ? `${id}*`
      : id;
  const labels = new Map(pane.entities.map((entity) => [entity.id, entity.label ?? entity.id]));
  const name = (id: string) => {
    const label = labels.get(id);
    return mark(label === undefined || label === id ? id : `${id} (${label})`);
  };

  const record =
    typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
  const present = Array.isArray(record.present)
    ? record.present.filter((id): id is string => typeof id === 'string')
    : undefined;
  if (present === undefined) {
    return [clip(JSON.stringify(state) ?? String(state), 300)];
  }
  const lines = [
    present.length === 0
      ? `nothing present (of ${pane.entities.length})`
      : `present ${present.length} of ${pane.entities.length}: ${list(present.map(name))}`,
  ];
  const removed = [...hit.removed].filter((id) => !present.includes(id));
  if (removed.length > 0) lines.push(`removed: ${list(removed.map(name))}`);
  const patches =
    typeof record.patches === 'object' && record.patches !== null
      ? (record.patches as Record<string, Record<string, unknown>>)
      : {};
  const written = Object.entries(patches).filter(([id]) => present.includes(id));
  // The elements this call touched first, then the others, so the lines that matter are kept.
  written.sort(
    ([a], [b]) =>
      Number(hit.updated.has(b) || hit.read.has(b)) - Number(hit.updated.has(a) || hit.read.has(a)),
  );
  for (const [id, fields] of written.slice(0, 6)) {
    const text = Object.entries(fields)
      .map(([key, value]) => `${key}=${show(value)}`)
      .join(' ');
    lines.push(`${mark(id)}: ${clip(text, 100)}`);
  }
  if (written.length > 6) lines.push(`and ${written.length - 6} more elements with written fields`);
  return lines;
}

/**
 * The lines for one pane at one call: the panel's own `describe`, or the generic one. A panel
 * whose `describe` throws is described generically, with a note, so one bug does not lose a trace.
 */
export function describePane(
  pane: ResolvedPane,
  state: unknown,
  current: Effect[],
  call: Call,
): string[] {
  if (pane.panel.describe === undefined) return describeGeneric(pane, state, current);
  try {
    const lines = pane.panel.describe(state, pane.content, current, call);
    return lines.length > 0 ? lines : ['(nothing to show)'];
  } catch (error) {
    return [
      ...describeGeneric(pane, state, current),
      `(the ${pane.panel.id} panel's describe failed: ${error instanceof Error ? error.message : String(error)})`,
    ];
  }
}
