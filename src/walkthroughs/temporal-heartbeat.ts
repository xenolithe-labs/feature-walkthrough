import { defineWalkthrough } from '../core';

const FAILURES = 'https://docs.temporal.io/encyclopedia/detecting-activity-failures';
const RETRY = 'https://docs.temporal.io/encyclopedia/retry-policies';
const STEP_FUNCTIONS = 'https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskHeartbeat.html';

/**
 * A Temporal Activity that heartbeats, goes quiet, is timed out and retried. Names, counts and
 * times are made up. The semantics follow the Temporal documentation (links in `where`).
 */
export const temporalHeartbeat = defineWalkthrough({
  id: 'temporal-heartbeat',
  title: 'Temporal: a missed heartbeat and a retry',
  lead: 'A long Activity reports progress with heartbeats. Its worker dies, the Heartbeat Timeout passes without one, the attempt times out, and the retry policy starts attempt 2, which resumes from the last progress that was heartbeated.',
  tags: ['temporal', 'step-functions', 'timeouts'],

  layout: {
    panes: [
      {
        id: 'time',
        panel: 'timeline',
        title: 'Time',
        content: {
          axis: { unit: 's', from: 0, to: 56, tick: 4, pxPerUnit: 6 },
          rows: [
            { id: 'worker-a', label: 'Worker A', sub: 'attempt 1' },
            { id: 'server', label: 'Service', sub: 'timers' },
            { id: 'worker-b', label: 'Worker B', sub: 'attempt 2' },
          ],
          spans: [
            { id: 'a1', row: 'worker-a', from: 0, to: 22, label: 'attempt 1' },
            { id: 'backoff', row: 'server', from: 22, to: 24, label: 'backoff 2 s', kind: 'wait' },
            { id: 'a2', row: 'worker-b', from: 24, to: 44, label: 'attempt 2' },
          ],
          instants: [
            { id: 'hb1', row: 'worker-a', at: 4, label: 'hb 1', kind: 'heartbeat' },
            { id: 'hb2', row: 'worker-a', at: 8, label: 'hb 2', kind: 'heartbeat' },
            { id: 'hb3', row: 'worker-a', at: 12, label: 'hb 3', kind: 'heartbeat' },
            { id: 'crash', row: 'worker-a', at: 14, label: 'worker dies', state: 'failed' },
            { id: 'timeout', row: 'server', at: 22, label: 'timed out', state: 'failed' },
            { id: 'hb4', row: 'worker-b', at: 28, label: 'hb 4', kind: 'heartbeat' },
            { id: 'hb5', row: 'worker-b', at: 32, label: 'hb 5', kind: 'heartbeat' },
            { id: 'hb6', row: 'worker-b', at: 36, label: 'hb 6', kind: 'heartbeat' },
            { id: 'hb7', row: 'worker-b', at: 40, label: 'hb 7', kind: 'heartbeat' },
            { id: 'done', row: 'worker-b', at: 44, label: 'completed', state: 'ok' },
          ],
          limits: [
            {
              id: 'hbt1',
              row: 'worker-a',
              after: 10,
              from: 'a1',
              reset: 'heartbeat',
              until: 'a1',
              label: 'heartbeat timeout 10 s',
            },
            { id: 'stc1', row: 'worker-a', after: 30, from: 'a1', label: 'start-to-close 30 s' },
            {
              id: 'hbt2',
              row: 'worker-b',
              after: 10,
              from: 'a2',
              reset: 'heartbeat',
              until: 'a2',
              label: 'heartbeat timeout 10 s',
            },
            { id: 'stc2', row: 'worker-b', after: 30, from: 'a2', label: 'start-to-close 30 s' },
          ],
        },
      },
      {
        id: 'machine',
        panel: 'flow',
        title: 'One Activity Execution',
        content: {
          direction: 'DOWN',
          nodes: [
            { id: 'scheduled', label: 'Scheduled' },
            { id: 'started', label: 'Attempt running' },
            { id: 'heartbeat', label: 'Heartbeat recorded' },
            { id: 'completed', label: 'Completed', kind: 'terminal' },
            { id: 'timedout', label: 'Attempt timed out', sub: 'no heartbeat in time' },
            { id: 'backoff', label: 'Backoff wait', sub: 'retry policy' },
          ],
          edges: [
            { from: 'scheduled', to: 'started', label: 'a worker takes it' },
            { from: 'started', to: 'heartbeat' },
            { from: 'heartbeat', to: 'completed', label: 'returns' },
            { from: 'heartbeat', to: 'timedout', label: 'silence > timeout' },
            { from: 'timedout', to: 'backoff' },
            { from: 'backoff', to: 'scheduled', label: 'retry' },
          ],
        },
      },
      {
        id: 'details',
        panel: 'payload',
        title: 'Heartbeat details',
        content: {
          payloads: [
            {
              id: 'activity',
              title: 'Activity state',
              sub: 'what the service holds and the worker reads',
              value: {
                heartbeatTimeout: '10s',
                retryPolicy: { initialInterval: '2s', backoffCoefficient: 2.0 },
                attempt: 1,
                lastHeartbeatDetails: { processed: 0 },
                resumeFrom: 0,
                status: 'running',
              },
            },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'start',
      title: 'Attempt 1 starts',
      text: 'The Activity is configured with a Heartbeat Timeout of 10 seconds. Time starts at 0.',
      calls: [
        {
          id: 'begin',
          label: 'Worker A starts attempt 1',
          text: 'Two limits start with the attempt. Start-To-Close (30 s) bounds one attempt. The Heartbeat Timeout (10 s) is the longest silence the service accepts between heartbeats.',
          where: `${FAILURES} (Start-To-Close is applied to each attempt; Heartbeat Timeout)`,
          effects: {
            time: [{ read: 'a1' }, { read: 'hbt1' }, { read: 'stc1' }],
            machine: [{ read: 'scheduled' }, { read: 'started' }, { read: 'scheduled.started' }],
            details: [{ read: 'activity', paths: ['heartbeatTimeout', 'attempt'] }],
          },
        },
      ],
    },
    {
      id: 'beats',
      title: 'The Activity heartbeats',
      text: 'Each heartbeat restarts the silence limit and can carry progress.',
      calls: [
        {
          id: 'hb-1',
          label: 'Heartbeat 1 at 4 s',
          text: 'The Activity records how far it got: 1,200 records. The 10-second limit now runs to 14 s.',
          where: `${FAILURES} (custom progress information can be included in the Heartbeat)`,
          effects: {
            time: [{ update: 'now', fields: { at: 4 } }, { read: 'hbt1' }],
            machine: [{ read: 'heartbeat' }, { read: 'started.heartbeat' }],
            details: [{ update: 'activity', fields: { 'lastHeartbeatDetails.processed': 1200 } }],
          },
        },
        {
          id: 'hb-2',
          label: 'Heartbeat 2 at 8 s',
          text: 'The limit moves again, to 18 s. A worker may throttle heartbeats, so not every call to record one reaches the service.',
          where: `${FAILURES} (Throttling)`,
          effects: {
            time: [{ update: 'now', fields: { at: 8 } }, { read: 'hbt1' }],
            machine: [{ read: 'heartbeat' }],
            details: [{ update: 'activity', fields: { 'lastHeartbeatDetails.processed': 2400 } }],
          },
        },
        {
          id: 'hb-3',
          label: 'Heartbeat 3 at 12 s',
          text: 'Progress is 3,600 records and the limit is 22 s. This is the last heartbeat attempt 1 gets to send.',
          effects: {
            time: [{ update: 'now', fields: { at: 12 } }, { read: 'hbt1' }],
            machine: [{ read: 'heartbeat' }],
            details: [{ update: 'activity', fields: { 'lastHeartbeatDetails.processed': 3600 } }],
          },
        },
      ],
    },
    {
      id: 'silence',
      title: 'Silence',
      text: 'The service only knows what it is told. A dead worker and a slow one look the same.',
      calls: [
        {
          id: 'dies',
          label: 'Worker A dies at 14 s',
          text: 'The process is gone. Nothing tells the service: it just stops hearing heartbeats.',
          effects: { time: [{ update: 'now', fields: { at: 14 } }, { read: 'crash' }] },
        },
        {
          id: 'quiet',
          label: '20 s: eight seconds of silence',
          text: 'Since the last heartbeat at 12 s, 8 s have passed. The limit, 22 s, is still ahead.',
          effects: { time: [{ update: 'now', fields: { at: 20 } }, { read: 'hbt1' }] },
        },
        {
          id: 'timed-out',
          label: '22 s: the Heartbeat Timeout passes',
          text: 'No heartbeat arrived within 10 s of the last one. The attempt fails, and the retry policy decides what happens next. The 3,600 from the last heartbeat is kept for the next attempt.',
          where: `${FAILURES} (if the Heartbeat Timeout is reached, the Activity Task fails and a retry occurs if a Retry Policy dictates it)`,
          effects: {
            time: [
              { update: 'now', fields: { at: 22 } },
              { update: 'a1', fields: { state: 'failed' } },
              { read: 'hbt1' },
              { read: 'timeout' },
            ],
            machine: [{ read: 'timedout' }, { read: 'heartbeat.timedout' }],
            details: [{ update: 'activity', fields: { status: 'attempt 1 timed out' } }],
          },
        },
      ],
    },
    {
      id: 'retry',
      title: 'Retry with backoff',
      text: 'The default retry policy has an unlimited number of attempts, waits 1 s before the first retry and doubles the wait each time. Here the initial interval is set to 2 s.',
      calls: [
        {
          id: 'backoff',
          label: 'Backoff, then attempt 2 on Worker B',
          text: 'The Activity waits 2 s and is scheduled again. A worker, here Worker B, takes it, and the Start-To-Close timer starts over.',
          where: `${RETRY} (default: initial interval 1 s, coefficient 2.0, maximum interval 100 x initial, unlimited attempts)`,
          effects: {
            time: [
              { update: 'now', fields: { at: 24 } },
              { read: 'backoff' },
              { read: 'a2' },
              { read: 'hbt2' },
              { read: 'stc2' },
            ],
            machine: [
              { read: 'backoff' },
              { read: 'timedout.backoff' },
              { read: 'backoff.scheduled' },
              { read: 'scheduled' },
              { read: 'scheduled.started' },
              { read: 'started' },
            ],
            details: [
              {
                update: 'activity',
                fields: { attempt: 2, resumeFrom: 3600, status: 'attempt 2 running' },
              },
            ],
          },
        },
      ],
    },
    {
      id: 'resume',
      title: 'Attempt 2 resumes',
      text: 'The next attempt can read the last heartbeat details of the one that timed out, so it does not start from the beginning.',
      calls: [
        {
          id: 'hb-4',
          label: 'Heartbeat 4 at 28 s: from 3,600 to 4,800',
          text: 'Attempt 2 started at record 3,600, the value attempt 1 heartbeated last, and has done 1,200 more.',
          where: `${FAILURES} (if an Activity Task Execution times out due to a missed Heartbeat, the next Activity Task can access and continue with that payload)`,
          effects: {
            time: [{ update: 'now', fields: { at: 28 } }, { read: 'hbt2' }],
            machine: [{ read: 'heartbeat' }],
            details: [{ update: 'activity', fields: { 'lastHeartbeatDetails.processed': 4800 } }],
          },
        },
        {
          id: 'hb-5-7',
          label: 'Heartbeats 5 to 7, up to 40 s',
          text: 'Every 4 s a heartbeat, every time inside the 10 s limit.',
          effects: {
            time: [{ update: 'now', fields: { at: 40 } }, { read: 'hbt2' }],
            machine: [{ read: 'heartbeat' }],
            details: [{ update: 'activity', fields: { 'lastHeartbeatDetails.processed': 8400 } }],
          },
        },
        {
          id: 'complete',
          label: 'Attempt 2 completes at 44 s',
          text: 'The Activity returns 9,000 records processed. Both limits held for this attempt.',
          effects: {
            time: [
              { update: 'now', fields: { at: 44 } },
              { update: 'a2', fields: { state: 'ok' } },
              { read: 'hbt2' },
              { read: 'stc2' },
              { read: 'done' },
            ],
            machine: [{ read: 'completed' }, { read: 'heartbeat.completed' }],
            details: [
              {
                update: 'activity',
                fields: { 'lastHeartbeatDetails.processed': 9000, status: 'completed' },
              },
            ],
          },
        },
      ],
    },
    {
      id: 'step-functions',
      title: 'The same idea in Step Functions',
      text: 'A Step Functions Task state has HeartbeatSeconds too: a task that stays silent for longer fails with a timeout error, and a Retry field can try it again.',
      calls: [
        {
          id: 'compare',
          label: 'What a heartbeat carries',
          text: 'SendTaskHeartbeat takes only a task token. It cannot carry progress, so resuming from the last progress is not something the heartbeat does there: the task would keep it somewhere itself. In Temporal the progress travels with the heartbeat.',
          where: STEP_FUNCTIONS,
          effects: {
            details: [{ read: 'activity', paths: ['lastHeartbeatDetails'] }],
          },
        },
      ],
    },
  ],
});
