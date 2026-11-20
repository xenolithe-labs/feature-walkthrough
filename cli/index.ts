/**
 * walkthrough lint <file...>
 *
 * Checks JSON configs, or TypeScript/JavaScript modules whose default export
 * is a config. Exits 1 when any file has an error.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatProblem, loadConfig } from '../src/core';

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

async function read(file: string): Promise<unknown> {
  const path = resolve(file);
  if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
  const module = (await import(pathToFileURL(path).href)) as { default?: unknown };
  if (module.default === undefined) throw new Error('the module has no default export');
  return module.default;
}

async function lint(files: string[]): Promise<number> {
  if (files.length === 0) {
    console.error('usage: walkthrough lint <file...>');
    return 2;
  }
  const registry = createRegistry();
  let failed = false;
  for (const file of files) {
    let config: unknown;
    try {
      config = await read(file);
    } catch (error) {
      console.error(
        `${file}: cannot read: ${error instanceof Error ? error.message : String(error)}`,
      );
      failed = true;
      continue;
    }
    const result = loadConfig(config, registry);
    for (const problem of result.problems) console.error(`${file}: ${formatProblem(problem)}`);
    if (result.ok) console.log(`${file}: ok (${result.walkthroughs.length} walkthrough(s))`);
    else failed = true;
  }
  return failed ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'lint') {
  process.exitCode = await lint(rest);
} else {
  console.error('usage: walkthrough lint <file...>');
  process.exitCode = 2;
}
