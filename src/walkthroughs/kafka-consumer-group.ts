import { defineWalkthrough } from '../core';

const CONSUMER =
  'https://kafka.apache.org/44/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html';
const CONFIGS = 'https://kafka.apache.org/44/configuration/consumer-configs/';

/**
 * A Kafka consumer group: two consumers share the partitions of a topic, one stops, and the other
 * takes its partition over from the committed offset. Topic, ids and order numbers are made up.
 * Facts about Kafka are checked against the Kafka 4.4 documentation (links in `where`).
 */
export const kafkaConsumerGroup = defineWalkthrough({
  id: 'kafka-consumer-group',
  title: 'Kafka: a consumer group loses a consumer',
  lead: 'A topic with two partitions is read by a group of two consumers. One stops. The other takes its partition over from the last committed offset, so a few events are processed twice: at-least-once delivery.',
  tags: ['kafka', 'event-driven'],

  lanes: [
    { id: 'shop', title: 'Producer' },
    { id: 'broker', title: 'Broker' },
    { id: 'c1', title: 'Consumer c1' },
    { id: 'c2', title: 'Consumer c2' },
  ],

  layout: {
    panes: [
      {
        id: 'topic',
        panel: 'bus',
        title: 'Topic orders',
        content: {
          channels: [
            {
              id: 'orders',
              kind: 'topic',
              partitions: ['p0', 'p1'],
              producers: [{ id: 'shop-api', label: 'shop-api' }],
              consumers: [
                { id: 'c1', label: 'c1', group: 'billing', sub: 'running' },
                { id: 'c2', label: 'c2', group: 'billing', sub: 'running' },
              ],
              cursors: [
                { id: 'billing-p0', partition: 'p0', group: 'billing', owner: 'c1', at: 0 },
                { id: 'billing-p1', partition: 'p1', group: 'billing', owner: 'c2', at: 0 },
              ],
              events: [
                { id: 'e1', label: '#101', partition: 'p0' },
                { id: 'e2', label: '#102', partition: 'p1' },
                { id: 'e3', label: '#103', partition: 'p0' },
                { id: 'e4', label: '#104', partition: 'p0' },
                { id: 'e5', label: '#105', partition: 'p1' },
                { id: 'e6', label: '#106', partition: 'p0' },
                { id: 'e7', label: '#107', partition: 'p1' },
                { id: 'e8', label: '#108', partition: 'p0' },
              ],
            },
          ],
        },
      },
      { id: 'exchange', panel: 'sequence', title: 'Who talks to the broker' },
    ],
  },

  steps: [
    {
      id: 'group',
      title: 'A topic and a group',
      text: 'Each partition is an ordered log. The group billing has two consumers, and each partition has exactly one of them.',
      calls: [
        {
          id: 'owners',
          label: 'Each partition has one owner',
          text: "Offsets count the events of one partition from 0. The marker under each partition is the group's committed offset: the offset of the next event the group will read. Here it is 0, and the lag, the number of events between the committed offset and the end of the partition, is 0 too.",
          where: `${CONSUMER} (each partition is assigned to exactly one consumer in the group; the committed offset is the offset of the next message to read)`,
          effects: {
            topic: [{ read: 'orders' }, { read: 'billing-p0' }, { read: 'billing-p1' }],
          },
        },
      ],
    },
    {
      id: 'append',
      title: 'The producer appends',
      text: 'Events go to the end of a partition and get the next offset there.',
      calls: [
        {
          id: 'append-1',
          label: 'Append #101 to #104',
          from: 'shop',
          to: 'broker',
          text: 'Four orders arrive. #101, #103 and #104 land in p0, #102 in p1. Each partition numbers its own events: #104 is offset 2 in p0. Nothing is read yet, so the lag is the whole partition.',
          where: `${CONSUMER}; https://kafka.apache.org/44/design/design/ (data for one key goes to one partition)`,
          effects: {
            topic: [
              { read: 'shop-api' },
              { add: 'e1' },
              { add: 'e2' },
              { add: 'e3' },
              { add: 'e4' },
              { read: 'billing-p0' },
              { read: 'billing-p1' },
            ],
          },
        },
      ],
    },
    {
      id: 'consume',
      title: 'Consumers read and commit',
      text: 'A consumer fetches events in offset order. Progress only counts once the group commits it.',
      calls: [
        {
          id: 'fetch-c1',
          label: 'c1 fetches p0 from offset 0',
          from: 'c1',
          to: 'broker',
          text: 'c1 receives #101, #103 and #104. They are marked delivered, but nothing is committed yet.',
          effects: {
            topic: [
              { read: 'c1' },
              { update: 'e1', fields: { state: 'delivered' } },
              { update: 'e3', fields: { state: 'delivered' } },
              { update: 'e4', fields: { state: 'delivered' } },
            ],
          },
        },
        {
          id: 'commit-c1',
          label: 'c1 commits offset 2',
          from: 'c1',
          to: 'broker',
          text: 'c1 has finished #101 and #103, so it commits 2: the next event to read is offset 2, #104. The lag drops from 3 to 1. #104 was delivered but is not covered by the commit.',
          where: `${CONSUMER} ("The committed offset should always be the offset of the next message that your application will read")`,
          effects: { topic: [{ update: 'billing-p0', fields: { at: 2 } }] },
        },
        {
          id: 'fetch-c2',
          label: 'c2 fetches p1 and commits offset 1',
          from: 'c2',
          to: 'broker',
          text: 'c2 reads #102 from p1 and commits 1. p1 has no lag.',
          effects: {
            topic: [
              { read: 'c2' },
              { update: 'e2', fields: { state: 'delivered' } },
              { update: 'billing-p1', fields: { at: 1 } },
            ],
          },
        },
      ],
    },
    {
      id: 'backlog',
      title: 'Lag grows',
      text: 'The producer is faster than the consumers for a while.',
      calls: [
        {
          id: 'append-2',
          label: 'Append #105 to #108',
          from: 'shop',
          to: 'broker',
          text: 'Four more orders. The end of p0 moves to offset 5 and the end of p1 to 3, while the committed offsets stay put. The lag of p0 is now 3 and that of p1 is 2.',
          effects: {
            topic: [
              { read: 'shop-api' },
              { add: 'e5' },
              { add: 'e6' },
              { add: 'e7' },
              { add: 'e8' },
              { read: 'billing-p0' },
              { read: 'billing-p1' },
            ],
          },
        },
      ],
    },
    {
      id: 'failure',
      title: 'c1 stops',
      text: 'The consumer dies after fetching #104 and before committing it.',
      calls: [
        {
          id: 'c1-stops',
          label: 'c1 stops sending heartbeats',
          text: 'A consumer that cannot send heartbeats for session.timeout.ms is considered dead (45 seconds by default in the 4.4 configuration docs). Until then p0 has an owner that does nothing, and its lag only grows.',
          where: `${CONSUMER} (Detecting Consumer Failures); ${CONFIGS} (session.timeout.ms)`,
          effects: { topic: [{ update: 'c1', fields: { state: 'stopped', tone: 'warn' } }] },
        },
        {
          id: 'c1-removed',
          label: 'The broker removes c1 from the group',
          from: 'broker',
          to: 'c1',
          text: 'After the session timeout the broker removes c1 from the group and starts a rebalance. p0 has no owner.',
          where: `${CONFIGS} (session.timeout.ms: the broker will remove this client from the group and initiate a rebalance)`,
          effects: {
            topic: [{ update: 'billing-p0', fields: { owner: null, tone: 'warn' } }],
          },
        },
      ],
    },
    {
      id: 'rebalance',
      title: 'Rebalance',
      text: 'The partitions of the group are shared out again among the consumers that are left.',
      calls: [
        {
          id: 'assign',
          label: 'p0 is assigned to c2',
          from: 'broker',
          to: 'c2',
          text: 'c2 now has both partitions. The committed offset of p0 belongs to the group, not to c1, so it stays 2.',
          where: `${CONSUMER} (partitions assigned to a failed process are reassigned to other consumers in the same group)`,
          effects: {
            topic: [
              { update: 'billing-p0', fields: { owner: 'c2', tone: 'none' } },
              { update: 'c2', fields: { state: 'p0 and p1' } },
            ],
          },
        },
      ],
    },
    {
      id: 'resume',
      title: 'c2 resumes from the committed offset',
      text: 'The new owner starts where the group last committed, not where c1 got to.',
      calls: [
        {
          id: 'fetch-again',
          label: 'c2 fetches p0 from offset 2',
          from: 'c2',
          to: 'broker',
          text: '#104 comes again: c1 already received it, but the commit did not cover it. c2 processes it a second time. Kafka delivers at least once, so a consumer has to cope with duplicates.',
          where: `${CONSUMER} (the process that took over would consume from the last committed offset; at-least-once delivery)`,
          effects: {
            topic: [
              { read: 'c2' },
              { update: 'e4', fields: { state: 'delivered', tone: 'warn' } },
              { update: 'e6', fields: { state: 'delivered' } },
              { update: 'e8', fields: { state: 'delivered' } },
            ],
          },
        },
        {
          id: 'commit-c2',
          label: 'c2 commits both partitions',
          from: 'c2',
          to: 'broker',
          text: 'The commits move p0 to the end, offset 5, and p1 to 3. The lag is 0 everywhere, and every event was processed at least once.',
          effects: {
            topic: [
              { update: 'e5', fields: { state: 'delivered' } },
              { update: 'e7', fields: { state: 'delivered' } },
              { update: 'billing-p0', fields: { at: 5 } },
              { update: 'billing-p1', fields: { at: 3 } },
            ],
          },
        },
      ],
    },
  ],
});
