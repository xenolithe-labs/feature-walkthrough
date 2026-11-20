import { demos } from '../../src/walkthroughs';

type Pane = { id: string; role?: string; title?: string; [key: string]: unknown };

type Config = {
  id: string;
  title: string;
  layout: {
    view?: 'grid' | 'focus';
    panes: Pane[];
  };
  steps: {
    calls: { show?: string; effects?: Record<string, unknown[]>; [key: string]: unknown }[];
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};

const all = ('walkthroughs' in demos ? demos.walkthroughs : [demos]) as unknown as Config[];

function demo(id: string): Config {
  const found = all.find((item) => item.id === id);
  if (found === undefined) throw new Error(`no demo "${id}"`);
  return structuredClone(found);
}

/**
 * A bundled demo made to show `count` panes at once: every pane is fixed, and panes beyond the
 * demo's own are copies of earlier ones under new ids, with the same effects. With fewer panes
 * than the demo has, the extra panes and their effects are dropped.
 */
export function withPanes(id: string, count: number, view?: 'grid' | 'focus'): Config {
  const config = demo(id);
  const own: Pane[] = config.layout.panes.map((pane) => ({ ...pane, role: 'fixed' }));
  const panes = own.slice(0, count);
  for (let index = 0; panes.length < count; index += 1) {
    const from = own[index % own.length]!;
    panes.push({
      ...structuredClone(from),
      id: `${from.id}-copy${index}`,
      title: `Copy ${index + 1}`,
    });
  }
  const kept = new Set(panes.map((pane) => pane.id));
  for (const step of config.steps) {
    for (const call of step.calls) {
      delete call.show;
      const effects: Record<string, unknown[]> = {};
      for (const [pane, list] of Object.entries(call.effects ?? {})) {
        if (kept.has(pane)) effects[pane] = list;
        const copies = panes.filter((item) => item.id.startsWith(`${pane}-copy`));
        for (const copy of copies) effects[copy.id] = structuredClone(list);
      }
      call.effects = effects;
    }
  }
  config.id = `${id}-${count}-panes`;
  config.layout = { ...(view === undefined ? {} : { view }), panes };
  return config;
}
