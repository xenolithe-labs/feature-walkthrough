import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listSkills, runSkills, shippedSkills, type SkillsIo } from '../../cli/skills';

const made: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-skills-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], options: { to?: string; global?: boolean; force?: boolean } = {}) {
  const cwd = scratch();
  const home = scratch();
  const out: string[] = [];
  const err: string[] = [];
  const io: SkillsIo = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    source: 'skills',
    cwd,
    home,
  };
  const again = (more: typeof options = options) =>
    runSkills({ args, to: more.to, global: more.global === true, force: more.force === true }, io);
  return { code: again(), out, err, cwd, home, again };
}

describe('the skills the package ships', () => {
  it('are found from the command line source, and are the two in the repository', () => {
    const source = shippedSkills(new URL('../../cli/skills.ts', import.meta.url).href);
    expect(source).toBeDefined();
    expect(listSkills(source!).map((skill) => skill.name)).toEqual([
      'feature-walkthrough',
      'walkthrough-design',
    ]);
  });

  it('are listed with a description and their files', () => {
    const { code, out } = run([]);
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('feature-walkthrough\n');
    expect(out.join('\n')).toContain('walkthrough-design\n');
    expect(out.join('\n')).toContain('SKILL.md');
  });

  it('can be printed', () => {
    const { code, out } = run(['show', 'walkthrough-design']);
    expect(code).toBe(0);
    expect(out[0]).toMatch(/^---\nname: walkthrough-design/);
  });
});

describe('installing skills', () => {
  it('copies every skill into ./.claude/skills by default, file for file', () => {
    const { code, cwd } = run(['install']);
    expect(code).toBe(0);
    for (const skill of listSkills('skills')) {
      for (const file of skill.files) {
        expect(readFileSync(join(cwd, '.claude', 'skills', skill.name, file), 'utf8')).toBe(
          readFileSync(join('skills', skill.name, file), 'utf8'),
        );
      }
    }
  });

  it('copies only the skills named, into the directory given', () => {
    const { code, cwd } = run(['install', 'walkthrough-design'], { to: 'agent/skills' });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'agent', 'skills', 'walkthrough-design', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, 'agent', 'skills', 'feature-walkthrough'))).toBe(false);
  });

  it('copies into the home directory with --global', () => {
    const { code, home, cwd } = run(['install'], { global: true });
    expect(code).toBe(0);
    expect(existsSync(join(home, '.claude', 'skills', 'feature-walkthrough', 'SKILL.md'))).toBe(
      true,
    );
    expect(existsSync(join(cwd, '.claude'))).toBe(false);
  });

  it('does not replace a skill that is there, and copies nothing, unless forced', () => {
    const first = run(['install', 'feature-walkthrough']);
    const mine = join(first.cwd, '.claude', 'skills', 'feature-walkthrough', 'SKILL.md');
    writeFileSync(mine, 'my edits');
    // Asking for both now: one is taken, so neither is copied.
    expect(first.again()).toBe(1);
    expect(first.err.join('\n')).toContain('Nothing was copied');
    expect(readFileSync(mine, 'utf8')).toBe('my edits');
    expect(first.again({ force: true })).toBe(0);
    expect(readFileSync(mine, 'utf8')).toMatch(/^---\nname: feature-walkthrough/);
  });

  it('refuses a name it does not have, and --to with --global', () => {
    const unknown = run(['install', 'no-such-skill']);
    expect(unknown.code).toBe(2);
    expect(unknown.err.join('\n')).toContain('There are: feature-walkthrough, walkthrough-design');
    expect(run(['install'], { to: 'x', global: true }).code).toBe(2);
  });
});
