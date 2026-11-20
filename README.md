# feature-walkthrough

A configurable UI that shows step-by-step walkthroughs of a flow. You describe the flow in a
config; the engine shows it in coordinated panels and a details card, one call at a time.

> **Status: early.** The engine, the page, fourteen panels and twenty-one demos work end to end.

| Panel      | Shows                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `sequence` | Lanes and messages, with loop/alt/opt/par frames and notes             |
| `graph`    | Nodes and relationships that appear as calls add them                  |
| `flow`     | A chart of steps and decisions that calls walk through                 |
| `boxes`    | Boxes within boxes: components, modules, call frames                   |
| `table`    | Rows of data: marked rows, cells and columns, a legend, groups, meters |
| `code`     | Source text with marked lines, as a diff, or as a growing transcript   |
| `payload`  | Message and object bodies, with the fields a call reads or changes     |
| `schema`   | Tables or types, their columns and the relations between them          |
| `array`    | Cells in a row, with the pointers and ranges that move over them       |
| `bus`      | Events in topics, queues and buses, with offsets, lag and rules        |
| `timeline` | Rows along a time axis: heartbeats, timeouts, retries, a `now` mark    |
| `tree`     | An indented, collapsible outline: files, accounts, an AST              |
| `bytes`    | Bit and byte layouts: packet headers, frames, token segments           |
| `ring`     | A hash ring: tokens, keys, owners and replicas, and which keys move    |

Demos: OAuth 2.0 with PKCE (with an `alt` frame for a failed check), a client retrying with backoff (`loop`, `par`, a lost message), a spreadsheet recalculating, one React state update, a Terraform
plan and apply (the change as a diff, the plan and apply output as a transcript), and what git stores on add, commit and push (with real object ids). Four
algorithm demos, recorded from the real code: binary search (found, and not found), quicksort with
its call stack, breadth-first search and edit distance. Three event-driven demos: a Kafka consumer
group that loses a consumer, a Temporal Activity that misses a heartbeat and is retried, and
EventBridge rules that start a Step Functions execution. Two more: a Kafka broker that fails
(leader election from the in-sync replicas, then a leadership rebalance), and an AWS API call
evaluated against service control policies inherited down an organisation. Protocols and storage:
the TCP three-way handshake header by header, a JWE token taken apart and decrypted, and a
consistent-hash ring gaining and losing a node.

Live demos: <https://xenolithe-labs.github.io/feature-walkthrough/>

## Use it

Write a JSON config, then:

```sh
npx feature-walkthrough flow.json                      # check it, then show it in the browser
npx feature-walkthrough lint flow.json                 # check only; exits 1 on errors
npx feature-walkthrough build flow.json -o flow.html   # one self-contained HTML file
npx feature-walkthrough highlight flow.json -o out.json # the config with syntax colours added
npx feature-walkthrough schema                         # the JSON Schema of a config
```

Code panes get syntax colours for any language the source names in `lang`. The colours are worked
out by the command line and stored in the page as data, so the viewer carries no highlighter and
stays small enough to embed anywhere. `--no-color` turns them off.

If the config has problems, `lint` prints each one with its path, and the page lists them too.
[`skills/feature-walkthrough/example.json`](skills/feature-walkthrough/example.json) is a small
complete config, and the files in `src/walkthroughs/` are larger ones.

Inside a React app:

```tsx
import { Walkthrough, createRegistry } from 'feature-walkthrough';
import 'feature-walkthrough/style.css';

<Walkthrough config={config} registry={createRegistry()} />;
```

The hosted page can also show any JSON config it is allowed to fetch: add `?src=<url of the config>`.

### For coding agents

[`skills/feature-walkthrough/`](skills/feature-walkthrough/SKILL.md) is a skill that teaches an
agent the config, each panel's shapes and the write, lint, fix, show loop. Copy the folder into
your agent's skills directory (for Claude Code, `.claude/skills/`). It also ships in the npm
package.

[`skills/walkthrough-design/`](skills/walkthrough-design/SKILL.md) is a second skill, for the design
before the config: who the reader is, what to leave out, which views to use, how to cut the flow
into calls and how to test the result. It has no syntax in it; its research is in `sources.md`.

### Explaining an algorithm

Do not write the steps of a loop by hand. Run the algorithm with a `Recorder`
(`import { Recorder } from 'feature-walkthrough'`): arrays you give it record their own reads and
writes, a few calls say which line is running and where a pointer is, and `finish()` returns the
ordinary config. Every line number is checked against the displayed source, so a wrong one fails
instead of misleading a reader. See `src/walkthroughs/algorithms/` and the skill.

Two views: **Grid** shows every pane at once; **Focus** shows the panes the current call touches
large, on a stage that fills a desktop-sized window (the page itself does not scroll there; on a
phone it is about a screen and a half), with a bar that lists every pane and what the call does
to it. The reader switches with the control in the header (the choice is kept per
browser), a link can ask for one with `v=focus` or `v=grid`, and a config can set the default with
`layout.view`.

Keys: ← → move one call, Shift ← → move one step. The address always points at the current call
(`#w=<walkthrough>&s=<step>&c=<call>&sel=<selected element>&v=<view>`), so any call can be linked to.

## The config

A config answers three questions:

| Question                       | Where                          | Holds                                                                                                 |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Which flow is this?            | `id`, `title`, `lead`, `lanes` | Identity and intro text                                                                               |
| What shows in each panel?      | `layout.panes[]`               | The panel type and its `content`: everything the pane can ever show                                   |
| Which step, and in what state? | `steps[].calls[]`              | Card text and `effects` per pane. A pane's state at a call is the fold of its effects up to that call |

Effects are `add`, `update`, `read`, `remove` and `focus`. Ids use letters, digits, `_` and `-`;
dots and colons are reserved for ids the engine builds, such as `table.column` and `from.to`. The JSON Schema of the shared
shape is in [`schema/walkthrough.schema.json`](schema/walkthrough.schema.json).

## Develop

```sh
pnpm install
pnpm dev                 # run the page
pnpm test                # unit tests
pnpm e2e                 # build, then browser tests (first: pnpm exec playwright install chromium)
pnpm typecheck && pnpm lint
pnpm build               # the viewer: one self-contained dist/viewer/index.html
pnpm build:all           # the viewer, the library and the command line
pnpm walkthrough <args>  # run the command line from source
pnpm schema && pnpm skill   # regenerate the JSON Schema and the skill's panel reference
pnpm colours             # regenerate the syntax colours of the bundled demos
```

Releases and the credentials they need are described in [`docs/release.md`](docs/release.md).

## Layout

- `src/core/` — the engine. It knows nothing about any panel or annotation (a lint rule enforces this).
- `src/shell/` — the page around the panels.
- `src/panels/`, `src/annotations/` — panel types and annotation plugins, registered in `src/registry.ts`.
- `src/walkthroughs/` — the bundled demo configs.
- `src/recorder/` — the trace recorder: run an algorithm, get a config. No React.
- `cli/` — the `feature-walkthrough` command.
- `skills/` — the skill for coding agents; `reference.md` in it is generated.

## License

MIT
