import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'skills/walkthrough-design';
const text = readFileSync(`${dir}/SKILL.md`, 'utf8');
const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
const front = match?.[1] ?? '';
const body = match?.[2] ?? '';

describe('the walkthrough-design skill', () => {
  it('has frontmatter with a name and a description', () => {
    expect(match).not.toBeNull();
    expect(front).toMatch(/^name: walkthrough-design$/m);
    expect(front).toMatch(/^description: .{80,}$/m);
  });

  it('points to the syntax skill and ships its sources and review', () => {
    expect(front).toContain('feature-walkthrough');
    expect(body).toContain('sources.md');
    expect(existsSync(`${dir}/sources.md`)).toBe(true);
    expect(existsSync(`${dir}/review.md`)).toBe(true);
  });

  it('leaks nothing about the schema', () => {
    for (const verb of ['add', 'update', 'read', 'remove', 'focus']) {
      expect(body).not.toMatch(new RegExp(`"${verb}"\\s*:`));
    }
    expect(body).not.toContain('"panel":');
    expect(body).not.toMatch(/"[A-Za-z_$][\w$]*"\s*:/); // no JSON key at all
    expect(body).not.toContain('```');
    expect(body).not.toMatch(/\blint\b|\beffects?\b|schema\.json|layout\.panes/i);
  });

  it('ends with a numbered review checklist', () => {
    const checklist = body.split('## Review checklist')[1] ?? '';
    expect(checklist.match(/^\d+\. /gm)?.length).toBeGreaterThanOrEqual(15);
  });
});
