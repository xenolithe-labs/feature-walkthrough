/**
 * What a reader sees in a graph or flow pane, as text: the nodes that are shown (nested in their
 * groups, with their tone and any changed label), the records' slots with their values, and the
 * edges that are drawn, marking what the current call touched.
 */
import { own, type Effect } from '../../core';
import { MOST, cap, clip, elements, hitOf, nested, show } from '../_shared/describe';

interface DiagramShape {
  nodes: {
    id: string;
    label: string;
    parent?: string | undefined;
    kind?: string | undefined;
    slots?: { id: string; value?: string | number | undefined }[] | undefined;
  }[];
  edges: { id?: string | undefined; from: string; to: string; label?: string | undefined }[];
}

const edgeId = (edge: DiagramShape['edges'][number]) => edge.id ?? `${edge.from}.${edge.to}`;

export function describeDiagram(
  state: unknown,
  content: DiagramShape,
  current: Effect[],
): string[] {
  const { present, patches } = elements(state);
  const here = new Set(present);
  const hit = hitOf(current);
  const gone = (id: string) => hit.removed.has(id);
  const shown = content.nodes.filter((node) => here.has(node.id) || gone(node.id));
  const lines: string[] = [];

  const name = (node: DiagramShape['nodes'][number]) => {
    const patch = own(patches, node.id);
    const label = typeof patch?.label === 'string' ? patch.label : node.label;
    const tone = typeof patch?.tone === 'string' && patch.tone !== 'none' ? ` ${patch.tone}` : '';
    const kind = node.kind === undefined || node.kind === 'step' ? '' : ` ${node.kind}`;
    const shownName = label === node.id ? node.id : `${node.id} "${clip(label, 30)}"`;
    return `${shownName}${kind}${tone}${hit.has(node.id) ? '*' : ''}${gone(node.id) ? ' (removed)' : ''}`;
  };
  const tree = nested(
    shown.map((node) => ({ id: node.id, parent: node.parent, text: name(node) })),
  );
  lines.push(
    `nodes ${shown.length} of ${content.nodes.length}: ${tree === '' ? 'none' : clip(tree, 300)}`,
  );

  for (const node of shown
    .filter((item) => item.slots !== undefined && item.slots.length > 0)
    .slice(0, 6)) {
    const slots = node.slots!.map((slot) => {
      const id = `${node.id}.${slot.id}`;
      const patch = own(patches, id);
      const value = show(patch?.value ?? slot.value ?? '');
      return `${slot.id}=${hit.has(id) ? `>${value}<` : value}`;
    });
    lines.push(`${node.id}: ${slots.join(' ')}`);
  }

  const edges = content.edges.filter((edge) => here.has(edgeId(edge)) || gone(edgeId(edge)));
  if (content.edges.length > 0) {
    lines.push(
      `edges ${edges.length} of ${content.edges.length}${
        edges.length === 0
          ? ''
          : `: ${cap(
              edges.map(
                (edge) =>
                  `${edge.from} -> ${edge.to}${edge.label === undefined ? '' : ` "${clip(edge.label, 24)}"`}${hit.has(edgeId(edge)) ? '*' : ''}${gone(edgeId(edge)) ? ' (removed)' : ''}`,
              ),
              MOST,
            )}`
      }`,
    );
  }
  return lines;
}
