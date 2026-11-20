# feature-walkthrough

A configurable UI that shows step-by-step walkthroughs of a flow. You describe the flow in a
config; the engine shows it in coordinated panels and a details card, one call at a time.

> **Status: early.** The engine, the page, eight panels and five demos work end to end.

| Panel      | Shows                                                              |
| ---------- | ------------------------------------------------------------------ |
| `sequence` | Lanes and the messages between them                                |
| `graph`    | Nodes and relationships that appear as calls add them              |
| `flow`     | A chart of steps and decisions that calls walk through             |
| `boxes`    | Boxes within boxes: components, modules, call frames               |
| `table`    | Rows of data, with the rows and cells a call reads or changes      |
| `code`     | Source text, with the lines a call is about                        |
| `payload`  | Message and object bodies, with the fields a call reads or changes |
| `schema`   | Tables or types, their columns and the relations between them      |

Demos: OAuth 2.0 with PKCE, a spreadsheet recalculating, one React state update, a Terraform
plan and apply, and what git stores on add, commit and push (with real object ids).

Live demos: <https://xenolithe-labs.github.io/feature-walkthrough/>

## Use it

Write a JSON config, then:

```sh
npx feature-walkthrough flow.json                      # check it, then show it in the browser
npx feature-walkthrough lint flow.json                 # check only; exits 1 on errors
npx feature-walkthrough build flow.json -o flow.html   # one self-contained HTML file
npx feature-walkthrough schema                         # the JSON Schema of a config
```

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

Keys: ← → move one call, Shift ← → move one step. The address always points at the current call
(`#w=<walkthrough>&s=<step>&c=<call>&sel=<selected element>`), so any call can be linked to.

## The config

A config answers three questions:

| Question                       | Where                          | Holds                                                                                                 |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Which flow is this?            | `id`, `title`, `lead`, `lanes` | Identity and intro text                                                                               |
| What shows in each panel?      | `layout.panes[]`               | The panel type and its `content`: everything the pane can ever show                                   |
| Which step, and in what state? | `steps[].calls[]`              | Card text and `effects` per pane. A pane's state at a call is the fold of its effects up to that call |

Effects are `add`, `update`, `read`, `remove`, `focus` and `set`. The JSON Schema of the shared
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
```

## Layout

- `src/core/` — the engine. It knows nothing about any panel or annotation (a lint rule enforces this).
- `src/shell/` — the page around the panels.
- `src/panels/`, `src/annotations/` — panel types and annotation plugins, registered in `src/registry.ts`.
- `src/walkthroughs/` — the bundled demo configs.
- `cli/` — the `feature-walkthrough` command.
- `skills/` — the skill for coding agents; `reference.md` in it is generated.

## License

MIT
