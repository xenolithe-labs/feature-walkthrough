import { createCipheriv, createDecipheriv } from 'node:crypto';

/** Demo-only key material: patterns, not secrets. Everything below is deterministic. */
export const KEK = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
export const CEK = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x80 + i));
export const IV = Buffer.from(Array.from({ length: 12 }, (_, i) => 0xa0 + i));
/** RFC 3394 section 2.2.3.1: the default initial value of AES Key Wrap (RFC 7518 section 4.4). */
const KW_IV = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');

export const HEADER_JSON = '{"alg":"A256KW","enc":"A256GCM","kid":"demo-key-1","typ":"JWT"}';
export const CLAIMS_JSON =
  '{"iss":"https://issuer.example","sub":"user-123","aud":"api.example","exp":1900000000}';

export const b64u = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** A JWE Compact Serialization (RFC 7516 section 7.1) with A256KW key wrapping and A256GCM. */
export function buildJwe() {
  const encodedHeader = b64u(HEADER_JSON);
  const wrap = createCipheriv('id-aes256-wrap', KEK, KW_IV);
  const encryptedKey = Buffer.concat([wrap.update(CEK), wrap.final()]);
  // RFC 7516 section 5.1 step 14/15 (the AAD is the ASCII of the encoded header); RFC 7518
  // section 5.3: a 96-bit IV and a 128-bit tag.
  const gcm = createCipheriv('aes-256-gcm', CEK, IV, { authTagLength: 16 });
  gcm.setAAD(Buffer.from(encodedHeader, 'ascii'));
  const ciphertext = Buffer.concat([gcm.update(CLAIMS_JSON, 'utf8'), gcm.final()]);
  const tag = gcm.getAuthTag();
  const parts = [encodedHeader, b64u(encryptedKey), b64u(IV), b64u(ciphertext), b64u(tag)];
  return { parts, compact: parts.join('.'), encryptedKey, ciphertext, tag };
}

/** The reverse, step by step as RFC 7516 section 5.2 lists it. */
export function openJwe(compact: string) {
  const parts = compact.split('.');
  if (parts.length !== 5) throw new Error('a compact JWE has five parts');
  const [header, key, iv, ciphertext, tag] = parts.map((part) =>
    Buffer.from(part, 'base64url'),
  ) as [Buffer, Buffer, Buffer, Buffer, Buffer];
  const unwrap = createDecipheriv('id-aes256-wrap', KEK, KW_IV);
  const cek = Buffer.concat([unwrap.update(key), unwrap.final()]);
  const gcm = createDecipheriv('aes-256-gcm', cek, iv, { authTagLength: 16 });
  gcm.setAAD(Buffer.from(parts[0]!, 'ascii'));
  gcm.setAuthTag(tag);
  const plaintext = Buffer.concat([gcm.update(ciphertext), gcm.final()]).toString('utf8');
  return { header: header.toString('utf8'), cek, plaintext };
}
