/**
 * `check` as a library: a config in, a result out. The command line only reads files and prints.
 */
import {
  formatPath,
  loadConfig,
  type PathSegment,
  type Problem,
  type Registry,
  type ResolvedWalkthrough,
} from '../core';
import { analyse } from './analysis';
import { designFindings } from './design';
import { runProviders, type FindingProvider } from './providers';
import {
  CHECK_SCHEMA_VERSION,
  type CheckResult,
  type FileReview,
  type WalkthroughReview,
} from './schema';
import { statsOf } from './stats';
import { STAGE_CAPACITY, selectCalls, traceOf } from './trace';
import type { Finding } from './types';

export const GROUPS = ['problems', 'design', 'layout', 'stats', 'trace'] as const;
export type Group = (typeof GROUPS)[number];

export interface ReviewOptions {
  /** Groups to produce. Empty or left out: every group but the trace. */
  only?: readonly Group[];
  /** A call to trace: "<step id>.<call id>", or "<step number>.<call number>". Turns the trace on. */
  call?: string | undefined;
  /** Trace every call. */
  trace?: boolean;
  /** Async checks that need the resolved walkthrough, such as layout. See providers.ts. */
  providers?: readonly FindingProvider[];
  providerTimeoutMs?: number;
  stageCapacity?: number;
}

/** Fields in the order a person reads them: what, where, then the words. */
const toProblem = (problem: Problem) => ({
  severity: problem.severity,
  rule: problem.rule,
  at: formatPath(problem.path),
  path: problem.path,
  message: problem.message,
});

const toFinding = (finding: Finding) => ({
  severity: finding.severity,
  rule: finding.rule,
  group: finding.group,
  at: formatPath(finding.path),
  path: finding.path,
  ...(finding.call === undefined ? {} : { call: finding.call }),
  ...(finding.count === undefined ? {} : { count: finding.count }),
  message: finding.message,
  source: finding.source,
});

function wants(options: ReviewOptions, group: Group): boolean {
  if (group === 'trace') {
    return (
      options.trace === true ||
      options.call !== undefined ||
      options.only?.includes('trace') === true
    );
  }
  return options.only === undefined || options.only.length === 0 || options.only.includes(group);
}

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const startsWith = (path: PathSegment[], prefix: PathSegment[]) =>
  prefix.every((segment, index) => path[index] === segment);

/** A problem about the walkthrough's own id in a collection says nothing about its content. */
const isIdClash = (problem: Problem, prefix: PathSegment[]) =>
  problem.rule === 'duplicate-id' &&
  problem.path.length === prefix.length + 1 &&
  problem.path[prefix.length] === 'id';

async function reviewOne(
  resolved: ResolvedWalkthrough | undefined,
  entry: Pick<WalkthroughReview, 'index' | 'id' | 'title' | 'path'>,
  problems: Problem[],
  options: ReviewOptions,
): Promise<WalkthroughReview> {
  const base: WalkthroughReview = {
    ...entry,
    status: resolved === undefined ? 'not-checked' : 'checked',
  };
  // Errors are always reported: they decide the exit code, and no selection should hide them.
  const shown = wants(options, 'problems')
    ? problems
    : problems.filter((problem) => problem.severity === 'error');
  if (shown.length > 0 || wants(options, 'problems')) base.problems = shown.map(toProblem);
  if (resolved === undefined) return base;

  const analysis = analyse(resolved, entry.path);
  const findings: Finding[] = [];
  if (wants(options, 'design')) findings.push(...designFindings(analysis));
  if (wants(options, 'layout') && options.providers !== undefined && options.providers.length > 0) {
    findings.push(
      ...(await runProviders(options.providers, resolved, entry.path, options.providerTimeoutMs)),
    );
  }
  if (wants(options, 'design') || wants(options, 'layout')) base.findings = findings.map(toFinding);
  if (wants(options, 'stats')) base.stats = statsOf(analysis);
  if (wants(options, 'trace')) {
    const chosen =
      options.call === undefined ? analysis.calls : selectCalls(analysis, options.call);
    // A walkthrough that has no such call (in a file of several) gets no trace at all.
    if (options.call === undefined || chosen.length > 0) {
      base.trace = traceOf(analysis, chosen, options.stageCapacity ?? STAGE_CAPACITY);
    }
  }
  return base;
}

/** Checks one parsed config (one walkthrough, or `{ walkthroughs: [...] }`). Never throws on a bad config. */
export async function reviewConfig(
  file: string,
  input: unknown,
  registry: Registry,
  options: ReviewOptions = {},
): Promise<FileReview> {
  const loaded = loadConfig(input, registry);
  const collection = isRecord(input) && 'walkthroughs' in input;
  const items: unknown[] = collection
    ? Array.isArray(input.walkthroughs)
      ? (input.walkthroughs as unknown[])
      : []
    : [input];
  const prefixOf = (index: number): PathSegment[] => (collection ? ['walkthroughs', index] : []);

  const own = (index: number) =>
    loaded.problems.filter((problem) =>
      collection ? startsWith(problem.path, prefixOf(index)) : true,
    );
  const failed = items.map((_, index) =>
    own(index).some(
      (problem) => problem.severity === 'error' && !isIdClash(problem, prefixOf(index)),
    ),
  );

  // loadConfig resolves nothing in a collection when any one walkthrough fails to parse, and
  // then reports only the parse errors. The others can still be checked, so each is loaded on
  // its own, and its own problems (a lint error, a warning) are reported with the prefix.
  let resolved: (ResolvedWalkthrough | undefined)[];
  const extra = new Map<number, Problem[]>();
  const clean = failed.filter((flag) => !flag).length;
  if (loaded.walkthroughs.length === clean) {
    let next = 0;
    resolved = failed.map((flag) => (flag ? undefined : loaded.walkthroughs[next++]));
  } else {
    resolved = items.map((item, index) => {
      if (failed[index]) return undefined;
      const alone = loadConfig(item, registry);
      extra.set(
        index,
        alone.problems.map((problem) => ({
          ...problem,
          path: [...prefixOf(index), ...problem.path],
        })),
      );
      return alone.walkthroughs[0];
    });
  }

  const walkthroughs = await Promise.all(
    items.map((item, index) =>
      reviewOne(
        resolved[index],
        {
          index,
          id: isRecord(item) && typeof item.id === 'string' ? item.id : null,
          title: isRecord(item) && typeof item.title === 'string' ? item.title : null,
          path: prefixOf(index),
        },
        [...own(index), ...(extra.get(index) ?? [])],
        options,
      ),
    ),
  );
  const rootProblems = collection
    ? loaded.problems.filter(
        (problem) => !(problem.path[0] === 'walkthroughs' && typeof problem.path[1] === 'number'),
      )
    : [];
  return { file, problems: rootProblems.map(toProblem), walkthroughs };
}

/** A file that could not be read or parsed. */
export function unreadable(file: string, reason: string): FileReview {
  return { file, readError: reason, problems: [], walkthroughs: [] };
}

export interface BuildOptions extends ReviewOptions {
  version: string;
  maxWarnings?: number | undefined;
}

/** Totals, the exit code and the document `--json` prints. */
export function buildResult(files: FileReview[], options: BuildOptions): CheckResult {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let walkthroughs = 0;
  let unread = 0;
  for (const file of files) {
    if (file.readError !== undefined) unread += 1;
    for (const problem of file.problems) {
      if (problem.severity === 'error') errors += 1;
      else warnings += 1;
    }
    for (const walkthrough of file.walkthroughs) {
      walkthroughs += 1;
      for (const problem of walkthrough.problems ?? []) {
        if (problem.severity === 'error') errors += 1;
        else warnings += 1;
      }
      for (const finding of walkthrough.findings ?? []) {
        if (finding.severity === 'warning') warnings += 1;
        else infos += 1;
      }
    }
  }
  let exitCode: 0 | 1 = 0;
  let reason = '';
  if (errors > 0 || unread > 0) {
    exitCode = 1;
    reason = [
      errors > 0 ? `${errors} config error${errors === 1 ? '' : 's'}` : '',
      unread > 0 ? `${unread} file${unread === 1 ? '' : 's'} could not be read` : '',
    ]
      .filter(Boolean)
      .join(', ');
  } else if (options.maxWarnings !== undefined && warnings > options.maxWarnings) {
    exitCode = 1;
    reason = `${warnings} warnings, more than --max-warnings ${options.maxWarnings}`;
  }
  return {
    schemaVersion: CHECK_SCHEMA_VERSION,
    tool: 'feature-walkthrough',
    version: options.version,
    options: {
      only: [...(options.only ?? [])],
      call: options.call ?? null,
      maxWarnings: options.maxWarnings ?? null,
      stageCapacity: options.stageCapacity ?? STAGE_CAPACITY,
    },
    files,
    summary: { files: files.length, walkthroughs, errors, warnings, infos, exitCode, reason },
  };
}
