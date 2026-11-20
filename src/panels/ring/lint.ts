/**
 * Lint rules of the ring panel:
 *   ring/position-out-of-range  a token or key position that is not an integer in 0..size-1
 *   ring/duplicate-position     two tokens at one position, in the content or after a call
 *   ring/replication-too-high   a replication factor above the number of declared nodes
 *   ring/under-replicated       (warning) a call leaves fewer healthy nodes than the factor
 *   ring/token-effect           add or remove on a token: tokens come and go with their node
 *   ring/absent-token           a read or update of a token while its node is not in the ring
 *   ring/unknown-field          an update sets a field the element does not have
 *   ring/bad-field              a field value of the wrong kind, or a state that is not a state
 *   ring/bad-tone               a tone that is not a tone
 * An effect on an id that is not in the pane is the core rule `unknown-id`.
 */
import {
  effectTarget,
  writtenEffects,
  type Problem,
  type ResolvedPane,
  type Walkthrough,
} from '../../core';
import { fieldProblems } from '../_shared/fields';
import {
  KEY_FIELDS,
  NODE_FIELDS,
  NODE_STATES,
  TOKEN_FIELDS,
  duplicatePositions,
  entitiesOf,
  init,
  isPosition,
  reduce,
  ringOf,
  type RingContent,
} from './model';

export function lintRing(pane: ResolvedPane, walkthrough: Walkthrough): Problem[] {
  const content = pane.content as RingContent;
  const paneIndex = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
  const where = ['layout', 'panes', paneIndex, 'content'];
  const problems: Problem[] = [];
  const { size } = content;

  const outOfRange = (value: unknown, path: (string | number)[], what: string) => {
    if (isPosition(size, value)) return;
    problems.push({
      severity: 'error',
      rule: 'ring/position-out-of-range',
      path,
      message: `${what} must be an integer from 0 to ${size - 1}; got ${JSON.stringify(value)}`,
    });
  };

  content.nodes.forEach((node, n) => {
    node.positions.forEach((position, p) =>
      outOfRange(position, [...where, 'nodes', n, 'positions', p], `a position of "${node.id}"`),
    );
  });
  content.keys.forEach((key, k) =>
    outOfRange(key.at, [...where, 'keys', k, 'at'], `the position of key "${key.id}"`),
  );
  if (content.replication > content.nodes.length) {
    problems.push({
      severity: 'error',
      rule: 'ring/replication-too-high',
      path: [...where, 'replication'],
      message: `replication ${content.replication} is more than the ${content.nodes.length} nodes there are to hold copies`,
    });
  }

  // What each id is, to check the fields an update sets.
  const kinds = new Map<string, 'node' | 'token' | 'key'>();
  for (const node of content.nodes) {
    kinds.set(node.id, 'node');
    node.positions.forEach((_, index) => kinds.set(`${node.id}.${index}`, 'token'));
  }
  for (const key of content.keys) kinds.set(key.id, 'key');
  const fields = {
    node: NODE_FIELDS,
    token: TOKEN_FIELDS,
    key: KEY_FIELDS,
  } as const;

  problems.push(
    ...fieldProblems(
      pane,
      walkthrough,
      (id) => {
        const kind = kinds.get(id);
        return kind === undefined ? undefined : fields[kind];
      },
      (id, field, value) => {
        if (field === 'at') return typeof value === 'number' ? null : 'a position is a number';
        if (field === 'state') {
          return (NODE_STATES as readonly unknown[]).includes(value)
            ? null
            : `a state is one of: ${NODE_STATES.join(', ')}`;
        }
        return undefined;
      },
    ),
  );

  // Fold the pane's own effects to check what depends on the state at each call.
  let state = init(entitiesOf(content));
  const seenDuplicates = new Set<string>();
  const checkDuplicates = (path: (string | number)[]) => {
    for (const group of duplicatePositions(ringOf(content, state))) {
      const key = group.map((token) => token.id).join('|');
      const label = `${group[0]!.at}`;
      if (seenDuplicates.has(`${key}@${label}`)) continue;
      seenDuplicates.add(`${key}@${label}`);
      problems.push({
        severity: 'error',
        rule: 'ring/duplicate-position',
        path,
        message: `tokens ${group.map((token) => `"${token.id}"`).join(' and ')} are both at ${label}`,
      });
    }
  };
  checkDuplicates(where);

  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      const callPath = ['steps', s, 'calls', c];
      writtenEffects(call, pane.id).forEach((effect, e) => {
        const path = [...callPath, 'effects', pane.id, e];
        const { verb, id } = effectTarget(effect);
        const kind = kinds.get(id);
        if (kind === 'token') {
          if (verb === 'add' || verb === 'remove') {
            problems.push({
              severity: 'error',
              rule: 'ring/token-effect',
              path: [...path, verb],
              message: `a token comes and goes with its node: ${verb} "${id.split('.')[0]}" instead`,
            });
          } else if (!state.present.includes(id.split('.')[0]!)) {
            problems.push({
              severity: 'error',
              rule: 'ring/absent-token',
              path: [...path, verb],
              message: `cannot ${verb} "${id}": node "${id.split('.')[0]}" is not in the ring at this call`,
            });
          }
        }
        if (verb === 'update' && effect.fields !== undefined && kind !== undefined) {
          for (const [field, value] of Object.entries(effect.fields)) {
            if (field === 'at' && typeof value === 'number') {
              outOfRange(value, [...path, 'fields', field], `the position of "${id}"`);
            }
          }
        }
        state = reduce(state, effect, call);
      });
      const ring = ringOf(content, state);
      checkDuplicates(callPath);
      const healthyNodes = ring.nodes.filter((node) => node.present && node.state !== 'down');
      if (writtenEffects(call, pane.id).length > 0 && healthyNodes.length < content.replication) {
        problems.push({
          severity: 'warning',
          rule: 'ring/under-replicated',
          path: callPath,
          message: `only ${healthyNodes.length} healthy ${healthyNodes.length === 1 ? 'node is' : 'nodes are'} left after this call, fewer than the replication factor ${content.replication}`,
        });
      }
    });
  });
  return problems;
}
