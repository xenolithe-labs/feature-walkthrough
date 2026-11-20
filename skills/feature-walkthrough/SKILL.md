---
name: feature-walkthrough
description: Write, check and show feature-walkthrough configs, which are JSON files that explain a flow one call at a time across coordinated panels (sequence, graph, flow chart, nested boxes, table, code, payload, schema). Use when asked to make a walkthrough, an explainer or a step-by-step diagram of a protocol, request flow, algorithm or system, or to edit or fix a feature-walkthrough config.
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
  "id": "my-flow", // ids: letters, digits, . _ : -
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
| `{ "set": value }`                | Replace a pane's free-form value (few panels use this)  |

Elements touched by the current call are highlighted and the rest fade, so give every call at
least one effect in each pane it is about. The highlight lasts for that call only; what `add`,
`update` and `remove` changed stays changed.

Whether elements are present before any call depends on the panel's `initial` default (below). Set
`"initial": false` on the content, or on one element, to make it appear only when a call does
`add`.

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

### Panes that share a slot

Panes are side by side by default. Give several panes `"role": "focus"` to make them share one
slot, and set `"show": "paneId"` on a call to switch which is visible. It stays until another call
changes it.

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
