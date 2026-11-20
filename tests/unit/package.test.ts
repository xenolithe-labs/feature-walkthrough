import { readFileSync } from 'node:fs';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { MARKER, injectConfig } from '../../cli/inject';
import { skillReference } from '../../scripts/skill-reference';
import { configJsonSchema, formatProblem, loadConfig } from '../../src/core';
import { createRegistry } from '../../src/registry';

describe('writing a config into the viewer page', () => {
  const page = `<head><title>x</title>${MARKER}</head><body></body>`;
  const read = (html: string): unknown => {
    const script = /<script>window\.__FEATURE_WALKTHROUGH__ = JSON\.parse\((.*)\);<\/script>/s.exec(
      html,
    );
    return JSON.parse(JSON.parse(script![1]!) as string);
  };

  it('round-trips the config', () => {
    const config = { id: 'a', title: 'costs $& and $1', list: [1, { b: null }] };
    expect(read(injectConfig(page, config))).toEqual(config);
  });

  it('cannot end the script element or start another', () => {
    const config = { text: '</script><script>alert(1)</script><!-- <img onerror=x>' };
    const html = injectConfig(page, config);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<!--');
    expect(read(html)).toEqual(config);
  });

  it('refuses a page with no place for a config', () => {
    expect(() => injectConfig('<html></html>', {})).toThrow(/no place/);
  });

  it('has its place in the page source', () => {
    expect(readFileSync('index.html', 'utf8')).toContain(MARKER);
  });
});

describe('generated files are up to date', () => {
  it('schema/walkthrough.schema.json (run "pnpm schema")', () => {
    const file: unknown = JSON.parse(readFileSync('schema/walkthrough.schema.json', 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(configJsonSchema())));
  });

  it('skills/feature-walkthrough/reference.md (run "pnpm skill")', async () => {
    const path = 'skills/feature-walkthrough/reference.md';
    const expected = await format(skillReference(createRegistry()), { filepath: path });
    expect(readFileSync(path, 'utf8')).toBe(expected);
  });
});

describe('the skill', () => {
  it('has an example that lints clean', () => {
    const example: unknown = JSON.parse(
      readFileSync('skills/feature-walkthrough/example.json', 'utf8'),
    );
    const result = loadConfig(example, createRegistry());
    expect(result.problems.map(formatProblem)).toEqual([]);
  });

  it('names every registered panel and annotation', () => {
    const skill = readFileSync('skills/feature-walkthrough/SKILL.md', 'utf8');
    const registry = createRegistry();
    for (const id of [...registry.panelIds(), ...registry.annotationIds()]) {
      expect(skill).toContain(`\`${id}\``);
    }
  });
});
