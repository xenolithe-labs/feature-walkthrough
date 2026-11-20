/**
 * What a reader sees in a boxes pane, as text: the boxes that are shown, written nested the way
 * they are drawn (`app[web*, db]`), and the arrows between them.
 */
import { own, type Effect } from '../../core';
import { MOST, cap, clip, elements, hitOf, nested } from '../_shared/describe';

interface BoxesShape {
  boxes: { id: string; label: string; parent?: string | undefined }[];
  edges: { id?: string | undefined; from: string; to: string; label?: string | undefined }[];
}

const edgeId = (edge: BoxesShape['edges'][number]) => edge.id ?? `${edge.from}.${edge.to}`;

export function describeBoxes(state: unknown, content: BoxesShape, current: Effect[]): string[] {
  const { present, patches } = elements(state);
  const here = new Set(present);
  const hit = hitOf(current);
  const gone = (id: string) => hit.removed.has(id);
  const shown = content.boxes.filter((box) => here.has(box.id) || gone(box.id));
  const text = nested(
    shown.map((box) => {
      const patch = own(patches, box.id);
      const label = typeof patch?.label === 'string' ? patch.label : box.label;
      const tone = typeof patch?.tone === 'string' && patch.tone !== 'none' ? ` ${patch.tone}` : '';
      return {
        id: box.id,
        parent: box.parent,
        text: `${box.id === label ? box.id : `${box.id} "${clip(label, 24)}"`}${tone}${hit.has(box.id) ? '*' : ''}${gone(box.id) ? ' (removed)' : ''}`,
      };
    }),
  );
  const lines = [
    `boxes ${shown.length} of ${content.boxes.length}: ${text === '' ? 'none' : clip(text, 300)}`,
  ];
  const edges = content.edges.filter((edge) => here.has(edgeId(edge)) || gone(edgeId(edge)));
  if (edges.length > 0) {
    lines.push(
      `arrows: ${cap(
        edges.map(
          (edge) =>
            `${edge.from} -> ${edge.to}${edge.label === undefined ? '' : ` "${clip(edge.label, 24)}"`}${hit.has(edgeId(edge)) ? '*' : ''}`,
        ),
        MOST,
      )}`,
    );
  }
  return lines;
}
