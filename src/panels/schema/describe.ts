/**
 * What a reader sees in a schema pane, as text: each table that is shown with its columns (name,
 * type, key badge), and the relations drawn between them, marking what the call touched.
 */
import { own, type Effect } from '../../core';
import { MOST, cap, clip, elements, hitOf } from '../_shared/describe';

interface SchemaShape {
  tables: {
    id: string;
    label: string;
    columns: { id: string; label?: string | undefined; type?: string | undefined; key?: string | undefined }[];
  }[];
  relations: { id?: string | undefined; from: string; to: string; label?: string | undefined }[];
}

const relationId = (relation: SchemaShape['relations'][number]) =>
  relation.id ?? `${relation.from}:${relation.to}`;

export function describeSchema(state: unknown, content: SchemaShape, current: Effect[]): string[] {
  const { present, patches } = elements(state);
  const here = new Set(present);
  const hit = hitOf(current);
  const gone = (id: string) => hit.removed.has(id);
  const lines: string[] = [];
  const tables = content.tables.filter((table) => here.has(table.id) || gone(table.id));
  lines.push(`tables ${tables.length} of ${content.tables.length}`);
  for (const table of tables.slice(0, 8)) {
    const columns = table.columns
      .filter((column) => here.has(`${table.id}.${column.id}`) || gone(`${table.id}.${column.id}`))
      .map((column) => {
        const id = `${table.id}.${column.id}`;
        const patch = own(patches, id);
        const type = typeof patch?.type === 'string' ? patch.type : column.type;
        const key = column.key === undefined ? '' : `${column.key} `;
        return `${key}${column.label ?? column.id}${type === undefined ? '' : `:${type}`}${hit.has(id) ? '*' : ''}`;
      });
    lines.push(
      `${table.id}${hit.has(table.id) ? '*' : ''}${gone(table.id) ? ' (removed)' : ''}: ${clip(columns.join(', '), 200) || 'no columns'}`,
    );
  }
  if (tables.length > 8) lines.push(`and ${tables.length - 8} more tables`);
  const relations = content.relations.filter(
    (relation) => here.has(relationId(relation)) || gone(relationId(relation)),
  );
  if (relations.length > 0) {
    lines.push(
      `relations: ${cap(
        relations.map(
          (relation) =>
            `${relation.from} -> ${relation.to}${relation.label === undefined ? '' : ` "${clip(relation.label, 24)}"`}${hit.has(relationId(relation)) ? '*' : ''}`,
        ),
        MOST,
      )}`,
    );
  }
  return lines;
}
