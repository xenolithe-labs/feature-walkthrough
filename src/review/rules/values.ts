import { effectTarget, type ResolvedPane, type ResolvedWalkthrough } from '../../core';
import { codeSpans, mentions } from '../text';
import { listKeys, type RawFinding, type Rule } from '../types';

const SKILL = 'walkthrough-design';

/** The ids of the elements present in a pane state, when the state keeps them the usual way. */
export function presentIds(state: unknown): ReadonlySet<string> | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const present = (state as { present?: unknown }).present;
  if (!Array.isArray(present)) return undefined;
  return new Set(present.filter((id): id is string => typeof id === 'string'));
}

function patchOf(state: unknown, id: string, field: string): unknown {
  if (typeof state !== 'object' || state === null) return undefined;
  const patches = (state as { patches?: Record<string, Record<string, unknown> | undefined> })
    .patches;
  if (patches === undefined || !Object.hasOwn(patches, id)) return undefined;
  const fields = patches[id];
  return fields !== undefined && Object.hasOwn(fields, field) ? fields[field] : undefined;
}

type Scalar = string | number;
const scalar = (value: unknown): Scalar | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined;

/**
 * The value an element had before any call wrote to it, for the panels whose elements hold a
 * visible value: a table cell and an array cell. Reads the content by its shape, so a panel with
 * another shape is simply not checked.
 */
function declaredValue(pane: ResolvedPane, id: string, field: string): Scalar | undefined {
  const content = pane.content as Record<string, unknown> | undefined;
  if (content === undefined || content === null) return undefined;
  if (pane.panel.id === 'table' && Array.isArray(content.rows)) {
    const row = (content.rows as { id?: unknown; cells?: Record<string, unknown> }[]).find(
      (item) => item.id === id,
    );
    return scalar(row?.cells?.[field]);
  }
  if (pane.panel.id === 'array' && field === 'value' && Array.isArray(content.arrays)) {
    const match = /^(.*)\.(\d+)$/.exec(id);
    if (match === null) return undefined;
    const array = (content.arrays as { id?: unknown; cells?: unknown[] }[]).find(
      (item) => item.id === match[1],
    );
    return scalar(array?.cells?.[Number(match[2])]);
  }
  return undefined;
}

/** The fields of an update whose new value a reader should be told. */
function valueFields(pane: ResolvedPane, fields: Record<string, unknown>): string[] {
  if (pane.panel.id === 'table') return Object.keys(fields).filter((key) => key !== 'tone');
  if (pane.panel.id === 'array') return Object.keys(fields).filter((key) => key === 'value');
  return [];
}

const NUMBER = /\d[\d.,]*\d|\d/g;

/** A value a reader is told: written whole, or by any number in it ("Cart (4)" is told by "4"). */
function stated(text: string, value: Scalar): boolean {
  const shown = String(value).trim();
  const plain = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
  if (mentions(text, shown) || mentions(plain, shown)) return true;
  return (shown.match(NUMBER) ?? []).some((number) => mentions(plain, number.replace(/,/g, '')));
}

/** Only values with a number in them: a word such as "done" is rarely repeated in the text. */
const hasNumber = (value: Scalar) => /\d/.test(String(value));

export const valueChangeUnstated: Rule = {
  id: 'design/value-change-unstated',
  severity: 'info',
  source: `${SKILL} section 5 (Text: "State the change with names and values ... give the old value as well as the new one"), checklist 18`,
  summary:
    'A table cell or array value is changed and the text contains neither the old nor the new value.',
  run({ walkthrough, calls }) {
    const out: RawFinding[] = [];
    for (const item of calls) {
      if (item.text === '') continue;
      const changes: string[] = [];
      for (const pane of walkthrough.panes) {
        for (const effect of item.touches[pane.id]?.effects ?? []) {
          const { verb, id } = effectTarget(effect);
          if (verb !== 'update' || effect.fields === undefined) continue;
          for (const field of valueFields(pane, effect.fields)) {
            const next = scalar(effect.fields[field]);
            if (next === undefined || !hasNumber(next)) continue;
            const previous =
              scalar(patchOf(item.before[pane.id]?.state, id, field)) ??
              declaredValue(pane, id, field);
            // Filling an empty cell is a first value, not a change of one.
            if (previous === undefined || String(previous).trim() === '') continue;
            if (String(previous) === String(next)) continue;
            // The same element updated in another pane (a variable in a table and its pointer
            // in an array) is shown there: the guidance says to check that before adding words.
            const shownElsewhere = walkthrough.panes.some(
              (other) => other.id !== pane.id && item.touches[other.id]?.updated.has(id) === true,
            );
            if (shownElsewhere) continue;
            if (stated(item.text, next)) continue;
            if (stated(item.text, previous)) continue;
            changes.push(
              `${pane.id}.${id}${field === 'value' ? '' : `.${field}`}: ${`${JSON.stringify(previous)} to `}${JSON.stringify(next)}`,
            );
          }
        }
      }
      if (changes.length === 0) continue;
      out.push({
        path: [...item.path, 'text'],
        call: item.key,
        message: `call "${item.key}" changes a value (${changes.slice(0, 3).join('; ')}${changes.length > 3 ? '; ...' : ''}) and its text mentions neither the old nor the new value. Say what it becomes, and what it was when the old value meant something ("balance 40 becomes 25"), unless a pane shows the value so plainly that the words would only repeat it`,
      });
    }
    return out.length <= 6
      ? out
      : [
          {
            ...out[0]!,
            count: out.length,
            message: `${out.length} calls change a value without naming it in the text (${listKeys(out.map((finding) => finding.call ?? ''))}); first: ${out[0]!.message}`,
          },
        ];
  },
};

/** Ids and names that count as a name for an element, by pane, leaving out lanes and calls. */
function namesIn(walkthrough: ResolvedWalkthrough) {
  const names = new Map<string, { pane: string; id: string }[]>();
  for (const pane of walkthrough.panes) {
    if (pane.panel.id === 'sequence') continue;
    for (const entity of pane.entities) {
      for (const name of new Set([entity.id, entity.label ?? ''])) {
        if (name.length < 2) continue;
        names.set(name, [...(names.get(name) ?? []), { pane: pane.id, id: entity.id }]);
      }
    }
  }
  return names;
}

function related(touchedId: string, id: string): boolean {
  return (
    touchedId === id ||
    touchedId.startsWith(`${id}.`) ||
    touchedId.startsWith(`${id}:`) ||
    id.startsWith(`${touchedId}.`) ||
    id.startsWith(`${touchedId}:`)
  );
}

function namedElements(rule: 'absent' | 'untouched'): Rule['run'] {
  return ({ walkthrough, calls }) => {
    const out: RawFinding[] = [];
    const lanes = new Set(
      walkthrough.lanes.flatMap((lane) => [lane.id.toLowerCase(), lane.title.toLowerCase()]),
    );
    const names = namesIn(walkthrough);
    for (const item of calls) {
      const found = new Map<string, 'absent' | 'untouched'>();
      for (const span of codeSpans(item.text)) {
        if (lanes.has(span.toLowerCase())) continue;
        const matches = names.get(span);
        if (matches === undefined) continue;
        // Touched by this call in any pane that holds an element of this name?
        const hit = matches.some(({ pane, id }) => {
          const touch = item.touches[pane];
          if (touch === undefined) return false;
          return [...touch.added, ...touch.updated, ...touch.read, ...touch.removed].some((other) =>
            related(other, id),
          );
        });
        if (hit) continue;
        const shown = matches.some(({ pane, id }) => {
          const present = presentIds(item.after[pane]?.state);
          return present === undefined || present.has(id);
        });
        found.set(span, shown ? 'untouched' : 'absent');
      }
      const wanted = [...found].filter(([, kind]) => kind === rule).map(([span]) => span);
      if (wanted.length === 0) continue;
      out.push({
        path: [...item.path, 'text'],
        call: item.key,
        message:
          rule === 'absent'
            ? `the text of call "${item.key}" names ${listKeys(wanted)}, which ${wanted.length === 1 ? 'is' : 'are'} not on screen at this call. Either the id is wrong, or the text refers to something the reader has not been shown`
            : `the text of call "${item.key}" names ${listKeys(wanted)}, but the call does not touch ${wanted.length === 1 ? 'it' : 'them'}. If the call relies on ${wanted.length === 1 ? 'it' : 'them'}, read ${wanted.length === 1 ? 'it' : 'them'} so the reader sees which; if not, the words and the marks disagree`,
      });
    }
    return out;
  };
}

export const textNamesAbsent: Rule = {
  id: 'design/text-names-absent',
  severity: 'warning',
  source: `${SKILL} section 6 ("A call touches every view whose state it depends on"), section 7 ("Same thing, same name")`,
  summary:
    'A backticked name in the text is an element id or label that is not on screen at this call.',
  run: namedElements('absent'),
};

export const textNamesUntouched: Rule = {
  id: 'design/text-names-untouched',
  severity: 'info',
  source: `${SKILL} section 6 ("Distinguish kinds of touch": mark what a call relies on), checklist 11`,
  summary: 'A backticked name in the text is an element on screen that the call does not touch.',
  run: namedElements('untouched'),
};

export const valuesEqualIndexes: Rule = {
  id: 'design/values-equal-indexes',
  severity: 'warning',
  source: `${SKILL} section 7 ("values that cannot be mistaken for positions"), checklist 19`,
  summary: "Half or more of an array's values equal their own indexes.",
  run({ walkthrough }) {
    const out: RawFinding[] = [];
    walkthrough.panes.forEach((pane, index) => {
      if (pane.panel.id !== 'array') return;
      const content = pane.content as { arrays?: { id: string; cells: unknown[] }[] };
      for (const array of content.arrays ?? []) {
        const cells = array.cells.map((cell) => String(cell));
        const same = cells.filter((cell, position) => cell === String(position)).length;
        if (cells.length < 3 || same * 2 < cells.length) continue;
        out.push({
          path: ['layout', 'panes', index, 'content', 'arrays'],
          message: `in array "${array.id}", ${same} of ${cells.length} values equal their own index, so a reader cannot tell a value from a position. Choose values that cannot be mistaken for indexes (12, 19, 23 rather than 0, 1, 2)`,
        });
      }
    });
    return out;
  },
};

export const valuesRepeat: Rule = {
  id: 'design/values-repeat',
  severity: 'info',
  source: `${SKILL} section 7 ("Make values tell things apart: 14 and 9, not 10 and 10"), checklist 19`,
  summary:
    'An array holds one value twice, or two rows of a table read the same in the first column.',
  run({ walkthrough }) {
    const out: RawFinding[] = [];
    walkthrough.panes.forEach((pane, index) => {
      const path = ['layout', 'panes', index, 'content'];
      if (pane.panel.id === 'array') {
        const content = pane.content as { arrays?: { id: string; cells: unknown[] }[] };
        for (const array of content.arrays ?? []) {
          const cells = array.cells.map((cell) => String(cell));
          const repeated = [
            ...new Set(cells.filter((cell, position) => cells.indexOf(cell) !== position)),
          ];
          if (repeated.length === 0) continue;
          out.push({
            path: [...path, 'arrays'],
            message: `array "${array.id}" holds the value ${listKeys(repeated)} more than once, so a call that names the value does not say which cell. Use distinct values, unless the repeat is what the walkthrough is about`,
          });
        }
      } else if (pane.panel.id === 'table') {
        const labels = new Map<string, string[]>();
        for (const entity of pane.entities) {
          if (entity.id.startsWith('col.')) continue;
          const key = (entity.label ?? entity.id).trim().toLowerCase();
          labels.set(key, [...(labels.get(key) ?? []), entity.id]);
        }
        for (const [label, ids] of labels) {
          if (ids.length < 2 || label === '') continue;
          out.push({
            path: [...path, 'rows'],
            message: `rows ${listKeys(ids)} of table "${pane.id}" read the same ("${label}") in the first column, so the text cannot name one without the other. Give each row a distinct name or value`,
          });
        }
      }
    });
    return out;
  },
};

export const valueRules: Rule[] = [
  valueChangeUnstated,
  textNamesAbsent,
  textNamesUntouched,
  valuesEqualIndexes,
  valuesRepeat,
];
