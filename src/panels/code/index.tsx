/**
 * code: source text with the lines a call is about.
 *
 * `content.sources` lists the texts. An effect on a source shows it and can
 * mark lines: `{ read: "main", lines: [3, [7, 9]] }`; add `expr` (a piece of text on those
 * lines, or a list of them) to mark just that part. `update` with `fields.text` replaces the
 * text from that call on. `update` with `fields.at` (a line number, or null) keeps a current-line
 * pointer in the margin until a later call moves it, and `fields.badge` is a short label
 * shown at the end of that line, such as "run 3" or "depth 2".
 */
import { useEffect, useRef, type ReactNode } from 'react';
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
import './code.css';

const CodeContent = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        id: IdSchema,
        title: z.string().min(1),
        lang: z.string().optional(),
        text: z.string(),
      }),
    )
    .min(1),
});
type CodeContent = z.infer<typeof CodeContent>;

const LinesSchema = z.array(
  z.union([z.number().int().min(1), z.tuple([z.number().int().min(1), z.number().int().min(1)])]),
);

const CodeEffect = EffectSchema.and(
  z.looseObject({
    lines: LinesSchema.optional(),
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

const EFFECT_KEYS = ['add', 'update', 'read', 'remove', 'focus', 'set', 'fields', 'lines', 'expr'];

const MARK = { add: 'added', update: 'updated', read: 'read', remove: 'removed' } as const;

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
  return <SourceView source={source} state={state} ctx={ctx} />;
}

function SourceView({
  source,
  state,
  ctx,
}: {
  source: CodeContent['sources'][number];
  state: ElementsState;
  ctx: PanelContext;
}) {
  const patch = own(state.patches, source.id);
  const body = text(patch?.text) ?? source.text;
  const lines = body.split('\n');

  const marks = new Map<number, string>();
  // Pieces of a line that a call marks on their own: line number -> [start, end, mark].
  const spans = new Map<number, [number, number, string][]>();
  for (const effect of ctx.current) {
    const { verb, id } = effectTarget(effect);
    if (id !== source.id || verb === 'focus' || verb === 'set') continue;
    const marked = expand(effect.lines, lines.length);
    for (const line of marked) marks.set(line, MARK[verb]);
    for (const piece of exprs(effect)) {
      const line = marked.find((item) => (lines[item - 1] ?? '').includes(piece));
      if (line === undefined) continue;
      const start = lines[line - 1]!.indexOf(piece);
      spans.set(line, [...(spans.get(line) ?? []), [start, start + piece.length, MARK[verb]]]);
    }
  }
  const pointer = typeof patch?.at === 'number' ? patch.at : undefined;
  const badge = text(patch?.badge);
  const first = marks.size === 0 ? (pointer ?? 0) : Math.min(...marks.keys());

  // Bring the first marked line into view without moving the page.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = scroller.current;
    if (box === null || first === 0) return;
    const row = box.querySelector<HTMLElement>(`[data-line="${first}"]`);
    if (row === null) return;
    const top = row.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3);
    }
  }, [first, source.id, ctx.call.id]);

  const selected = ctx.selection.id === source.id;
  return (
    <div className="fw-code-panel" data-source={source.id}>
      <button
        type="button"
        className={`fw-code-title${selected ? ' is-selected' : ''}`}
        aria-pressed={selected}
        onClick={() => ctx.selection.select(selected ? undefined : source.id)}
      >
        {source.title}
      </button>
      <div className="fw-code-scroll" ref={scroller}>
        <pre
          className={`fw-code-lines${marks.size > 0 ? ' has-marks' : ''}`}
          data-lang={source.lang}
        >
          {lines.map((line, index) => {
            const mark = marks.get(index + 1);
            const here = pointer === index + 1;
            const parts = (spans.get(index + 1) ?? []).sort((a, b) => a[0] - b[0]);
            const pieces: ReactNode[] = [];
            let from = 0;
            for (const [start, end, kind] of parts) {
              if (start < from) continue;
              pieces.push(line.slice(from, start));
              pieces.push(
                <mark key={start} className={`fw-code-expr is-${kind}`}>
                  {line.slice(start, end)}
                </mark>,
              );
              from = end;
            }
            pieces.push(line.slice(from));
            return (
              <span
                key={index}
                className={`fw-code-line${mark === undefined ? '' : ` is-${mark}`}${here ? ' is-at' : ''}${parts.length > 0 ? ' has-expr' : ''}`}
                data-line={index + 1}
                data-mark={mark}
                data-at={here ? true : undefined}
                aria-current={here ? 'step' : undefined}
              >
                <span className="fw-code-number" aria-hidden="true">
                  {index + 1}
                </span>
                <code>{line === '' ? ' ' : pieces}</code>
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
  Component: CodeView,
  lint: (pane, walkthrough) => {
    const content = pane.content as CodeContent;
    const declared = new Map(content.sources.map((source) => [source.id, source.text.split('\n')]));
    const sourceLines = new Map(declared);
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        writtenEffects(call, pane.id).forEach((effect, e) => {
          const { verb, id } = effectTarget(effect);
          if (id === undefined || !sourceLines.has(id)) return;
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
          if (verb === 'remove') sourceLines.set(id, declared.get(id)!);
          const replaced = text(effect.fields?.text);
          if (replaced !== undefined) sourceLines.set(id, replaced.split('\n'));
          const lines = sourceLines.get(id)!;
          const named = ranges(effect.lines);
          const reversed = named.find(([from, to]) => to < from);
          if (reversed !== undefined) {
            problems.push({
              severity: 'error',
              rule: 'code/reversed-range',
              path: [...at, 'lines'],
              message: `the range [${reversed[0]}, ${reversed[1]}] ends before it starts`,
            });
          }
          const marked = expand(effect.lines, lines.length);
          const last = named.reduce((most, [, to]) => Math.max(most, to), 0);
          if (last > lines.length) {
            problems.push({
              severity: 'error',
              rule: 'code/line-out-of-range',
              path: [...at, 'lines'],
              message: `line ${last} is past the end of "${id}", which has ${lines.length} lines here`,
            });
          }
          // An expression must really be on the lines it is marked on.
          for (const piece of exprs(effect)) {
            if (!marked.some((line) => (lines[line - 1] ?? '').includes(piece))) {
              problems.push({
                severity: 'error',
                rule: 'code/expr-not-on-lines',
                path: [...at, 'expr'],
                message:
                  marked.length === 0
                    ? `"expr" marks part of a line, so the effect needs "lines"`
                    : `"${piece}" is not on line ${marked.join(', ')} of "${id}"`,
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
