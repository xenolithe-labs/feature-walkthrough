import { statusAnnotation } from './annotations/status';
import { Registry } from './core';
import { arrayPanel } from './panels/array';
import { boxesPanel } from './panels/boxes';
import { codePanel } from './panels/code';
import { flowPanel } from './panels/flow';
import { graphPanel } from './panels/graph';
import { payloadPanel } from './panels/payload';
import { schemaPanel } from './panels/schema';
import { sequencePanel } from './panels/sequence';
import { tablePanel } from './panels/table';

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
    .registerAnnotation(statusAnnotation);
}
