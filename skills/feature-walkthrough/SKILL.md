---
name: feature-walkthrough
description: Write, check and show feature-walkthrough configs, which are JSON files that explain a flow one call at a time across coordinated panels (sequence, graph, flow chart, nested boxes, table, code, payload, schema, array). Use when asked to make a walkthrough, an explainer or a step-by-step diagram of a protocol, request flow, algorithm or system, or to edit or fix a feature-walkthrough config.
---

# feature-walkthrough

A walkthrough is one JSON file. The viewer shows it as a set of panes plus a details card, and the
reader moves through it one call at a time. You write the JSON; you never write UI code.

## The loop

1. Write the config (start from [`example.json`](example.json)).
2. Check it: `npx feature-walkthrough lint flow.json`. It exits 1 on errors and prints one line per
   problem with the path, such as `steps[2].calls[0].effects.graph[1]`.
3. Fix every error and every warning, then lint again until it prints `ok`.
4. Show it: `npx feature-walkthrough flow.json` serves it locally, or
   `npx feature-walkthrough build flow.json -o flow.html` writes one self-contained HTML file.

Do not hand over a config that has not passed `lint`.

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

`update` may only set fields the element has. A misspelt field, or a tone that is not a tone, is a
lint error.

A lasting marker that outlives one call is a **tone**: `{ "update": id, "fields": { "tone": "warn" } }`.
Tones are `warn`, `good`, `muted`, and `none` to clear. Use them for states such as "dirty",
"done" or "skipped".

Use the same element id in two panes when it is the same thing (a row in a table and a node in a
graph). Selecting it in one pane then selects it in the other.

## Panels

Exact shapes are in [`reference.md`](reference.md), generated from the lint schemas.

| Panel      | Use it for                                | Elements                   | Present at start |
| ---------- | ----------------------------------------- | -------------------------- | ---------------- |
| `sequence` | Messages between lanes over time          | lanes, calls               | lanes            |
| `graph`    | Things and relationships that build up    | nodes, edges               | no               |
| `flow`     | A flow chart that calls walk through      | nodes, edges               | yes              |
| `boxes`    | Nesting: modules, components, frames      | boxes, edges               | yes              |
| `table`    | Rows of data that calls read and change   | rows                       | yes              |
| `code`     | Source text, with the lines in question   | sources                    | yes              |
| `payload`  | Message and object bodies, field by field | payloads                   | yes              |
| `schema`   | Tables or types, columns and relations    | tables, columns, relations | yes              |
| `array`    | A row of cells with pointers and ranges   | cells, pointers, ranges    | cells            |

- **`sequence`**: write no effects. Every call with `from` and `to` becomes an arrow on its own
  call. `content.lanes` optionally limits and orders the lanes shown.
- **`graph`, `flow`**: nodes `{ id, label, sub?, kind?, tone? }` and edges `{ from, to, label?, id? }`.
  `kind` is `step`, `decision` or `terminal`. An edge without an `id` gets the id `from.to`
  (for example `cached.query`); give an explicit `id` when two edges join the same pair. Read the
  edge as well as the node to show which way a decision went. `fields` can change `label`, `sub`
  and `tone`. `direction` is `RIGHT` or `DOWN`.
- **`boxes`**: boxes `{ id, label, sub?, parent? }`; `parent` nests one box inside another.
  `direction` is `row` or `column`.
- **`table`**: `columns` `{ id, label, mono? }` and `rows` `{ id, cells: { columnId: "text" } }`.
  Cell values are strings. `update` with `fields` keyed by column id changes cells. Add
  `"cells": ["columnId"]` to a `read` to mark single cells and not the whole row. No column may have
  the id `tone`.
- **`code`**: `sources` `{ id, title, lang?, text }`. Mark lines with
  `{ "read": "sourceId", "lines": [3, [7, 9]] }`; line numbers start at 1 and `[7, 9]` is a range.
  Any effect on a source brings it to the front. Count the lines; lint rejects a line past the end.
  Add `"expr": "a < b"` (or a list) to mark just that text inside the marked lines, and lint checks
  it is really there. `{ "update": "src", "fields": { "at": 7, "badge": "run 3" } }` keeps a
  current-line arrow in the margin, and a small label at the end of that line, until a later call
  moves them; `"at": null` clears the arrow.

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
- Declare everything in content first, then write the calls. Lint tells you about ids that do not
  exist, elements added twice and effects on elements that are not present.
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
