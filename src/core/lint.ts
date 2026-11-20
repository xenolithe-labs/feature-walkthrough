/**
 * Turns raw config into walkthroughs bound to registered panel types, and
 * reports every problem with the path where it is.
 *
 * Rules:
 *   schema              the shape is wrong
 *   duplicate-id        two panes, lanes, steps or calls share an id
 *   unknown-panel       a pane names a panel type that is not registered
 *   unknown-pane        effects, a summary or `show` name a pane that is not in the layout
 *   unknown-lane        `from` or `to` name a lane that is not declared
 *   unknown-id          an effect names an element that is not in the pane's content
 *   show-not-focus      `show` names a pane whose role is not "focus"
 *   absent-element      an effect reads, updates, removes or focuses an element that is not present yet
 *   already-present     (warning) an effect adds an element that is already present
 *   summary-mismatch    a step summary differs from the union of its calls' effects
 *   unknown-annotation  annotation data or config names a plugin that is not registered
 * Panel types and annotation plugins add their own rules through `lint`.
 */
import type { ZodError } from 'zod';
import { effectTarget, effectsOf } from './effects';
import type { Registry } from './registry';
import {
  CollectionSchema,
  EffectSchema,
  WalkthroughSchema,
  type Effect,
  type Step,
  type Walkthrough,
} from './schema';
import type {
  PathSegment,
  Problem,
  ResolvedAnnotation,
  ResolvedPane,
  ResolvedWalkthrough,
} from './types';

export interface LoadResult {
  /** Walkthroughs that have no errors and can be shown. */
  walkthroughs: ResolvedWalkthrough[];
  problems: Problem[];
  /** True when there is no error (warnings are allowed). */
  ok: boolean;
}

export function formatPath(path: PathSegment[]): string {
  let text = '';
  for (const segment of path) {
    if (typeof segment === 'number') text += `[${segment}]`;
    else text += text === '' ? segment : `.${segment}`;
  }
  return text === '' ? '(root)' : text;
}

export function formatProblem(problem: Problem): string {
  return `${problem.severity} ${problem.rule} at ${formatPath(problem.path)}: ${problem.message}`;
}

function fromZod(error: ZodError, prefix: PathSegment[], rule = 'schema'): Problem[] {
  return error.issues.map((issue) => ({
    severity: 'error',
    rule,
    path: [...prefix, ...issue.path.map((key) => (typeof key === 'number' ? key : String(key)))],
    message: issue.message,
  }));
}

function quoteList(ids: readonly string[]): string {
  return ids.length === 0 ? '(none)' : ids.map((id) => `"${id}"`).join(', ');
}

function duplicates(
  items: readonly { id: string }[],
  what: string,
  pathOf: (index: number) => PathSegment[],
): Problem[] {
  const seen = new Set<string>();
  const problems: Problem[] = [];
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      problems.push({
        severity: 'error',
        rule: 'duplicate-id',
        path: [...pathOf(index), 'id'],
        message: `${what} id "${item.id}" is used more than once`,
      });
    }
    seen.add(item.id);
  });
  return problems;
}

function resolvePanes(
  walkthrough: Walkthrough,
  registry: Registry,
  prefix: PathSegment[],
  problems: Problem[],
): Map<string, ResolvedPane> {
  const panes = new Map<string, ResolvedPane>();
  walkthrough.layout.panes.forEach((pane, index) => {
    const path = [...prefix, 'layout', 'panes', index];
    const panel = registry.panel(pane.panel);
    if (panel === undefined) {
      problems.push({
        severity: 'error',
        rule: 'unknown-panel',
        path: [...path, 'panel'],
        message: `panel type "${pane.panel}" is not registered. Registered: ${quoteList(registry.panelIds())}`,
      });
      return;
    }
    const content = panel.schema.content.safeParse(pane.content);
    if (!content.success) {
      problems.push(...fromZod(content.error, [...path, 'content']));
      return;
    }
    const entities = panel.entities(content.data, walkthrough);
    const seen = new Set<string>();
    for (const entity of entities) {
      if (seen.has(entity.id)) {
        problems.push({
          severity: 'error',
          rule: 'duplicate-id',
          path: [...path, 'content'],
          message: `element id "${entity.id}" is used more than once in pane "${pane.id}"`,
        });
      }
      seen.add(entity.id);
    }
    if (!panes.has(pane.id)) {
      panes.set(pane.id, {
        id: pane.id,
        title: pane.title ?? pane.id,
        role: pane.role,
        panel,
        content: content.data,
        entities,
      });
    }
  });
  return panes;
}

function resolveAnnotations(
  walkthrough: Walkthrough,
  registry: Registry,
  prefix: PathSegment[],
  problems: Problem[],
): ResolvedAnnotation[] {
  const used = new Set<string>(Object.keys(walkthrough.annotations ?? {}));
  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      for (const id of Object.keys(call.annotations ?? {})) {
        if (registry.annotation(id) === undefined) {
          problems.push({
            severity: 'error',
            rule: 'unknown-annotation',
            path: [...prefix, 'steps', s, 'calls', c, 'annotations', id],
            message: `annotation plugin "${id}" is not registered. Registered: ${quoteList(registry.annotationIds())}`,
          });
        }
        used.add(id);
      }
    });
  });

  const resolved: ResolvedAnnotation[] = [];
  for (const id of used) {
    const plugin = registry.annotation(id);
    if (plugin === undefined) {
      if (walkthrough.annotations?.[id] !== undefined) {
        problems.push({
          severity: 'error',
          rule: 'unknown-annotation',
          path: [...prefix, 'annotations', id],
          message: `annotation plugin "${id}" is not registered. Registered: ${quoteList(registry.annotationIds())}`,
        });
      }
      continue;
    }
    const config = plugin.schema.config.safeParse(walkthrough.annotations?.[id]);
    if (!config.success) {
      problems.push(...fromZod(config.error, [...prefix, 'annotations', id]));
      continue;
    }
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        const data: unknown = call.annotations?.[id];
        if (data === undefined) return;
        const parsed = plugin.schema.call.safeParse(data);
        if (!parsed.success) {
          problems.push(
            ...fromZod(parsed.error, [...prefix, 'steps', s, 'calls', c, 'annotations', id]),
          );
        }
      });
    });
    resolved.push({ plugin, config: config.data });
  }
  return resolved;
}

const SUMMARY_VERBS = ['add', 'update', 'read', 'remove'] as const;

function checkSummary(
  step: Step,
  panes: Map<string, ResolvedPane>,
  stepPath: PathSegment[],
  problems: Problem[],
): void {
  if (step.summary === undefined) return;
  for (const paneId of Object.keys(step.summary)) {
    if (!panes.has(paneId)) {
      problems.push({
        severity: 'error',
        rule: 'unknown-pane',
        path: [...stepPath, 'summary', paneId],
        message: `pane "${paneId}" is not in the layout`,
      });
    }
  }
  for (const pane of panes.values()) {
    const actual = {
      add: new Set<string>(),
      update: new Set<string>(),
      read: new Set<string>(),
      remove: new Set<string>(),
    };
    for (const call of step.calls) {
      for (const effect of effectsOf(pane, call)) {
        const { verb, id } = effectTarget(effect);
        if (id !== undefined && verb !== 'focus' && verb !== 'set') actual[verb].add(id);
      }
    }
    const written = step.summary[pane.id];
    for (const verb of SUMMARY_VERBS) {
      const expected = new Set(written?.[verb] ?? []);
      const missing = [...actual[verb]].filter((id) => !expected.has(id));
      const extra = [...expected].filter((id) => !actual[verb].has(id));
      if (missing.length === 0 && extra.length === 0) continue;
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`the calls also ${verb} ${quoteList(missing)}`);
      if (extra.length > 0) parts.push(`no call does ${verb} ${quoteList(extra)}`);
      problems.push({
        severity: 'error',
        rule: 'summary-mismatch',
        path: [...stepPath, 'summary', pane.id, verb],
        message: `summary of step "${step.id}" for pane "${pane.id}" differs from its calls: ${parts.join('; ')}`,
      });
    }
  }
}

function checkCalls(
  walkthrough: Walkthrough,
  panes: Map<string, ResolvedPane>,
  prefix: PathSegment[],
  problems: Problem[],
): void {
  const lanes = new Set((walkthrough.lanes ?? []).map((lane) => lane.id));
  const known = new Map<string, Set<string>>();
  const present = new Map<string, Set<string>>();
  for (const pane of panes.values()) {
    known.set(pane.id, new Set(pane.entities.map((entity) => entity.id)));
    present.set(
      pane.id,
      new Set(pane.entities.filter((entity) => entity.initial).map((entity) => entity.id)),
    );
  }

  walkthrough.steps.forEach((step, s) => {
    const stepPath = [...prefix, 'steps', s];
    step.calls.forEach((call, c) => {
      const callPath = [...stepPath, 'calls', c];

      for (const end of ['from', 'to'] as const) {
        const laneId = call[end];
        if (laneId !== undefined && !lanes.has(laneId)) {
          problems.push({
            severity: 'error',
            rule: 'unknown-lane',
            path: [...callPath, end],
            message: `lane "${laneId}" is not declared. Declared: ${quoteList([...lanes])}`,
          });
        }
      }

      if (call.show !== undefined) {
        const target = panes.get(call.show);
        const declared = walkthrough.layout.panes.find((pane) => pane.id === call.show);
        if (declared === undefined) {
          problems.push({
            severity: 'error',
            rule: 'unknown-pane',
            path: [...callPath, 'show'],
            message: `pane "${call.show}" is not in the layout`,
          });
        } else if ((target?.role ?? declared.role) !== 'focus') {
          problems.push({
            severity: 'error',
            rule: 'show-not-focus',
            path: [...callPath, 'show'],
            message: `"show" picks among focus panes, and pane "${call.show}" has role "fixed"`,
          });
        }
      }

      for (const paneId of Object.keys(call.effects ?? {})) {
        if (walkthrough.layout.panes.every((pane) => pane.id !== paneId)) {
          problems.push({
            severity: 'error',
            rule: 'unknown-pane',
            path: [...callPath, 'effects', paneId],
            message: `pane "${paneId}" is not in the layout`,
          });
        }
      }

      for (const pane of panes.values()) {
        const written = call.effects?.[pane.id] ?? [];
        const all = effectsOf(pane, call);
        const offset = all.length - written.length;
        all.forEach((effect: Effect, index) => {
          // Implicit effects come from the panel, so they point at the call itself.
          const path =
            index < offset ? callPath : [...callPath, 'effects', pane.id, index - offset];
          const shape = (pane.panel.schema.effect ?? EffectSchema).safeParse(effect);
          if (!shape.success) {
            problems.push(...fromZod(shape.error, path));
            return;
          }
          const { verb, id } = effectTarget(effect);
          if (id === undefined) return;
          if (!known.get(pane.id)!.has(id)) {
            problems.push({
              severity: 'error',
              rule: 'unknown-id',
              path: [...path, verb],
              message: `"${id}" is not in the content of pane "${pane.id}"`,
            });
            return;
          }
          const here = present.get(pane.id)!;
          if (verb === 'add') {
            if (here.has(id)) {
              problems.push({
                severity: 'warning',
                rule: 'already-present',
                path: [...path, verb],
                message: `"${id}" is already present in pane "${pane.id}"`,
              });
            }
            here.add(id);
          } else {
            if (!here.has(id)) {
              problems.push({
                severity: 'error',
                rule: 'absent-element',
                path: [...path, verb],
                message: `cannot ${verb} "${id}" in pane "${pane.id}": no earlier call added it`,
              });
            }
            if (verb === 'remove') here.delete(id);
          }
        });
      }
    });
    checkSummary(step, panes, stepPath, problems);
  });
}

/** Checks one parsed walkthrough and binds it to the registry. */
export function resolveWalkthrough(
  walkthrough: Walkthrough,
  registry: Registry,
  prefix: PathSegment[] = [],
): { resolved: ResolvedWalkthrough | undefined; problems: Problem[] } {
  const problems: Problem[] = [];

  problems.push(
    ...duplicates(walkthrough.layout.panes, 'pane', (i) => [...prefix, 'layout', 'panes', i]),
    ...duplicates(walkthrough.lanes ?? [], 'lane', (i) => [...prefix, 'lanes', i]),
    ...duplicates(walkthrough.steps, 'step', (i) => [...prefix, 'steps', i]),
  );
  const calls = walkthrough.steps.flatMap((step, s) =>
    step.calls.map((call, c) => ({ id: call.id, path: [...prefix, 'steps', s, 'calls', c] })),
  );
  problems.push(...duplicates(calls, 'call', (i) => calls[i]!.path));

  const panes = resolvePanes(walkthrough, registry, prefix, problems);
  const annotations = resolveAnnotations(walkthrough, registry, prefix, problems);
  checkCalls(walkthrough, panes, prefix, problems);

  const prefixed = (problem: Problem): Problem => ({
    ...problem,
    path: [...prefix, ...problem.path],
  });
  walkthrough.layout.panes.forEach((declared) => {
    const pane = panes.get(declared.id);
    if (pane?.panel.lint === undefined) return;
    problems.push(...pane.panel.lint(pane, walkthrough).map(prefixed));
  });
  for (const { plugin, config } of annotations) {
    problems.push(...(plugin.lint?.(walkthrough, config) ?? []).map(prefixed));
  }

  if (problems.some((problem) => problem.severity === 'error')) {
    return { resolved: undefined, problems };
  }
  return {
    resolved: {
      source: walkthrough,
      id: walkthrough.id,
      title: walkthrough.title,
      lead: walkthrough.lead,
      lanes: walkthrough.lanes ?? [],
      panes: walkthrough.layout.panes.map((pane) => panes.get(pane.id)!),
      annotations,
      steps: walkthrough.steps,
    },
    problems,
  };
}

/**
 * The single way in: raw config (one walkthrough, or `{ walkthroughs: [...] }`)
 * to walkthroughs that are ready to show, plus every problem found.
 */
export function loadConfig(input: unknown, registry: Registry): LoadResult {
  const isCollection =
    typeof input === 'object' && input !== null && !Array.isArray(input) && 'walkthroughs' in input;

  let parsed: { walkthrough: Walkthrough; prefix: PathSegment[] }[];
  if (isCollection) {
    const result = CollectionSchema.safeParse(input);
    if (!result.success)
      return { walkthroughs: [], problems: fromZod(result.error, []), ok: false };
    parsed = result.data.walkthroughs.map((walkthrough, index) => ({
      walkthrough,
      prefix: ['walkthroughs', index],
    }));
  } else {
    const result = WalkthroughSchema.safeParse(input);
    if (!result.success)
      return { walkthroughs: [], problems: fromZod(result.error, []), ok: false };
    parsed = [{ walkthrough: result.data, prefix: [] }];
  }

  const problems: Problem[] = duplicates(
    parsed.map((item) => item.walkthrough),
    'walkthrough',
    (index) => parsed[index]!.prefix,
  );
  const walkthroughs: ResolvedWalkthrough[] = [];
  for (const { walkthrough, prefix } of parsed) {
    const result = resolveWalkthrough(walkthrough, registry, prefix);
    problems.push(...result.problems);
    if (result.resolved !== undefined) walkthroughs.push(result.resolved);
  }
  return { walkthroughs, problems, ok: problems.every((problem) => problem.severity !== 'error') };
}
