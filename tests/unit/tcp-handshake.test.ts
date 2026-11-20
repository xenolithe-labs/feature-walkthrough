import { describe, expect, it } from 'vitest';
import { createFolder, formatProblem, loadConfig, type ElementsState } from '../../src/core';
import {
  BytesContent,
  hexBytes,
  numeric,
  valueOf,
  decodedOf,
  type FrameDecl,
} from '../../src/panels/bytes/model';
import { createRegistry } from '../../src/registry';
import { tcpHandshake } from '../../src/walkthroughs/tcp-handshake';

const loaded = loadConfig(tcpHandshake, createRegistry());
const walkthrough = loaded.walkthroughs[0]!;
const folder = createFolder(walkthrough);
const content = BytesContent.parse(
  tcpHandshake.layout.panes.find((pane) => pane.id === 'segment')!.content,
);

/** The calls in order: [step, call]. */
const AT = [
  [0, 0],
  [1, 0],
  [1, 1],
  [2, 0],
  [2, 1],
  [3, 0],
  [3, 1],
] as const;
const stateAt = (index: number, pane: string) =>
  folder.at(...(AT[index] as [number, number]))[pane]!.state as ElementsState;

/** The bytes of a segment, read from the frame's fields the way a receiver would parse them. */
function bytesOfFrame(frame: FrameDecl, state: ElementsState): Buffer {
  let bits = '';
  for (const field of frame.fields) {
    const value = valueOf(frame, field, state.patches);
    if (field.id === 'options') {
      bits += hexBytes(String(value))!
        .map((byte) => byte.toString(2).padStart(8, '0'))
        .join('');
    } else {
      bits += numeric('bits', value)!.toString(2).padStart(field.size!, '0');
    }
  }
  expect(bits.length % 8).toBe(0);
  return Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
}

const ip = (text: string) => text.split('.').map(Number);

/** RFC 9293 section 3.1: the ones' complement sum over the pseudo-header, header and data. */
function checksum(source: string, destination: string, segment: Buffer): number {
  const copy = Buffer.from(segment);
  copy.writeUInt16BE(0, 16);
  const all = Buffer.concat([
    Buffer.from([...ip(source), ...ip(destination), 0, 6, copy.length >> 8, copy.length & 255]),
    copy,
  ]);
  let sum = 0;
  for (let i = 0; i < all.length; i += 2) sum += (all[i]! << 8) + (all[i + 1] ?? 0);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

const CLIENT = '192.0.2.10';
const SERVER = '192.0.2.20';

describe('tcp-handshake demo', () => {
  it('lints clean', () => {
    expect(loaded.problems.map(formatProblem)).toEqual([]);
  });

  // RFC 9293 section 3.5, Figure 6: SEQ=100 SYN; SEQ=300 ACK=101 SYN,ACK; SEQ=101 ACK=301 ACK.
  const segments = [
    {
      name: 'SYN',
      call: 1,
      frame: 'seg',
      from: CLIENT,
      to: SERVER,
      seq: 100,
      ack: 0,
      flags: 0x02,
      header: 24,
    },
    {
      name: 'SYN,ACK',
      call: 3,
      frame: 'seg',
      from: SERVER,
      to: CLIENT,
      seq: 300,
      ack: 101,
      flags: 0x12,
      header: 24,
    },
    {
      name: 'ACK',
      call: 5,
      frame: 'last',
      from: CLIENT,
      to: SERVER,
      seq: 101,
      ack: 301,
      flags: 0x10,
      header: 20,
    },
  ];

  for (const segment of segments) {
    it(`${segment.name}: the bits shown are the segment of Figure 6, with a valid checksum`, () => {
      const frame = content.frames.find((item) => item.id === segment.frame)!;
      const bytes = bytesOfFrame(frame, stateAt(segment.call, 'segment'));
      expect(bytes.length).toBe(segment.header);
      expect(bytes.readUInt32BE(4)).toBe(segment.seq);
      expect(bytes.readUInt32BE(8)).toBe(segment.ack);
      // Data Offset counts 32-bit words of the header (RFC 9293 section 3.1).
      expect(bytes[12]! >> 4).toBe(segment.header / 4);
      expect(bytes[12]! & 0x0f).toBe(0);
      expect(bytes[13]).toBe(segment.flags);
      // The MSS option (kind 2, length 4, 1460) is only in SYN segments: section 3.2, MUST-65.
      if (segment.header === 24) expect([...bytes.subarray(20)]).toEqual([2, 4, 0x05, 0xb4]);
      const shown = bytes.readUInt16BE(16);
      expect(shown).toBe(checksum(segment.from, segment.to, bytes));
    });

    it(`${segment.name}: the decoded readings agree with the values`, () => {
      const frame = content.frames.find((item) => item.id === segment.frame)!;
      const state = stateAt(segment.call, 'segment');
      const reading = (id: string) => {
        const field = frame.fields.find((item) => item.id === id)!;
        return {
          value: numeric('bits', valueOf(frame, field, state.patches)),
          decoded: decodedOf(frame, field, state.patches),
        };
      };
      for (const id of ['sport', 'dport']) {
        expect(reading(id).decoded).toBe(String(reading(id).value));
      }
      expect(reading('window').decoded).toBe(`${reading('window').value} bytes`);
      expect(reading('doff').decoded).toContain(`${segment.header} bytes`);
    });
  }

  it('swaps the ports for the reply and sends the final ACK from the client again', () => {
    const frame = content.frames[0]!;
    const port = (index: number, id: string) =>
      numeric(
        'bits',
        valueOf(
          frame,
          frame.fields.find((f) => f.id === id)!,
          stateAt(index, 'segment').patches,
        ),
      );
    expect([port(1, 'sport'), port(1, 'dport')]).toEqual([49152n, 443n]);
    expect([port(3, 'sport'), port(3, 'dport')]).toEqual([443n, 49152n]);
  });

  it('follows the states and variables of Figure 6 and RFC 9293 section 3.10.7', () => {
    const cell = (index: number, row: string, column: string) => {
      const pane = tcpHandshake.layout.panes.find((item) => item.id === 'state')!;
      const rows = (pane.content as { rows: { id: string; cells: Record<string, string> }[] }).rows;
      const patch = stateAt(index, 'state').patches[row] as Record<string, string> | undefined;
      return patch?.[column] ?? rows.find((item) => item.id === row)!.cells[column];
    };
    const states = AT.map((_, index) => [
      cell(index, 'client', 'state'),
      cell(index, 'server', 'state'),
    ]);
    expect(states).toEqual([
      ['CLOSED', 'LISTEN'],
      ['SYN-SENT', 'LISTEN'],
      ['SYN-SENT', 'SYN-RECEIVED'],
      ['SYN-SENT', 'SYN-RECEIVED'],
      ['ESTABLISHED', 'SYN-RECEIVED'],
      ['ESTABLISHED', 'SYN-RECEIVED'],
      ['ESTABLISHED', 'ESTABLISHED'],
    ]);
    // A SYN takes one sequence number: after sending SEQ=100, SND.NXT is 101; after SEQ=300, 301.
    expect(cell(1, 'client', 'snd_nxt')).toBe('101');
    expect(cell(3, 'server', 'snd_nxt')).toBe('301');
    // RCV.NXT is SEG.SEQ+1 on receiving a SYN.
    expect(cell(2, 'server', 'rcv_nxt')).toBe('101');
    expect(cell(4, 'client', 'rcv_nxt')).toBe('301');
    // The pure ACK takes none: the client's SND.NXT is still 101 after it, and the final
    // segment's sequence number is 101 as well.
    expect(cell(5, 'client', 'snd_nxt')).toBe('101');
  });
});
