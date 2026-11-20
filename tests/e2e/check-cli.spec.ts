import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CheckResultSchema } from '../../src/review';
import { demos } from '../../src/walkthroughs';

// Runs the built command line, as a package user would: plain Node, no bundler, no TypeScript.
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['dist/cli/index.js', ...args], { encoding: 'utf8' });

const demo = 'walkthroughs' in demos ? demos.walkthroughs[0]! : demos;

test('the built command line prints one JSON document for check --json on a demo', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fw-check-')), 'demo.json');
  writeFileSync(file, JSON.stringify(demo));
  const result = run('check', file, '--json', '--call', '1.1');
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');

  // stdout holds exactly one document, and it matches the published shape.
  const parsed = CheckResultSchema.parse(JSON.parse(result.stdout));
  const [walkthrough] = parsed.files[0]!.walkthroughs;
  expect(walkthrough!.status).toBe('checked');
  expect(walkthrough!.stats!.calls).toBeGreaterThan(5);
  expect(walkthrough!.trace).toHaveLength(1);
  expect(walkthrough!.trace![0]!.panes.length).toBeGreaterThan(0);
  expect(walkthrough!.trace![0]!.panes.every((pane) => pane.lines.length > 0)).toBe(true);
  expect(parsed.summary.exitCode).toBe(0);
});

test('check exits 1 for a config with errors, 2 when it is called wrongly', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'fw-check-')), 'bad.json');
  writeFileSync(file, JSON.stringify({ id: 'x', title: 'X' }));
  const bad = run('check', file, '--json');
  expect(bad.status).toBe(1);
  expect(CheckResultSchema.parse(JSON.parse(bad.stdout)).summary.errors).toBeGreaterThan(0);
  expect(run('check').status).toBe(2);
  expect(run('check', file, '--only', 'nonsense').status).toBe(2);
});

test('help: the general usage, the details of one command, and an unknown command', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['dist/cli/index.js', ...args], { encoding: 'utf8' });

  const general = run('help');
  expect(general.status).toBe(0);
  for (const command of ['lint', 'check', 'build', 'highlight', 'schema', 'skills', 'help']) {
    expect(general.stdout).toContain(`feature-walkthrough ${command}`);
  }
  // Nothing at all, and --help, say the same.
  expect(run().stdout).toBe(general.stdout);
  expect(run('--help').stdout).toBe(general.stdout);

  for (const command of ['serve', 'lint', 'check', 'build', 'highlight', 'schema', 'skills']) {
    const one = run('help', command);
    expect(one.status, command).toBe(0);
    expect(one.stdout, command).toContain('Usage:');
    expect(one.stdout, command).not.toBe(general.stdout);
    // "<command> --help" is the same text.
    if (command !== 'serve') expect(run(command, '--help').stdout, command).toBe(one.stdout);
  }

  const unknown = run('help', 'nope');
  expect(unknown.status).toBe(2);
  expect(unknown.stderr).toContain('no command named "nope"');
});
