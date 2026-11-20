import { defineWalkthrough } from '../core';
import { hashPosition } from './ring-hash';

const DYNAMO = 'https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf';
const CASSANDRA = 'https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html';

/** The hash space is small so that a position can be read: MD5 of the name, mod 1000. */
export const SIZE = 1000;
export const REPLICATION = 2;
const at = (name: string) => hashPosition(name, SIZE);

// The names are made up. They were picked so that the joining node's token falls in an arc that
// holds several keys; every position below is the hash of the name, not a number chosen by hand.
export const NODE_NAMES = ['node-1', 'node-6', 'node-13', 'node-10'] as const;
export const KEY_NAMES = Array.from({ length: 12 }, (_, i) => `user:${100 + i}`);
const keyId = (name: string) => name.replace(':', '-');

interface Member {
  id: string;
  at: number;
  down: boolean;
}

/**
 * The owner and replicas of a key, worked out here on its own, for the table. Tokens sorted by
 * position and a binary search for the first at or after the key, then the walk: the panel
 * derives the same by its own code, and a test checks that the two agree at every call.
 */
export function holdersOf(
  members: Member[],
  position: number,
  replication = REPLICATION,
): string[] {
  const ring = members.filter((member) => !member.down).sort((a, b) => a.at - b.at);
  if (ring.length === 0) return [];
  let low = 0;
  let high = ring.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ring[middle]!.at >= position) high = middle;
    else low = middle + 1;
  }
  const out: string[] = [];
  for (let step = 0; step < ring.length && out.length < replication; step += 1) {
    out.push(ring[(low + step) % ring.length]!.id);
  }
  return out;
}

const member = (name: string, down = false): Member => ({ id: name, at: at(name), down });
const before = ['node-1', 'node-6', 'node-13'].map((name) => member(name));
const joined = [...before, member('node-10')];
const failed = joined.map((item) => (item.id === 'node-6' ? { ...item, down: true } : item));

const ownerIn = (members: Member[], key: string) => holdersOf(members, at(key))[0] ?? '-';
const replicasIn = (members: Member[], key: string) => holdersOf(members, at(key)).slice(1);

const moved = (a: Member[], b: Member[]) =>
  KEY_NAMES.filter((key) => ownerIn(a, key) !== ownerIn(b, key));
const movedOnJoin = moved(before, joined);
const movedOnFailure = moved(joined, failed);

/**
 * What the table shows now, so that a call updates only the rows whose cells change.
 * The "after" column starts empty.
 */
const shown = new Map(
  KEY_NAMES.map((key) => [key, { before: ownerIn(before, key), after: '', moved: '' }]),
);

function compare(from: Member[], to: Member[]) {
  return KEY_NAMES.flatMap((key) => {
    const next = {
      before: ownerIn(from, key),
      after: ownerIn(to, key),
      moved: ownerIn(from, key) === ownerIn(to, key) ? '' : 'moved',
    };
    const now = shown.get(key)!;
    const fields = Object.fromEntries(
      Object.entries(next).filter(([column, value]) => now[column as keyof typeof now] !== value),
    );
    shown.set(key, next);
    return Object.keys(fields).length === 0 ? [] : [{ update: keyId(key), fields }];
  });
}

const list = (keys: string[]) => keys.join(', ');
const where = (node: string) => `${node} at ${at(node)}`;

/**
 * Consistent hashing with a ring: a lookup, a node that joins, and a node that goes down. Names
 * and counts are made up; every position is the MD5 of a name, mod 1000. The rules follow the
 * Dynamo paper (links in `where`).
 */
export const consistentHashing = defineWalkthrough({
  id: 'consistent-hashing',
  title: 'Consistent hashing: adding a node and which keys move',
  lead: 'Nodes and keys are hashed onto one ring. A key belongs to the first node at or after it going clockwise, and is copied to the next node. Add a node and only the keys in one arc change owner; take a node down and its keys go to the next node along.',
  tags: ['dynamo', 'cassandra', 'consistent-hashing', 'partitioning'],

  lanes: [
    { id: 'client', title: 'Client' },
    { id: 'node-13', title: 'node-13' },
    { id: 'node-6', title: 'node-6' },
    { id: 'node-10', title: 'node-10' },
    { id: 'node-1', title: 'node-1' },
  ],

  layout: {
    panes: [
      {
        id: 'ring',
        panel: 'ring',
        title: 'Hash ring (0 to 999)',
        content: {
          size: SIZE,
          replication: REPLICATION,
          nodes: [
            { id: 'node-1', positions: [at('node-1')] },
            { id: 'node-6', positions: [at('node-6')] },
            { id: 'node-13', positions: [at('node-13')] },
            { id: 'node-10', positions: [at('node-10')], initial: false },
          ],
          keys: KEY_NAMES.map((name) => ({ id: keyId(name), label: name, at: at(name) })),
        },
      },
      {
        id: 'owners',
        panel: 'table',
        title: 'Who owns each key',
        content: {
          columns: [
            { id: 'key', label: 'Key', mono: true },
            { id: 'at', label: 'At', mono: true },
            { id: 'before', label: 'Owner before', mono: true },
            { id: 'after', label: 'Owner after', mono: true },
            { id: 'moved', label: '' },
          ],
          rows: KEY_NAMES.map((name) => ({
            id: keyId(name),
            cells: {
              key: name,
              at: String(at(name)),
              before: ownerIn(before, name),
              after: '',
              moved: '',
            },
          })),
        },
      },
      { id: 'messages', panel: 'sequence', title: 'Who talks to whom' },
    ],
  },

  steps: [
    {
      id: 'ring',
      title: 'Three nodes, a dozen keys',
      text: 'Every node and key is hashed with MD5 and reduced to a position from 0 to 999. Each node has one token. A token owns the arc that ends at it.',
      calls: [
        {
          id: 'look',
          label: 'Hash the nodes and the keys',
          text: `The tokens are ${where('node-1')}, ${where('node-6')} and ${where('node-13')}. A key belongs to the first token at or after it, going clockwise, and past 999 the ring wraps to 0. Replication is ${REPLICATION}: each key is also held by the next distinct node.`,
          where: `${DYNAMO} sections 4.1 and 4.2 (MD5 of the key; a node owns the region between it and its predecessor)`,
          effects: {
            ring: [{ read: 'node-1' }, { read: 'node-6' }, { read: 'node-13' }],
            owners: KEY_NAMES.map((name) => ({ read: keyId(name) })),
          },
        },
      ],
    },
    {
      id: 'lookup',
      title: 'Look up a key',
      text: 'A lookup is a walk clockwise from the key.',
      calls: [
        {
          id: 'owner',
          label: 'Find the owner of user:105',
          from: 'client',
          to: 'node-13',
          text: `user:105 hashes to ${at('user:105')}. The first token at or after it is node-13 at ${at('node-13')}, so node-13 owns it.`,
          where: `${DYNAMO} section 4.2 (walk the ring clockwise to the first node with a position larger than the key's)`,
          effects: {
            ring: [{ read: 'user-105' }, { read: 'node-13' }],
            owners: [{ read: 'user-105' }],
          },
        },
        {
          id: 'replica',
          label: 'Find its replica',
          from: 'node-13',
          to: 'node-6',
          text: `With replication ${REPLICATION} the next distinct node clockwise also holds the key. The walk passes 999, wraps to 0 and reaches node-6 at ${at('node-6')}.`,
          where: `${DYNAMO} section 4.3 (the preference list holds the next nodes along the ring, as distinct physical nodes)`,
          effects: {
            ring: [{ read: 'user-105' }, { read: 'node-6' }],
            owners: [{ read: 'user-105' }],
          },
        },
      ],
    },
    {
      id: 'join',
      title: 'A fourth node joins',
      text: 'The new node hashes to one position and takes over the arc that ends there.',
      calls: [
        {
          id: 'add',
          label: 'node-10 joins the ring',
          from: 'node-10',
          to: 'node-13',
          text: `node-10 hashes to ${at('node-10')}. It now owns the arc after node-1's token at ${at('node-1')}, up to ${at('node-10')}, which used to belong to node-13. The keys in that arc move: ${list(movedOnJoin)}. Every other key keeps its owner. The panel works this out; the marked keys and the bracket around the arc are not written in the config.`,
          where: `${DYNAMO} section 4.2 (the departure or arrival of a node only affects its immediate neighbours)`,
          effects: {
            ring: [{ add: 'node-10' }],
            owners: compare(before, joined),
          },
        },
        {
          id: 'check',
          label: 'Only one arc moved',
          text: `${movedOnJoin.length} of ${KEY_NAMES.length} keys changed owner, all of them in node-10's arc. The table says the same: compare its two owner columns. The other keys keep their owner, though some now have a different replica, because node-10 is now the node after node-1.`,
          effects: {
            ring: [{ read: 'node-10' }, { read: 'node-13' }],
            owners: movedOnJoin.map((name) => ({ read: keyId(name) })),
          },
        },
      ],
    },
    {
      id: 'failure',
      title: 'A node goes down',
      text: 'A node that is down is skipped, and its keys are served by the next node along.',
      calls: [
        {
          id: 'down',
          label: 'node-6 goes down',
          from: 'node-6',
          to: 'client',
          text: `node-6 owned ${list(movedOnFailure)}. With node-6 skipped, the first healthy token at or after each of them is node-1 at ${at('node-1')}, so they move there. The dashed marks on the ring show the arc that node-1 now serves for node-6.`,
          where: `${DYNAMO} sections 4.5 and 4.6 (reads and writes use the first N healthy nodes of the preference list: a sloppy quorum with hinted handoff)`,
          effects: {
            ring: [{ update: 'node-6', fields: { state: 'down' } }],
            owners: compare(joined, failed),
          },
        },
        {
          id: 'lookup-down',
          label: 'Find the owner of user:100 while node-6 is down',
          from: 'client',
          to: 'node-1',
          text: `user:100 hashes to ${at('user:100')}. The walk reaches node-6 first, skips it because it is down, and stops at node-1, with node-10 as the replica.`,
          where: `${DYNAMO} section 4.6; ${CASSANDRA} (replicas are distinct nodes found by walking the ring; hints are written for replicas that are down)`,
          effects: {
            ring: [{ read: 'user-100' }],
            owners: [{ read: 'user-100' }],
          },
        },
        {
          id: 'up',
          label: 'node-6 comes back',
          text: 'The node is healthy again, so the keys it owns are owned by it again. This panel does not model how the data is handed back.',
          effects: {
            ring: [{ update: 'node-6', fields: { state: 'up' } }],
            owners: compare(failed, joined),
          },
        },
      ],
    },
  ],
});

export {
  replicasIn,
  ownerIn,
  before as membersBefore,
  joined as membersJoined,
  failed as membersFailed,
};
