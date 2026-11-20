#!/usr/bin/env node
/**
 * feature-walkthrough [serve] <file>     check a config, then show it in the browser
 * feature-walkthrough lint <file...>     check configs
 * feature-walkthrough build <file>       write one self-contained HTML file
 * feature-walkthrough schema             print the JSON Schema of a config
 *
 * A file is a JSON config, or a JavaScript or TypeScript module whose default
 * export is a config.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { configJsonSchema, formatProblem, loadConfig } from '../src/core';
import { injectConfig } from './inject';

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

const USAGE = `Usage:
  feature-walkthrough <file>                 check the config, then show it in the browser
  feature-walkthrough lint <file...>         check configs; exits 1 if any has an error
  feature-walkthrough build <file> [-o out]  write one self-contained HTML file
  feature-walkthrough schema                 print the JSON Schema of a config

Options:
  -o, --out <path>   where build writes (default: <file name>.html)
  -p, --port <n>     port to serve on (default: 4400, or the next free one)
      --no-open      do not open the browser
  -h, --help         show this text
  -v, --version      show the version

A file is a JSON config, or a JavaScript or TypeScript module whose default export is a config.`;

async function read(file: string): Promise<unknown> {
  const path = resolve(file);
  if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
  // The query makes Node load the module again after it changes.
  const url = `${pathToFileURL(path).href}?t=${Date.now()}`;
  const module = (await import(url)) as { default?: unknown };
  if (module.default === undefined) throw new Error('the module has no default export');
  return module.default;
}

/** Reads and checks one file, printing its problems. */
async function check(file: string): Promise<{ ok: boolean; config?: unknown }> {
  let config: unknown;
  try {
    config = await read(file);
  } catch (error) {
    console.error(
      `${file}: cannot read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false };
  }
  const result = loadConfig(config, createRegistry());
  for (const problem of result.problems) console.error(`${file}: ${formatProblem(problem)}`);
  if (result.ok) console.error(`${file}: ok (${result.walkthroughs.length} walkthrough(s))`);
  return { ok: result.ok, config };
}

/** The built viewer page. It sits beside the built command line. */
function viewer(): string {
  const candidates = ['../viewer/index.html', '../dist/viewer/index.html'].map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  );
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined) throw new Error('the viewer is not built: run "pnpm build" first');
  return readFileSync(found, 'utf8');
}

async function lint(files: string[]): Promise<number> {
  if (files.length === 0) {
    console.error(USAGE);
    return 2;
  }
  let failed = false;
  for (const file of files) if (!(await check(file)).ok) failed = true;
  return failed ? 1 : 0;
}

async function build(file: string, out: string | undefined): Promise<number> {
  const { ok, config } = await check(file);
  if (!ok) return 1;
  const target = out ?? `${basename(file, extname(file))}.html`;
  writeFileSync(target, injectConfig(viewer(), config));
  console.error(`wrote ${target}`);
  return 0;
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

async function serve(file: string, port: number, open: boolean): Promise<number> {
  // Problems are printed, and the page lists them too, so serving goes ahead either way.
  const first = await check(file);
  if (first.config === undefined) return 1;
  const page = viewer();

  const server = createServer((request, response) => {
    if (request.method !== 'GET' || new URL(request.url ?? '/', 'http://x').pathname !== '/') {
      response.writeHead(404).end();
      return;
    }
    // The file is read on every request, so a refresh shows the latest edit.
    read(file).then(
      (config) => {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(injectConfig(page, config));
      },
      (error: unknown) => {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(
          `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  });

  const listening = await new Promise<number>((done, fail) => {
    let tries = 0;
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && tries < 20) {
        tries += 1;
        server.listen(port + tries, '127.0.0.1');
      } else fail(error);
    });
    server.on('listening', () => {
      const address = server.address();
      done(typeof address === 'object' && address !== null ? address.port : port);
    });
    server.listen(port, '127.0.0.1');
  });

  const url = `http://localhost:${listening}/`;
  console.error(`showing ${file} at ${url}  (refresh after editing; Ctrl+C to stop)`);
  if (open) openBrowser(url);
  return new Promise(() => {});
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        port: { type: 'string', short: 'p' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.version) {
    console.log(typeof __VERSION__ === 'undefined' ? 'dev' : __VERSION__);
    return 0;
  }

  const [command, ...rest] = positionals;
  if (command === 'lint') return lint(rest);
  if (command === 'schema') {
    console.log(JSON.stringify(configJsonSchema(), null, 2));
    return 0;
  }
  if (command === 'build') {
    if (rest.length !== 1) {
      console.error(USAGE);
      return 2;
    }
    return build(rest[0]!, values.out);
  }

  // Anything else is a file to show: "serve <file>" or just "<file>".
  const files = command === 'serve' ? rest : positionals;
  if (files.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const port = Number(values.port ?? 4400);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be a number from 1 to 65535, not "${values.port}"`);
    return 2;
  }
  return serve(files[0]!, port, values['no-open'] !== true);
}

process.exitCode = await main(process.argv.slice(2));
