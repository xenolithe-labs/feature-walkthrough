import { LIST_LIMIT, listKeys, type Rule } from '../types';
import { normalise, type TextStats } from '../text';

/** The design skill's ceiling is "about 40 words in three sentences". */
export const WORD_CEILING = 40;
const WORD_LIMIT = 45;
const NEAR_CEILING = 32;

/** Over the ceiling by more than rounding: long, or four sentences that add up to a lot. */
export function overCeiling(stats: TextStats): boolean {
  return stats.words > WORD_LIMIT || (stats.sentences > 3 && stats.words > 36);
}

const SKILL = 'walkthrough-design';

export const textTooLong: Rule = {
  id: 'design/text-too-long',
  severity: 'warning',
  source: `${SKILL} section 5 (Length), checklist 16`,
  summary: 'A call whose text is over about 40 words, or runs past three sentences.',
  run({ calls }) {
    return calls.flatMap(({ key, path, stats }) => {
      if (!overCeiling(stats)) return [];
      return [
        {
          path: [...path, 'text'],
          call: key,
          message: `the text of call "${key}" has ${stats.words} words in ${stats.sentences} sentences; the ceiling is about ${WORD_CEILING} words in three. Keep the change and its values, then why; leave out what a pane already shows, or split the call if it carries two ideas`,
        },
      ];
    });
  },
};

export const textCrowded: Rule = {
  id: 'design/text-crowded',
  severity: 'info',
  source: `${SKILL} section 5 (Length): "if most of your calls are near the ceiling..."`,
  summary: 'Half or more of the calls sit near the word ceiling.',
  run({ calls, prefix }) {
    if (calls.length < 6) return [];
    const near = calls.filter(({ stats }) => stats.words >= NEAR_CEILING);
    if (near.length * 2 < calls.length) return [];
    return [
      {
        path: [...prefix, 'steps'],
        message: `${near.length} of ${calls.length} calls have ${NEAR_CEILING} words or more, close to the ceiling of about ${WORD_CEILING}. When most calls are this long, the calls carry two ideas or the panes do not carry the values: split calls, or put the values in the panes, instead of trimming words`,
      },
    ];
  },
};

export const textMissing: Rule = {
  id: 'design/text-missing',
  severity: 'warning',
  source: `${SKILL} section 5 (Text = what changed, why, and what to notice), checklist 17`,
  summary: 'A call with no text.',
  run({ calls }) {
    const missing = calls.filter(({ text }) => text === '');
    if (missing.length === 0) return [];
    if (missing.length <= LIST_LIMIT) {
      return missing.map(({ key, path }) => ({
        path: [...path, 'text'],
        call: key,
        message: `call "${key}" has no text; the reader sees only its name. Say what changed, with its values, and why it matters`,
      }));
    }
    return [
      {
        path: [...missing[0]!.path, 'text'],
        call: missing[0]!.key,
        message: `${missing.length} of ${calls.length} calls have no text (${listKeys(missing.map((item) => item.key))}). Say in each what changed, with its values, and why it matters`,
      },
    ];
  },
};

export const textDuplicate: Rule = {
  id: 'design/text-duplicate',
  severity: 'warning',
  source: `${SKILL} section 5 (Text), checklist 17; worked example B ("the same generic sentence")`,
  summary: 'The same text on several calls.',
  run({ calls }) {
    const groups = new Map<string, typeof calls>();
    for (const item of calls) {
      if (item.stats.words < 3) continue;
      const key = normalise(item.text);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const repeated = [...groups.values()]
      .filter((group) => group.length > 1)
      .sort((a, b) => b.length - a.length);
    if (repeated.length === 0) return [];
    const covered = repeated.reduce((sum, group) => sum + group.length, 0);
    const worst = repeated[0]!;
    const second = worst[1]!;
    return [
      {
        path: [...second.path, 'text'],
        call: second.key,
        message: `${covered} calls share ${repeated.length === 1 ? 'one text' : `${repeated.length} texts`} with other calls; the largest group is ${listKeys(worst.map((item) => item.key))}: "${worst[0]!.text.slice(0, 80)}${worst[0]!.text.length > 80 ? '...' : ''}". Each call states its own change: give each the values it handled, or merge calls that do the same thing. If they are alike loop iterations, show the first, the second and the one that differs, and say how many were skipped`,
      },
    ];
  },
};

const FORWARD =
  /\b(as we(?:'ll| will) see|we(?:'ll| will) see (?:later|below|shortly|next)|(?:explained|covered|described|discussed) (?:later|below|in a later)|more (?:on|about) this later|see (?:below|later)|later on we)\b/i;

export const textForwardReference: Rule = {
  id: 'design/text-forward-reference',
  severity: 'warning',
  source: `${SKILL} section 5 (One new term per call: "No forward references")`,
  summary: 'A text that points ahead ("as we will see").',
  run({ calls }) {
    return calls.flatMap(({ key, path, text }) => {
      const match = FORWARD.exec(text);
      if (match === null) return [];
      return [
        {
          path: [...path, 'text'],
          call: key,
          message: `the text of call "${key}" points ahead ("${match[0]}"); a reader who jumps here cannot follow it. Say what is needed now, and let the later call explain itself`,
        },
      ];
    });
  },
};

const LAYOUT =
  /\b(arrows?|(?:top|bottom)[- ](?:left|right)(?: corner)?|(?:left|right)[- ]hand (?:pane|side|panel)|highlighted|highlights?|(?:the )?(?:green|red|blue|yellow|orange|purple|amber|grey|gray) (?:row|cell|box|node|line|arrow|pane|badge|bar|dot|text))\b/i;

export const textNarratesLayout: Rule = {
  id: 'design/text-narrates-layout',
  severity: 'info',
  source: `${SKILL} section 5 (Stand alone: "Do not narrate the layout"), section 6 (Never colour alone), checklist 17`,
  summary: 'A text that says where something is on screen, or what colour it is.',
  run({ calls }) {
    return calls.flatMap(({ key, path, text }) => {
      const match = LAYOUT.exec(text);
      if (match === null) return [];
      return [
        {
          path: [...path, 'text'],
          call: key,
          message: `the text of call "${key}" describes the picture ("${match[0]}"). Name things by their own names and values, and say what changed or why, not where it is drawn or how it is coloured`,
        },
      ];
    });
  },
};

export const labelLong: Rule = {
  id: 'design/label-long',
  severity: 'info',
  source: `${SKILL} section 5 (Name = what happens, "in a short verb phrase"), checklist 15`,
  summary: 'A call name that runs past ten words.',
  run({ calls }) {
    return calls.flatMap(({ key, path, call }) => {
      const words = call.label.trim().split(/\s+/).length;
      if (words <= 10) return [];
      return [
        {
          path: [...path, 'label'],
          call: key,
          message: `the name of call "${key}" has ${words} words; a name is a short verb phrase ("POST /token", "Mark A3 dirty"). Move the rest to the text`,
        },
      ];
    });
  },
};

export const textRules: Rule[] = [
  textTooLong,
  textCrowded,
  textMissing,
  textDuplicate,
  textForwardReference,
  textNarratesLayout,
  labelLong,
];
