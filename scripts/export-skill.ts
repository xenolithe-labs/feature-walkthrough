import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { format } from 'prettier';
import { skillReference } from './skill-reference';

// Panels import their stylesheets. Outside a bundler those are empty modules.
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function load(url, context, next) {
       if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
       return next(url, context);
     }`,
  )}`,
);
const { createRegistry } = await import('../src/registry');

const target = 'skills/feature-walkthrough/reference.md';
writeFileSync(target, await format(skillReference(createRegistry()), { filepath: target }));
console.log(`wrote ${target}`);
