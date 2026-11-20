import { defineWalkthrough } from '../core';

const JWE = 'RFC 7516';
const JWA = 'RFC 7518';

/** The compact JWE shown here, and the bytes after decoding it. */
const SEGMENTS = {
  header: 'eyJhbGciOiJBMjU2S1ciLCJlbmMiOiJBMjU2R0NNIiwia2lkIjoiZGVtby1rZXktMSIsInR5cCI6IkpXVCJ9',
  ekey: 'C39XATKWENRbLHDRNt4RmCeYYf3TMsv2GfZQ77k1h591eL1YPFOU2g',
  iv: 'oKGio6Slpqeoqaqr',
  ciphertext:
    'ey0ZQy-CqRIWG3LG9zulqcRZdcRK-qxIuMHrS2yz8_DsC1uI_J-zpO2cpKOy7Qp33h4mNoSVxseTJ-TiKo2m_NfCWSM46GpmzWyULxFdboSS-IdtGM8',
  tag: 'Rski9s8a6fyH8PVW6kW0LQ',
};

const HEX = {
  ekey: '0b7f5701329610d45b2c70d136de1198279861fdd332cbf619f650efb935879f7578bd583c5394da',
  iv: 'a0a1a2a3a4a5a6a7a8a9aaab',
  ciphertext:
    '7b2d19432f82a912161b72c6f73ba5a9c45975c44afaac48b8c1eb4b6cb3f3f0ec0b5b88fc9fb3a4ed9ca4a3b2ed0a77de1e26368495c6c79327e4e22a8da6fcd7c2592338e86a66cd6c942f115d6e8492f8876d18cf',
  tag: '46c922f6cf1ae9fc87f0f556ea45b42d',
};

/**
 * A JWE in compact serialisation, opened step by step. The token was made by
 * `tests/helpers/jwe.ts` with Node's crypto (A256KW key wrapping, A256GCM content encryption, a
 * fixed demo key and IV so that the result is the same every time), and
 * `tests/unit/jwe-compact.test.ts` rebuilds it, decrypts it and compares every value shown here.
 */
export const jweCompact = defineWalkthrough({
  id: 'jwe-compact',
  title: 'JWE: opening a compact token',
  lead: 'A JSON Web Encryption in compact form is five base64url pieces joined by dots. Split it, decode the header, unwrap the key, and decrypt: each piece has its own job, and the first one is also the integrity input for the rest.',
  tags: ['jwe', 'jose', 'crypto'],

  layout: {
    panes: [
      {
        id: 'token',
        panel: 'bytes',
        title: 'The token and its bytes',
        content: {
          frames: [
            {
              id: 'jwe',
              title: 'JWE Compact Serialization',
              sub: 'five base64url values, four dots',
              unit: 'segments',
              separator: '.',
              length: 295,
              cursor: { at: 0, label: 'parser' },
              fields: [
                {
                  id: 'header',
                  label: 'Protected header',
                  size: 84,
                  value: SEGMENTS.header,
                  link: { $ref: 'header', text: 'decoded header' },
                },
                {
                  id: 'ekey',
                  label: 'Encrypted key',
                  size: 54,
                  value: SEGMENTS.ekey,
                  link: { $ref: 'raw.ekey', text: 'the key as bytes' },
                },
                {
                  id: 'iv',
                  label: 'Initialization vector',
                  size: 16,
                  value: SEGMENTS.iv,
                  link: { $ref: 'raw.iv', text: 'the IV as bytes' },
                },
                {
                  id: 'ciphertext',
                  label: 'Ciphertext',
                  size: 115,
                  value: SEGMENTS.ciphertext,
                  link: { $ref: 'claims', text: 'decrypted claims' },
                },
                {
                  id: 'tag',
                  label: 'Authentication tag',
                  size: 22,
                  value: SEGMENTS.tag,
                  link: { $ref: 'raw.tag', text: 'the tag as bytes' },
                },
              ],
            },
            {
              id: 'raw',
              title: 'After base64url decoding',
              sub: 'the bytes behind segments 2 to 5',
              unit: 'bytes',
              width: 16,
              ascii: true,
              length: 154,
              initial: false,
              fields: [
                { id: 'ekey', label: 'Encrypted key', size: 40, value: HEX.ekey },
                { id: 'iv', label: 'IV', size: 12, value: HEX.iv },
                {
                  id: 'ciphertext',
                  label: 'Ciphertext',
                  size: 86,
                  variable: true,
                  value: HEX.ciphertext,
                },
                { id: 'tag', label: 'Tag', size: 16, value: HEX.tag },
              ],
            },
          ],
        },
      },
      {
        id: 'decoded',
        panel: 'payload',
        title: 'What it decodes to',
        content: {
          initial: false,
          payloads: [
            {
              id: 'header',
              title: 'Protected header',
              sub: 'segment 1, decoded: UTF-8 JSON',
              value: {
                alg: 'A256KW',
                enc: 'A256GCM',
                kid: 'demo-key-1',
                typ: 'JWT',
                from: { $ref: 'jwe.header', text: 'segment 1' },
              },
            },
            {
              id: 'cek',
              title: 'Content encryption key',
              sub: 'unwrapped with the key encryption key (a demo value)',
              value: {
                length: '256 bits',
                from: { $ref: 'raw.ekey', text: 'unwrapped from the encrypted key' },
              },
            },
            {
              id: 'claims',
              title: 'Plaintext: the claims',
              sub: 'decrypted and authenticated',
              value: {
                iss: 'https://issuer.example',
                sub: 'user-123',
                aud: 'api.example',
                exp: 1900000000,
                from: { $ref: 'jwe.ciphertext', text: 'segment 4' },
              },
            },
          ],
        },
      },
    ],
  },

  steps: [
    {
      id: 'token',
      title: 'The token',
      text: 'What arrives is one string of URL-safe characters.',
      calls: [
        {
          id: 'whole',
          label: 'Five values, four dots',
          text: 'Segment 1 is the protected header, 2 the encrypted key, 3 the initialization vector, 4 the ciphertext and 5 the authentication tag, always in that order. The compact form has one recipient and no room for anything else. With a direct key (`alg: dir`) segment 2 would be empty and two dots would sit side by side.',
          where: `${JWE} §7.1; direct encryption: ${JWE} §5.2 step 10, ${JWA} §4.5`,
          effects: { token: [{ read: 'jwe' }] },
        },
      ],
    },
    {
      id: 'decode',
      title: 'Split and decode',
      text: 'Decoding starts with the front of the string.',
      calls: [
        {
          id: 'split',
          label: 'Split on the dots',
          text: 'Exactly four dots must be found; the five pieces between them are base64url text with no padding, no line breaks and no spaces.',
          where: `${JWE} §5.2 steps 1 and 2`,
          effects: {
            token: [
              { read: 'jwe.header' },
              { read: 'jwe.ekey' },
              { read: 'jwe.iv' },
              { read: 'jwe.ciphertext' },
              { read: 'jwe.tag' },
            ],
          },
        },
        {
          id: 'decode-header',
          label: 'Decode the header',
          text: 'Segment 1 decodes to 63 bytes of UTF-8 that must be a JSON object. In the compact form this is the whole JOSE header. Everything else to do depends on what it says.',
          where: `${JWE} §5.2 steps 2 to 4`,
          effects: {
            token: [
              { update: 'jwe.cursor', fields: { at: 85 } },
              {
                update: 'jwe.header',
                fields: { decoded: '63 bytes of JSON once decoded' },
              },
            ],
            decoded: [{ add: 'header' }],
          },
        },
        {
          id: 'read-header',
          label: 'Read what it asks for',
          text: '`alg` says how the content key reached us: A256KW means the encrypted key is the content key wrapped with a 256-bit AES key wrap. `enc` says how the content is encrypted: AES-256 in Galois/Counter Mode. A recipient must understand every parameter it is required to.',
          where: `${JWE} §5.2 steps 5 and 6; ${JWA} §4.4 (A256KW), §5.3 (A256GCM)`,
          effects: { decoded: [{ read: 'header', paths: ['alg', 'enc'] }] },
        },
      ],
    },
    {
      id: 'key',
      title: 'Unwrap the key',
      text: 'The other segments are binary data, base64url-encoded.',
      calls: [
        {
          id: 'decode-rest',
          label: 'Decode the rest',
          text: 'Decoded, the wrapped key is 40 bytes (a 32-byte key plus the 8 bytes AES key wrap adds), the IV is 12 bytes (96 bits is required for AES-GCM), and the tag is 16 bytes (128 bits). Longer than a couple of rows, the 86-byte ciphertext is drawn with a gap.',
          where: `${JWE} §5.2 step 2; ${JWA} §5.3 (96-bit IV, 128-bit tag)`,
          effects: {
            token: [
              { update: 'jwe.cursor', fields: { at: 295 } },
              { update: 'jwe.ekey', fields: { decoded: '40 bytes: a wrapped key' } },
              { update: 'jwe.iv', fields: { decoded: '12 bytes = 96 bits' } },
              { update: 'jwe.ciphertext', fields: { decoded: '86 bytes' } },
              { update: 'jwe.tag', fields: { decoded: '16 bytes = 128 bits' } },
              { add: 'raw' },
            ],
          },
        },
        {
          id: 'unwrap',
          label: 'Unwrap the content key',
          text: 'The recipient looks up the key encryption key named by `kid` and runs AES key wrap backwards. If the integrity check built into the wrap fails, the token is rejected. The result must be as long as the content algorithm needs: 256 bits.',
          where: `${JWE} §5.2 step 9; ${JWA} §4.4, RFC 3394 §2.2.2`,
          effects: {
            token: [{ read: 'raw.ekey' }],
            decoded: [{ add: 'cek' }],
          },
        },
      ],
    },
    {
      id: 'decrypt',
      title: 'Decrypt',
      text: 'Now everything needed for the authenticated decryption is in hand.',
      calls: [
        {
          id: 'aad',
          label: 'Take the header as written',
          text: 'The additional authenticated data is the ASCII of segment 1 exactly as it was sent, not the decoded JSON and not a re-encoding of it. Any change to the header, even a space, makes the tag check fail.',
          where: `${JWE} §5.2 steps 14 and 15`,
          effects: { token: [{ read: 'jwe.header' }] },
        },
        {
          id: 'open',
          label: 'Decrypt and check the tag',
          text: 'AES-256-GCM takes the content key, the IV, the ciphertext, the tag and the additional data. If the tag does not match, nothing is released. If it does, the plaintext is the claims of a JSON Web Token.',
          where: `${JWE} §5.2 step 16; ${JWA} §5.3; RFC 7519 §4.1 (claims)`,
          effects: {
            token: [
              { read: 'raw.iv' },
              { read: 'raw.ciphertext' },
              { read: 'raw.tag' },
              { read: 'jwe.ciphertext' },
            ],
            decoded: [{ read: 'cek' }, { add: 'claims' }],
          },
        },
      ],
    },
  ],
});
