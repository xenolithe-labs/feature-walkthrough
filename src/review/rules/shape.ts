import { LIST_LIMIT, listKeys, type Rule } from '../types';
import { normalise } from '../text';

const SKILL = 'walkthrough-design';

export const stepTextMissing: Rule = {
  id: 'design/step-text-missing',
  severity: 'info',
  source: `${SKILL} section 4 ("Give a step a one-sentence purpose")`,
  summary: 'Steps with no text of their own.',
  run({ walkthrough, prefix }) {
    const { steps } = walkthrough;
    const without = steps.filter((step) => (step.text ?? '').trim() === '');
    if (without.length === 0) return [];
    const first = steps.indexOf(without[0]!);
    const ids = listKeys(without.map((step) => step.id));
    return [
      {
        path: [...prefix, 'steps', first, 'text'],
        message:
          without.length === steps.length
            ? `no step has a text. A step is a phase the reader can name: give each a one-sentence purpose, and put the recap in its last call (steps: ${ids})`
            : `${without.length} of ${steps.length} steps have no text (${ids}). Give each a one-sentence purpose, or none: a reader should not have to guess what a step is for`,
      },
    ];
  },
};

export const stepTitleRepeated: Rule = {
  id: 'design/step-title-repeated',
  severity: 'warning',
  source: `${SKILL} section 4 ("A step is a phase the reader can name"), checklist 12`,
  summary: 'Two steps with the same title.',
  run({ walkthrough, prefix }) {
    const seen = new Map<string, number[]>();
    walkthrough.steps.forEach((step, index) => {
      const key = normalise(step.title);
      seen.set(key, [...(seen.get(key) ?? []), index]);
    });
    return [...seen.values()]
      .filter((indexes) => indexes.length > 1)
      .map((indexes) => ({
        path: [...prefix, 'steps', indexes[1]!, 'title'],
        message: `steps ${listKeys(indexes.map((index) => walkthrough.steps[index]!.id))} share the title "${walkthrough.steps[indexes[0]!]!.title}". A step names a phase the reader can tell from the others: say what differs`,
      }));
  },
};

const MOST_CALLS = 6;

export const stepShape: Rule = {
  id: 'design/step-shape',
  severity: 'info',
  source: `${SKILL} section 4 ("Typically 3 to 7 steps of 1 to 5 calls")`,
  summary:
    'A step with many more calls than the guidance, too few steps for the calls, or too many.',
  run({ walkthrough, prefix }) {
    const { steps } = walkthrough;
    const total = steps.reduce((sum, step) => sum + step.calls.length, 0);
    const out: ReturnType<Rule['run']> = [];
    const big = steps.filter((step) => step.calls.length > MOST_CALLS);
    if (big.length > 0) {
      out.push({
        path: [...prefix, 'steps', steps.indexOf(big[0]!)],
        message: `${big.length > 1 ? 'steps' : 'step'} ${big
          .map((step) => `"${step.id}" (${step.calls.length} calls)`)
          .slice(0, LIST_LIMIT)
          .join(
            ', ',
          )} hold more than ${MOST_CALLS} calls; a step is typically 1 to 5. Put a boundary where the reader's question changes or control passes to another actor`,
      });
    }
    if (steps.length < 3 && total >= 8) {
      out.push({
        path: [...prefix, 'steps'],
        message: `${total} calls in ${steps.length} step${steps.length === 1 ? '' : 's'}; typically 3 to 7 steps. Name the phases the reader passes through and cut the calls into them`,
      });
    }
    if (steps.length > 8) {
      out.push({
        path: [...prefix, 'steps'],
        message: `${steps.length} steps; typically 3 to 7. Merge steps whose question does not change, or split the walkthrough`,
      });
    }
    return out;
  },
};

export const noVisibleChange: Rule = {
  id: 'design/call-touches-nothing',
  severity: 'warning',
  source: `${SKILL} section 6 ("Highlight everything the call changes"; "A call that changes nothing ... is still a call"), checklist 11`,
  summary: 'A call that adds, updates, reads or removes nothing in any pane, and is not a message.',
  run({ calls }) {
    const idle = calls.filter((item) => !item.touchesAny && !item.isMessage);
    const focusOnly = (item: (typeof calls)[number]) =>
      Object.values(item.touches).some((touch) => touch.focused.size > 0);
    const message = (item: (typeof calls)[number]) =>
      `call "${item.key}" ${
        focusOnly(item)
          ? 'only centres a pane (focus), which marks nothing'
          : 'touches nothing in any pane'
      }, so the reader sees no mark. Use read for what it looks at or relies on, update for what it changes`;
    if (idle.length <= LIST_LIMIT) {
      return idle.map((item) => ({
        path: [...item.path, 'effects'],
        call: item.key,
        message: message(item),
      }));
    }
    return [
      {
        path: [...idle[0]!.path, 'effects'],
        call: idle[0]!.key,
        message: `${idle.length} of ${calls.length} calls touch nothing in any pane (${listKeys(idle.map((item) => item.key))}), so the reader sees no mark on them. Use read for what a call looks at or relies on, update for what it changes`,
      },
    ];
  },
};

export const callsWithoutPointer: Rule = {
  id: 'design/call-without-where',
  severity: 'info',
  source: `${SKILL} section 5 ("Support claims with a pointer"), section 8, checklist 20`,
  summary: 'Some calls have a `where` pointer and others do not.',
  run({ calls }) {
    const has = calls.filter((item) => (item.call.where ?? '').trim() !== '');
    if (has.length === 0 || has.length === calls.length) return [];
    const lacking = calls.filter((item) => (item.call.where ?? '').trim() === '');
    return [
      {
        path: [...lacking[0]!.path, 'where'],
        call: lacking[0]!.key,
        message: `${has.length} calls point to a source with where, but ${lacking.length} do not (${listKeys(lacking.map((item) => item.key))}). A claim with no pointer cannot be checked: add one (spec section, file and line, the command that produced the value), or say in the text that the value is assumed`,
      },
    ];
  },
};

/** Words that state what was cut, or which version or date the claims hold for. */
const SCOPE =
  /\b(omit(?:s|ted)?|left out|leaves? out|skips?|skipped|ignor(?:e|es|ed|ing)|not (?:shown|covered|modelled|modeled|included)|out of scope|simplif(?:y|ies|ied)|assum(?:e|es|ed|ing)|version|v\d+(?:\.\d+)*|as of|checked (?:on|against)|(?:19|20)\d\d)\b/i;

export const leadScope: Rule = {
  id: 'design/scope-not-stated',
  severity: 'info',
  source: `${SKILL} section 2 ("Say what you cut"), section 8 ("name the version and the date"), checklist 3`,
  summary:
    'Nowhere in the lead or the text is anything said about what was left out, or the version or date.',
  run({ walkthrough, calls, prefix }) {
    const where = [
      walkthrough.lead ?? '',
      ...walkthrough.steps.map((step) => step.text ?? ''),
      ...calls.map((item) => item.text),
    ].join('\n');
    if (SCOPE.test(where)) return [];
    return [
      {
        path: [...prefix, 'lead'],
        message:
          'nothing in the lead, the step texts or the call texts says what was left out, or which version or date the claims hold for. Add one line to the lead ("Omitted: retries and token expiry. Checked against RFC 7636, November 2026"), so the simplification is not read as the whole story',
      },
    ];
  },
};

export const shapeRules: Rule[] = [
  stepTextMissing,
  stepTitleRepeated,
  stepShape,
  noVisibleChange,
  callsWithoutPointer,
  leadScope,
];
