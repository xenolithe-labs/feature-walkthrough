/**
 * `feature-walkthrough check`: reads the files, asks the checker in src/review/, prints.
 * Exit codes: 0 clean, 1 config errors (or too many warnings), 2 a mistake in how it was called.
 */
import type { Registry } from '../src/core';
import {
  GROUPS,
  buildResult,
  formatCheckText,
  reviewConfig,
  unreadable,
  type FileReview,
  type FindingProvider,
  type Group,
} from '../src/review';

export interface CheckArgs {
  files: string[];
  json: boolean;
  call: string | undefined;
  only: string | undefined;
  maxWarnings: string | undefined;
  trace: boolean;
}

export interface CheckDeps {
  read(file: string): Promise<unknown>;
  registry: Registry;
  providers: readonly FindingProvider[];
  version: string;
  out(text: string): void;
  err(text: string): void;
}

export const CHECK_USAGE = `Usage:
  feature-walkthrough check <file...> [--json] [--call <step>.<call>] [--only <group,...>] [--max-warnings <n>]

  Everything lint reports, plus design findings, stats and a trace of what a reader sees.

  --json                 print one JSON document (schema/check-result.schema.json) and nothing else
  --call <step>.<call>   trace that call: "<step id>.<call id>", or "<step number>.<call number>"
  --trace                trace every call (long)
  --only <group,...>     only these groups: ${GROUPS.join(', ')}. Config errors are always reported
  --max-warnings <n>     exit 1 if there are more than n warnings (lint and design; infos do not count)

  Exit codes: 0 clean, 1 config errors or too many warnings, 2 usage error.`;

function parseOnly(text: string | undefined): Group[] | string {
  if (text === undefined) return [];
  const names = text.split(',').map((name) => name.trim());
  const bad = names.filter((name) => !(GROUPS as readonly string[]).includes(name));
  if (bad.length > 0 || names.length === 0) {
    return `--only takes some of ${GROUPS.join(', ')}; not "${bad.join('", "') || text}"`;
  }
  return names as Group[];
}

export async function runCheck(args: CheckArgs, deps: CheckDeps): Promise<number> {
  const usage = (message: string) => {
    deps.err(`${message}\n${CHECK_USAGE}`);
    return 2;
  };
  if (args.files.length === 0) return usage('check needs at least one file');
  const only = parseOnly(args.only);
  if (typeof only === 'string') return usage(only);
  let maxWarnings: number | undefined;
  if (args.maxWarnings !== undefined) {
    maxWarnings = Number(args.maxWarnings);
    if (!Number.isInteger(maxWarnings) || maxWarnings < 0) {
      return usage(`--max-warnings takes a whole number, 0 or more, not "${args.maxWarnings}"`);
    }
  }
  if (args.call !== undefined && !/^[^.\s]+\.[^.\s]+$/.test(args.call)) {
    return usage(`--call takes "<step id>.<call id>", for example s1.c2; not "${args.call}"`);
  }

  const options = {
    only,
    call: args.call,
    trace: args.trace,
    providers: deps.providers,
  };
  const files: FileReview[] = [];
  for (const file of args.files) {
    let config: unknown;
    try {
      config = await deps.read(file);
    } catch (error) {
      files.push(unreadable(file, error instanceof Error ? error.message : String(error)));
      continue;
    }
    files.push(await reviewConfig(file, config, deps.registry, options));
  }

  if (args.call !== undefined) {
    const checked = files.flatMap((file) =>
      file.walkthroughs.filter((walkthrough) => walkthrough.status === 'checked'),
    );
    const found = checked.some((walkthrough) => (walkthrough.trace ?? []).length > 0);
    if (checked.length > 0 && !found) {
      return usage(
        `no call matches --call ${args.call}. Calls are named "<step id>.<call id>", as in the "call" of a finding or the key of a trace`,
      );
    }
  }

  const result = buildResult(files, { ...options, version: deps.version, maxWarnings });
  deps.out(args.json ? JSON.stringify(result, null, 2) : formatCheckText(result));
  return result.summary.exitCode;
}
