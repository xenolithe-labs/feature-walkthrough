# feature-walkthrough

A configurable UI that shows step-by-step walkthroughs of a flow. You describe the flow in a
config; the engine shows it in coordinated panels and a details card, one call at a time.

> **Status: early.** The engine, the page, fourteen panels and twenty-five demos work end to end.

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

The `graph` and `flow` panels can also draw cloud and cluster topologies: nodes nest in groups
(`parent`), a group can be a trust boundary whose crossing edges are marked, nodes take icons
(built in, or your own path data), a node can move between the groups it lists (`parents`), and
a read edge shows traffic along it, with an optional `weight` as stroke width.

Lines go round the nodes: edges follow the route the layout (ELK) finds, with right angles or
smooth curves and their labels on a pill, never straight through a node. Optional hints steer the
layout (`routing`, `spacing`, `order`, an edge's `fromSide` and `toSide`, a node's `rank`), and
nodes can be placed by hand without pixels: on a grid (`cell`, `span`), relative to a neighbour
(`rightOf`, `below`, `alignWith`), or pinned on one or both axes. Nodes can be discs with their label
beneath (`shape: "circle"`), carry a count (`badge`) or a ring colour that the pane explains
(`accent`, `accents`), and `layout: "hub"` fans trees out to the left and right of one node. The
`lint` command runs the real layout and warns about what it would look like (an edge through a
node, a label on a line, a diagram too wide to read) and which hint would fix it, for an author
who cannot see the picture.

Demos: OAuth 2.0 with PKCE (with an `alt` frame for a failed check), a client retrying with backoff (`loop`, `par`, a lost message), a spreadsheet recalculating, one React state update, a Terraform
plan and apply (the change as a diff, the plan and apply output as a transcript), and what git stores on add, commit and push (with real object ids). Four
algorithm demos, recorded from the real code: binary search (found, and not found), quicksort with
its call stack, breadth-first search and edit distance. Three event-driven demos: a Kafka consumer
group that loses a consumer, a Temporal Activity that misses a heartbeat and is retried, and
EventBridge rules that start a Step Functions execution. Two more: a Kafka broker that fails
(leader election from the in-sync replicas, then a leadership rebalance), and an AWS API call
evaluated against service control policies inherited down an organisation. Protocols and storage:
the TCP three-way handshake header by header, a JWE token taken apart and decrypted, and a
consistent-hash ring gaining and losing a node. Cloud topology: a VPC drawn with nested
groups, an HTTPS request into an app, then a rolling replacement of an instance. Three data-structure demos, also recorded
from the real code: reversing a linked list in place, inserting into a binary search tree, and a
hash table that chains a collision. And one advisory at the centre of a dependency-vulnerability
investigation, with the weaknesses and exploit signals on one side and what it reaches on the other
(the hub layout; every name in it is invented).

Live demos: <https://xenolithe-labs.github.io/feature-walkthrough/>

## Use it

Write a JSON config, then:

```sh
npx feature-walkthrough flow.json                      # check it, then show it in the browser
npx feature-walkthrough lint flow.json                 # check only (and the layout of diagrams); exits 1 on errors
npx feature-walkthrough check flow.json --json         # lint, design and layout findings, stats, for agents
npx feature-walkthrough check flow.json --call s1.c2   # what a reader sees at one call, as text
npx feature-walkthrough build flow.json -o flow.html   # one self-contained HTML file
npx feature-walkthrough highlight flow.json -o out.json # the config with syntax colours added
npx feature-walkthrough schema                         # the JSON Schema of a config
npx feature-walkthrough skills install                 # copy the agent skills into ./.claude/skills
```

Code panes get syntax colours for any language the source names in `lang`. The colours are worked
out by the command line and stored in the page as data, so the viewer carries no highlighter and
stays small enough to embed anywhere. `--no-color` turns them off.

If the config has problems, `lint` prints each one with its path, and the page lists them too.
[`skills/feature-walkthrough/example.json`](skills/feature-walkthrough/example.json) is a small
complete config, and the files in `src/walkthroughs/` are larger ones.

`check` is for tools that write configs and cannot see the result. It reports everything `lint`
does, then design findings (a call with no text, text over the word ceiling, a call that marks
nothing, a value changed without being named, more than three panes at once, and so on, each with
the part of the design guidance it comes from), stats, and with `--call <step>.<call>` a text trace
of what each pane shows at that call and which panes the Focus view puts on stage. `--json` prints
one document whose shape is [`schema/check-result.schema.json`](schema/check-result.schema.json);
`--max-warnings <n>` makes warnings fail the run; exit codes are 0 clean, 1 config errors, 2 usage
error. The same checks are exported for other tools (`reviewConfig`, `designFindings`, `traceOf`
from the package), and asynchronous checks such as diagram layout plug in through
`cli/providers.ts`.

Inside a React app:

```tsx
import { Walkthrough, createRegistry } from 'feature-walkthrough';
import 'feature-walkthrough/style.css';

<Walkthrough config={config} registry={createRegistry()} />;
```

The hosted page can also show any JSON config it is allowed to fetch: add `?src=<url of the config>`.

### For coding agents

Two skills ship in the npm package. Put them where your agent looks for skills:

```sh
npx feature-walkthrough skills                    # list them
npx feature-walkthrough skills install            # copy both into ./.claude/skills
npx feature-walkthrough skills install --global   # or into ~/.claude/skills, for every project
npx feature-walkthrough skills install --to <dir> # or into another agent's skills directory
```

Installing is a plain copy from the package; nothing is downloaded. A skill that is already there
is left alone unless you pass `--force`.

[`skills/feature-walkthrough/`](skills/feature-walkthrough/SKILL.md) is a skill that teaches an
agent the config, each panel's shapes and the write, check, fix, show loop.

[`skills/walkthrough-design/`](skills/walkthrough-design/SKILL.md) is a second skill, for the design
before the config: who the reader is, what to leave out, which views to use, how to cut the flow
into calls and how to test the result. It has no syntax in it; its research is in `sources.md`.

### Explaining an algorithm

Do not write the steps of a loop by hand. Run the algorithm with a `Recorder`
(`import { Recorder } from 'feature-walkthrough'`): arrays you give it record their own reads and
writes, a few calls say which line is running and where a pointer is, and `finish()` returns the
ordinary config. Every line number is checked against the displayed source, so a wrong one fails
instead of misleading a reader. See `src/walkthroughs/algorithms/` and the skill. Linked structures work the same way:
`rec.records()` and `heap.node(...)` make the objects the algorithm uses record their own pointer
changes, drawn as records (nodes of named slots) with arrows that leave from the slot, and `layout:
"tree"` lays them out as a tree.

Two views: **Grid** shows every pane at once; **Focus** shows the panes the current call touches
large, on a stage that fills a desktop-sized window (the page itself does not scroll there; on a
phone it is about a screen and a half), with a bar that lists every pane and what the call does
to it. The reader switches with the control in the header (the choice is kept per
browser), a link can ask for one with `v=focus` or `v=grid`, and a config can set the default with
`layout.view`.

Keys: ← → move one call, Shift ← → move one step. The address always points at the current call
(`#w=<walkthrough>&s=<step>&c=<call>&sel=<selected element>&v=<view>&m=<0|1>`), so any call can be linked to.

**Motion** is off unless someone turns it on. With it on, a step of one call takes about 0.2 s to
show what changed: a pointer slides to its new cell, a bracket grows, a "now" marker moves, a
meter bar fills, something added fades in, a changed value settles. It never carries meaning on its
own (every call looks the same at rest, and the colours and marks are the same with it off), the
author scripts none of it, and a second step within a third of a second just snaps, so fast
stepping is never slower. Turn it on with the Motion button in the header (kept per browser), with
`m=1` in the address (`m=0` forces it off), or with `"layout": { "motion": true }` in the config.
The address wins, then the reader's choice, then the config. A system that asks for reduced motion
always wins: nothing moves.

**Play** steps through the calls on its own, so a reader can watch a walkthrough run. It is in the
navigation bar (Space also starts and stops it when focus is not in a control), with a speed of
Slower, Normal or Faster. It stays on a call for a time that grows with the words on the card (about
2.5 s plus a quarter of a second a word, between 3 and 15 s at Normal), waits while the pointer or
focus is in the panes or the card, and stops on any key or click, when the tab is hidden and at the
last call. A thin line under the button shows the time left. It works with motion off and with
reduced motion (it just steps), and `m=0` takes it away. Screen readers are told only that it started or stopped.

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
- `src/review/` — the checker behind `check`: design rules, stats, the trace. No React.
- `cli/` — the `feature-walkthrough` command.
- `skills/` — the skill for coding agents; `reference.md` in it is generated.

## License

MIT
