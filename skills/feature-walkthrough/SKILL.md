---
name: feature-walkthrough
description: Write, check and show feature-walkthrough configs, which are JSON files that explain a flow one call at a time across coordinated panels (sequence, graph, flow chart, nested boxes, table, code, payload, schema, array, event bus, timeline, tree, bytes, hash ring). Use when asked to make a walkthrough, an explainer or a step-by-step diagram of a protocol, request flow, algorithm or system, or to edit or fix a feature-walkthrough config.
---

# feature-walkthrough

A walkthrough is one JSON file. The viewer shows it as a set of panes plus a details card, and the
reader moves through it one call at a time. You write the JSON; you never write UI code.

## The loop

You cannot see the result, so ask the checker what the reader will see.

1. Write the config (start from [`example.json`](example.json)).
2. Check it: `npx feature-walkthrough check flow.json --json`. The document has `summary` (counts and
   `exitCode`), and for each walkthrough `problems`, `findings`, `stats` and, when asked for, `trace`.
   It exits 1 on config errors and 2 when it was called wrongly.
3. Fix every `problems` entry (each has a `path`, for example `steps[2].calls[0].effects.graph[1]`),
   and check again until there are no errors and no warnings. A walkthrough with errors gets no
   findings, stats or trace yet.
4. Read `findings`. Each is a `warning` (fix it) or an `info` (look; keep it if it is on purpose),
   with a `rule`, the `path` to edit, a `message` that says what to do, and the `source` in the
   design guidance (the `walkthrough-design` skill) it comes from. Then look at `stats`: words per
   call, how many calls touch nothing.
   For `graph` and `flow` panes the findings include layout ones (group `layout`): the real layout
   is run and you are told what the picture would look like (an edge through a node, a label on a
   line, a diagram too wide to read). You cannot see the picture, so apply the hint the finding
   names (`fromSide`, `routing`, `spacing`, `direction`, a cell) and check again.
5. For each call you are unsure of, read what the reader sees there:
   `npx feature-walkthrough check flow.json --call <step id>.<call id>` (the `call` of a finding is
   already in that form; `2.1` means step 2, call 1). `--trace` does every call and is long. Check
   that each pane shows what the call's text says, and that nothing the text names is missing.
6. Show it: `npx feature-walkthrough flow.json` serves it locally, or
   `npx feature-walkthrough build flow.json -o flow.html` writes one self-contained HTML file.
   Both add syntax colours to code panes. To get colours into a JSON file that is loaded some
   other way, run `npx feature-walkthrough highlight flow.json -o flow.coloured.json`.

Do not hand over a config that has errors or warnings you have not looked at.
`npx feature-walkthrough lint flow.json` is the fast subset (problems only, as text, on stderr); use
it for a quick edit-and-check, and `check` before you hand over.

`check` options: `--only problems,design,layout,stats,trace` picks groups (config errors are always
reported), `--max-warnings 0` exits 1 if any warning is left, and several files may be given. The
shape of the JSON is the JSON Schema `feature-walkthrough/check-result.schema.json` (`schema/check-result.schema.json` in the package).

What `--json` looks like, cut down, for a copy of `example.json` in which the call `miss.reply-1` has
no text (the example itself checks clean):

```json
{
  "summary": { "errors": 0, "warnings": 1, "infos": 1, "exitCode": 0 },
  "files": [
    {
      "file": "flow.json",
      "walkthroughs": [
        {
          "id": "cache-read",
          "status": "checked",
          "problems": [],
          "findings": [
            {
              "severity": "warning",
              "rule": "design/text-missing",
              "at": "steps[0].calls[3].text",
              "call": "miss.reply-1",
              "message": "call \"miss.reply-1\" has no text; the reader sees only its name. Say what changed, with its values, and why it matters",
              "source": "walkthrough-design section 5 (...), checklist 17"
            }
          ],
          "stats": { "calls": 6, "words": { "mean": 10, "overCeiling": 0, "withoutText": 1 } }
        }
      ]
    }
  ]
}
```

What `--call hit.get-2` prints for `example.json` (the `>x<` marks a value the call touched, `x*` a thing it touched; the
last pane lines say what the reader sees, and the stage is what the Focus view puts on screen):

```text
step 2 "Second read: a hit" · call 1 "GET /user/7" [hit.get-2] · client -> service
  step text: The same user is asked for again.
  text (21 words): This time user 7 is in the cache, and its hits go from 0 to 1. The database is not asked.
  focus view, stage of 3: exchange, path, cache (largest: path) [path: touched, cache: touched, exchange: touched]
  pane exchange "Exchange" (sequence): added get-2
    message "GET /user/7": client -> service, drawn as call
  pane path "Decision" (flow): read get, cached, cached.reply
    nodes 5 of 5: get "GET /user/7" terminal*, cached "In the cache?" decision*, query "Query the database", ...
    edges 5 of 5: get -> cached, cached -> reply "yes"*, cached -> query "no", query -> fill, fill -> reply
  pane cache "Cache" (table): updated user-7
    1 of 1 rows shown; columns: key, value, hits
    user-7 (updated): key=user:7 value={name: "Ada"} hits=>1<
```

## The config answers three questions

| Question                       | Where                          |
| ------------------------------ | ------------------------------ |
| Which flow is this?            | `id`, `title`, `lead`, `lanes` |
| What can each pane ever show?  | `layout.panes[].content`       |
| Which step, and in what state? | `steps[].calls[].effects`      |

```jsonc
{
  "id": "my-flow", // ids: letters, digits, _ and - (no dots or colons)
  "title": "…",
  "lead": "One or two sentences on what the reader will learn.",
  "lanes": [{ "id": "client", "title": "Client" }], // the actors; needed for a sequence pane
  "layout": {
    "panes": [
      { "id": "exchange", "panel": "sequence", "title": "Exchange" },
      { "id": "state", "panel": "table", "title": "State", "content": {/* per panel */} },
    ],
  },
  "steps": [
    {
      "id": "step-1",
      "title": "Short step name",
      "text": "What this step is for.",
      "calls": [
        {
          "id": "call-1",
          "label": "Short name of the call", // shown on the card and on sequence arrows
          "from": "client", // optional lane ids; with both, the call is a message
          "to": "server",
          "text": "Why this happens and what to notice.",
          "where": "POST /token", // optional pointer: endpoint, file, spec section
          "request": { "lang": "http", "text": "…" }, // optional; a string also works
          "response": "…",
          "blocks": [{ "title": "Note", "text": "…" }], // optional extra text blocks
          "effects": { "state": [{ "update": "row-1", "fields": { "status": "done" } }] },
        },
      ],
    },
  ],
}
```

A file may also hold several walkthroughs: `{ "walkthroughs": [ … ] }`. The viewer then shows a
picker.

## Content and effects

**Content** declares every element a pane can ever show, each with an `id`. **Effects** say what a
call does to those elements. A pane's state at a call is its content plus every effect up to and
including that call, so stepping backwards always works. You never write "state at step N" by
hand.

An effect has exactly one verb:

| Effect                            | Meaning                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `{ "add": id }`                   | The element appears (it must not be present yet)        |
| `{ "update": id, "fields": {…} }` | The element changes; `fields` replaces the named values |
| `{ "read": id }`                  | The element is used by this call but not changed        |
| `{ "remove": id }`                | The element goes away                                   |
| `{ "focus": id }`                 | Centre the pane on the element                          |

Elements touched by the current call are highlighted and the rest fade, so give every call at
least one effect in each pane it is about. The highlight lasts for that call only; what `add`,
`update` and `remove` changed stays changed.

Whether elements are present before any call depends on the panel's `initial` default (below). Set
`"initial": false` on the content, or on one element, to make it appear only when a call does
`add`.

### Ids

An id you write uses letters, digits, `_` and `-`. Dots and colons are reserved, because the engine
uses them to build the ids of things that belong to other things. You never declare these ids,
but you name them in effects:

| Element                    | Its id         | Example              |
| -------------------------- | -------------- | -------------------- |
| An edge without an `id`    | `from.to`      | `cached.query`       |
| A column of a schema table | `table.column` | `order.user_id`      |
| A relation without an `id` | `from:to`      | `order.user_id:user` |
| A cell of an array         | `array.index`  | `items.3`            |
| A column of a table pane   | `col.column`   | `col.lag`            |
| A token of a ring node     | `node.index`   | `node-10.0`          |
| A slot of a record node    | `node.slot`    | `n1.next`            |

`update` may only set fields the element has. A misspelt field, or a tone that is not a tone, is a
lint error.

A lasting marker that outlives one call is a **tone**: `{ "update": id, "fields": { "tone": "warn" } }`.
Tones are `warn`, `good`, `muted`, and `none` to clear. Use them for states such as "dirty",
"done" or "skipped".

Use the same element id in two panes when it is the same thing (a row in a table and a node in a
graph). Selecting it in one pane then selects it in the other.

## Panels

Exact shapes are in [`reference.md`](reference.md), generated from the lint schemas.

| Panel      | Use it for                                        | Elements                                                        | Present at start         |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| `sequence` | Messages between lanes over time                  | lanes, calls                                                    | lanes                    |
| `graph`    | Things and relationships that build up            | nodes, slots, edges                                             | no                       |
| `flow`     | A flow chart that calls walk through              | nodes, slots, edges                                             | yes                      |
| `boxes`    | Nesting: modules, components, frames              | boxes, edges                                                    | yes                      |
| `table`    | Rows of data that calls read and change           | rows                                                            | yes                      |
| `code`     | Source text, with the lines in question           | sources                                                         | yes                      |
| `payload`  | Message and object bodies, field by field         | payloads                                                        | yes                      |
| `schema`   | Tables or types, columns and relations            | tables, columns, relations                                      | yes                      |
| `array`    | A row of cells with pointers and ranges           | cells, pointers, ranges                                         | cells                    |
| `bus`      | Events in topics, queues and buses                | channels, events, producers, consumers, cursors, rules, targets | all but events           |
| `timeline` | Rows along a time axis: heartbeats, timeouts      | rows, instants, spans, limits, `now`                            | all                      |
| `tree`     | An outline: files, DOM, accounts, an AST          | nodes                                                           | yes                      |
| `bytes`    | Bit and byte layouts: headers, frames, tokens     | frames, fields (`frame.field`), `frame.cursor`                  | fields with frame        |
| `ring`     | Consistent hashing, partition ownership, replicas | nodes, tokens, keys                                             | all but `initial: false` |

- **`sequence`**: write no effects. Every call with `from` and `to` becomes an arrow on its own
  call. `content.lanes` optionally limits and orders the lanes shown. Optional content, all by call id:
  - `styles`: `{ "token-response": "reply" }`. `call` (default, solid, filled head), `reply`
    (dashed, open head), `async` (solid, open head), `lost` (ends in a cross before the lane).
    A call from a lane to itself is drawn as a loop on the lane; it cannot be `lost`.
  - `fragments`: `{ "id": "retry", "kind": "loop", "label": "until it works", "from": "try-1",
"to": "ok-3" }`. `kind` is `loop`, `alt`, `opt` or `par`; `from` and `to` are the first and last
    message. `alt` and `par` take `"branches": [{ "at": "call-id", "label": "else" }]`, the call each
    further alternative starts at (the `label` of the fragment names the first). A frame appears with
    its first message, a branch divider with its first message. Frames may nest; they may not cross.
    Lint: `sequence/unknown-call`, `fragment-reversed`, `fragment-overlap`, `branch-order`,
    `branches-not-allowed`, `alt-needs-branch` (warning).
  - `notes`: `{ "id": "n1", "at": "make-state", "over": "app", "text": "..." }`; `over` is a lane or
    `["from-lane", "to-lane"]`. The note appears with its message, under it. Fragment and note ids are
    elements like any other (selectable, unique across the walkthrough).
- **`graph`, `flow`**: nodes `{ id, label, sub?, kind?, tone? }` and edges `{ from, to, label?, id? }`.
  `kind` is `step`, `decision` or `terminal`. An edge without an `id` gets the id `from.to`
  (for example `cached.query`); give an explicit `id` when two edges join the same pair. Read the
  edge as well as the node to show which way a decision went. `fields` can change `label`, `sub`,
  `tone` and `badge`. `direction` is `RIGHT` or `DOWN`. Cloud and cluster topologies add the following:
  - **Groups.** A node with `"parent": "<id>"` is drawn inside that node, which becomes a container
    around its children (one element type: a group takes marks, tones, selection and edges like any
    node, and an edge may start or end at one). Groups nest. A group does not fade while the call
    touches something inside it. An edge between a group and something inside it is a lint error.
    Layout runs once over every level. An explicit `x`/`y` is then relative to the parent, and a
    group's size comes from what it holds.
  - **Boundaries.** `"boundary": true` on a node that holds others draws it as a trust boundary or
    network zone (dashed border and a tag). Every edge that crosses one is marked with a gate and
    named on the card. This is derived from where the ends sit, never written. An edge that ends at
    the boundary node itself does not cross it.
  - **Icons.** `"icon": "<name>"` puts a glyph on a node or group. Built in: `server`, `database`,
    `queue`, `balancer`, `user`, `lock`, `cloud`, `globe`, `function`, `storage`, `cache`,
    `container`, `key`, `shield`, `network`, `gateway`, `document`, `package`, `bug`, `users`, `alert`. A pane's own
    `"icons": { "name": "M12 2 …" }` adds more (provider icons you supply): a value is SVG path data
    drawn in a 24 by 24 box as an outline, or `{ "d": "…", "fill": true, "size": 64 }` for a filled
    shape in a box of another size. Only path data is accepted (letters of path commands, numbers,
    separators; at most 4000 characters), never markup. An unknown name is a lint error.
  - **Moving.** `"parents": ["a", "b"]` lists every group a node may ever sit in (`parent` is where
    it starts, the first by default). `{ "update": "pod", "fields": { "parent": "b" } }` moves it;
    a parent outside the list is a lint error, and a node without `parents` has no `parent` field to
    update. Layout reserves a position in every listed group, so nothing else shifts when the node
    moves, and an empty reserved position draws nothing. Edges and boundary crossings follow the node.
  - **Traffic.** A call that `read`s an edge sends one dot along it (not under reduced motion);
    `{ "read": "reply-edge", "reverse": true }` runs it from target to source, for a reply. `reverse`
    is only for the `read` of an edge. An edge may have `"weight"` (0.5 to 12, its stroke width in
    pixels) and `update` may change it: `{ "update": "e", "fields": { "weight": 6 } }`.
  - **Lines.** Edges follow a route round the nodes, not a straight line through them. Pane
    `"routing"`: `"orthogonal"` (the default: right angles with rounded corners), `"curved"` (smooth
    curves) or `"straight"` (the old straight lines between borders; a straight line can cross a
    node). `"spacing"`: `"compact"`, `"normal"` (default) or `"roomy"`, the room between nodes and
    layers. `"order": "declared"` keeps nodes in the order you declared them within a layer, even
    where that makes lines cross (left alone, the layout reorders to avoid crossings). An edge may
    say `"routing"` (`"straight"`, `"orthogonal"` or `"curved"`: how this one line is drawn),
    `"fromSide"` and `"toSide"` (`"top"`, `"right"`, `"bottom"`, `"left"`: the side of its node the
    line leaves or arrives by). A node may say `"rank": "first"` or `"last"`: the first or last
    layer of a layered layout. A label sits on a pill where the layout put it. Routes come from the
    layout, so they never change between calls; a pinned or grid diagram is routed by a router that
    goes round every node; the tree layout, a diagram too dense to lay out (over 200 edges and three
    per node) and slot arrows draw straight lines (slot arrows have their own router); a node
    that moves between parents draws its edges straight. A self loop is always drawn beside its node.
  - **Placing nodes by hand.** Do not write pixels. In order of preference:
    1. `"cell": [column, row]`, whole numbers that only give the order (empty columns and rows take
       no room, so start at 0 or 1), with `"span": [columns, rows]` to cover more than one cell. The
       column widths and row heights come from the nodes in them, so text never overlaps. Inside a
       group, cells are relative to the group. As soon as any node of a pane (or of a group) has a
       cell or a relative place, that pane (group) is placed by the grid: nodes with no cell go into
       the first free cell, one column past the furthest node that points at them (one row, for
       `direction: "DOWN"`); lines are routed round the nodes, in the gaps between columns and rows.
       Absent nodes keep their cell, so nothing moves between calls.
    2. Relative to a node of the same group: `"rightOf": "<id>"` (the next column, same row),
       `"below": "<id>"` (the next row, same column), both together (column from `rightOf`, row from
       `below`), `"alignWith": "<id>"` (same row; same column when `below` is also given). They
       resolve to cells, so a cycle (`a` right of `b`, `b` below `a`), an unknown name, a name in
       another group, or two nodes that end up in one cell are lint errors.
    3. `"x"` and `"y"` pixel pins. When every node is pinned, positions are as given. When only some
       are, the layered layout places the rest and the pinned nodes keep the axes you gave; nodes
       that would overlap a pin move along their free axis. Pins are not used (and lint says
       `pin-ignored`, never silently) in a pane with groups, with cells, or with `layout` `tree` or
       `hub`, unless every node is pinned. Not built: `via` (cells an edge must pass) and "same rank
       as": nothing honours them predictably.
  - **Shapes.** `"shape"`: `"box"` (default), `"circle"` (a disc with the icon in it and the label,
    one or two short lines, beneath it; the line meets the disc) or `"pill"`. `"badge"`: a small count or
    short text (at most 8 characters) on a node's corner; `update` may change it:
    `{ "update": "apps", "fields": { "badge": 7 } }`. `"more": 4` draws a dashed disc reading `+4`: it
    stands for four children that are not drawn (give it a label such as `Show all`). `"accent"`:
    `red`, `amber`, `violet`, `blue` or `teal`, a ring colour for a kind of thing. Colour never
    carries meaning alone: the pane's `"accents": { "red": "Weakness" }` must explain every colour
    used (lint error `unknown-accent` otherwise); it is shown as a key beside the diagram and
    added to the node's accessible name. Marks (added, read, ...) still show over an accent.
    More built-in icons: `package`, `bug`, `users`, `alert`.
  - **Hub layout.** `"layout": "hub"` puts one node in the middle (the root of the tree with the most
    nodes; tree edges are found as for `tree`: the first edge that points at a node makes its source
    the parent) with the trees that hang from it fanning out to its left and right, level after
    level, with a smooth curve from each parent to its children, leaving together. A child of the
    hub says `"side": "left"` or `"right"`; without one it goes to the side with fewer nodes so far.
    Use it with `"shape": "circle"` nodes. See the dependency-vulnerability demo
    (`src/walkthroughs/dependency-vulnerability.ts`).
  - **Layout feedback.** `lint` also runs the real layout of every `graph` and `flow` pane (in Node:
    text estimates give the sizes, so it needs no browser) and warns, naming the elements:
    `edge-through-node` ("edge a→b passes through node "c"; try "fromSide": "bottom" on edge a.b, or
    pin node c elsewhere"), `label-overlap`, `edge-crossings` (more pairs of crossing edges than
    `max(4, 0.4 × edges)`), `node-overlap` (pinned nodes on top of each other, with a place to move
    one to), `too-dense`, `too-wide` (the diagram would need a zoom below 0.6 to fit a 560 px pane:
    try `"direction"`, `"spacing": "compact"`, or split it) and `not-routed` (too many nodes for the
    router: edges are drawn straight). They are warnings: lint still exits 0. They are skipped for a
    walkthrough that has errors, so fix those first. The loop: lint, apply the hint the warning
    names, lint again, until the layout warnings are gone. Other lint rules for hints (all in
    `graph/` and `flow/`): `unknown-anchor`, `placement-cycle`, `cell-taken`, `span-without-cell`,
    `pin-ignored`, `hint-ignored` (a hint with nothing to act on, such as `rank` in a tree layout),
    `unknown-accent`; a bad value of any hint is a schema error.
    **Records** (data structures): a node may have `slots`, an ordered row (or, with
    `"arrange": "column"`, a column) of named places, each `{ id, value?, label?, tone? }`. A slot is
    an element with the id `node.slot`: `read` marks it, `update` with `fields.value` (text or a
    number) changes what it says, `tone` works. Every slot reserves the width of the widest value
    that is declared or written to it (`width`, in characters, reserves more), so nothing shifts as
    values change. A slot is present when
    its node is; `"initial": false` on a slot makes it appear only when a call does `add node.slot`.
    `"head": false` hides the node's label strip, `"names": false` hides the slots' names. An edge
    end may be a node or `node.slot`: `{ "from": "n1.next", "to": "n2" }` draws the arrow out of
    that slot (a dot in the slot, then a curve), and a `to` slot ends at the slot. The arrow with
    the default id is `n1.next.n2`; **re-pointing is `remove` of the old edge and `add` of the new
    one**, both declared in the content. A pointer that is empty is a slot whose value says `null`.
    `"tree": false` on an edge says it is a reference (a variable pointing in), not a link of the
    structure: it is drawn, and arrives from above or below, but the tree layout ignores it.
    `"layout": "tree"` places nodes as a tree: the first edge that points at a node makes its source
    the parent (edges that would close a cycle, and `tree: false` edges, are not tree edges but
    still draw), children go left to right (top to bottom when `direction` is `RIGHT`) in the order
    of the slots they hang from, then in declaration order, and a node that uses `left` and
    `right` slots leaves a gap for the child it lacks. Positions come from the whole content, so
    nothing moves when a call adds a node. Lint rules: `unknown-slot`, `duplicate-slot`, an effect
    on a slot of a node that is not present (`slot-of-absent-node`).
- **`boxes`**: boxes `{ id, label, sub?, parent? }`; `parent` nests one box inside another.
  `direction` is `row` or `column`.
- **`table`**: `columns` `{ id, label, mono?, meter? }` and `rows` `{ id, cells: { columnId: "text" }, group? }`.
  Cell values are strings. `update` with `fields` keyed by column id changes cells. Add
  `"cells": ["columnId"]` to a `read` to mark single cells and not the whole row. No column may have
  the id `tone`. Headers keep the case you write. Optional, and none changes a table that does not
  use them:
  - `legend`: `{ "L": { "tone": "good", "label": "leader" } }` (tones `good`, `warn`, `muted`; the
    tone may be left out). A cell whose text is a legend key is drawn with that tone, and the legend
    is shown under the table. Use it for placement matrices and heat-map grids: change a cell with
    `update`, and its tone follows.
  - `group` on a row: consecutive rows with the same group get a header row that spans the table.
    Keep a group's rows together (lint warns otherwise). Group headers are not elements.
  - `meter: { max, warn? }` on a column: its cells must be numbers written as text (`"38"`). They
    are drawn as a bar and the number, and a number above `warn` is toned. Lint rejects a cell, or
    an `update` value, that is not a number or is outside 0 to `max`. A legend does not apply to a
    meter column.
  - `{ "read": "col.lag" }` marks a whole column (`col.` and the column id). A column is always
    present: it is read, never added, removed or updated.
- **`tree`**: `nodes` `{ id, label, sub?, kind?, tone?, parent?, parents?, collapsed?, initial? }`.
  `parent` hangs a node under another; children keep declaration order. `kind` is a short word
  drawn before the label (`OU`, `dir`). `update` can set `label`, `sub`, `tone`, `collapsed`
  (true or false) and `parent`, which moves the node and its subtree: only to an id listed in the
  node's `parents`, or back to the parent it was declared with. Lint rejects any other move, a
  cycle (also one that only a sequence of moves makes), a move under an absent node, and an `add`
  under an absent parent. Depth, indentation and connector lines are worked out. For the call, every
  ancestor of a touched node is opened, even if it is `collapsed`; the reader can close one with
  its twisty or Space, which wins for that call, and the closed node then says how many nodes it
  hides and how many of them the call touches. A call that sets `collapsed: true` on a node and
  also touches something inside it shows the node open for that call; the collapse applies from
  the next. Absent nodes keep their row. Removing a node drops its changes, so a moved node comes
  back where it was declared. The pane scrolls to the first touched node. Keys: Up, Down, Home and
  End move between nodes, Enter selects, Space opens or closes; Left and Right are left to the
  walkthrough.
- **`code`**: `sources` `{ id, title, lang?, text }`. Mark lines with
  `{ "read": "sourceId", "lines": [3, [7, 9]] }`; line numbers start at 1 and `[7, 9]` is a range.
  Any effect on a source brings it to the front. Set `lang` (`js`, `python`, `sql`, `hcl`, ...) and
  the command line adds syntax colours when it shows or builds the config; you never write the
  `tokens` field yourself. Count the lines; lint rejects a line past the end.
  Add `"expr": "a < b"` (or a list) to mark just that text inside the marked lines, and lint checks
  it is really there. `{ "update": "src", "fields": { "at": 7, "badge": "run 3" } }` keeps a
  current-line arrow in the margin, and a small label at the end of that line, until a later call
  moves them; `"at": null` clears the arrow.
  - **Diff**: give a source `"base": "<old text>"` next to `text`. The panel works out the changed
    lines and shows them with a `+`/`-` gutter and both line numbers; the reader can switch between
    "Changes" and "Result". `lines` always mean lines of `text`. To mark a removed line (or any line
    of the old text) use `"old": [2]`, which counts lines of `base`. `expr` is looked for on both.
    Syntax colours cover `text` and `base` (the command line adds `baseTokens`). Lint:
    `code/old-without-base`, `code/no-changes` (warning).
  - **Transcript**: `"transcript": true` (commands start with `"$ "`) or
    `"transcript": { "prompt": "> " }` makes the text output that appears over time, shown plain.
    `{ "update": "log", "fields": { "upto": 12 } }` reveals the first 12 lines; later lines keep their
    place and stay hidden, and the pane scrolls to the newest line. `upto` only grows, and `lines`
    may only mark lines already revealed. Lint: `code/upto-backwards`, `code/upto-out-of-range`,
    `code/upto-not-transcript`, `code/line-not-revealed`, `code/diff-transcript`.

- **`payload`**: `payloads` `{ id, title, sub?, value, raw? }`, where `value` is any JSON. Fields
  are addressed by dot path, with array positions as numbers: `entries.1.hash`. Mark fields with
  `{ "read": "payloadId", "paths": ["tree", "entries.0"] }`; change them with
  `{ "update": "payloadId", "fields": { "entries.1.hash": "new value" } }`. Paths must already
  exist. A key that contains a dot or a backslash is written with a backslash before it: the key
  `a.b` under `meta` is the path `meta.a\.b`. A leaf written as `{ "$ref": "elementId", "text": "shown" }`
  is a link that selects that element in every pane. `raw` (`{ label, text }`) adds a plain-text
  view; do not combine it with `fields` updates, because the text will not change.
- **`schema`**: `tables` `{ id, label, sub?, columns: [{ id, label?, type?, key?, note? }] }` and
  `relations` `{ from, to, label?, id? }`. A column's element id is `table.column`, and relation
  ends are a table id or a `table.column`. A relation without an `id` gets `from:to` (for example
  `order.user_id:user`). A relation may point back at its own table. `key` is a short badge such
  as `PK` or `FK`. Use `schema` for the shape of data and `table` for the rows.

- **`array`**: `arrays` `{ id, cells: [3, "a"…], length?, label? }`, `pointers` `{ id, at?, array?,
side?, label? }` and `ranges` `{ id, from, to, array?, dim?, label? }`. Cells are elements with the id
  `array.index` (`a.3`). `read` marks a compare, `update` with `"fields": { "value": 9 }` marks a
  write (a swap is two writes), `add` and `remove` grow and shrink it: `length` makes room for
  slots that start empty and absent, so a queue or stack grows without anything moving. A pointer
  moves with `{ "update": "lo", "fields": { "at": 4 } }`: nothing to clear. `at` is an index, one
  past either end (`-1`, `length`), or `null` for nothing; off the ends it is drawn at the edge
  with its value. A range is `from` to `to` inclusive, each an index or the id of a pointer to
  follow, so a window needs no effects at all; `from` = `to` + 1 is empty. `dim` draws the cells
  outside it dimmed. Give `array` on pointers and ranges when the pane has more than one array.
  Pointers and ranges each get a track, so nothing moves when one appears. Tones (`warn`, `good`,
  `muted`) work on cells, pointers and ranges.

- **`bus`**: `channels` `{ id, kind, partitions?, events, producers, consumers, cursors, rules }`.
  `kind` is `topic` (a log: events have offsets), `queue` or `bus`. Everything is nested in its
  channel. Events `{ id, label?, partition?, data? }` are listed in the order they reach the
  channel; they start absent and `add` publishes one, so offsets never move (lint rejects
  publishing out of order). An event's `fields.state` is `delivered`, `acked`, `failed` or `dead`
  (`none` clears it). Consumers `{ id, group?, sub? }` and producers take `fields.state` as free
  text. A cursor `{ id, partition?, group?, owner?, at }` is a group's committed offset in one
  partition, the offset of the **next** event to read: `update` with `fields.at` moves it and
  `fields.owner` (a consumer id, or `null`) hands the partition over, which is a rebalance. Lag is
  worked out as the end of the partition minus `at`: never write it. A rule `{ id, pattern?,
targets }` on a `bus` has an event pattern (field: list of values; nested objects; the operators
  `prefix`, `anything-but`, `exists`); the panel matches it against the `data` of the events the
  call touches and shows which rules matched. All fields must match, any value of a field may.
  Lint warns when a call invokes a target whose rule does not match the event in that call.
- **`timeline`**: `axis` `{ unit, from?, to, tick, pxPerUnit? }`, `rows` `{ id, label?, sub? }`,
  `instants` `{ id, row, at, kind?: heartbeat|event, state? }`, `spans` `{ id, row, from, to,
kind?: run|wait|lease, state? }` and `limits` `{ id, row, after, from, reset?, until?, by? }`.
  Times are numbers in the axis unit. The marker `now` is an element: `{ "update": "now",
"fields": { "at": 12 } }` moves it forward (never back). Instants and spans show once their
  time has come, so each call that moves `now` plays time forward and what it reveals is marked as
  added. `state` is `ok`, `late`, `missed`, `failed`, `retried` (`none` clears). A limit is drawn on
  the axis and its outcome is worked out, not written. With `reset` it is a silence limit (a
  heartbeat timeout): no more than `after` without an instant of that kind, counted from `from`
  (a time, an instant, or a span's start) until `until`; the gap that crosses it is drawn and the
  instant that ends it is `late`. Without `reset` it is one deadline `after` from `from`, met by
  `by` or by the end of the span `from` names. Lint rejects an instant on an unknown row, a span
  that ends before it starts, times off the axis, and a call that touches something that has not
  happened yet at that call.
- **`bytes`**: `frames` `{ id, title, unit, fields: [{ id, label?, short?, size?, variable?, value?,
decoded?, link?, counts?, tone? }], width?, ascii?, separator?, length?, inside?, cursor? }`. `unit` is
  `bits` (rows of `width`, 32 by default, with a bit ruler; each field `size` is in bits), `bytes` (rows
  of 8 or 16 as a hex dump, `ascii: true` adds a gutter; `size` in bytes) or `segments` (text pieces
  joined by `separator`, for a JWT or JWE; the size is the text). A field's element id is
  `frame.field` (`tcp.syn`); a frame with a `cursor` `{ at, label }` has `frame.cursor`. `value` is a
  number or `0x01bb` / `0b101` in a bits frame, hex pairs (`16 03 03`) in a bytes frame, the text in a
  segments frame; `decoded` is what it means (`443`). Offsets, rows, a field that straddles a row
  (drawn in two pieces that mark and select as one), the length and a variable field's gap are derived,
  never written. A `variable` field has a `size` (its length here; rows past the second are a gap) or
  none (it runs on and must be last). `length` on a frame and `counts` on a field
  (`{ of: "body" }` or `{ of: { from, to }, per: 32 }`, for a Data Offset or a length field) are
  checked by lint, at every call. `link` is `{ "$ref": "id", "text": "…" }`, the same as in `payload`.
  `inside: "frame.field"` draws a frame indented under the field that carries it. `read` marks a field,
  `update` takes `fields.value`, `decoded`, `tone` (a frame takes `title`, `sub`, `tone`; the cursor
  `at` as an offset or `null`, `label`). Add and remove act on whole frames; fields have no presence
  of their own. At a narrow pane the rows are halved (32 to 16 bits) so labels stay readable; a field
  of 1 or 2 bits reads sideways, using `short` if given.

- **`ring`**: a hash space drawn as a ring, for consistent hashing and replica placement. Content:
  `size` (positions are the integers `0` to `size - 1`, and the ring wraps), `replication` (how many
  nodes hold a key, the owner included), `nodes` `{ id, label?, positions: [..], state?, initial? }`
  and `keys` `{ id, at, label? }`. Each position of a node is a token (a virtual node); its element
  id is `node.index` from 0 (`node-10.0`). Write positions as hashes of real names, computed in
  code, not picked by hand. A key belongs to the first token at or after it going clockwise; a token
  owns the arc that ends at it; the replicas are the next distinct nodes. **None of this is
  written**: the owner and replicas of every key, each node's share of the ring, and **which keys
  changed owner in a call** (drawn as diamonds, with a bracket round the arc that changed hands) are
  all derived. `add` / `remove` a node is a join / leave (its tokens come and go with it);
  `update` a node with `fields.state` (`up`, `suspect`, `down`); `update` a token or key with
  `fields.at` moves it with one update; `add` a key puts it on the ring; `read` a key is a lookup
  and draws the clockwise walk to its owner and replicas (a selected key shows its walk too). A
  node that is `down` is skipped: owners and replicas are the first `replication` healthy nodes
  along the walk, as with a sloppy quorum in the Dynamo paper; `suspect` is not skipped. Hint
  storage and replay, and data streaming, are not modelled. Arcs are coloured per node and each
  node also has its own pattern; a legend table gives state, share, keys owned and held. It is
  drawn for 3 to 6 nodes with 1 to 8 tokens each: beyond 24 tokens only the tokens a call or the
  reader points at are labelled, and beyond six nodes colours repeat with a different pattern, so
  the legend carries the names. Lint: `ring/position-out-of-range`, `ring/duplicate-position` (also
  after a move), `ring/replication-too-high`, `ring/under-replicated` (warning),
  `ring/token-effect`, `ring/absent-token`, `ring/unknown-field`, `ring/bad-field`.

### Panes that share a slot

Panes are side by side by default. Give several panes `"role": "focus"` to make them share one
slot, and set `"show": "paneId"` on a call to switch which is visible. It stays until another call
changes it.

### Views

The page has two views of the same walkthrough, and the reader picks one with the Grid / Focus
control in the header. **Grid** shows every pane at once (all fixed panes and the current focus
pane). **Focus** puts the panes the current call has effects on
(at most three, one on a phone) on a stage that fills a desktop-sized window, and lists every pane in a bar that says what the call
does to it ("2 added · 1 read"). It needs nothing in the config; it works from the effects.
Set `"layout": { "view": "focus", … }` to open on Focus; omit it for Grid. A reader's own choice
and a link's `v=focus` or `v=grid` in the address override it. Because Focus follows the effects,
write the effects of each call with care: a pane a call is about but has no effect on is not
brought forward (a `read` is enough).

### Motion and Play

Motion is the reader's, and off by default: short transitions (about 0.2 s) that show what changed
from the call before to this one. Nothing in the config scripts it, and nothing depends on it: it
is derived from the effects, every call looks the same at rest, and meaning is never carried by
motion alone. Set `"layout": { "motion": true }` to open with it on. A reader's own choice (the
Motion button in the header) and a link's `m=1` or `m=0` override that, `m=0` also removes Play, and
a system that asks for reduced motion always wins. A **Play** button in the navigation bar steps
through the calls at a pace that follows the words on each card (Space starts and stops it). Write
each card so it can be read in a few seconds; a long card makes Play slow, not stuck. Play adds no
config.

### Annotations

The `status` annotation puts a labelled chip on calls. Declare the statuses once at
`annotations.status` on the walkthrough, then set `"annotations": { "status": { "status": "id" } }`
on a call. See `reference.md`.

## Writing a good walkthrough

- One call is one thing happening. If the card text needs "and then", split the call.
- Three to seven steps, one to five calls each. Step titles are nouns or short phrases.
- `label` is what happens (`POST /token`, `Mark A3 dirty`); `text` is why, and what to notice.
- Pick panels for what changes. Use `sequence` when the story is who talks to whom, `table` when
  it is values changing, `flow` when it is a decision, `graph` when it is things being created and
  linked, `payload` when it is what a message or stored object contains, `schema` when it is how
  types or tables relate. Two or three visible panes is usually right; put the rest in a shared
  slot with `"role": "focus"`.
- Declare everything in content first, then write the calls. `check` tells you about ids that do not
  exist, elements added twice and effects on elements that are not present, and then about calls
  with no text, text that is too long, calls that mark nothing, and values changed without being
  named.
- Use made-up but realistic values, and keep them consistent from call to call.
- Only state facts you can support. Put spec or doc pointers in `where`.

## For React apps

```tsx
import { Walkthrough, createRegistry } from 'feature-walkthrough';
import 'feature-walkthrough/style.css';

<Walkthrough config={config} registry={createRegistry()} />;
```

`defineWalkthrough({...})` gives type checking for a config written in TypeScript and returns the
same JSON. The JSON Schema of the shared shape is `npx feature-walkthrough schema`, or
`feature-walkthrough/schema.json`.

## Algorithms: record the run, do not write the trace

For an algorithm, do not write the effects of a loop by hand. Run the real code with a `Recorder`
and let it write the config; a hand-written trace can be wrong, a recorded one cannot disagree with
the code. `Recorder` is exported from the package and has no dependency on React.

```ts
import { Recorder, stripHooks } from 'feature-walkthrough';

const SOURCE = `function find(items, target) {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (items[mid] === target) return mid;
    if (items[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}`;

const rec = new Recorder({
  id: 'find',
  title: 'Binary search',
  source: { title: 'find.js', text: SOURCE },
});
const items = rec.array('items', [2, 5, 9, 14], {
  pointers: ['lo', 'hi', 'mid'],
  ranges: [{ id: 'window', from: 'lo', to: 'hi', dim: true }],
});
// ... run find(items, 9) with hooks in the body: rec.at(5, 'const mid'); rec.point('mid', mid); ...
const config = rec.finish(); // plain JSON: steps, calls, effects, line marks
```

- `rec.array(id, data, { pointers, ranges, pane })` returns a real array to give the algorithm. Reading
  `items[i]` records a compare, writing `items[i] = x` a write, `push` and `pop` add and remove
  cells, with no call from the author. Changes before the first `at` are setup and become the
  starting values. `rec.grid(...)` does the same for a table, `rec.vars(...)` is a table of
  variables, `rec.stack(...)` is a call stack, `rec.pane(id, panel, content)` is any other pane
  (then use `rec.read`, `rec.update`, `rec.tone`).
- `rec.at(line, "text on that line", { label, text, expr, changes })` starts a call, one card, for
  that line (or `[first, last]`). **The text is checked against the shown source and the call
  throws if the line does not contain it**, so a wrong line number fails a test and cannot mislead a
  reader. Every call gets the line mark, the current-line arrow and a `run n` / `depth n` label.
- `rec.point(name, index)`, `rec.range(name, from, to)`, `rec.set(name, value)`, `rec.tone(...)`
  say what a call does. `rec.enter(name, args)` and `rec.leave(result)` push and pop a stack frame.
- Steps are author-marked with `rec.step("Round {n}")` (`{n}` counts), or with
  `steps: "frames"` one step per function call. Put the recorder calls on lines that start with
  `rec.`: `stripHooks(text)` removes them, which gives the source to show. Keep the algorithm in a
  file next to the recorder calls and add a test that `stripHooks` of it equals the `source.text`
  you pass, and that the final state of the walkthrough equals the algorithm's real result.
  `src/walkthroughs/algorithms/` has four examples (binary search, quicksort, BFS, edit distance).

### Data structures

For linked lists, trees and hash tables, ask the recorder for a `records` pane and track the
objects the algorithm uses. A tracked object is the same plain object with its properties turned
into accessors, so the code that runs is the code that is shown.

```ts
const heap = rec.records('list', { title: 'Linked list', direction: 'RIGHT', layout: 'tree' });
heap.vars('vars', { prev: null, curr: null }, { head: false }); // variables: arrows into the structure
let head = null;
for (const val of [3, 1]) head = heap.node({ val, next: head }, { id: `n${val}` }); // setup
// ... inside the algorithm, on lines of their own:
//   rec.node(node, { id: 'x' });   // a node made during the run is added by that call
//   rec.ref('curr', curr);         // a variable moved
// and plain code does the rest: `curr.next = prev` records the slot change and the arrow move.
```

- `heap.node(obj, { id?, label?, arrange?, head?, names?, x?, y? })` makes every own property a
  slot, in order. A property holding an object or `null` is a pointer slot (value `null`, or empty
  with an arrow); anything else is a value slot. `heap.slots(id, cells)` is a node whose slots are
  the cells of an array (the buckets of a hash table).
- Setting a pointer records `remove` of the old edge, `update` of the slot and `add` of the new
  edge; reading a property records a `read` of its slot. Before the first `at()` it is setup and
  becomes the starting state. After `finish()` the objects are ordinary again.
- `heap.vars(id, { name: null | text })` is a node of variables; `rec.ref(name, value)` sets
  one. Their arrows are marked `tree: false`, except for variables named in `links`
  (`{ links: ['root'] }`): that arrow is a link of the structure, so a tree layout hangs the tree
  under the variables node, centred above its root.
- `rec.node(obj)` and `rec.ref(...)` use the first `rec.records()`; they start with `rec.`, so
  `stripHooks` removes them. The pane is ordinary `graph` config, and every edge that ever
  existed is declared. `src/walkthroughs/algorithms/` has three examples (reversing a linked
  list, inserting into a binary search tree, a hash table with chaining). A tree whose nodes
  change parent (a B-tree split moving children) cannot be shown, because layout is fixed from
  the first parent each node is given.
