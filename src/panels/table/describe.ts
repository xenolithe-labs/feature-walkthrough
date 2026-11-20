/**
 * What a reader sees in a table pane, as text: the rows that are shown, with their cells, and
 * which rows and cells the current call touched. Rows the call touched come first.
 */
import { effectTarget, own, type Effect } from '../../core';
import { MOST, elements, hitOf, marked, show } from '../_shared/describe';

interface TableShape {
  columns: { id: string; label: string }[];
  rows: { id: string; cells: Record<string, string> }[];
}

export function describeTable(state: unknown, content: TableShape, current: Effect[]): string[] {
  const { present, patches } = elements(state);
  const hit = hitOf(current);
  const shownIds = new Set(present);
  const rows = content.rows.filter((row) => shownIds.has(row.id) || hit.removed.has(row.id));

  // Cells the call touched, by row.
  const cells = new Map<string, Set<string>>();
  for (const effect of current) {
    const { verb, id } = effectTarget(effect);
    const keys =
      verb === 'update'
        ? Object.keys(effect.fields ?? {})
        : verb === 'read' && Array.isArray(effect.cells)
          ? effect.cells.filter((key): key is string => typeof key === 'string')
          : [];
    const set = cells.get(id) ?? new Set<string>();
    for (const key of keys) set.add(key);
    cells.set(id, set);
  }
  const columnsHit = content.columns
    .filter((column) => hit.read.has(`col.${column.id}`))
    .map((column) => column.id);

  const order = [...rows].sort((a, b) => Number(hit.has(b.id)) - Number(hit.has(a.id)));
  const lines = [
    `${rows.length - [...hit.removed].filter((id) => rows.some((row) => row.id === id)).length} of ${content.rows.length} rows shown; columns: ${content.columns
      .map((column) => (columnsHit.includes(column.id) ? `${column.id}*` : column.id))
      .join(', ')}`,
  ];
  for (const row of order.slice(0, MOST)) {
    const touchedCells = cells.get(row.id) ?? new Set<string>();
    const tag = hit.added.has(row.id)
      ? ' (added)'
      : hit.removed.has(row.id)
        ? ' (removed)'
        : hit.updated.has(row.id)
          ? ' (updated)'
          : hit.read.has(row.id)
            ? ' (read)'
            : '';
    const patch = own(patches, row.id);
    const text = content.columns
      .map((column) => {
        const value = show(own(patch, column.id) ?? own(row.cells, column.id) ?? '');
        return `${column.id}=${marked(value, touchedCells.has(column.id))}`;
      })
      .join(' ');
    const tone =
      typeof patch?.tone === 'string' && patch.tone !== 'none' ? ` tone=${patch.tone}` : '';
    lines.push(`${row.id}${tag}: ${text}${tone}`);
  }
  if (order.length > MOST) lines.push(`and ${order.length - MOST} more rows`);
  return lines;
}
