/**
 * code: source text with the lines a call is about.
 *
 * `content.sources` lists the texts. An effect on a source shows it and can
 * mark lines: `{ read: "main", lines: [3, [7, 9]] }`; add `expr` (a piece of text on those
 * lines, or a list of them) to mark just that part. `update` with `fields.text` replaces the
 * text from that call on. `update` with `fields.at` (a line number, or null) keeps a current-line
 * pointer in the margin until a later call moves it, and `fields.badge` is a short label
 * shown at the end of that line, such as "run 3" or "depth 2".
 *
 * Two more kinds of source:
 *  - A source with `base` is a diff: the panel works out the added and removed lines from `base`
 *    to `text` and shows them with a gutter. `lines` still mean lines of `text`; `old` names
 *    lines of `base` (which is how a removed line is marked). The reader can switch between the
 *    "changes" and the "result".
 *  - A source with `transcript` is output that appears over time. `update` with `fields.upto`
 *    reveals it up to that line; the lines after it keep their place and stay hidden.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import {
  EffectSchema,
  IdSchema,
  effectTarget,
  initElements,
  reduceElements,
  type Effect,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
  own,
  writtenEffects,
} from '../../core';
import { text } from '../_shared/changes';
import { diffLines, type DiffRow } from './diff';
import { TokensSchema, pieces as cut, tokensMatch } from './tokens';
import { describeCode } from './describe';
import './code.css';

const CodeContent = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        id: IdSchema,
        title: z.string().min(1),
        lang: z.string().optional(),
        text: z.string(),
        /** Syntax colours, worked out ahead of time. See tokens.ts. */
        tokens: TokensSchema.optional(),
        /** The text this one replaces. With it the source is shown as a diff of `base` to `text`. */
        base: z.string().optional(),
        /** Syntax colours of `base`, for the removed lines. */
        baseTokens: TokensSchema.optional(),
        /**
         * Output that appears over time. Lines that start with the prompt (default "$ ") are
         * commands. `update` with `fields.upto` reveals the text up to that line.
         */
        transcript: z
          .union([z.literal(true), z.strictObject({ prompt: z.string().min(1) })])
          .optional(),
      }),
    )
    .min(1),
});
type CodeContent = z.infer<typeof CodeContent>;
type CodeSource = CodeContent['sources'][number];

const LinesSchema = z.array(
  z.union([z.number().int().min(1), z.tuple([z.number().int().min(1), z.number().int().min(1)])]),
);

const CodeEffect = EffectSchema.and(
  z.looseObject({
    lines: LinesSchema.optional(),
    old: LinesSchema.optional(),
    expr: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  }),
) as unknown as z.ZodType<Effect>;

/** The pieces of text an effect marks inside its lines. */
function exprs(effect: Effect): string[] {
  const value = effect.expr;
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

type Range = [first: number, last: number];

/** The line ranges an effect names. A single line is a range of one. */
function ranges(lines: unknown): Range[] {
  const parsed = LinesSchema.safeParse(lines);
  if (!parsed.success) return [];
  return parsed.data.map((item) => (typeof item === 'number' ? [item, item] : item));
}

/** The lines an effect names, one by one, up to `limit`: however far a range claims to reach. */
function expand(lines: unknown, limit: number): number[] {
  const result: number[] = [];
  for (const [from, to] of ranges(lines)) {
    for (let line = from; line <= Math.min(to, limit); line += 1) result.push(line);
  }
  return result;
}

const EFFECT_KEYS = ['add', 'update', 'read', 'remove', 'focus', 'fields', 'lines', 'old', 'expr'];

const MARK = { add: 'added', update: 'updated', read: 'read', remove: 'removed' } as const;

/** The prompt of a transcript source, or undefined for any other source. */
export function promptOf(source: Pick<CodeSource, 'transcript'>): string | undefined {
  const { transcript } = source;
  if (transcript === undefined) return undefined;
  return transcript === true ? '$ ' : transcript.prompt;
}

/** How many lines of a transcript are shown: `upto`, kept between 0 and the end. */
export function revealed(upto: unknown, total: number): number {
  return typeof upto === 'number' && Number.isFinite(upto)
    ? Math.min(total, Math.max(0, Math.floor(upto)))
    : 0;
}

/** The rows a source shows: the diff when there is a base to compare with, else line by line. */
export function rowsOf(lines: readonly string[], base: readonly string[] | undefined): DiffRow[] {
  return base === undefined
    ? lines.map((text, index) => ({ kind: 'same' as const, text, newNo: index + 1 }))
    : diffLines(base, lines);
}

function CodeView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: CodeContent;
  ctx: PanelContext;
}) {
  // A removed source is not shown. With none left, the pane says so. It stays on screen for the
  // call that removes it, like a removed element anywhere else.
  const leaving = new Set(
    ctx.current.filter((effect) => effect.remove !== undefined).map((effect) => effect.remove),
  );
  const present = content.sources.filter(
    (item) => state.present.includes(item.id) || leaving.has(item.id),
  );
  const source = present.find((item) => item.id === state.focus) ?? present[0];
  if (source === undefined) return <p className="fw-code-empty">No source is shown here now.</p>;
  return <SourceView key={source.id} source={source} state={state} ctx={ctx} />;
}

function SourceView({
  source,
  state,
  ctx,
}: {
  source: CodeSource;
  state: ElementsState;
  ctx: PanelContext;
}) {
  const patch = own(state.patches, source.id);
  const body = text(patch?.text) ?? source.text;
  const lines = body.split('\n');
  const [view, setView] = useState<'changes' | 'result'>('changes');
  const baseLines = source.base?.split('\n');
  const diff = baseLines !== undefined && view === 'changes';
  const rows = rowsOf(lines, diff ? baseLines : undefined);
  const prompt = promptOf(source);
  const shown = prompt === undefined ? rows.length : revealed(patch?.upto, rows.length);

  const marks = new Map<number, string>();
  // Pieces of a line that a call marks on their own: row -> [start, end, mark].
  const spans = new Map<number, [number, number, string][]>();
  for (const effect of ctx.current) {
    const { verb, id } = effectTarget(effect);
    if (id !== source.id || verb === 'focus') continue;
    const newLines = new Set(expand(effect.lines, lines.length));
    const oldLines = new Set(diff ? expand(effect.old, baseLines.length) : []);
    const hit: number[] = [];
    rows.forEach((row, index) => {
      if (index >= shown) return;
      const named =
        (row.newNo !== undefined && newLines.has(row.newNo)) ||
        (row.oldNo !== undefined && oldLines.has(row.oldNo));
      if (named) hit.push(index);
    });
    for (const index of hit) marks.set(index, MARK[verb]);
    for (const piece of exprs(effect)) {
      const index = hit.find((item) => rows[item]!.text.includes(piece));
      if (index === undefined) continue;
      const start = rows[index]!.text.indexOf(piece);
      spans.set(index, [...(spans.get(index) ?? []), [start, start + piece.length, MARK[verb]]]);
    }
  }
  const pointer = typeof patch?.at === 'number' ? patch.at : undefined;
  const badge = text(patch?.badge);
  // What to bring into view: the newest line of a transcript, else the first marked or pointed line.
  const pointed = rows.findIndex((row) => row.newNo !== undefined && row.newNo === pointer);
  const anchor =
    prompt !== undefined ? shown - 1 : marks.size > 0 ? Math.min(...marks.keys()) : pointed;

  // Bring that line into view without moving the page.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = scroller.current;
    if (box === null || anchor < 0) return;
    const row = box.querySelector<HTMLElement>(`[data-row="${anchor}"]`);
    if (row === null) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (prompt !== undefined) {
      // A transcript grows downwards: keep the newest line at the foot of the pane.
      if (bottom > box.scrollTop + box.clientHeight || top < box.scrollTop) {
        box.scrollTop = Math.max(0, bottom - box.clientHeight + 6);
      }
    } else if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [anchor, source.id, ctx.call.id, prompt, diff]);

  // Colours belong to the declared text. Text that a call replaced is shown plain.
  const colours = body === source.text && prompt === undefined ? source.tokens : undefined;

  const selected = ctx.selection.id === source.id;
  const classes = [
    'fw-code-lines',
    marks.size > 0 ? 'has-marks' : '',
    diff ? 'is-diff' : '',
    prompt !== undefined ? 'is-transcript' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="fw-code-panel" data-source={source.id}>
      <div className="fw-code-head">
        <button
          type="button"
          className={`fw-code-title${selected ? ' is-selected' : ''}`}
          aria-pressed={selected}
          onClick={() => ctx.selection.select(selected ? undefined : source.id)}
        >
          {source.title}
        </button>
        {baseLines !== undefined && (
          <div className="fw-code-views" role="group" aria-label={`${source.title}: view`}>
            {(['changes', 'result'] as const).map((name) => (
              <button
                key={name}
                type="button"
                className="fw-code-view"
                aria-pressed={view === name}
                onClick={() => setView(name)}
              >
                {name === 'changes' ? 'Changes' : 'Result'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="fw-code-scroll" ref={scroller}>
        <pre className={classes} data-lang={source.lang} data-view={diff ? 'changes' : 'result'}>
          {rows.map((row, index) => {
            const mark = marks.get(index);
            const here = pointer !== undefined && row.newNo === pointer;
            const parts = spans.get(index) ?? [];
            const hidden = index >= shown;
            const command = prompt !== undefined && row.text.startsWith(prompt);
            const removed = row.kind === 'del';
            const lineColours = removed
              ? source.baseTokens?.lines[row.oldNo! - 1]
              : colours?.lines[row.newNo! - 1];
            const palette = removed ? source.baseTokens?.palette : colours?.palette;
            // Pieces of one marked expression sit in one <mark>, so its outline is drawn once
            // however many colours the expression has.
            const drawn: ReactNode[] = [];
            let group: ReactNode[] = [];
            let groupMark: string | undefined;
            const close = (key: number) => {
              if (group.length === 0) return;
              drawn.push(
                groupMark === undefined ? (
                  group
                ) : (
                  <mark key={`m${key}`} className={`fw-code-expr is-${groupMark}`}>
                    {group}
                  </mark>
                ),
              );
              group = [];
            };
            cut(row.text, lineColours, parts).forEach((piece, position) => {
              if (piece.mark !== groupMark) {
                close(position);
                groupMark = piece.mark;
              }
              const colour =
                piece.colour === undefined
                  ? undefined
                  : palette?.[piece.colour]?.[ctx.theme === 'dark' ? 1 : 0];
              group.push(
                <span key={position} style={colour === undefined ? undefined : { color: colour }}>
                  {piece.text}
                </span>,
              );
            });
            close(row.text.length + 1);
            return (
              <span
                key={index}
                className={[
                  'fw-code-line',
                  mark === undefined ? '' : `is-${mark}`,
                  here ? 'is-at' : '',
                  parts.length > 0 ? 'has-expr' : '',
                  diff && row.kind !== 'same' ? `is-diff-${row.kind}` : '',
                  command ? 'is-command' : '',
                  hidden ? 'is-hidden' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-row={index}
                data-line={row.newNo}
                data-old={diff ? row.oldNo : undefined}
                data-kind={diff ? row.kind : undefined}
                data-mark={mark}
                data-at={here ? true : undefined}
                aria-current={here ? 'step' : undefined}
                aria-hidden={hidden ? true : undefined}
              >
                {prompt === undefined &&
                  (diff ? (
                    <>
                      <span className="fw-code-number is-old" aria-hidden="true">
                        {row.oldNo}
                      </span>
                      <span className="fw-code-number is-new" aria-hidden="true">
                        {row.newNo}
                      </span>
                      <span className="fw-code-sign">
                        <span aria-hidden="true">
                          {row.kind === 'add' ? '+' : removed ? '−' : ' '}
                        </span>
                        {row.kind !== 'same' && (
                          <span className="fw-code-sr">
                            {row.kind === 'add' ? 'added: ' : 'removed: '}
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="fw-code-number" aria-hidden="true">
                      {row.newNo}
                    </span>
                  ))}
                <code>{row.text === '' ? ' ' : drawn}</code>
                {here && badge !== undefined && <span className="fw-code-badge">{badge}</span>}
                {'\n'}
              </span>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

export const codePanel: PanelType<CodeContent, ElementsState> = {
  id: 'code',
  schema: { content: CodeContent, effect: CodeEffect },
  entities: (content) =>
    content.sources.map((source) => ({ id: source.id, label: source.title, initial: true })),
  init: (content) =>
    initElements(content.sources.map((source) => ({ id: source.id, initial: true }))),
  // Any effect on a source also brings that source to the front.
  reduce: (state, effect) => {
    const next = reduceElements(state, effect);
    const { verb, id } = effectTarget(effect);
    if (id === undefined || verb === 'remove' || next.focus === id) return next;
    return { ...next, focus: id };
  },
  describe: describeCode,
  Component: CodeView,
  lint: (pane, walkthrough) => {
    const content = pane.content as CodeContent;
    const byId = new Map(content.sources.map((source) => [source.id, source]));
    const declared = new Map(content.sources.map((source) => [source.id, source.text.split('\n')]));
    const sourceLines = new Map(declared);
    // How far each transcript is revealed, as the calls so far leave it.
    const upto = new Map<string, number>();
    const problems: Problem[] = [];
    const paneIndex = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
    content.sources.forEach((source, position) => {
      const at = ['layout', 'panes', paneIndex, 'content', 'sources', position];
      if (source.tokens !== undefined && !tokensMatch(source.text, source.tokens)) {
        problems.push({
          severity: 'error',
          rule: 'code/tokens-mismatch',
          path: [...at, 'tokens'],
          message: `the colour tokens of "${source.id}" do not spell out its text: work them out again, or remove them`,
        });
      }
      if (source.baseTokens !== undefined) {
        if (source.base === undefined || !tokensMatch(source.base, source.baseTokens)) {
          problems.push({
            severity: 'error',
            rule: 'code/tokens-mismatch',
            path: [...at, 'baseTokens'],
            message: `the colour tokens of the base of "${source.id}" do not spell out its "base": work them out again, or remove them`,
          });
        }
      }
      if (source.base !== undefined && source.transcript !== undefined) {
        problems.push({
          severity: 'error',
          rule: 'code/diff-transcript',
          path: [...at, 'transcript'],
          message: `"${source.id}" has both "base" and "transcript": a source is a diff or a transcript, not both`,
        });
      }
      if (source.base !== undefined && source.base === source.text) {
        problems.push({
          severity: 'warning',
          rule: 'code/no-changes',
          path: [...at, 'base'],
          message: `"base" of "${source.id}" is the same as its text, so the diff shows no change`,
        });
      }
    });
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        writtenEffects(call, pane.id).forEach((effect, e) => {
          const { verb, id } = effectTarget(effect);
          const source = byId.get(id);
          if (id === undefined || source === undefined) return;
          const at = ['steps', s, 'calls', c, 'effects', pane.id, e];
          // A misspelt key ("line" for "lines") is otherwise ignored without a word.
          for (const key of Object.keys(effect)) {
            if (EFFECT_KEYS.includes(key)) continue;
            problems.push({
              severity: 'warning',
              rule: 'code/unknown-key',
              path: [...at, key],
              message: `an effect on a source takes ${EFFECT_KEYS.join(', ')}; "${key}" is ignored`,
            });
          }
          // Removing a source drops what was patched onto it, as the reducer does.
          if (verb === 'remove') {
            sourceLines.set(id, declared.get(id)!);
            upto.delete(id);
          }
          const replaced = text(effect.fields?.text);
          if (replaced !== undefined) sourceLines.set(id, replaced.split('\n'));
          const lines = sourceLines.get(id)!;
          const baseCount = source.base?.split('\n').length;

          // Line references, in the new text (`lines`) and in the base (`old`).
          const references: [key: 'lines' | 'old', limit: number | undefined, what: string][] = [
            ['lines', lines.length, `"${id}", which has ${lines.length} lines here`],
            ['old', baseCount, `the base of "${id}", which has ${baseCount} lines`],
          ];
          for (const [key, limit, what] of references) {
            const named = ranges(effect[key]);
            if (named.length === 0 && effect[key] === undefined) continue;
            if (key === 'old' && limit === undefined) {
              problems.push({
                severity: 'error',
                rule: 'code/old-without-base',
                path: [...at, 'old'],
                message: `"old" names lines of the base, and "${id}" has no "base"`,
              });
              continue;
            }
            const reversed = named.find(([from, to]) => to < from);
            if (reversed !== undefined) {
              problems.push({
                severity: 'error',
                rule: 'code/reversed-range',
                path: [...at, key],
                message: `the range [${reversed[0]}, ${reversed[1]}] ends before it starts`,
              });
            }
            const last = named.reduce((most, [, to]) => Math.max(most, to), 0);
            if (limit !== undefined && last > limit) {
              problems.push({
                severity: 'error',
                rule: 'code/line-out-of-range',
                path: [...at, key],
                message: `line ${last} is past the end of ${what}`,
              });
            }
          }

          // Transcript reveal.
          const now = effect.fields?.upto;
          if (now !== undefined) {
            if (source.transcript === undefined) {
              problems.push({
                severity: 'error',
                rule: 'code/upto-not-transcript',
                path: [...at, 'fields', 'upto'],
                message: `"upto" reveals a transcript, and "${id}" is not one`,
              });
            } else if (typeof now !== 'number' || !Number.isInteger(now) || now < 0) {
              problems.push({
                severity: 'error',
                rule: 'code/upto-out-of-range',
                path: [...at, 'fields', 'upto'],
                message: `"upto" is a line count from 0 to ${lines.length}; got ${JSON.stringify(now)}`,
              });
            } else if (now > lines.length) {
              problems.push({
                severity: 'error',
                rule: 'code/upto-out-of-range',
                path: [...at, 'fields', 'upto'],
                message: `"upto" is ${now}, past the end of "${id}", which has ${lines.length} lines here`,
              });
            } else if (now < (upto.get(id) ?? 0)) {
              problems.push({
                severity: 'error',
                rule: 'code/upto-backwards',
                path: [...at, 'fields', 'upto'],
                message: `"upto" goes back from ${upto.get(id)} to ${now}: a transcript only grows`,
              });
            } else upto.set(id, now);
          }
          if (source.transcript !== undefined) {
            const reach = upto.get(id) ?? 0;
            const last = ranges(effect.lines).reduce((most, [, to]) => Math.max(most, to), 0);
            if (last > reach && last <= lines.length) {
              problems.push({
                severity: 'error',
                rule: 'code/line-not-revealed',
                path: [...at, 'lines'],
                message: `line ${last} of "${id}" is not revealed yet: "upto" is ${reach} here`,
              });
            }
          }

          // An expression must really be on the lines it is marked on.
          const marked = expand(effect.lines, lines.length);
          const markedOld = source.base === undefined ? [] : expand(effect.old, baseCount ?? 0);
          const baseText = source.base?.split('\n') ?? [];
          for (const piece of exprs(effect)) {
            const found =
              marked.some((line) => (lines[line - 1] ?? '').includes(piece)) ||
              markedOld.some((line) => (baseText[line - 1] ?? '').includes(piece));
            if (!found) {
              problems.push({
                severity: 'error',
                rule: 'code/expr-not-on-lines',
                path: [...at, 'expr'],
                message:
                  marked.length + markedOld.length === 0
                    ? `"expr" marks part of a line, so the effect needs "lines"`
                    : `"${piece}" is not on line ${[...marked, ...markedOld].join(', ')} of "${id}"`,
              });
            }
          }
          const pointer = effect.fields?.at;
          if (pointer !== undefined && pointer !== null) {
            const valid =
              typeof pointer === 'number' &&
              Number.isInteger(pointer) &&
              pointer >= 1 &&
              pointer <= lines.length;
            if (!valid) {
              problems.push({
                severity: 'error',
                rule: 'code/line-out-of-range',
                path: [...at, 'fields', 'at'],
                message: `"at" is a line from 1 to ${lines.length} of "${id}", or null; got ${JSON.stringify(pointer)}`,
              });
            }
          }
        });
      });
    });
    return problems;
  },
};
