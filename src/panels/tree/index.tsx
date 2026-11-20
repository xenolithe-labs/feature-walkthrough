/**
 * tree: an indented, collapsible outline of things that nest too deeply for boxes: a file tree,
 * the DOM, a component tree, an organisation of accounts, owner references, an AST.
 *
 * Nodes are the elements. `update` can set `label`, `sub`, `tone`, `collapsed`, and `parent`
 * (a move, only to one of the node's declared `parents`). Depth, indentation, connector lines,
 * and what a collapsed node hides are worked out, never written.
 *
 * Keys: Up, Down, Home and End move between nodes; Enter selects; Space opens or closes. Left and
 * Right are left alone, because they step through the calls of the walkthrough.
 */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import {
  IdSchema,
  effectTarget,
  initElements,
  markOf,
  reduceElements,
  touched,
  type ElementsState,
  type PanelContext,
  type PanelType,
  own,
} from '../../core';
import { TONES, changesSection, text, toneOf } from '../_shared/changes';
import { fieldProblems } from '../_shared/fields';
import { useRevealTouched } from '../_shared/reveal';
import { NODE_FIELDS, fieldKind, treeProblems } from './lint';
import { treeRows } from './model';
import './tree.css';

const NodeSchema = z.strictObject({
  id: IdSchema,
  label: z.string().min(1),
  sub: z.string().optional(),
  /** A short word before the label: "OU", "dir", "fn". Only drawn, never interpreted. */
  kind: z.string().min(1).max(12).optional(),
  tone: z.enum(TONES).optional(),
  /** The node this one hangs under. Omit it for a top-level node. */
  parent: IdSchema.optional(),
  /** The nodes an `update` may move this one under. Where it was declared is always allowed. */
  parents: z.array(IdSchema).optional(),
  /** Children are hidden until a call (or the reader) opens the node. */
  collapsed: z.boolean().optional(),
  /** Present before the first call. Defaults to the pane's `initial`. */
  initial: z.boolean().optional(),
});
type NodeDecl = z.infer<typeof NodeSchema>;

const TreeContent = z.strictObject({
  nodes: z.array(NodeSchema).min(1),
  /** Whether nodes are present before the first call unless they say otherwise. */
  initial: z.boolean().default(true),
});
type TreeContent = z.infer<typeof TreeContent>;

function entitiesOf(content: TreeContent) {
  return content.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    initial: node.initial ?? content.initial,
  }));
}

function TreeView({
  state,
  content,
  ctx,
}: {
  state: ElementsState;
  content: TreeContent;
  ctx: PanelContext;
}) {
  const current = touched(ctx.current);
  const selected = ctx.selection.id;
  const toggleSelect = (id: string) => ctx.selection.select(selected === id ? undefined : id);

  const shown = useMemo(
    () => new Set([...state.present, ...current.removed]),
    [state.present, current.removed],
  );
  const effects = ctx.current;
  const touchedIds = useMemo(
    () =>
      new Set(
        effects
          .map((effect) => effectTarget(effect))
          .flatMap(({ verb, id }) => (verb === 'focus' ? [] : [id])),
      ),
    [effects],
  );

  // What the reader opened or closed lasts for this call only, so a link to a call is the same
  // for everyone.
  const [chosen, setChosen] = useState<{ call: string; open: Record<string, boolean> }>({
    call: ctx.call.id,
    open: {},
  });
  const overrides = chosen.call === ctx.call.id ? chosen.open : undefined;
  const rows = useMemo(
    () =>
      treeRows({
        nodes: content.nodes,
        patches: state.patches,
        shown,
        touched: touchedIds,
        overrides,
      }),
    [content.nodes, state.patches, shown, touchedIds, overrides],
  );
  const byId = useMemo(() => new Map(content.nodes.map((node) => [node.id, node])), [content]);

  const [active, setActive] = useState<string | undefined>(undefined);
  const stop = rows.find((row) => row.shown && row.id === active) ?? rows.find((row) => row.shown);

  // The first node the call touched is scrolled into view.
  const scroller = useRevealTouched<HTMLDivElement>(ctx.call.id);

  const flip = (id: string, open: boolean) =>
    setChosen({
      call: ctx.call.id,
      open: { ...(chosen.call === ctx.call.id ? chosen.open : {}), [id]: !open },
    });

  const move = (from: HTMLElement, key: string) => {
    const items = [
      ...(scroller.current?.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-hidden])') ??
        []),
    ];
    const at = items.indexOf(from);
    const to =
      key === 'Home'
        ? 0
        : key === 'End'
          ? items.length - 1
          : Math.min(items.length - 1, Math.max(0, at + (key === 'ArrowDown' ? 1 : -1)));
    items[to]?.focus();
  };

  return (
    <div className="fw-tree-scroll" ref={scroller}>
      <div className="fw-tree" role="tree" aria-label={ctx.pane.title}>
        {rows.map((row) => {
          const node = byId.get(row.id)!;
          const patch = own(state.patches, row.id);
          const label = text(patch?.label) ?? node.label;
          const sub = text(patch?.sub) ?? node.sub;
          const mark = markOf(row.id, current);
          const classes = [
            'fw-tree-row',
            row.shown ? `is-${mark}` : 'is-absent',
            selected === row.id ? 'is-selected' : '',
            row.hiddenTouched > 0 ? 'has-hidden-touched' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={row.id}
              role="treeitem"
              className={classes}
              data-entity={row.id}
              data-mark={row.shown ? mark : 'absent'}
              data-tone={row.shown ? toneOf(patch?.tone, node.tone) : undefined}
              data-depth={row.depth}
              data-open={row.hasChildren ? String(row.open) : undefined}
              aria-level={row.depth + 1}
              aria-expanded={row.hasChildren ? row.open : undefined}
              aria-selected={selected === row.id}
              aria-hidden={row.shown ? undefined : true}
              tabIndex={row.shown && stop?.id === row.id ? 0 : -1}
              onFocus={() => setActive(row.id)}
              onClick={() => toggleSelect(row.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                // Left and Right are not used: they step through the calls.
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  move(event.currentTarget, event.key);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  toggleSelect(row.id);
                } else if (event.key === ' ') {
                  event.preventDefault();
                  if (row.hasChildren) flip(row.id, row.open);
                }
              }}
            >
              {row.guides.slice(1).map((guide, level) => (
                <span key={level} className={`fw-tree-guide is-${guide}`} aria-hidden="true" />
              ))}
              <span
                className={`fw-tree-twisty${row.hasChildren ? ' is-branch' : ''}`}
                aria-hidden="true"
                onClick={(event) => {
                  if (!row.hasChildren) return;
                  event.stopPropagation();
                  flip(row.id, row.open);
                }}
              >
                {row.hasChildren ? (row.open ? '▾' : '▸') : ''}
              </span>
              {node.kind !== undefined && <span className="fw-tree-kind">{node.kind}</span>}
              <span className="fw-tree-label">{label}</span>
              {sub !== undefined && <span className="fw-tree-sub">{sub}</span>}
              {row.hasChildren && !row.open && row.hidden > 0 && (
                <span className="fw-tree-hidden" data-touched={row.hiddenTouched > 0 || undefined}>
                  {row.hidden} hidden
                  {row.hiddenTouched > 0 ? `, ${row.hiddenTouched} touched by this call` : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const treePanel: PanelType<TreeContent, ElementsState> = {
  id: 'tree',
  schema: { content: TreeContent },
  entities: entitiesOf,
  init: (content) => initElements(entitiesOf(content)),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: TreeView,
  cardSections: ({ content, current, pane }) =>
    changesSection(
      pane.title,
      new Map(entitiesOf(content).map((entity) => [entity.id, entity.label])),
      current,
    ),
  lint: (pane, walkthrough) => {
    const content = pane.content as TreeContent;
    const ids = new Set(content.nodes.map((node) => node.id));
    return [
      ...treeProblems(pane, walkthrough, content.nodes, content.initial),
      ...fieldProblems(
        pane,
        walkthrough,
        (id) => (ids.has(id) ? NODE_FIELDS : undefined),
        (_id, field, value) => fieldKind(field, value),
      ),
    ];
  },
};

export type { NodeDecl };
