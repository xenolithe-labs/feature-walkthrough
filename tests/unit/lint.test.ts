import { describe, expect, it } from 'vitest';
import {
  Registry,
  configJsonSchema,
  defineWalkthrough,
  formatPath,
  formatProblem,
  loadConfig,
} from '../../src/core';
import { baseConfig, itemsPanel, testRegistry, type BaseConfig } from '../helpers/registry';

function problemsOf(config: unknown) {
  return loadConfig(config, testRegistry()).problems;
}

function bend(change: (config: BaseConfig) => void): BaseConfig {
  const config = baseConfig();
  change(config);
  return config;
}

/** One failing fixture per rule, with the path the problem must point at. */
const failing: Record<string, { config: unknown; path: string; severity?: 'warning' }> = {
  schema: {
    config: bend((config) => {
      (config.steps[0]!.calls[0] as Record<string, unknown>).label = 7;
    }),
    path: 'steps[0].calls[0].label',
  },
  'duplicate-id': {
    config: bend((config) => {
      config.steps[1]!.calls[2]!.id = 'ask';
    }),
    path: 'steps[1].calls[2].id',
  },
  'unknown-panel': {
    config: bend((config) => {
      config.layout.panes[0]!.panel = 'hologram';
    }),
    path: 'layout.panes[0].panel',
  },
  'unknown-pane': {
    config: bend((config) => {
      Object.assign(config.steps[1]!.calls[2]!, { effects: { nowhere: [{ add: 'a' }] } });
    }),
    path: 'steps[1].calls[2].effects.nowhere',
  },
  'unknown-lane': {
    config: bend((config) => {
      config.steps[0]!.calls[0]!.to = 'printer';
    }),
    path: 'steps[0].calls[0].to',
  },
  'unknown-id': {
    config: bend((config) => {
      Object.assign(config.steps[1]!.calls[2]!, { effects: { things: [{ add: 'zzz' }] } });
    }),
    path: 'steps[1].calls[2].effects.things[0].add',
  },
  'show-not-focus': {
    config: bend((config) => {
      config.steps[1]!.calls[0]!.show = 'things';
    }),
    path: 'steps[1].calls[0].show',
  },
  'absent-element': {
    config: bend((config) => {
      Object.assign(config.steps[1]!.calls[2]!, { effects: { things: [{ read: 'b' }] } });
    }),
    path: 'steps[1].calls[2].effects.things[0].read',
  },
  'already-present': {
    config: bend((config) => {
      Object.assign(config.steps[1]!.calls[2]!, { effects: { things: [{ add: 'seed' }] } });
    }),
    path: 'steps[1].calls[2].effects.things[0].add',
    severity: 'warning',
  },
  'summary-mismatch': {
    config: bend((config) => {
      config.steps[0]!.summary!.things!.add = ['a'];
    }),
    path: 'steps[0].summary.things.add',
  },
  'unknown-annotation': {
    config: bend((config) => {
      Object.assign(config.steps[0]!.calls[0]!, { annotations: { stars: 5 } });
    }),
    path: 'steps[0].calls[0].annotations.stars',
  },
  'items/bad-name': {
    config: bend((config) => {
      (config.layout.panes[0]!.content as { items: { id: string }[] }).items.push({
        id: 'bad-one',
      });
    }),
    path: 'layout.panes[0].content.items[4].id',
  },
  'mark/missing': {
    config: bend((config) => {
      Object.assign(config, { annotations: { mark: { required: true } } });
    }),
    path: 'steps[0].calls[0]',
  },
};

describe('lint rules', () => {
  it('passes the base config with no problems at all', () => {
    const result = loadConfig(baseConfig(), testRegistry());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.walkthroughs.map((walkthrough) => walkthrough.id)).toEqual(['demo']);
  });

  for (const [rule, fixture] of Object.entries(failing)) {
    it(`reports ${rule} at ${fixture.path}`, () => {
      const result = loadConfig(fixture.config, testRegistry());
      const hit = result.problems.find((problem) => problem.rule === rule);
      expect(hit, JSON.stringify(result.problems, null, 2)).toBeDefined();
      expect(formatPath(hit!.path)).toBe(fixture.path);
      expect(hit!.severity).toBe(fixture.severity ?? 'error');
      if (fixture.severity === 'warning') {
        expect(result.ok).toBe(true);
        expect(result.walkthroughs).toHaveLength(1);
      } else {
        expect(result.ok).toBe(false);
        expect(result.walkthroughs).toHaveLength(0);
      }
    });
  }
});

describe('lint details', () => {
  it('lists the registered panels when one is unknown', () => {
    const [problem] = problemsOf(failing['unknown-panel']!.config);
    expect(problem!.message).toContain('"items", "messages"');
  });

  it('says what a summary is missing and what it has too much of', () => {
    const config = bend((c) => {
      c.steps[0]!.summary!.things!.add = ['a', 'c'];
    });
    const [problem] = problemsOf(config);
    expect(problem!.message).toContain('the calls also add "b"');
    expect(problem!.message).toContain('no call does add "c"');
  });

  it('checks a summary against the effects a panel implies', () => {
    const config = bend((c) => {
      delete (c.steps[0]!.summary as Record<string, unknown>).log;
    });
    const hit = problemsOf(config).find((problem) => problem.rule === 'summary-mismatch');
    expect(formatPath(hit!.path)).toBe('steps[0].summary.log.add');
  });

  it('accepts an element again after it was removed', () => {
    const config = bend((c) => {
      Object.assign(c.steps[1]!.calls[2]!, { effects: { things: [{ add: 'b' }, { read: 'b' }] } });
    });
    expect(problemsOf(config)).toEqual([]);
  });

  it('rejects an effect with no verb, two verbs, or stray fields', () => {
    for (const effect of [{}, { add: 'a', remove: 'b' }, { read: 'seed', fields: { x: 1 } }]) {
      const config = bend((c) => {
        Object.assign(c.steps[1]!.calls[2]!, { effects: { things: [effect] } });
      });
      const result = loadConfig(config, testRegistry());
      expect(result.ok).toBe(false);
      expect(result.problems[0]!.rule).toBe('schema');
      expect(formatPath(result.problems[0]!.path)).toMatch(
        /^steps\[1\]\.calls\[2\]\.effects\.things\[0\]/,
      );
    }
  });

  it('rejects keys the contract does not know', () => {
    const config = bend((c) => {
      Object.assign(c, { colour: 'red' });
    });
    expect(problemsOf(config)[0]!.rule).toBe('schema');
  });

  it('reports invalid pane content at its path', () => {
    const config = bend((c) => {
      (c.layout.panes[0]!.content as Record<string, unknown>).items = 'nope';
    });
    const [problem] = problemsOf(config);
    expect(problem!.rule).toBe('schema');
    expect(formatPath(problem!.path)).toBe('layout.panes[0].content.items');
  });

  it('reports invalid annotation data at its path', () => {
    const config = bend((c) => {
      Object.assign(c.steps[0]!.calls[0]!, { annotations: { mark: { level: 'never' } } });
    });
    const [problem] = problemsOf(config);
    expect(formatPath(problem!.path)).toBe('steps[0].calls[0].annotations.mark.level');
  });

  it('formats a problem on one line', () => {
    const [problem] = problemsOf(failing['unknown-lane']!.config);
    expect(formatProblem(problem!)).toMatch(
      /^error unknown-lane at steps\[0\]\.calls\[0\]\.to: lane "printer"/,
    );
    expect(formatPath([])).toBe('(root)');
  });
});

describe('collections', () => {
  it('loads a list of walkthroughs and prefixes problem paths', () => {
    const second = bend((c) => {
      c.id = 'second';
      c.steps[0]!.calls[0]!.to = 'printer';
    });
    const result = loadConfig({ walkthroughs: [baseConfig(), second] }, testRegistry());
    expect(result.walkthroughs.map((walkthrough) => walkthrough.id)).toEqual(['demo']);
    expect(formatPath(result.problems[0]!.path)).toBe('walkthroughs[1].steps[0].calls[0].to');
  });

  it('rejects two walkthroughs with the same id', () => {
    const result = loadConfig({ walkthroughs: [baseConfig(), baseConfig()] }, testRegistry());
    expect(result.problems[0]).toMatchObject({
      rule: 'duplicate-id',
      path: ['walkthroughs', 1, 'id'],
    });
  });

  it('rejects input that is not a config', () => {
    for (const input of [null, 4, 'text', [], { walkthroughs: [] }]) {
      expect(loadConfig(input, testRegistry()).ok).toBe(false);
    }
  });
});

describe('registry and helpers', () => {
  it('refuses a second panel or plugin with the same id', () => {
    expect(() => testRegistry().registerPanel(itemsPanel)).toThrow(/already registered/);
    expect(new Registry().panel('items')).toBeUndefined();
  });

  it('defineWalkthrough returns the JSON it was given', () => {
    const config = baseConfig();
    expect(defineWalkthrough(config)).toBe(config);
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  it('exports a JSON Schema for the config', () => {
    const schema = configJsonSchema() as { anyOf?: unknown[] };
    expect(schema.anyOf).toHaveLength(2);
    expect(JSON.stringify(schema)).toContain('"walkthroughs"');
  });
});
