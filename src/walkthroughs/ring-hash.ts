/**
 * A real hash for the ring demo, in plain TypeScript so that it runs in the browser: MD5, which
 * is the hash the Dynamo paper names for turning a key into a position (section 4.1). The
 * tests check it against `node:crypto`. MD5 is used here to spread names over a ring, not to
 * protect anything.
 */
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const CONSTANTS = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

const rotate = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

/** The MD5 digest of the UTF-8 bytes of `text`, as 32 lower-case hex digits. */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor((bytes.length * 8) / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => view.getUint32(offset + i * 4, true));
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + CONSTANTS[i]! + words[g]!) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotate(f, SHIFTS[(i >> 4) * 4 + (i % 4)]!)) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((word, i) => out.setUint32(i * 4, word, true));
  return Array.from({ length: 16 }, (_, i) => out.getUint8(i).toString(16).padStart(2, '0')).join(
    '',
  );
}

/** Where `text` lands in a space of `size` positions: its 128-bit MD5 as a number, mod `size`. */
export const hashPosition = (text: string, size: number): number =>
  Number(BigInt(`0x${md5(text)}`) % BigInt(size));
