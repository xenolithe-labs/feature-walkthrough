import { Registry } from './core';

/**
 * The panel types and annotation plugins this build ships with.
 * Adding one is a line here and a folder under panels/ or annotations/.
 */
export function createRegistry(): Registry {
  return new Registry();
}
