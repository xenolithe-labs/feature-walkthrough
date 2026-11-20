import { defineWalkthrough } from '../core';

/**
 * A client that retries with a growing delay until a service answers. It exists to show the
 * sequence panel's `loop` and `par` frames, a lost message and an asynchronous one. Every name,
 * count and delay is a made-up example.
 */
export const retryBackoff = defineWalkthrough({
  id: 'retry-backoff',
  title: 'Retrying with backoff',
  lead: 'A client asks a service for a report. The first request is lost, the second meets a busy service, the third succeeds. Between tries the client waits longer each time, so a struggling service is not hit again at once.',
  tags: ['reliability', 'retries'],

  lanes: [
    { id: 'client', title: 'Client' },
    { id: 'service', title: 'Service' },
    { id: 'metrics', title: 'Metrics' },
  ],

  layout: {
    panes: [
      {
        id: 'exchange',
        panel: 'sequence',
        title: 'Messages',
        content: {
          styles: {
            'try-1': 'lost',
            'busy-2': 'reply',
            'count-2': 'async',
            'ok-3': 'reply',
          },
          fragments: [
            {
              id: 'retrying',
              kind: 'loop',
              label: 'until a try succeeds, at most 5 tries',
              from: 'try-1',
              to: 'ok-3',
            },
            {
              id: 'at-once',
              kind: 'par',
              label: 'record the failure',
              from: 'count-2',
              to: 'wait-2',
              branches: [{ at: 'wait-2', label: 'back off' }],
            },
          ],
          notes: [
            {
              id: 'doubling',
              at: 'wait-2',
              over: 'client',
              text: 'the wait doubles each try',
            },
          ],
        },
      },
      {
        id: 'logic',
        panel: 'flow',
        title: 'The client’s loop',
        content: {
          direction: 'RIGHT',
          nodes: [
            { id: 'send', label: 'Send the request' },
            { id: 'answer', label: 'Answer?', kind: 'decision' },
            { id: 'wait', label: 'Wait', sub: 'twice as long as last time' },
            { id: 'done', label: 'Use the reply', kind: 'terminal' },
          ],
          edges: [
            { from: 'send', to: 'answer' },
            { from: 'answer', to: 'done', label: '200' },
            { from: 'answer', to: 'wait', label: 'none or 503' },
            { from: 'wait', to: 'send' },
          ],
        },
      },
      {
        id: 'tries',
        panel: 'table',
        title: 'Tries',
        content: {
          columns: [
            { id: 'try', label: 'Try' },
            { id: 'waited', label: 'Waited before', mono: true },
            { id: 'result', label: 'Result' },
          ],
          rows: [
            { id: 't1', initial: false, cells: { try: '1', waited: '0 s', result: '' } },
            { id: 't2', initial: false, cells: { try: '2', waited: '1 s', result: '' } },
            { id: 't3', initial: false, cells: { try: '3', waited: '2 s', result: '' } },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'lost',
      title: 'A lost request',
      text: 'The client has no way to tell a lost request from a slow service, so it waits for a limit and then gives up on that try.',
      calls: [
        {
          id: 'try-1',
          label: 'GET /report',
          from: 'client',
          to: 'service',
          text: 'The request is dropped on the way. The service never sees it, so nothing comes back.',
          effects: { logic: [{ read: 'send' }], tries: [{ add: 't1' }] },
        },
        {
          id: 'timeout-1',
          label: 'No answer after 3 s',
          from: 'client',
          to: 'client',
          text: 'The client’s own timer runs out. This try has failed.',
          effects: {
            logic: [{ read: 'answer' }, { read: 'answer.wait' }],
            tries: [{ update: 't1', fields: { result: 'no answer' } }],
          },
        },
        {
          id: 'wait-1',
          label: 'Back off 1 s',
          from: 'client',
          to: 'client',
          text: 'Before the next try the client waits a short while, so that a service that is only briefly unavailable has time to recover.',
          effects: { logic: [{ read: 'wait' }] },
        },
      ],
    },
    {
      id: 'busy',
      title: 'A busy service',
      text: 'The second try reaches the service, which says it cannot help right now.',
      calls: [
        {
          id: 'try-2',
          label: 'GET /report (try 2)',
          from: 'client',
          to: 'service',
          text: 'The same request, sent again.',
          effects: { logic: [{ read: 'wait.send' }, { read: 'send' }], tries: [{ add: 't2' }] },
        },
        {
          id: 'busy-2',
          label: '503 Service Unavailable',
          from: 'service',
          to: 'client',
          text: 'The service answers, but with an error that means “try again later”.',
          effects: {
            logic: [{ read: 'answer' }, { read: 'answer.wait' }],
            tries: [{ update: 't2', fields: { result: '503' } }],
          },
        },
        {
          id: 'count-2',
          label: 'Count the failure',
          from: 'client',
          to: 'metrics',
          text: 'The client reports the failure and does not wait for an answer: an asynchronous message, drawn with an open arrowhead.',
          effects: { logic: [{ read: 'answer' }] },
        },
        {
          id: 'wait-2',
          label: 'Back off 2 s',
          from: 'client',
          to: 'client',
          text: 'At the same time the client starts its wait, now twice as long as the last one. The two boxes inside the frame happen in parallel.',
          effects: { logic: [{ read: 'wait' }] },
        },
      ],
    },
    {
      id: 'recovered',
      title: 'It recovers',
      text: 'The third try finds a service that has recovered.',
      calls: [
        {
          id: 'try-3',
          label: 'GET /report (try 3)',
          from: 'client',
          to: 'service',
          text: 'Another try, after the longer wait.',
          effects: { logic: [{ read: 'wait.send' }, { read: 'send' }], tries: [{ add: 't3' }] },
        },
        {
          id: 'ok-3',
          label: '200 OK',
          from: 'service',
          to: 'client',
          text: 'The report comes back and the loop ends. The client stops retrying as soon as one try succeeds.',
          effects: {
            logic: [{ read: 'answer' }, { read: 'answer.done' }, { read: 'done' }],
            tries: [{ update: 't3', fields: { result: '200 OK' } }],
          },
        },
      ],
    },
  ],
});
