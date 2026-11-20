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
  z.looseObject({ lines: LinesSchema.optional() }),
) as unknown as z.ZodType<Effect>;

type Range = [first: number, last: number];

/** The line ranges an effect names. A single line is a range of one. */
function ranges(lines: unknown): Range[] {
  const parsed = LinesSchema.safeParse(lines);
  if (!parsed.success) return [];
  return parsed.data.map((item) => (typeof item === 'number' ? [item, item] : item));
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
  // A removed source is not shown. With none left, the pane says so.
  // It stays on screen for the call that removes it, like a removed element anywhere else.
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
  const body = text(own(state.patches, source.id)?.text) ?? source.text;
  const lines = body.split('\n');

  const marks = new Map<number, string>();
  for (const effect of ctx.current) {
    const { verb, id } = effectTarget(effect);
    if (id !== source.id || verb === 'focus' || verb === 'set') continue;
    for (const [from, to] of ranges(effect.lines)) {
      // Only lines that exist are marked, however far a range claims to reach.
      for (let line = from; line <= Math.min(to, lines.length); line += 1) {
        marks.set(line, MARK[verb]);
      }
    }
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
    const declared = new Map(
      content.sources.map((source) => [source.id, source.text.split('\n').length]),
    );
    const length = new Map(declared);
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        writtenEffects(call, pane.id).forEach((effect, e) => {
          const { id } = effectTarget(effect);
          if (id === undefined || !length.has(id)) return;
          const { verb } = effectTarget(effect);
          // Removing a source drops what was patched onto it, as the reducer does.
          if (verb === 'remove') length.set(id, declared.get(id)!);
          const replaced = text(effect.fields?.text);
          if (replaced !== undefined) length.set(id, replaced.split('\n').length);
          const named = ranges(effect.lines);
          const reversed = named.find(([from, to]) => to < from);
          if (reversed !== undefined) {
            problems.push({
              severity: 'error',
              rule: 'code/reversed-range',
              path: ['steps', s, 'calls', c, 'effects', pane.id, e, 'lines'],
              message: `the range [${reversed[0]}, ${reversed[1]}] ends before it starts`,
            });
          }
          const last = named.reduce((most, [, to]) => Math.max(most, to), 0);
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
