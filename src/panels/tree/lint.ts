/**
 * The tree's own lint rules, named `tree/<rule>`. Moves are checked in call order against where
 * each node is at that moment, so a cycle that only a sequence of moves makes is found too.
 */
import {
  effectTarget,
  writtenEffects,
  type Problem,
  type ResolvedPane,
  type Walkthrough,
} from '../../core';
import { ancestorsOf, candidateParents, type NodeDecl } from './model';

export interface LintNode extends NodeDecl {
  initial?: boolean | undefined;
}

export const NODE_FIELDS = ['label', 'sub', 'tone', 'collapsed', 'parent'] as const;

/** A message for a field value that is the wrong kind, null for a good one, undefined to defer. */
export function fieldKind(field: string, value: unknown): string | null | undefined {
  if (field === 'collapsed') {
    return typeof value === 'boolean' ? null : 'the field "collapsed" takes true or false';
  }
  if (field === 'label') {
    return typeof value === 'string' && value !== '' ? null : 'the field "label" takes text';
  }
  if (field === 'parent') {
    return typeof value === 'string' ? null : 'the field "parent" takes the id of a node';
  }
  return undefined;
}

/** True when following parents from `id` comes back to `id`. */
export function loopsBack(id: string, parents: ReadonlyMap<string, string | undefined>): boolean {
  const seen = new Set<string>();
  for (let at = parents.get(id); at !== undefined; at = parents.get(at)) {
    if (at === id) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}

export function treeProblems(
  pane: ResolvedPane,
  walkthrough: Walkthrough,
  nodes: readonly LintNode[],
  initial: boolean,
): Problem[] {
  const index = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
  const at = ['layout', 'panes', index, 'content', 'nodes'];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const problems: Problem[] = [];

  nodes.forEach((node, position) => {
    const named: [string, string[]][] = [
      ['parent', node.parent === undefined ? [] : [node.parent]],
      ['parents', node.parents ?? []],
    ];
    for (const [field, ids] of named) {
      for (const id of ids) {
        if (byId.has(id)) continue;
        problems.push({
          severity: 'error',
          rule: 'tree/unknown-parent',
          path: [...at, position, field],
          message: `node "${node.id}" names "${id}" in ${field}, which is not a node of this pane`,
        });
      }
    }
    if (node.parents?.includes(node.id)) {
      problems.push({
        severity: 'error',
        rule: 'tree/cycle',
        path: [...at, position, 'parents'],
        message: `node "${node.id}" lists itself as a candidate parent`,
      });
    }
  });

  // A declared loop: following parents leads back to the node. A node that only hangs from a
  // loop is not reported, because fixing the loop fixes it.
  const declared = new Map(nodes.map((node) => [node.id, node.parent]));
  nodes.forEach((node, position) => {
    if (node.parent === undefined || !byId.has(node.parent)) return;
    if (loopsBack(node.id, declared)) {
      problems.push({
        severity: 'error',
        rule: 'tree/cycle',
        path: [...at, position, 'parent'],
        message: `node "${node.id}" ends up under itself`,
      });
    }
  });

  // Walk the calls in order, keeping where every node is and which are present.
  const parents = new Map<string, string | undefined>(declared);
  const present = new Set(nodes.filter((node) => node.initial ?? initial).map((node) => node.id));
  const childrenPresent = (id: string) => [...present].filter((other) => parents.get(other) === id);

  nodes.forEach((node, position) => {
    if (node.parent !== undefined && byId.has(node.parent)) {
      if (present.has(node.id) && !present.has(node.parent)) {
        problems.push({
          severity: 'error',
          rule: 'tree/parent-absent',
          path: [...at, position],
          message: `node "${node.id}" is present from the start but its parent "${node.parent}" is not`,
        });
      }
    }
  });

  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      writtenEffects(call, pane.id).forEach((effect, e) => {
        const { verb, id } = effectTarget(effect);
        const node = byId.get(id);
        if (node === undefined) return;
        const path = ['steps', s, 'calls', c, 'effects', pane.id, e];
        if (verb === 'add') {
          const parent = parents.get(id);
          if (parent !== undefined && !present.has(parent)) {
            problems.push({
              severity: 'error',
              rule: 'tree/parent-absent',
              path: [...path, 'add'],
              message: `"${id}" is added while its parent "${parent}" is absent`,
            });
          }
          present.add(id);
        } else if (verb === 'remove') {
          const orphans = childrenPresent(id);
          if (orphans.length > 0) {
            problems.push({
              severity: 'error',
              rule: 'tree/remove-parent',
              path: [...path, 'remove'],
              message: `"${id}" is removed while "${orphans.join('", "')}" is still under it. Remove those first`,
            });
          }
          present.delete(id);
          // Removing drops what updates changed, so a moved node is back where it was declared.
          parents.set(id, node.parent);
        } else if (verb === 'update') {
          const target = effect.fields?.parent;
          if (typeof target !== 'string') return;
          const fieldPath = [...path, 'fields', 'parent'];
          const allowed = candidateParents(node);
          if (!allowed.includes(target)) {
            problems.push({
              severity: 'error',
              rule: 'tree/bad-move',
              path: fieldPath,
              message:
                allowed.length === 0
                  ? `"${id}" has no candidate parents to move to: declare them in "parents"`
                  : `"${id}" cannot move under "${target}". Its candidate parents are: ${allowed.join(', ')}`,
            });
            return;
          }
          if (target === id || ancestorsOf(target, parents).includes(id)) {
            problems.push({
              severity: 'error',
              rule: 'tree/cycle',
              path: fieldPath,
              message: `moving "${id}" under "${target}" puts it under itself`,
            });
            return;
          }
          if (!present.has(target)) {
            problems.push({
              severity: 'error',
              rule: 'tree/parent-absent',
              path: fieldPath,
              message: `"${id}" is moved under "${target}", which is absent at that call`,
            });
          }
          parents.set(id, target);
        }
      });
    });
  });
  return problems;
}
