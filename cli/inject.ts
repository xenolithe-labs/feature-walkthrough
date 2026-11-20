/** Where the viewer page takes a config written into it. */
export const MARKER = '<!--fw-config-->';
const GLOBAL = '__FEATURE_WALKTHROUGH__';

/**
 * Writes a config into the viewer page as data. Every "<" is escaped, so no
 * text in a config can end the script element or start another one.
 */
export function injectConfig(page: string, config: unknown): string {
  if (!page.includes(MARKER)) throw new Error('the viewer page has no place for a config');
  // The config travels as a JSON text inside a string and is parsed on the page, so that it means
  // exactly what the file meant: written as an object literal, a key named "__proto__" would not.
  // U+2028 and U+2029 are line ends in older script parsers.
  const json = JSON.stringify(JSON.stringify(config))
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
  // A function, so that "$" in the config is not read as a replacement pattern.
  return page.replace(MARKER, () => `<script>window.${GLOBAL} = JSON.parse(${json});</script>`);
}
