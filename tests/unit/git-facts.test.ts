import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  blobs,
  commitText,
  commits,
  files,
  trees,
  type TreeEntry,
} from '../../src/walkthroughs/git-facts';

/** An object id the way git computes it: SHA-1 of "<type> <size>\0" and then the body. */
function objectId(type: string, body: Buffer): string {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]))
    .digest('hex');
}

/** A tree's body: per entry, "<mode> <name>\0" and then the 20 raw bytes of the hash. */
function treeBody(entries: readonly TreeEntry[]): Buffer {
  return Buffer.concat(
    entries.flatMap((entry) => [
      // Git writes a directory's mode without its leading zero.
      Buffer.from(`${entry.mode.replace(/^0/, '')} ${entry.name}\0`),
      Buffer.from(entry.hash, 'hex'),
    ]),
  );
}

describe('the git demo uses real object ids', () => {
  it.each(Object.keys(files) as (keyof typeof files)[])('blob %s', (name) => {
    expect(objectId('blob', Buffer.from(files[name]))).toBe(blobs[name]);
  });

  it.each(Object.keys(trees) as (keyof typeof trees)[])('tree %s', (name) => {
    expect(objectId('tree', treeBody(trees[name].entries))).toBe(trees[name].hash);
  });

  it.each(Object.keys(commits) as (keyof typeof commits)[])('commit %s', (name) => {
    expect(objectId('commit', Buffer.from(commitText(commits[name])))).toBe(commits[name].hash);
  });

  it('the edited file is 50 bytes, as the demo says', () => {
    expect(Buffer.from(files.greetAfter).length).toBe(50);
  });
});
