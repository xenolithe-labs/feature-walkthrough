import { defineWalkthrough } from '../core';

const DESIGN = 'https://kafka.apache.org/44/design/design/';
const BROKER = 'https://kafka.apache.org/44/configuration/broker-configs/';
const PRODUCER = 'https://kafka.apache.org/44/configuration/producer-configs/';

/**
 * A Kafka cluster loses a broker. Brokers, topics, partition numbers and lag figures are made up.
 * Facts about Kafka are checked against the Kafka 4.4 documentation (links in `where`). What those
 * pages do not say (which in-sync replica is chosen, how clients learn of a new leader, what
 * "preferred" means exactly) is worded neutrally in the text.
 */
export const kafkaBrokerFailure = defineWalkthrough({
  id: 'kafka-broker-failure',
  title: 'Kafka: a broker fails, leaders are elected, then leadership is rebalanced',
  lead: 'Four brokers hold replicas of six partitions. One broker stops. For each partition it led, the controller can only choose a new leader from the in-sync replicas, so one partition recovers and one stays offline. When the broker returns, "rebalance" here means moving leadership back to where it was, not a consumer group rebalance.',
  tags: ['kafka', 'event-driven'],

  lanes: [
    { id: 'client', title: 'Producer' },
    { id: 'ctrl', title: 'Controller' },
    { id: 'b2', title: 'Broker b2' },
    { id: 'b4', title: 'Broker b4' },
  ],

  layout: {
    panes: [
      {
        id: 'placement',
        panel: 'table',
        title: 'Where each partition lives',
        content: {
          columns: [
            { id: 'part', label: 'Partition', mono: true },
            { id: 'b1', label: 'b1' },
            { id: 'b2', label: 'b2' },
            { id: 'b3', label: 'b3' },
            { id: 'b4', label: 'b4' },
            { id: 'lag', label: 'Follower lag (s)', meter: { max: 60, warn: 30 } },
          ],
          legend: {
            L: { tone: 'good', label: 'leader' },
            F: { tone: 'muted', label: 'follower in the ISR' },
            o: { tone: 'warn', label: 'follower outside the ISR' },
            x: { tone: 'warn', label: 'replica on the stopped broker' },
          },
          rows: [
            {
              id: 'orders-0',
              group: 'Topic orders',
              cells: { part: 'orders-0', b1: 'L', b2: 'F', b3: 'F', lag: '1' },
            },
            {
              id: 'orders-1',
              group: 'Topic orders',
              cells: { part: 'orders-1', b2: 'L', b3: 'o', b4: 'F', lag: '38' },
            },
            {
              id: 'orders-2',
              group: 'Topic orders',
              cells: { part: 'orders-2', b1: 'F', b3: 'L', b4: 'F', lag: '0' },
            },
            {
              id: 'payments-0',
              group: 'Topic payments',
              cells: { part: 'payments-0', b1: 'F', b2: 'F', b4: 'L', lag: '2' },
            },
            {
              id: 'payments-1',
              group: 'Topic payments',
              cells: { part: 'payments-1', b1: 'L', b3: 'F', b4: 'F', lag: '1' },
            },
            {
              id: 'payments-2',
              group: 'Topic payments',
              cells: { part: 'payments-2', b1: 'o', b2: 'L', b4: 'o', lag: '52' },
            },
          ],
        },
      },
      { id: 'exchange', panel: 'sequence', title: 'Who tells whom' },
    ],
  },

  steps: [
    {
      id: 'healthy',
      title: 'A healthy cluster',
      text: 'Each partition has one leader and followers that copy it. The followers that are keeping up form its in-sync replica set, the ISR.',
      calls: [
        {
          id: 'steady',
          label: 'Brokers heartbeat to the controller',
          from: 'b2',
          to: 'ctrl',
          text: "Read a row across: L is the leader, F a follower in the ISR, o a follower that fell out of it, a blank means the broker holds no replica. A write counts as committed only once all in-sync replicas have it. The ISR is decided by time, not by a count of messages: a follower that has not caught up for replica.lag.time.max.ms (30 s by default) is removed. The meter is this demo's own figure, seconds since the slowest follower was last caught up, with its bar turning to a warning past that 30 s limit. orders-1 has lost b3 that way, and in payments-2 both followers have. Column b2 is marked because it leads orders-1 and payments-2, and because b2 is about to stop.",
          where: `${DESIGN}#replication (in-sync replicas, committed writes); ${BROKER}#brokerconfigs_replica.lag.time.max.ms (default 30000); ${BROKER}#brokerconfigs_broker.heartbeat.interval.ms (default 2000)`,
          effects: { placement: [{ read: 'col.b2' }] },
        },
      ],
    },
    {
      id: 'failure',
      title: 'Broker b2 stops',
      text: 'The cluster finds out by silence.',
      calls: [
        {
          id: 'crash',
          label: 'b2 stops',
          text: 'Every replica on b2 is gone at once: x in column b2. orders-1 and payments-2 have lost their leader; orders-0 and payments-0 have lost only a follower. Nothing is sent, so nothing has noticed yet.',
          effects: {
            placement: [
              {
                update: 'orders-0',
                fields: { b2: 'x' },
              },
              { update: 'orders-1', fields: { b2: 'x' } },
              { update: 'payments-0', fields: { b2: 'x' } },
              { update: 'payments-2', fields: { b2: 'x' } },
            ],
          },
        },
        {
          id: 'detect',
          label: 'The controller stops hearing b2',
          text: 'In a KRaft cluster each broker keeps a session alive with periodic heartbeats. When the controller gets none before broker.session.timeout.ms (9 s by default), it considers the broker offline. Only now can it act on the partitions b2 led.',
          where: `${DESIGN}#replication; ${BROKER}#brokerconfigs_broker.session.timeout.ms (default 9000)`,
          effects: { placement: [{ read: 'col.b2' }] },
        },
      ],
    },
    {
      id: 'election',
      title: 'New leaders, from the ISR only',
      text: 'The controller may only choose among replicas that are in the ISR.',
      calls: [
        {
          id: 'elect-orders-1',
          label: 'orders-1: b4 becomes leader',
          from: 'ctrl',
          to: 'b4',
          text: 'orders-1 had the ISR b2 and b4. With b2 gone, b4 is the only member left, so it leads. b3 is alive and holds a copy, but it fell outside the ISR, so it is not eligible, even though it is a replica of the same partition. If several ISR members were alive, the cited pages do not say which one is chosen, so this demo does not either. How the new leadership reaches the brokers and clients is also outside the cited pages.',
          where: `${DESIGN}#replica-management ("If the controller detects the failure of a broker, it is responsible for electing one of the remaining members of the ISR to serve as the new leader"); ${DESIGN}#replicated-logs-quorums-isrs-and-state-machines-oh-my ("Only members of this set are eligible for election as leader")`,
          effects: {
            placement: [
              { update: 'orders-1', fields: { b4: 'L' } },
              { read: 'orders-1', cells: ['b3'] },
            ],
          },
        },
        {
          id: 'no-candidate',
          label: 'payments-2: no ISR member is alive',
          text: 'b2 was the only member of the payments-2 ISR. b1 and b4 are alive, but both fell outside it (their meter is past 30 s). With unclean.leader.election.enable at its default of false they cannot be elected, so the partition stays unavailable until a replica from the ISR comes back. Allowing it would trade availability for the risk of losing writes those replicas never received.',
          where: `${BROKER}#brokerconfigs_unclean.leader.election.enable (default false); ${DESIGN}#unclean-leader-election-what-if-they-all-die`,
          effects: { placement: [{ read: 'payments-2' }] },
        },
        {
          id: 'retry',
          label: 'The producer retries on b4',
          from: 'client',
          to: 'b4',
          text: 'A producer sends data directly to the broker that leads the partition. Failed sends are retried (retries defaults to 2147483647) until delivery.timeout.ms (120 s by default) runs out. Once orders-1 has a leader, the retried records go to b4. Records for payments-2 keep failing until that partition has a leader again, or until the timeout. The cited pages do not describe how a client learns the new leader; only that it refreshes metadata on a timer (metadata.max.age.ms, 5 min by default).',
          where: `${DESIGN}#the-producer; ${PRODUCER}#producerconfigs_retries; ${PRODUCER}#producerconfigs_delivery.timeout.ms; ${PRODUCER}#producerconfigs_metadata.max.age.ms`,
          effects: { placement: [{ read: 'orders-1' }, { read: 'payments-2' }] },
        },
      ],
    },
    {
      id: 'return',
      title: 'b2 returns and leadership moves back',
      text: 'Coming back is slower than failing: a replica has to catch up before it counts again.',
      calls: [
        {
          id: 'restart',
          label: 'b2 restarts',
          from: 'b2',
          to: 'ctrl',
          text: 'b2 heartbeats again. Its replicas of orders-0, orders-1 and payments-0 are followers that are behind, so they are outside the ISR (o) and the meter climbs past the limit. The partition it was the only ISR member of, payments-2, is handled next.',
          effects: {
            placement: [
              { update: 'orders-0', fields: { b2: 'o', lag: '41' } },
              { update: 'orders-1', fields: { b2: 'o', lag: '57' } },
              { update: 'payments-0', fields: { b2: 'o', lag: '44' } },
            ],
          },
        },
        {
          id: 'payments-back',
          label: 'payments-2 gets its leader back',
          from: 'ctrl',
          to: 'b2',
          text: 'With the default settings the partition waited for a replica of its ISR, and b2 is the one. It leads again. Because a write only counts as committed once all in-sync replicas have it, and b2 was the whole ISR, it has every committed write. b1 and b4 are still behind.',
          where: `${DESIGN}#availability-and-durability-guarantees ("the partition will remain unavailable until the most recent leader becomes available again"); ${DESIGN}#replicated-logs-quorums-isrs-and-state-machines-oh-my`,
          effects: { placement: [{ update: 'payments-2', fields: { b2: 'L' } }] },
        },
        {
          id: 'rejoin',
          label: 'b2 catches up and rejoins the ISR',
          text: 'A replica that was out must fully re-sync before it rejoins the ISR. Once b2 has caught up, its cells become F again and the meter falls back under the limit. orders-1 still shows b3, which has not caught up.',
          where: `${DESIGN}#replicated-logs-quorums-isrs-and-state-machines-oh-my ("before rejoining, it must fully re-sync again")`,
          effects: {
            placement: [
              { update: 'orders-0', fields: { b2: 'F', lag: '1' } },
              { update: 'orders-1', fields: { b2: 'F', lag: '38' } },
              { update: 'payments-0', fields: { b2: 'F', lag: '2' } },
            ],
          },
        },
        {
          id: 'rebalance',
          label: 'Leadership moves back to b2',
          from: 'ctrl',
          to: 'b2',
          text: 'Leadership now sits unevenly: b4 leads orders-1 only because b2 was away. With auto.leader.rebalance.enable (true by default) a background check, every 300 s by default, moves leadership back to each partition\'s preferred leader. Here that is b2 for orders-1, where it led before. The cited pages do not define "preferred" more exactly, nor the imbalance threshold, so the demo does not either.',
          where: `${BROKER}#brokerconfigs_auto.leader.rebalance.enable (default true); ${BROKER}#brokerconfigs_leader.imbalance.check.interval.seconds (default 300)`,
          effects: {
            placement: [{ read: 'col.b2' }, { update: 'orders-1', fields: { b2: 'L', b4: 'F' } }],
          },
        },
      ],
    },
  ],
});
