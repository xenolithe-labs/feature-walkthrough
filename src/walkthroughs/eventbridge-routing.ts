import { defineWalkthrough } from '../core';

const PATTERNS =
  'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns-content-based-filtering.html';
const BUS = 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html';
const RULES = 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html';
const RETRY = 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html';
const DLQ = 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html';
const ERRORS = 'https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html';

const order = {
  version: '0',
  'detail-type': 'OrderPlaced',
  source: 'shop.orders',
  account: '111122223333',
  region: 'eu-west-1',
  time: '2026-03-02T10:15:00Z',
  detail: { orderId: 'o-1001', tier: 'gold', amount: 120 },
};

/**
 * One event on an EventBridge bus: three rules, two of which match, and the Step Functions
 * execution that one of them starts. Account, region and ids are made-up example values.
 */
export const eventbridgeRouting = defineWalkthrough({
  id: 'eventbridge-routing',
  title: 'EventBridge: one event, three rules, a state machine',
  lead: 'An event reaches a bus. Each rule compares its pattern with the event; every rule that matches sends the event to its targets. One target starts a Step Functions execution, whose Task state retries a failure before it gives up.',
  tags: ['eventbridge', 'step-functions', 'event-driven'],

  layout: {
    panes: [
      {
        id: 'bus',
        panel: 'bus',
        title: 'Event bus',
        content: {
          channels: [
            {
              id: 'default',
              label: 'default',
              kind: 'bus',
              producers: [{ id: 'shop', label: 'shop.orders' }],
              events: [
                {
                  id: 'e1',
                  label: 'OrderPlaced',
                  data: {
                    source: 'shop.orders',
                    'detail-type': 'OrderPlaced',
                    detail: { tier: 'gold', amount: 120 },
                  },
                },
              ],
              rules: [
                {
                  id: 'r-order',
                  label: 'order-placed',
                  pattern: { source: ['shop.orders'], 'detail-type': ['OrderPlaced'] },
                  targets: [{ id: 'sfn', label: 'OrderWorkflow', sub: 'Step Functions' }],
                },
                {
                  id: 'r-vip',
                  label: 'vip-orders',
                  pattern: { detail: { tier: ['gold', 'platinum'] } },
                  targets: [{ id: 'notify', label: 'notify-sales', sub: 'Lambda' }],
                },
                {
                  id: 'r-refund',
                  label: 'refunds',
                  pattern: { 'detail-type': ['OrderRefunded'] },
                  targets: [{ id: 'refund', label: 'refund-fn', sub: 'Lambda' }],
                },
              ],
            },
          ],
        },
      },
      {
        id: 'body',
        panel: 'payload',
        title: 'The event',
        content: {
          payloads: [{ id: 'e1', title: 'Event e1', sub: 'what the rules look at', value: order }],
        },
      },
      {
        id: 'machine',
        panel: 'flow',
        title: 'State machine OrderWorkflow',
        content: {
          direction: 'RIGHT',
          nodes: [
            { id: 'validate', label: 'Validate' },
            { id: 'charge', label: 'Charge card', sub: 'Retry, then Catch' },
            { id: 'ship', label: 'Ship' },
            { id: 'done', label: 'Succeed', kind: 'terminal' },
            { id: 'failed', label: 'Order failed', kind: 'terminal' },
          ],
          edges: [
            { from: 'validate', to: 'charge' },
            { from: 'charge', to: 'ship', label: 'ok' },
            { from: 'ship', to: 'done' },
            { from: 'charge', to: 'failed', label: 'Catch' },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'bus',
      title: 'A bus and its rules',
      text: 'A rule has an event pattern and up to five targets. The bus does nothing with an event until a rule matches it.',
      calls: [
        {
          id: 'rules',
          label: 'Three rules on the bus',
          text: 'order-placed wants source shop.orders and detail-type OrderPlaced. vip-orders looks only at detail.tier. refunds wants a different detail-type.',
          where: `${RULES}; ${BUS}`,
          effects: {
            bus: [
              { read: 'default' },
              { read: 'r-order' },
              { read: 'r-vip' },
              { read: 'r-refund' },
            ],
          },
        },
      ],
    },
    {
      id: 'arrive',
      title: 'An event arrives',
      text: 'The producer puts an event on the bus. Events share the same top-level fields.',
      calls: [
        {
          id: 'put',
          label: 'shop.orders puts OrderPlaced on the bus',
          text: 'The panel compares the pattern of every rule with this event. Every field of a pattern has to match; a field matches when any of the values listed for it does. Two rules match and one does not.',
          where: `${PATTERNS} (all fields must match; the values of one field are alternatives)`,
          effects: {
            bus: [{ read: 'shop' }, { add: 'e1' }],
            body: [{ read: 'e1', paths: ['detail-type', 'source', 'detail.tier'] }],
          },
        },
      ],
    },
    {
      id: 'deliver',
      title: 'Matching rules deliver',
      text: 'An event can match more than one rule, and each matching rule sends it to all of its targets. A rule that does not match does nothing.',
      calls: [
        {
          id: 'start',
          label: 'order-placed starts the state machine',
          text: 'The target is a Step Functions state machine, which EventBridge lists as an asynchronous target: it does not wait for the execution to finish.',
          where:
            'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html (Step Functions state machine, ASYNC)',
          effects: {
            bus: [
              { update: 'e1', fields: { state: 'delivered' } },
              { read: 'r-order' },
              { update: 'sfn', fields: { state: 'execution started' } },
            ],
            machine: [{ read: 'validate' }],
          },
        },
        {
          id: 'notify',
          label: 'vip-orders calls notify-sales',
          text: 'The same event matches vip-orders because its tier is gold. refunds did not match, so refund-fn is not called.',
          effects: {
            bus: [
              { read: 'e1' },
              { read: 'r-vip' },
              { update: 'notify', fields: { state: 'invoked' } },
            ],
          },
        },
      ],
    },
    {
      id: 'execute',
      title: 'The execution',
      text: 'Inside the state machine a Task can fail without the whole execution failing.',
      calls: [
        {
          id: 'charge-fails',
          label: 'Charge card fails once',
          text: 'The Task state has a Retry field. Step Functions tries retriers first, and only a failure that retries do not resolve goes to the Catch. By default it waits 1 second, then doubles the wait, for at most 3 retries.',
          where: `${ERRORS} (IntervalSeconds 1, MaxAttempts 3, BackoffRate 2.0 by default; Retry is applied before Catch)`,
          effects: {
            machine: [{ read: 'validate.charge' }, { read: 'charge' }],
          },
        },
        {
          id: 'charge-ok',
          label: 'The retry succeeds and the order ships',
          text: 'The execution carries on to Ship and ends in Succeed.',
          effects: {
            machine: [
              { read: 'charge.ship' },
              { read: 'ship' },
              { read: 'ship.done' },
              { read: 'done' },
            ],
            bus: [{ update: 'sfn', fields: { state: 'execution succeeded', tone: 'good' } }],
          },
        },
      ],
    },
    {
      id: 'failure',
      title: 'When a target cannot be reached',
      text: 'Delivery to a target can fail too, for example when a function is throttled.',
      calls: [
        {
          id: 'retry-policy',
          label: 'Retries and a dead-letter queue',
          text: 'By default EventBridge retries delivery to a target for up to 24 hours and up to 185 times, with exponential back-off and jitter. An event that is still undelivered is then dropped, unless the target has a dead-letter queue, an SQS standard queue, set per target.',
          where: `${RETRY}; ${DLQ}`,
          effects: { bus: [{ read: 'notify' }] },
        },
      ],
    },
  ],
});
