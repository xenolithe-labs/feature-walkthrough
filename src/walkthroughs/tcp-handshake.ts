import { defineWalkthrough } from '../core';

const RFC = 'RFC 9293';

/** The 1-bit control flags in header order (RFC 9293 §3.1, Figure 1). */
const FLAGS = ['cwr', 'ece', 'urg', 'ack', 'psh', 'rst', 'syn', 'fin'] as const;

const flags = (on: readonly string[], decoded: Record<string, string> = {}) =>
  FLAGS.map((id) => ({
    id,
    label: id.toUpperCase(),
    short: id.toUpperCase(),
    size: 1,
    value: on.includes(id) ? 1 : 0,
    ...(decoded[id] === undefined ? {} : { decoded: decoded[id] }),
  }));

/**
 * The fixed 20 bytes of a TCP header (RFC 9293 §3.1) with the values of one segment. The
 * checksums are over the pseudo-header of RFC 9293 §3.1 with the documentation addresses
 * 192.0.2.10 (client) and 192.0.2.20 (server) of RFC 5737; `tests/unit/tcp-handshake.test.ts`
 * recomputes them and every other value shown here from the bytes of the segment.
 */
function header(segment: {
  sport: [string, string];
  dport: [string, string];
  seq: [number, string];
  acknum: [number, string];
  doff: number;
  on: readonly string[];
  flagNotes: Record<string, string>;
  checksum: string;
  urgent: string;
  options?: { value: string; decoded: string };
}) {
  const words = segment.doff;
  return [
    {
      id: 'sport',
      label: 'Source Port',
      size: 16,
      value: segment.sport[0],
      decoded: segment.sport[1],
    },
    {
      id: 'dport',
      label: 'Destination Port',
      size: 16,
      value: segment.dport[0],
      decoded: segment.dport[1],
    },
    {
      id: 'seq',
      label: 'Sequence Number',
      size: 32,
      value: segment.seq[0],
      decoded: segment.seq[1],
    },
    {
      id: 'acknum',
      label: 'Acknowledgment Number',
      size: 32,
      value: segment.acknum[0],
      decoded: segment.acknum[1],
    },
    {
      id: 'doff',
      label: 'Data Offset',
      short: 'Off',
      size: 4,
      value: words,
      decoded: `${words} words of 32 bits: the header is ${words * 4} bytes`,
      counts: {
        of: { from: 'sport', to: segment.options === undefined ? 'urgent' : 'options' },
        per: 32,
      },
    },
    { id: 'rsrvd', label: 'Reserved', short: 'Rsv', size: 4, value: 0, decoded: 'must be zero' },
    ...flags(segment.on, segment.flagNotes),
    { id: 'window', label: 'Window', size: 16, value: '0xffff', decoded: '65535 bytes' },
    {
      id: 'checksum',
      label: 'Checksum',
      size: 16,
      value: segment.checksum,
      decoded: 'over the pseudo-header, header and data',
    },
    {
      id: 'urgent',
      label: 'Urgent Pointer',
      size: 16,
      value: segment.urgent,
      decoded: 'not used: URG is clear',
    },
    ...(segment.options === undefined
      ? []
      : [
          {
            id: 'options',
            label: 'Options',
            size: 32,
            variable: true,
            value: segment.options.value,
            decoded: segment.options.decoded,
          },
        ]),
  ];
}

const MSS = {
  value: '02 04 05 b4',
  decoded: 'MSS: kind 2, length 4, 1460 bytes',
};

/**
 * The TCP three-way handshake, with the segments of RFC 9293 Figure 6 drawn bit by bit. The
 * sequence numbers are the ones in the RFC (100 and 300); the ports and the addresses used for
 * the checksum are made up. States and variables follow RFC 9293 §3.3 and §3.10.7.
 */
export const tcpHandshake = defineWalkthrough({
  id: 'tcp-handshake',
  title: 'TCP: the three-way handshake',
  lead: 'Two sides agree on starting sequence numbers before any data flows. Watch the header of each segment: the sequence and acknowledgment numbers and the SYN and ACK flags are what change, and each side’s state follows.',
  tags: ['tcp', 'networking'],

  lanes: [
    { id: 'client', title: 'Peer A (client)' },
    { id: 'server', title: 'Peer B (server)' },
  ],

  layout: {
    panes: [
      { id: 'wire', panel: 'sequence', title: 'On the wire' },
      {
        id: 'segment',
        panel: 'bytes',
        title: 'The segment, bit by bit',
        content: {
          initial: false,
          frames: [
            {
              id: 'seg',
              title: 'Segment 1: SYN',
              sub: 'client to server, with the MSS option',
              unit: 'bits',
              length: 192,
              cursor: { at: null, label: 'parsed to' },
              fields: header({
                sport: ['0xc000', '49152'],
                dport: ['0x01bb', '443'],
                seq: [100, 'the client’s initial sequence number'],
                acknum: [0, 'not used: ACK is clear'],
                doff: 6,
                on: ['syn'],
                flagNotes: { syn: 'set: synchronize sequence numbers', ack: 'clear' },
                checksum: '0x51e8',
                urgent: '0x0000',
                options: MSS,
              }),
            },
            {
              id: 'last',
              title: 'Segment 3: ACK',
              sub: 'client to server, no options',
              unit: 'bits',
              length: 160,
              cursor: { at: null, label: 'parsed to' },
              fields: header({
                sport: ['0xc000', '49152'],
                dport: ['0x01bb', '443'],
                seq: [101, 'one past the client’s SYN'],
                acknum: [301, 'the next sequence number the client expects'],
                doff: 5,
                on: ['ack'],
                flagNotes: { syn: 'clear', ack: 'set: the acknowledgment number is significant' },
                checksum: '0x6868',
                urgent: '0x0000',
              }),
              initial: false,
            },
          ],
        },
      },
      {
        id: 'state',
        panel: 'table',
        title: 'Each side’s state',
        content: {
          columns: [
            { id: 'peer', label: 'Peer' },
            { id: 'state', label: 'State', mono: true },
            { id: 'snd_nxt', label: 'SND.NXT', mono: true },
            { id: 'rcv_nxt', label: 'RCV.NXT', mono: true },
          ],
          rows: [
            {
              id: 'client',
              cells: { peer: 'A (client)', state: 'CLOSED', snd_nxt: '–', rcv_nxt: '–' },
            },
            {
              id: 'server',
              cells: { peer: 'B (server)', state: 'LISTEN', snd_nxt: '–', rcv_nxt: '–' },
            },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'waiting',
      title: 'Waiting',
      text: 'One side has to be ready before the other speaks. A server opens a socket passively and waits.',
      calls: [
        {
          id: 'listen',
          label: 'The server listens',
          from: 'server',
          to: 'server',
          text: 'A passive open: the server’s TCP is in LISTEN and has no connection yet. The client has nothing either (CLOSED is the idea of no connection, not a real state of any connection).',
          where: `${RFC} §3.3.2 (states), §3.5 Figure 6 line 1`,
          effects: { state: [{ read: 'server' }, { read: 'client' }] },
        },
      ],
    },
    {
      id: 'syn',
      title: 'SYN',
      text: 'The client asks to synchronise: it picks a starting sequence number and says so with the SYN flag.',
      calls: [
        {
          id: 'send-syn',
          label: 'The client sends SYN',
          from: 'client',
          to: 'server',
          text: 'SYN is set, ACK is not, so the acknowledgment number means nothing and is zero. The sequence number 100 is the client’s starting point. The header is 6 words long because of one option, the maximum segment size, which only SYN segments may carry. A SYN uses up one sequence number, so the client’s next one is 101.',
          where: `${RFC} §3.5 Figure 6 line 2; §3.1 (header, MSS option §3.2); §3.4 (SYN takes sequence space)`,
          request: { lang: 'text', text: '<SEQ=100><CTL=SYN>' },
          effects: {
            segment: [
              { add: 'seg' },
              { read: 'seg.seq' },
              { read: 'seg.syn' },
              { read: 'seg.doff' },
              { read: 'seg.options' },
            ],
            state: [{ update: 'client', fields: { state: 'SYN-SENT', snd_nxt: '101' } }],
          },
        },
        {
          id: 'receive-syn',
          label: 'The server receives SYN',
          from: 'server',
          to: 'server',
          text: 'The server reads the header from the front. The ports pick the listening socket, the sequence number 100 becomes the server’s record of where the client started, and the next number it expects is 101.',
          where: `${RFC} §3.10.7.2 (LISTEN state: RCV.NXT is set to SEG.SEQ+1)`,
          effects: {
            segment: [
              { update: 'seg.cursor', fields: { at: 64 } },
              { read: 'seg.sport' },
              { read: 'seg.dport' },
              { read: 'seg.seq' },
              { read: 'seg.syn' },
            ],
            state: [{ update: 'server', fields: { state: 'SYN-RECEIVED', rcv_nxt: '101' } }],
          },
        },
      ],
    },
    {
      id: 'syn-ack',
      title: 'SYN, ACK',
      text: 'The server answers with its own SYN and, in the same segment, acknowledges the client’s.',
      calls: [
        {
          id: 'send-syn-ack',
          label: 'The server sends SYN, ACK',
          from: 'server',
          to: 'client',
          text: 'Both flags are set. The ports swap. The sequence number 300 is the server’s starting point; the acknowledgment number 101 says everything before 101, which is the client’s SYN, has arrived. The server’s own next number is 301.',
          where: `${RFC} §3.5 Figure 6 line 3; §3.10.7.2 (the reply is <SEQ=ISS><ACK=RCV.NXT><CTL=SYN,ACK>)`,
          request: { lang: 'text', text: '<SEQ=300><ACK=101><CTL=SYN,ACK>' },
          effects: {
            segment: [
              {
                update: 'seg',
                fields: {
                  title: 'Segment 2: SYN, ACK',
                  sub: 'server to client, with the MSS option',
                },
              },
              { update: 'seg.cursor', fields: { at: null } },
              { update: 'seg.sport', fields: { value: '0x01bb', decoded: '443' } },
              { update: 'seg.dport', fields: { value: '0xc000', decoded: '49152' } },
              {
                update: 'seg.seq',
                fields: { value: 300, decoded: 'the server’s initial sequence number' },
              },
              {
                update: 'seg.acknum',
                fields: { value: 101, decoded: 'the next sequence number the server expects' },
              },
              {
                update: 'seg.ack',
                fields: { value: 1, decoded: 'set: the acknowledgment number is significant' },
              },
              { update: 'seg.checksum', fields: { value: '0x50ab' } },
            ],
            state: [{ update: 'server', fields: { snd_nxt: '301' } }],
          },
        },
        {
          id: 'receive-syn-ack',
          label: 'The client receives SYN, ACK',
          from: 'client',
          to: 'client',
          text: 'The client checks the acknowledgment number: 101 acknowledges its SYN, so its side is synchronised and the connection is ESTABLISHED for it. It records 300 as the server’s starting point and expects 301 next.',
          where: `${RFC} §3.5 Figure 6 line 3 (A is ESTABLISHED); §3.10.7.3 (SYN-SENT state)`,
          effects: {
            segment: [
              { update: 'seg.cursor', fields: { at: 96 } },
              { read: 'seg.seq' },
              { read: 'seg.acknum' },
              { read: 'seg.syn' },
              { read: 'seg.ack' },
            ],
            state: [{ update: 'client', fields: { state: 'ESTABLISHED', rcv_nxt: '301' } }],
          },
        },
      ],
    },
    {
      id: 'ack',
      title: 'ACK',
      text: 'One more segment closes the loop: the server learns that the client saw its SYN.',
      calls: [
        {
          id: 'send-ack',
          label: 'The client sends ACK',
          from: 'client',
          to: 'server',
          text: 'Only ACK is set. The sequence number is 101, not 102: an ACK takes no sequence number. The acknowledgment number 301 acknowledges the server’s SYN. With no option the header is back to 5 words. Segment 2 stays above, dimmed, to compare.',
          where: `${RFC} §3.5 Figure 6 line 4 (an ACK does not occupy sequence number space)`,
          request: { lang: 'text', text: '<SEQ=101><ACK=301><CTL=ACK>' },
          effects: {
            segment: [
              { update: 'seg', fields: { tone: 'muted' } },
              { update: 'seg.cursor', fields: { at: null } },
              { add: 'last' },
              { read: 'last.seq' },
              { read: 'last.acknum' },
              { read: 'last.doff' },
              { read: 'last.ack' },
            ],
            state: [{ read: 'client' }],
          },
        },
        {
          id: 'receive-ack',
          label: 'The server receives ACK',
          from: 'server',
          to: 'server',
          text: 'The acknowledgment number 301 covers the server’s SYN, so its side is synchronised too: both ends are ESTABLISHED and data may flow. A data segment would repeat sequence number 101, because the ACK used none.',
          where: `${RFC} §3.5 Figure 6 lines 4 and 5 (B is ESTABLISHED)`,
          effects: {
            segment: [
              { update: 'last.cursor', fields: { at: 96 } },
              { read: 'last.acknum' },
              { read: 'last.ack' },
            ],
            state: [{ update: 'server', fields: { state: 'ESTABLISHED' } }],
          },
        },
      ],
    },
  ],
});
