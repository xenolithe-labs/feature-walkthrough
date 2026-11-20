/** A leaf that points at another element: `{ "$ref": "<element id>", "text": "shown text" }`. */
export interface Ref {
  $ref: string;
  text?: string;
}

export function isRef(value: unknown): value is Ref {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { $ref?: unknown }).$ref === 'string'
  );
}

export function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== 'object' || isRef(value);
}

/** The members of an object or array, as [key, value] pairs in order. */
export function members(value: unknown): [string, unknown][] {
  if (isLeaf(value)) return [];
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item as unknown]);
  return Object.entries(value as Record<string, unknown>);
}

/**
 * A path is keys and array positions joined by dots: "entries.1.hash". A key that itself
 * contains a dot or a backslash is written with a backslash in front of each of them: the key
 * "a.b" under "meta" is the path "meta.a\.b". Paths without a backslash read as they always did.
 */
export function splitPath(path: string): string[] {
  const keys: string[] = [];
  let key = '';
  for (let i = 0; i < path.length; i += 1) {
    const char = path[i]!;
    const after = path[i + 1];
    if (char === '\\' && (after === '.' || after === '\\')) {
      key += after;
      i += 1;
    } else if (char === '.') {
      keys.push(key);
      key = '';
    } else {
      key += char;
    }
  }
  keys.push(key);
  return keys;
}

/** The path of the member `key` of the value at `parent` ("" for the top level). */
export function joinPath(parent: string, key: string): string {
  const escaped = key.replace(/[\\.]/g, (char) => `\\${char}`);
  return parent === '' ? escaped : `${parent}.${escaped}`;
}

export function hasPath(value: unknown, path: string): boolean {
  let at = value;
  for (const key of splitPath(path)) {
    if (isLeaf(at)) return false;
    const found = members(at).find(([name]) => name === key);
    if (found === undefined) return false;
    at = found[1];
  }
  return true;
}

/** A copy of `value` with the member at `path` replaced. The path must exist. */
export function setPath(value: unknown, path: string, next: unknown): unknown {
  return setKeys(value, splitPath(path), next);
}

function setKeys(value: unknown, keys: string[], next: unknown): unknown {
  const [key, ...rest] = keys;
  if (key === undefined || isLeaf(value)) return value;
  const inner = (old: unknown) => (rest.length === 0 ? next : setKeys(old, rest, next));
  if (Array.isArray(value)) {
    return value.map((item, index) => (String(index) === key ? inner(item) : (item as unknown)));
  }
  const copy: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    copy[name] = name === key ? inner(item) : item;
  }
  return copy;
}

/** The declared value with a payload's patches applied, in the order they were made. */
export function patched(value: unknown, patch: Readonly<Record<string, unknown>> | undefined) {
  let result = value;
  for (const [path, next] of Object.entries(patch ?? {})) {
    if (path !== 'tone') result = setPath(result, path, next);
  }
  return result;
}
