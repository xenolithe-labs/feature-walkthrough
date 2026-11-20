/**
 * code: source text with the lines a call is about.
 *
 * `content.sources` lists the texts. An effect on a source shows it and can
 * mark lines: `{ read: "main", lines: [3, [7, 9]] }`. `update` with
 * `fields.text` replaces the text from that call on.
 */
import { useEffect, useRef } from 'react';
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
  z.looseObject({ lines: LinesSchema.optional() }),
) as unknown as z.ZodType<Effect>;

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
  for (const effect of ctx.current) {
    const { verb, id } = effectTarget(effect);
    if (id !== source.id || verb === 'focus' || verb === 'set') continue;
    for (const line of expand(effect.lines)) marks.set(line, MARK[verb]);
  }
  const first = marks.size === 0 ? 0 : Math.min(...marks.keys());

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
            return (
              <span
                key={index}
                className={`fw-code-line${mark === undefined ? '' : ` is-${mark}`}`}
                data-line={index + 1}
                data-mark={mark}
              >
                <span className="fw-code-number" aria-hidden="true">
                  {index + 1}
                </span>
                <code>{line === '' ? ' ' : line}</code>
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
    const length = new Map(
      content.sources.map((source) => [source.id, source.text.split('\n').length]),
    );
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        (call.effects?.[pane.id] ?? []).forEach((effect, e) => {
          const { id } = effectTarget(effect);
          if (id === undefined || !length.has(id)) return;
          const replaced = text(effect.fields?.text);
          if (replaced !== undefined) length.set(id, replaced.split('\n').length);
          const last = Math.max(0, ...expand(effect.lines));
          if (last > length.get(id)!) {
            problems.push({
              severity: 'error',
              rule: 'code/line-out-of-range',
              path: ['steps', s, 'calls', c, 'effects', pane.id, e, 'lines'],
              message: `line ${last} is past the end of "${id}", which has ${length.get(id)} lines here`,
            });
          }
        });
      });
    });
    return problems;
  },
};
