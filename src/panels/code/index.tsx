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

function expand(lines: unknown): number[] {
  const parsed = LinesSchema.safeParse(lines);
  if (!parsed.success) return [];
  const result: number[] = [];
  for (const item of parsed.data) {
    if (typeof item === 'number') result.push(item);
    else for (let line = item[0]; line <= item[1]; line += 1) result.push(line);
  }
  return result;
}

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
  const source = content.sources.find((item) => item.id === state.focus) ?? content.sources[0]!;
  const body = text(state.patches[source.id]?.text) ?? source.text;
  const lines = body.split('\n');

  const marks = new Map<number, string>();
  // Pieces of a line that a call marks on their own: line number -> [start, end, mark].
  const spans = new Map<number, [number, number, string][]>();
  for (const effect of ctx.current) {
    const { verb, id } = effectTarget(effect);
    if (id !== source.id || verb === 'focus' || verb === 'set') continue;
    const marked = expand(effect.lines);
    for (const line of marked) marks.set(line, MARK[verb]);
    for (const piece of exprs(effect)) {
      const line = marked.find((item) => (lines[item - 1] ?? '').includes(piece));
      if (line === undefined) continue;
      const start = lines[line - 1]!.indexOf(piece);
      spans.set(line, [...(spans.get(line) ?? []), [start, start + piece.length, MARK[verb]]]);
    }
  }
  const patch = state.patches[source.id];
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
    const sourceLines = new Map(
      content.sources.map((source) => [source.id, source.text.split('\n')]),
    );
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        (call.effects?.[pane.id] ?? []).forEach((effect, e) => {
          const { id } = effectTarget(effect);
          if (id === undefined || !sourceLines.has(id)) return;
          const at = ['steps', s, 'calls', c, 'effects', pane.id, e];
          const replaced = text(effect.fields?.text);
          if (replaced !== undefined) sourceLines.set(id, replaced.split('\n'));
          const lines = sourceLines.get(id)!;
          const marked = expand(effect.lines);
          const last = Math.max(0, ...marked);
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
