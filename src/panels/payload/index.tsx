/**
 * payload: the bodies that travel or get stored, field by field.
 *
 * `content.payloads` lists structured values: a message, a token, a stored
 * object. A call can mark single fields by path,
 * `{ read: "commit", paths: ["tree", "parents.0"] }`, and change them,
 * `{ update: "index", fields: { "entries.1.hash": "f7a2…" } }`. A leaf written
 * as `{ "$ref": "<id>", "text": "…" }` is a link: choosing it selects that
 * element in every pane that has it. `raw` adds a second, plain-text view.
 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  EffectSchema,
  IdSchema,
  effectTarget,
  initElements,
  markOf,
  reduceElements,
  touched,
  type Effect,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Problem,
} from '../../core';
import { TONES, changesSection, toneOf } from '../_shared/changes';
import { revealScroll } from '../_shared/reveal';
import { hasPath, isLeaf, isRef, members, patched, setPath } from './paths';
import './payload.css';

const PayloadSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  /** A second, smaller line: what kind of thing this is. */
  sub: z.string().optional(),
  /** Any JSON value. Objects and arrays become fields. */
  value: z.unknown(),
  /** The same thing as plain text, shown on request. */
  raw: z.strictObject({ label: z.string().min(1).default('Raw'), text: z.string() }).optional(),
  tone: z.enum(TONES).optional(),
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
});

const PayloadContent = z.strictObject({
  payloads: z.array(PayloadSchema).min(1),
  /** Whether payloads are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
type PayloadContent = z.infer<typeof PayloadContent>;

const PathsSchema = z.array(z.string().min(1));
const PayloadEffect = EffectSchema.and(
  z.looseObject({ paths: PathsSchema.optional() }),
) as unknown as z.ZodType<Effect>;

function pathsOf(effect: Effect): string[] {
  const parsed = PathsSchema.safeParse(effect.paths);
  return parsed.success ? parsed.data : [];
}

const entitiesOf = (content: PayloadContent) =>
  content.payloads.map((payload) => ({
    id: payload.id,
    label: payload.title,
    initial: payload.initial ?? content.initial,
  }));

const MARK = { add: 'added', update: 'updated', read: 'read', remove: 'removed' } as const;

/** Which fields of one payload the current call marks, by path. */
function fieldMarks(current: Effect[], payloadId: string): Map<string, string> {
  const marks = new Map<string, string>();
  for (const effect of current) {
    const { verb, id } = effectTarget(effect);
    if (id !== payloadId || verb === 'focus' || verb === 'set') continue;
    for (const path of pathsOf(effect)) marks.set(path, MARK[verb]);
    if (verb === 'update') {
      for (const path of Object.keys(effect.fields ?? {})) {
        if (path !== 'tone') marks.set(path, 'updated');
      }
    }
  }
  return marks;
}

interface Shared {
  marks: Map<string, string>;
  selected: string | undefined;
  select(id: string): void;
}

function Leaf({ value, shared }: { value: unknown; shared: Shared }) {
  if (isRef(value)) {
    return (
      <button
        type="button"
        className={`fw-pl-ref${shared.selected === value.$ref ? ' is-selected' : ''}`}
        data-ref={value.$ref}
        aria-pressed={shared.selected === value.$ref}
        onClick={(event) => {
          event.stopPropagation();
          shared.select(value.$ref);
        }}
      >
        {value.text ?? value.$ref}
      </button>
    );
  }
  if (typeof value === 'string') {
    return <span className={`fw-pl-value${value.includes('\n') ? ' is-block' : ''}`}>{value}</span>;
  }
  return <span className="fw-pl-value is-literal">{String(value)}</span>;
}

/** Short containers of plain values sit on one line: one entry of a list, for example. */
function fitsOneLine(value: unknown): boolean {
  const items = members(value);
  if (items.length === 0 || Array.isArray(value)) return false;
  let length = 0;
  for (const [name, item] of items) {
    if (!isLeaf(item)) return false;
    const shown = isRef(item) ? (item.text ?? item.$ref) : String(item);
    if (shown.includes('\n')) return false;
    length += name.length + shown.length + 4;
  }
  return length <= 76;
}

function Field({
  name,
  value,
  path,
  depth,
  shared,
}: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  shared: Shared;
}) {
  const mark = shared.marks.get(path);
  const markClass = mark === undefined ? '' : ` is-${mark}`;
  if (isLeaf(value)) {
    return (
      <div className={`fw-pl-row${markClass}`} data-path={path} data-mark={mark}>
        <span className="fw-pl-key">{name}</span>
        <Leaf value={value} shared={shared} />
      </div>
    );
  }
  if (depth > 0 && fitsOneLine(value)) {
    return (
      <div className={`fw-pl-row is-inline${markClass}`} data-path={path} data-mark={mark}>
        <span className="fw-pl-key">{name}</span>
        <span className="fw-pl-items">
          {members(value).map(([key, item]) => {
            const inner = shared.marks.get(`${path}.${key}`);
            return (
              <span
                key={key}
                className={`fw-pl-item${inner === undefined ? '' : ` is-${inner}`}`}
                data-path={`${path}.${key}`}
                data-mark={inner}
              >
                <span className="fw-pl-key">{key}</span>
                <Leaf value={item} shared={shared} />
              </span>
            );
          })}
        </span>
      </div>
    );
  }
  const items = members(value);
  return (
    <div className={`fw-pl-group${markClass}`} data-path={path} data-mark={mark}>
      <span className="fw-pl-key">{name}</span>
      {items.length === 0 ? (
        <span className="fw-pl-value is-literal">{Array.isArray(value) ? '[]' : '{}'}</span>
      ) : (
        <div className="fw-pl-children">
          {items.map(([key, item]) => (
            <Field
              key={key}
              name={key}
              value={item}
              path={`${path}.${key}`}
              depth={depth + 1}
              shared={shared}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PayloadView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: PayloadContent;
  ctx: PanelContext;
}) {
  const current = touched(ctx.current);
  const selected = ctx.selection.id;
  const select = (id: string) => ctx.selection.select(selected === id ? undefined : id);
  const [rawShown, setRawShown] = useState<ReadonlySet<string>>(new Set());

  // A payload is shown while it is present, and on the call that removes it.
  const shown = content.payloads.filter(
    (payload) => state.present.includes(payload.id) || current.removed.has(payload.id),
  );
  const firstTouched = shown.find((payload) => markOf(payload.id, current) !== 'faded')?.id;

  // Bring the first payload this call is about into view without moving the page.
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = scroller.current;
    if (box === null || firstTouched === undefined || !current.any) return;
    const card = box.querySelector<HTMLElement>(`[data-entity="${CSS.escape(firstTouched)}"]`);
    if (card === null) return;
    // Within a payload taller than the pane, the field the call marks matters more than the title.
    const field = card.querySelector<HTMLElement>('[data-path][data-mark]');
    const target = field ?? card;
    const frame = box.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const y = revealScroll(
      { scroll: box.scrollTop, size: box.clientHeight },
      { start: rect.top - frame.top + box.scrollTop, size: rect.height },
    );
    if (y !== undefined) box.scrollTop = y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstTouched, ctx.call.id]);

  return (
    <div className="fw-payloads" ref={scroller}>
      {shown.length === 0 && <p className="fw-payloads-empty">Nothing here yet.</p>}
      {shown.map((payload) => {
        const patch = state.patches[payload.id];
        const value = patched(payload.value, patch);
        const marks = fieldMarks(ctx.current, payload.id);
        const mark = markOf(payload.id, current);
        // When a call names fields, the fields carry the mark and the card stays plain.
        const cardMark = marks.size > 0 && mark !== 'added' && mark !== 'removed' ? 'idle' : mark;
        const raw = payload.raw !== undefined && rawShown.has(payload.id);
        const shared: Shared = { marks, selected, select };
        return (
          <section
            key={payload.id}
            className={`fw-payload is-${cardMark}${selected === payload.id ? ' is-selected' : ''}`}
            data-entity={payload.id}
            data-mark={mark}
            data-tone={toneOf(patch?.tone, payload.tone)}
          >
            <header className="fw-payload-head">
              <button
                type="button"
                className="fw-payload-title"
                aria-pressed={selected === payload.id}
                onClick={() => select(payload.id)}
              >
                {payload.title}
              </button>
              {payload.sub !== undefined && <span className="fw-payload-sub">{payload.sub}</span>}
              {payload.raw !== undefined && (
                <button
                  type="button"
                  className="fw-payload-toggle"
                  aria-pressed={raw}
                  onClick={() =>
                    setRawShown((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(payload.id)) next.add(payload.id);
                      return next;
                    })
                  }
                >
                  {payload.raw.label}
                </button>
              )}
            </header>
            {raw ? (
              <pre className="fw-payload-raw">{payload.raw!.text}</pre>
            ) : isLeaf(value) ? (
              <div className="fw-pl-children is-top">
                <div className="fw-pl-row">
                  <Leaf value={value} shared={shared} />
                </div>
              </div>
            ) : (
              <div className="fw-pl-children is-top">
                {members(value).map(([key, item]) => (
                  <Field key={key} name={key} value={item} path={key} depth={0} shared={shared} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export const payloadPanel: PanelType<PayloadContent, ElementsState> = {
  id: 'payload',
  schema: { content: PayloadContent, effect: PayloadEffect },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: PayloadView,
  cardSections: ({ content, current, pane }) =>
    changesSection(
      pane.title,
      new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
      current,
    ),
  lint: (pane, walkthrough) => {
    const content = pane.content as PayloadContent;
    // The values as they stand at each call, so a path is checked against what is there by then.
    const values = new Map(content.payloads.map((payload) => [payload.id, payload.value]));
    const raws = new Set(content.payloads.filter((p) => p.raw !== undefined).map((p) => p.id));
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        (call.effects?.[pane.id] ?? []).forEach((effect, e) => {
          const { id } = effectTarget(effect);
          if (id === undefined || !values.has(id)) return;
          const at = ['steps', s, 'calls', c, 'effects', pane.id, e];
          const missing = (path: string, where: (string | number)[]) =>
            problems.push({
              severity: 'error',
              rule: 'payload/unknown-path',
              path: where,
              message: `payload "${id}" has no field at "${path}" by this call`,
            });
          const fields = Object.entries(effect.fields ?? {}).filter(([path]) => path !== 'tone');
          if (fields.length > 0 && raws.has(id)) {
            problems.push({
              severity: 'warning',
              rule: 'payload/raw-out-of-date',
              path: [...at, 'fields'],
              message: `payload "${id}" has a "raw" text, which will not show this change`,
            });
          }
          for (const [path, next] of fields) {
            if (hasPath(values.get(id), path)) values.set(id, setPath(values.get(id), path, next));
            else missing(path, [...at, 'fields', path]);
          }
          pathsOf(effect).forEach((path, position) => {
            if (!hasPath(values.get(id), path)) missing(path, [...at, 'paths', position]);
          });
        });
      });
    });
    return problems;
  },
};
