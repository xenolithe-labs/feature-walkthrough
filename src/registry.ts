import { statusAnnotation } from './annotations/status';
import { Registry } from './core';
import { graphPanel } from './panels/graph';
import { sequencePanel } from './panels/sequence';

/**
 * The panel types and annotation plugins this build ships with.
 * Adding one is a line here and a folder under panels/ or annotations/.
 */
export function createRegistry(): Registry {
  return new Registry()
    .registerPanel(sequencePanel)
    .registerPanel(graphPanel)
    .registerAnnotation(statusAnnotation);
}
