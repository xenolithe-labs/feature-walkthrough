/**
 * What a reader sees in a tree pane, as text: the outline, one node per line, indented by depth,
 * with the nodes the call touched marked, and a note for each collapsed node about what it hides.
 */
import { own, type Effect } from '../../core';
import { clip, elements, hitOf } from '../_shared/describe';
import { treeRows, type NodeDecl } from './model';

interface TreeShape {
  nodes: (NodeDecl & { label: string; kind?: string | undefined })[];
}

const MOST_ROWS = 16;

export function describeTree(state: unknown, content: TreeShape, current: Effect[]): string[] {
  const { present, patches } = elements(state);
  const hit = hitOf(current);
  const touchedIds = new Set(content.nodes.map((node) => node.id).filter((id) => hit.has(id)));
  const shown = new Set([...present, ...hit.removed]);
  const rows = treeRows({ nodes: content.nodes, patches, shown, touched: touchedIds }).filter(
    (row) => row.shown,
  );
  const byId = new Map(content.nodes.map((node) => [node.id, node]));
  const lines = [`${present.length} of ${content.nodes.length} nodes shown`];
  for (const row of rows.slice(0, MOST_ROWS)) {
    const node = byId.get(row.id)!;
    const patch = own(patches, node.id);
    const label = typeof patch?.label === 'string' ? patch.label : node.label;
    const kind = node.kind === undefined ? '' : `${node.kind} `;
    const hidden =
      row.hidden > 0
        ? ` (+${row.hidden} hidden${row.hiddenTouched > 0 ? `, ${row.hiddenTouched} touched` : ''})`
        : '';
    const removed = hit.removed.has(node.id) ? ' (removed)' : '';
    lines.push(
      `${'  '.repeat(row.depth)}${kind}${clip(label, 40)}${hit.has(node.id) ? '*' : ''}${removed}${hidden}`,
    );
  }
  if (rows.length > MOST_ROWS) lines.push(`and ${rows.length - MOST_ROWS} more rows`);
  return lines;
}
