/**
 * Layout feedback for an author who cannot see the picture: runs the real layout of every diagram
 * pane under Node (ELK runs there; sizes come from text estimates, so no browser is needed) and
 * reports what is wrong with the result as warnings that name the elements and, where a hint would
 * likely fix it, say which.
 *
 * It is asynchronous because ELK is, so it is not part of `loadConfig` (which is synchronous and is
 * what the viewer runs): `feature-walkthrough lint` awaits it after loading. Nothing the viewer
 * imports reaches this file, so the viewer does not carry it.
 *
 * Rules (all warnings, `<panel>/<rule>`):
 *   edge-through-node   an edge passes through a node that is not one of its ends
 *   label-overlap       an edge label sits on another label, another edge's line, or a node
 *   edge-crossings      more edges cross each other than a reader can follow
 *   node-overlap        two nodes overlap (pinned positions)
 *   too-dense           so many edges that the fast layering was used and lines are straight
 *   too-wide            the diagram cannot be read at a normal pane width without zooming out too far
 *   not-routed          too many nodes to route lines round them: edges are drawn straight
 */
import {
  loadConfig,
  type Problem,
  type Registry,
  type ResolvedPane,
  type ResolvedWalkthrough,
} from '../../core';
import {
  crossingLimit,
  crossings,
  labelHits,
  overlaps,
  sideAwayFrom,
  throughNodes,
  type AuditEdge,
  type AuditNode,
} from './audit';
import { ancestorsOf, containerIds, parentMap } from './groups';
import {
  edgeIdOf,
  layoutEdgesOf,
  layoutNodesOf,
  layoutOptionsOf,
  sizesOf,
  type InputContent,
} from './input';
import { READABLE_ZOOM, absoluteBoxes, fitZoom, layoutFull, type Layout } from './layout';
import { borderLine, flatten, labelSize, type Rect } from './route';
import { splitEnd } from './slots';

/** The pane a reader sees a diagram in, at a normal width. */
export const NORMAL_PANE = { width: 560, height: 520 } as const;

const MAX_PER_RULE = 8;

/** The shape every check works on: boxes, and each edge's line as it is drawn. */
export function drawn(
  content: InputContent,
  layout: Layout,
  layoutNodes: ReturnType<typeof layoutNodesOf>,
): { nodes: AuditNode[]; edges: AuditEdge[]; boxes: Map<string, Rect> } {
  const boxes = absoluteBoxes(layoutNodes, layout.positions);
  const parent = parentMap(layoutNodes);
  const holders = containerIds(layoutNodes);
  const nodes: AuditNode[] = layoutNodes.flatMap((node) => {
    const box = boxes.get(node.id);
    return box === undefined
      ? []
      : [{ id: node.id, box, group: holders.has(node.id), above: ancestorsOf(node.id, parent) }];
  });
  const straight = content.routing === 'straight';
  const edges: AuditEdge[] = [];
  for (const edge of content.edges) {
    const source = splitEnd(edge.from);
    const target = splitEnd(edge.to);
    // A slot arrow has its own router, which goes round nodes; a self loop is drawn beside its node.
    if (source.slot !== undefined || target.slot !== undefined) continue;
    if (source.node === target.node) continue;
    const a = boxes.get(source.node);
    const b = boxes.get(target.node);
    if (a === undefined || b === undefined) continue;
    const id = edgeIdOf(edge);
    const route = straight || edge.routing === 'straight' ? undefined : layout.routes[id];
    const line = route === undefined ? [...borderLine(a, b)] : flatten(route.points, route.style);
    const text = edge.label;
    let label: Rect | undefined;
    if (text !== undefined && text !== '') {
      const size = labelSize(text);
      const at =
        route?.label ??
        (() => {
          const mid = {
            x: (line[0]!.x + line.at(-1)!.x) / 2,
            y: (line[0]!.y + line.at(-1)!.y) / 2,
          };
          return { x: mid.x - size.width / 2, y: mid.y - size.height / 2, ...size };
        })();
      label = at;
    }
    edges.push({ id, source: source.node, target: target.node, line, label });
  }
  return { nodes, edges, boxes };
}

const list = (ids: readonly string[]) =>
  ids.length <= 3
    ? ids.map((id) => `"${id}"`).join(', ')
    : `${ids
        .slice(0, 3)
        .map((id) => `"${id}"`)
        .join(', ')} and ${ids.length - 3} more`;

/**
 * Layout findings for every diagram pane of a config, as problems with paths like the ones lint
 * prints. Takes the config as written (what the command line has) and loads it itself, so a
 * walkthrough in a `{ walkthroughs: [...] }` collection gets its `walkthroughs[i]` prefix, and a
 * walkthrough that has errors is skipped: fix those first. Resolves to warnings only.
 */
export async function layoutProblems(config: unknown, registry: Registry): Promise<Problem[]> {
  const loaded = loadConfig(config, registry);
  const raw =
    typeof config === 'object' && config !== null && 'walkthroughs' in config
      ? ((config as { walkthroughs: { id?: unknown }[] }).walkthroughs ?? [])
      : undefined;
  const problems: Problem[] = [];
  for (const walkthrough of loaded.walkthroughs) {
    const at = raw?.findIndex((item) => item.id === walkthrough.id);
    const prefix = at === undefined ? [] : ['walkthroughs', at];
    problems.push(...(await walkthroughProblems(walkthrough, prefix)));
  }
  return problems;
}

export async function walkthroughProblems(
  walkthrough: ResolvedWalkthrough,
  prefix: (string | number)[],
): Promise<Problem[]> {
  const problems: Problem[] = [];
  for (const [index, pane] of walkthrough.panes.entries()) {
    if (pane.panel.id !== 'graph' && pane.panel.id !== 'flow') continue;
    problems.push(...(await paneProblems(pane, walkthrough, prefix, index)));
  }
  return problems;
}

export async function paneProblems(
  pane: ResolvedPane,
  walkthrough: ResolvedWalkthrough,
  prefix: (string | number)[],
  index: number,
): Promise<Problem[]> {
  const content = pane.content as InputContent;
  const panel = pane.panel.id;
  const sized = sizesOf(pane.id, content, walkthrough.source);
  const sizes = new Map([...sized].map(([id, entry]) => [id, entry.size]));
  const layoutNodes = layoutNodesOf(content, sizes);
  const edges = layoutEdgesOf(content);
  const layout = await layoutFull(
    layoutNodes,
    edges,
    content.direction,
    content.layout,
    layoutOptionsOf(content),
  );
  const shape = drawn(content, layout, layoutNodes);
  const base = [...prefix, 'layout', 'panes', index, 'content'];
  const out: Problem[] = [];
  const warn = (rule: string, path: (string | number)[], message: string) =>
    out.push({ severity: 'warning', rule: `${panel}/${rule}`, path, message });
  const edgePath = (id: string) => {
    const position = content.edges.findIndex((edge) => edgeIdOf(edge) === id);
    return [...base, 'edges', Math.max(0, position)];
  };
  const nodePath = (id: string) => [
    ...base,
    'nodes',
    Math.max(
      0,
      content.nodes.findIndex((node) => node.id === id),
    ),
  ];
  const name = (id: string) => {
    const edge = content.edges.find((item) => edgeIdOf(item) === id);
    return edge === undefined ? `"${id}"` : `${edge.from}→${edge.to}`;
  };
  const edgeById = new Map(content.edges.map((edge) => [edgeIdOf(edge), edge]));
  const mode = content.layout;
  const routing = content.routing ?? 'orthogonal';
  const capped = <T>(
    items: T[],
    emit: (item: T) => void,
    rule: string,
    path: (string | number)[],
  ) => {
    items.slice(0, MAX_PER_RULE).forEach(emit);
    if (items.length > MAX_PER_RULE) {
      warn(rule, path, `${items.length - MAX_PER_RULE} more like the ones above`);
    }
  };

  // 1. Edges through nodes.
  const through = throughNodes(shape.nodes, shape.edges);
  const byEdge = new Map<string, string[]>();
  for (const item of through) byEdge.set(item.edge, [...(byEdge.get(item.edge) ?? []), item.node]);
  capped(
    [...byEdge],
    ([edgeId, blockers]) => {
      const edge = edgeById.get(edgeId)!;
      const a = shape.boxes.get(splitEnd(edge.from).node)!;
      const blocker = shape.boxes.get(blockers[0]!)!;
      const advice: string[] = [];
      if (layout.kind === 'tree' || layout.kind === 'fast') {
        advice.push(
          `a ${layout.kind === 'tree' ? 'tree' : 'dense'} layout draws straight lines; pin node ${list(blockers)} elsewhere, or use the layered layout`,
        );
      } else if (routing !== 'orthogonal' || edge.routing === 'straight') {
        advice.push('set routing to "orthogonal" so the line goes round nodes');
      } else {
        const side = sideAwayFrom(a, blocker);
        const from =
          edge.fromSide === undefined
            ? `try "fromSide": "${side}" on edge ${edgeId}`
            : `edge ${edgeId} already leaves by "${edge.fromSide}"`;
        advice.push(`${from}, or pin node ${blockers[0]!} elsewhere`);
      }
      warn(
        'edge-through-node',
        edgePath(edgeId),
        `edge ${name(edgeId)} passes through node ${list(blockers)}; ${advice.join('; ')}`,
      );
    },
    'edge-through-node',
    base,
  );

  // 2. Labels on something.
  const hits = labelHits(shape.nodes, shape.edges);
  capped(
    hits,
    (hit) => {
      const what =
        hit.on === 'label'
          ? `the label of edge ${name(hit.other)}`
          : hit.on === 'line'
            ? `the line of edge ${name(hit.other)}`
            : `node "${hit.other}"`;
      warn(
        'label-overlap',
        edgePath(hit.edge),
        `the label of edge ${name(hit.edge)} overlaps ${what}; shorten the label, or set "spacing": "roomy"`,
      );
    },
    'label-overlap',
    base,
  );

  // 3. Crossings.
  const crossed = crossings(shape.edges);
  const limit = crossingLimit(shape.edges.length);
  if (crossed.length > limit) {
    const tally = new Map<string, number>();
    for (const [a, b] of crossed) {
      tally.set(a, (tally.get(a) ?? 0) + 1);
      tally.set(b, (tally.get(b) ?? 0) + 1);
    }
    const worst = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
    warn(
      'edge-crossings',
      base,
      `${crossed.length} pairs of edges cross (more than ${limit} for ${shape.edges.length} edges); the edges in most crossings are ${worst.map(([id, count]) => `${name(id)} (${count})`).join(', ')}. Try "order": "declared", "layout" direction DOWN, or fewer edges`,
    );
  }

  // 4. Overlapping nodes (pinned or placed by hand).
  capped(
    overlaps(shape.nodes),
    ([a, b]) => {
      const box = shape.boxes.get(b)!;
      const other = shape.boxes.get(a)!;
      warn(
        'node-overlap',
        nodePath(b),
        `node "${b}" overlaps node "${a}"; move "${b}" to x ${Math.round(other.x + other.width + 20)} or y ${Math.round(other.y + other.height + 20)} (it is at ${Math.round(box.x)}, ${Math.round(box.y)})`,
      );
    },
    'node-overlap',
    base,
  );

  // 5. Density, readability, and what the layout could not do.
  if (layout.kind === 'fast') {
    warn(
      'too-dense',
      base,
      `${edges.length} edges on ${content.nodes.length} nodes is too dense to lay out and route: nodes go in plain layers and edges are drawn straight. Split it into two panes, or leave out edges that carry no step`,
    );
  }
  for (const note of layout.notes) {
    if (note.rule === 'not-routed') warn('not-routed', base, note.message);
  }
  const rects = [...shape.boxes.values()];
  if (rects.length > 0) {
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const box = {
      width: Math.max(...rects.map((r) => r.x + r.width)) - left,
      height: Math.max(...rects.map((r) => r.y + r.height)) - top,
    };
    const zoom = fitZoom(box, NORMAL_PANE, 24, 1.15);
    if (zoom < READABLE_ZOOM) {
      const wide = box.width / NORMAL_PANE.width > box.height / NORMAL_PANE.height;
      const advice = [
        wide && content.direction === 'RIGHT'
          ? 'set "direction": "DOWN"'
          : !wide && content.direction === 'DOWN'
            ? 'set "direction": "RIGHT"'
            : undefined,
        content.spacing === 'compact' || mode !== 'layered'
          ? undefined
          : 'set "spacing": "compact"',
        'or split the diagram: the viewer then follows the call and not the whole picture',
      ].filter((item) => item !== undefined);
      warn(
        'too-wide',
        base,
        `the diagram is ${Math.round(box.width)} by ${Math.round(box.height)} px, so it fits a ${NORMAL_PANE.width} px pane only at zoom ${zoom.toFixed(2)} (text is unreadable below ${READABLE_ZOOM}); ${advice.join(', ')}`,
      );
    }
  }
  return out;
}
