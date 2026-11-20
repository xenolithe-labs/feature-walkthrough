/**
 * What a reader sees in a ring pane, as text: the nodes in the ring with their state and token
 * positions, and for each key that is shown where it hashes, which node owns it and which hold
 * its replicas, marking what the current call touched.
 */
import type { Effect } from '../../core';
import { cap, elements, hitOf } from '../_shared/describe';
import { holders, keyAt, place, ringOf, tokenId, type RingContent } from './model';

export function describeRing(state: unknown, content: RingContent, current: Effect[]): string[] {
  const shown = elements(state);
  const here = new Set(shown.present);
  const hit = hitOf(current);
  const ring = ringOf(content, shown);
  const lines = [
    `ring of ${ring.size} positions, ${ring.replication} ${ring.replication === 1 ? 'copy' : 'copies'} of each key`,
  ];
  const nodes = ring.nodes
    .filter((node) => node.present || hit.removed.has(node.id))
    .map((node) => {
      const tokens = ring.tokens.filter((token) => token.node === node.id).map((token) => token.at);
      const touched =
        hit.has(node.id) ||
        content.nodes
          .find((item) => item.id === node.id)
          ?.positions.some((_, index) => hit.has(tokenId(node.id, index)));
      return `${node.label} (${node.state}) at ${tokens.length === 0 ? 'no token' : tokens.join(', ')}${touched ? '*' : ''}${hit.removed.has(node.id) ? ' (removed)' : ''}`;
    });
  lines.push(`nodes: ${nodes.length === 0 ? 'none' : cap(nodes, 8)}`);
  for (const key of content.keys) {
    if (!here.has(key.id) && !hit.removed.has(key.id)) continue;
    const at = keyAt(key, shown);
    const placement = place(ring, at);
    const names = new Map(ring.nodes.map((node) => [node.id, node.label]));
    const who = holders(placement).map((id) => names.get(id) ?? id);
    lines.push(
      `key ${key.label ?? key.id}@${at}${hit.has(key.id) ? '*' : ''}: ${
        placement.owner === undefined
          ? 'no healthy node'
          : `owner ${names.get(placement.owner) ?? placement.owner}${who.length > 1 ? `, replicas ${who.slice(1).join(', ')}` : ''}${placement.hinted ? ' (a down node was skipped)' : ''}`
      }`,
    );
  }
  return lines;
}
