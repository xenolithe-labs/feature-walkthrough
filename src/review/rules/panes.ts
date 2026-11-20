import { LIST_LIMIT, listKeys, type Rule } from '../types';

const SKILL = 'walkthrough-design';

/** The panes a walkthrough puts on screen at once before the guidance asks for a reason. */
const MOST_PANES = 3;

export const paneNeverTouched: Rule = {
  id: 'design/pane-never-touched',
  severity: 'warning',
  source: `${SKILL} section 3 ("A view is wrong when it never changes across the whole walkthrough"), checklist 6`,
  summary: 'A pane that no call ever adds to, updates, reads or removes from.',
  run({ walkthrough, calls }) {
    return walkthrough.panes.flatMap((pane, index) => {
      if (calls.some((item) => item.touches[pane.id]?.any === true)) return [];
      return [
        {
          path: ['layout', 'panes', index],
          message: `no call touches pane "${pane.id}", so it never changes and is never relied on. Remove it and put what it shows in the text, or have the calls that depend on it read it`,
        },
      ];
    });
  },
};

export const paneIdleAfterStart: Rule = {
  id: 'design/pane-idle-after-start',
  severity: 'info',
  source: `${SKILL} section 3 ("A view is wrong when it never changes"), section 6 ("Keep the state the reader needs visible")`,
  summary: 'A pane touched only in the first call of a longer walkthrough.',
  run({ walkthrough, calls }) {
    if (calls.length < 5) return [];
    return walkthrough.panes.flatMap((pane, index) => {
      const touching = calls.filter((item) => item.touches[pane.id]?.any === true);
      if (touching.length === 0 || touching.some((item) => item.index > 0)) return [];
      return [
        {
          path: ['layout', 'panes', index],
          message: `pane "${pane.id}" is touched only by the first call of ${calls.length}, so it is a still picture for the rest. If later calls depend on what it holds, have them read it; if not, put it in the text`,
        },
      ];
    });
  },
};

export const focusNeverShown: Rule = {
  id: 'design/focus-pane-never-shown',
  severity: 'warning',
  source: `${SKILL} section 3 ("Choose two or three views")`,
  summary: 'A focus pane that no call ever shows.',
  run({ walkthrough, calls }) {
    return walkthrough.panes.flatMap((pane, index) => {
      if (pane.role !== 'focus') return [];
      if (calls.some((item) => item.focus === pane.id)) return [];
      return [
        {
          path: ['layout', 'panes', index],
          message: `focus pane "${pane.id}" is never shown: no call has show: "${pane.id}" (and it is not the first focus pane, which shows by default). Add show to the calls it belongs to, or remove the pane`,
        },
      ];
    });
  },
};

export const tooManyPanes: Rule = {
  id: 'design/too-many-panes',
  severity: 'warning',
  source: `${SKILL} section 3 ("A fourth needs a reason you can state in one sentence"), checklist 5`,
  summary: 'More than three panes on screen at one call.',
  run({ calls }) {
    let worst: (typeof calls)[number] | undefined;
    for (const item of calls) {
      if (item.visible.length > (worst?.visible.length ?? MOST_PANES)) worst = item;
    }
    if (worst === undefined) return [];
    const n = worst.visible.length;
    const first = calls.find((item) => item.visible.length === n)!;
    return [
      {
        path: ['layout', 'panes'],
        call: first.key,
        message: `${n} panes are on screen at call "${first.key}" (${worst.visible.map((id) => `"${id}"`).join(', ')}); the guidance is two or three, and a fourth needs a reason you can state in a sentence. Make the least important one a focus pane, fold its items into another pane as rows, or move them to the text`,
      },
    ];
  },
};

export const showFlips: Rule = {
  id: 'design/show-flips',
  severity: 'info',
  source: `${SKILL} section 6 ("Keep layout still between calls")`,
  summary: 'The shown focus pane changes on most calls and goes back to the one before.',
  run({ calls }) {
    if (calls.length < 6) return [];
    let switches = 0;
    let flips = 0;
    let firstFlip: (typeof calls)[number] | undefined;
    for (let i = 1; i < calls.length; i += 1) {
      if (calls[i]!.focus === calls[i - 1]!.focus) continue;
      switches += 1;
      const next = calls[i + 1];
      if (next !== undefined && next.focus === calls[i - 1]!.focus) {
        flips += 1;
        firstFlip ??= calls[i];
      }
    }
    if (flips < 3 || switches * 5 < calls.length * 2 || firstFlip === undefined) return [];
    return [
      {
        path: [...firstFlip.path, 'show'],
        call: firstFlip.key,
        message: `the focus pane changes ${switches} times in ${calls.length} calls and goes straight back ${flips} times (first at "${firstFlip.key}"), so the picture keeps moving. Show both panes together (make one fixed), or change the focus only where the reader's question changes`,
      },
    ];
  },
};

export const elementNeverShown: Rule = {
  id: 'design/element-never-shown',
  severity: 'warning',
  source: `${SKILL} section 3 ("A view is wrong when it never changes")`,
  summary: 'An element declared in a pane that starts absent and that no call adds.',
  run({ walkthrough, calls, elements }) {
    const out: ReturnType<Rule['run']> = [];
    walkthrough.panes.forEach((pane, index) => {
      const added = new Set<string>();
      for (const item of calls) for (const id of item.touches[pane.id]?.added ?? []) added.add(id);
      const never = [...(elements.get(pane.id) ?? [])]
        .filter(([id, element]) => !element.initial && !added.has(id))
        .map(([id]) => id);
      if (never.length === 0) return;
      out.push({
        path: ['layout', 'panes', index, 'content'],
        message: `in pane "${pane.id}", ${never.length === 1 ? 'the element' : 'elements'} ${listKeys(never)} start${never.length === 1 ? 's' : ''} absent and no call adds ${never.length === 1 ? 'it' : 'them'}, so the reader never sees ${never.length === 1 ? 'it' : 'them'}. Add ${never.length === 1 ? 'it' : 'them'} in the call that introduces ${never.length === 1 ? 'it' : 'them'}, or delete ${never.length === 1 ? 'it' : 'them'} from the content`,
      });
    });
    return out;
  },
};

export const elementFlash: Rule = {
  id: 'design/element-flash',
  severity: 'info',
  source: `${SKILL} section 6 ("Keep layout still"; "Highlight everything the call changes, and nothing else")`,
  summary: 'An element removed in the call right after it was added, so it shows for one call.',
  run({ walkthrough, calls }) {
    const out: ReturnType<Rule['run']> = [];
    for (let i = 1; i < calls.length; i += 1) {
      const now = calls[i]!;
      const before = calls[i - 1]!;
      for (const pane of walkthrough.panes) {
        const gone = [...(now.touches[pane.id]?.removed ?? [])].filter((id) =>
          before.touches[pane.id]?.added.has(id),
        );
        if (gone.length === 0) continue;
        out.push({
          path: now.path,
          call: now.key,
          message: `${gone.map((id) => `"${id}"`).join(', ')} is added in call "${before.key}" and removed in the next, "${now.key}", so it is on screen for one call only in pane "${pane.id}". Show it for as long as the idea needs, or leave it out and say it in the text`,
        });
      }
    }
    return out.length <= LIST_LIMIT
      ? out
      : [
          {
            ...out[0]!,
            message: `${out.length} elements are removed in the call after they are added; first: ${out[0]!.message}`,
          },
        ];
  },
};

export const paneRules: Rule[] = [
  paneNeverTouched,
  paneIdleAfterStart,
  focusNeverShown,
  tooManyPanes,
  showFlips,
  elementNeverShown,
  elementFlash,
];
