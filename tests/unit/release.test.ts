import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const example = readFileSync('scripts/secrets/mapping.example.tsv', 'utf8');
const rows = example
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'))
  .map((line) => line.split('\t'));

describe('the secrets mapping', () => {
  it('has well-formed rows in the example', () => {
    for (const row of rows) {
      expect(row).toHaveLength(4);
      expect(row[0]).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(['github', 'local']).toContain(row[1]);
      expect(['yes', 'opt']).toContain(row[2]);
      expect(row[3]).toMatch(/^op:\/\/[^/]+\/[^/]+\/.+$/);
    }
  });

  it('holds only placeholders in the example, never a real vault or item', () => {
    for (const row of rows) expect(row[3]).toMatch(/^op:\/\/YOUR_[A-Z_]+\/YOUR_[A-Z_]+\//);
  });

  it('names every secret the workflows use', () => {
    const pushed = new Set(rows.filter((row) => row[1] === 'github').map((row) => row[0]));
    const used = new Set<string>();
    for (const file of readdirSync('.github/workflows')) {
      const text = readFileSync(`.github/workflows/${file}`, 'utf8');
      for (const match of text.matchAll(/secrets\.([A-Z0-9_]+)/g)) used.add(match[1]!);
    }
    used.delete('GITHUB_TOKEN');
    expect([...used].sort()).toEqual([...pushed].sort());
  });

  it('keeps the real mapping and local credential files out of git', () => {
    for (const path of ['scripts/secrets/mapping.tsv', '.env', '.env.local', '.npmrc']) {
      // Exits 0 only when the path is ignored.
      execFileSync('git', ['check-ignore', '-q', path]);
    }
    const tracked = execFileSync('git', ['ls-files', 'scripts/secrets'], { encoding: 'utf8' });
    expect(tracked.split('\n')).not.toContain('scripts/secrets/mapping.tsv');
  });
});

describe('the release workflow', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

  it('stores no npm token: npm trusts the workflow instead', () => {
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
    expect(workflow).toMatch(/id-token: write/);
  });

  it('stages for approval and never publishes directly', () => {
    expect(workflow).toMatch(/npm stage publish/);
    expect(workflow).not.toMatch(/npm publish/);
  });
});
