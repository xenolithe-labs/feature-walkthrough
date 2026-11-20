import { createDiagramPanel } from '../_diagram/panel';

/**
 * graph: nodes and the relationships between them.
 *
 * `content` lists every node and edge the pane can ever show. Elements start
 * absent and effects add, read, update and remove them by id. An edge is
 * drawn only while both of its ends are shown, so removing a node needs no
 * extra edge effects.
 */
export const graphPanel = createDiagramPanel({ id: 'graph', initial: false, direction: 'RIGHT' });
