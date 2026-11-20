import { createDiagramPanel } from '../_diagram/panel';

/**
 * flow: steps, decisions and the arrows between them.
 *
 * The whole chart is there from the start, and calls walk through it with
 * `read` (this stage is running) and `update` (this stage changed). A node's
 * `kind` picks its shape: step, decision or terminal.
 */
export const flowPanel = createDiagramPanel({ id: 'flow', initial: true, direction: 'DOWN' });
