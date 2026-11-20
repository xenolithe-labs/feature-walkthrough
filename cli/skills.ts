/**
 * feature-walkthrough skills                        list the agent skills that ship with the package
 * feature-walkthrough skills install [name...]      copy them where an agent will find them
 * feature-walkthrough skills show <name>            print one skill's SKILL.md
 *
 * A skill is a folder with a SKILL.md that teaches a coding agent how to do something: here, how
 * to write a walkthrough config and how to design a walkthrough. Installing is a plain copy of the
 * folder; nothing is fetched from anywhere.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILLS_USAGE = `Usage:
  feature-walkthrough skills                      list the skills that ship with this package
  feature-walkthrough skills install [name...]    copy skills into ./.claude/skills (all of them, or the ones named)
  feature-walkthrough skills show <name>          print a skill's SKILL.md

Options for install:
      --to <dir>     the skills directory to copy into (default: ./.claude/skills)
      --global       copy into ~/.claude/skills, for every project
      --force        replace a skill that is already there

A skill is a folder of instructions for a coding agent. Agents that look elsewhere for skills
can be pointed at the folder with --to.`;

export interface SkillsIo {
  out(text: string): void;
  err(text: string): void;
  /** The directory that holds the shipped skill folders. */
  source: string | undefined;
  cwd: string;
  home: string;
}

export interface SkillsOptions {
  args: string[];
  to: string | undefined;
  global: boolean;
  force: boolean;
}

/** The shipped skills folder: beside the source in a checkout, above `dist` in the package. */
export function shippedSkills(from: string = import.meta.url): string | undefined {
  for (const up of ['../skills', '../../skills', '../../../skills']) {
    const path = fileURLToPath(new URL(up, from));
    if (existsSync(join(path, 'feature-walkthrough', 'SKILL.md'))) return path;
  }
  return undefined;
}

interface Skill {
  name: string;
  description: string;
  files: string[];
  path: string;
}

function filesOf(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? filesOf(path, `${prefix}${entry}/`)
      : [`${prefix}${entry}`];
  });
}

export function listSkills(source: string): Skill[] {
  return readdirSync(source)
    .filter((name) => existsSync(join(source, name, 'SKILL.md')))
    .sort()
    .map((name) => {
      const text = readFileSync(join(source, name, 'SKILL.md'), 'utf8');
      const front = text.startsWith('---') ? (text.split('---')[1] ?? '') : '';
      const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? '';
      return {
        name,
        description,
        files: filesOf(join(source, name)).sort(),
        path: join(source, name),
      };
    });
}

/** The first sentence of a description, for a list. */
function firstSentence(text: string): string {
  const end = text.indexOf('. ');
  return end < 0 ? text : text.slice(0, end + 1);
}

export function runSkills(options: SkillsOptions, io: SkillsIo): number {
  if (io.source === undefined) {
    io.err('the skills are not in this installation: expected a "skills" folder in the package');
    return 1;
  }
  const skills = listSkills(io.source);
  const [action, ...names] = options.args;

  if (action === undefined || action === 'list') {
    for (const skill of skills) {
      io.out(
        `${skill.name}\n  ${firstSentence(skill.description)}\n  files: ${skill.files.join(', ')}`,
      );
    }
    io.out(`\nCopy them where your agent looks for skills: feature-walkthrough skills install`);
    return 0;
  }

  const pick = (wanted: string[]): Skill[] | undefined => {
    const unknown = wanted.filter((name) => !skills.some((skill) => skill.name === name));
    if (unknown.length > 0) {
      io.err(
        `no skill named ${unknown.map((name) => `"${name}"`).join(', ')}. There are: ${skills.map((skill) => skill.name).join(', ')}`,
      );
      return undefined;
    }
    return wanted.length === 0 ? skills : skills.filter((skill) => wanted.includes(skill.name));
  };

  if (action === 'show') {
    if (names.length !== 1) {
      io.err(SKILLS_USAGE);
      return 2;
    }
    const chosen = pick(names);
    if (chosen === undefined) return 2;
    io.out(readFileSync(join(chosen[0]!.path, 'SKILL.md'), 'utf8').trimEnd());
    return 0;
  }

  if (action === 'install') {
    if (options.to !== undefined && options.global) {
      io.err('give --to or --global, not both');
      return 2;
    }
    const chosen = pick(names);
    if (chosen === undefined) return 2;
    const target = options.global
      ? join(io.home, '.claude', 'skills')
      : resolve(io.cwd, options.to ?? join('.claude', 'skills'));
    // Nothing is copied unless everything can be: a half-installed set is worse than none.
    const taken = chosen.filter((skill) => existsSync(join(target, skill.name)));
    if (taken.length > 0 && !options.force) {
      io.err(
        `already there: ${taken.map((skill) => join(target, skill.name)).join(', ')}. Nothing was copied. Use --force to replace ${taken.length === 1 ? 'it' : 'them'}`,
      );
      return 1;
    }
    mkdirSync(target, { recursive: true });
    for (const skill of chosen) {
      cpSync(skill.path, join(target, skill.name), { recursive: true, force: true });
      io.out(`copied ${skill.name} to ${join(target, skill.name)} (${skill.files.length} files)`);
    }
    return 0;
  }

  io.err(SKILLS_USAGE);
  return 2;
}

/** The io the command line uses. */
export function realIo(): SkillsIo {
  return {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => console.error(text),
    source: shippedSkills(),
    cwd: process.cwd(),
    home: homedir(),
  };
}
