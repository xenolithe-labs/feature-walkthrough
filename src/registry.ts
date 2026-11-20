import { statusAnnotation } from './annotations/status';
import { Registry } from './core';
import { arrayPanel } from './panels/array';
import { boxesPanel } from './panels/boxes';
import { busPanel } from './panels/bus';
import { codePanel } from './panels/code';
import { flowPanel } from './panels/flow';
import { graphPanel } from './panels/graph';
import { payloadPanel } from './panels/payload';
import { ringPanel } from './panels/ring';
import { schemaPanel } from './panels/schema';
import { sequencePanel } from './panels/sequence';
import { tablePanel } from './panels/table';
import { timelinePanel } from './panels/timeline';

/**
 * The panel types and annotation plugins this build ships with.
 * Adding one is a line here and a folder under panels/ or annotations/.
 */
export function createRegistry(): Registry {
  return new Registry()
    .registerPanel(sequencePanel)
    .registerPanel(graphPanel)
    .registerPanel(flowPanel)
    .registerPanel(boxesPanel)
    .registerPanel(tablePanel)
    .registerPanel(codePanel)
    .registerPanel(payloadPanel)
    .registerPanel(schemaPanel)
    .registerPanel(arrayPanel)
    .registerPanel(busPanel)
    .registerPanel(timelinePanel)
    .registerPanel(ringPanel)
    .registerAnnotation(statusAnnotation);
}
