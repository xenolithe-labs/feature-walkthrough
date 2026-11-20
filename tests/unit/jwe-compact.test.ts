import { describe, expect, it } from 'vitest';
import { createFolder, formatProblem, loadConfig } from '../../src/core';
import { BytesContent } from '../../src/panels/bytes/model';
import { createRegistry } from '../../src/registry';
import { jweCompact } from '../../src/walkthroughs/jwe-compact';
import { CEK, CLAIMS_JSON, HEADER_JSON, b64u, buildJwe, openJwe } from '../helpers/jwe';

const loaded = loadConfig(jweCompact, createRegistry());
const pane = (id: string) => jweCompact.layout.panes.find((item) => item.id === id)!;
const token = BytesContent.parse(pane('token').content);
const [jwe, raw] = token.frames as [(typeof token.frames)[number], (typeof token.frames)[number]];
const payloads = (
  pane('decoded').content as { payloads: { id: string; value: Record<string, unknown> }[] }
).payloads;

describe('jwe-compact demo', () => {
  const built = buildJwe();

  it('lints clean', () => {
    expect(loaded.problems.map(formatProblem)).toEqual([]);
    expect(createFolder(loaded.walkthroughs[0]!).at(0, 0)).toBeDefined();
  });

  it('shows the token Node produces from the fixed demo key, IV and claims', () => {
    expect(jwe.fields.map((field) => field.value)).toEqual(built.parts);
    // Every declared size is the length of the text, and the frame's length the whole string.
    expect(jwe.fields.map((field) => field.size)).toEqual(built.parts.map((part) => part.length));
    expect(jwe.length).toBe(built.compact.length);
    expect(built.compact.split('.')).toHaveLength(5);
  });

  it('opens: the decoded header and claims are what the payload pane shows', () => {
    const opened = openJwe(built.compact);
    expect(opened.plaintext).toBe(CLAIMS_JSON);
    const header = JSON.parse(opened.header) as Record<string, unknown>;
    const shown = payloads.find((item) => item.id === 'header')!.value;
    expect({ ...shown, from: undefined }).toEqual({ ...header, from: undefined });
    expect(Object.keys(shown).filter((key) => key !== 'from')).toEqual(Object.keys(header));
    const claims = JSON.parse(CLAIMS_JSON) as Record<string, unknown>;
    const shownClaims = payloads.find((item) => item.id === 'claims')!.value;
    for (const [key, value] of Object.entries(claims)) expect(shownClaims[key]).toBe(value);
    // The card says the header is 63 bytes and the cek 256 bits.
    expect(Buffer.from(HEADER_JSON).length).toBe(63);
    expect(opened.cek.equals(CEK)).toBe(true);
    expect(payloads.find((item) => item.id === 'cek')!.value.length).toBe('256 bits');
  });

  it('shows the decoded bytes of segments 2 to 5 as hex', () => {
    const hex = (id: string) => raw.fields.find((field) => field.id === id)!.value;
    expect(hex('ekey')).toBe(built.encryptedKey.toString('hex'));
    expect(hex('iv')).toBe(Buffer.from(built.parts[2]!, 'base64url').toString('hex'));
    expect(hex('ciphertext')).toBe(built.ciphertext.toString('hex'));
    expect(hex('tag')).toBe(built.tag.toString('hex'));
    expect(raw.fields.map((field) => field.size)).toEqual([40, 12, 86, 16]);
    // AES key wrap adds 8 bytes to a 32-byte key; RFC 7518 section 5.3: 96-bit IV, 128-bit tag.
    expect(built.encryptedKey.length).toBe(CEK.length + 8);
  });

  it('rejects a header that was changed, because it is the additional authenticated data', () => {
    const other = b64u(HEADER_JSON.replace('demo-key-1', 'demo-key-2'));
    const forged = [other, ...built.parts.slice(1)].join('.');
    expect(() => openJwe(forged)).toThrow();
  });

  it('has a second segment that is not empty, unlike direct encryption', () => {
    expect(built.parts[1]).not.toBe('');
    expect(JSON.parse(HEADER_JSON)).toMatchObject({ alg: 'A256KW', enc: 'A256GCM' });
  });
});
