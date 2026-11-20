# feature-walkthrough

A configurable UI that shows step-by-step walkthroughs of a flow. You describe the flow in a
config; the engine shows it in coordinated panels and a details card, one call at a time.

> **Status: early.** The core (config contract, cursor, fold, registry, card model, lint) is in
> place with tests. The shell, the panels and the demo walkthroughs are next.

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
pnpm build               # one self-contained dist/index.html
pnpm walkthrough lint <file...>   # check JSON or TypeScript configs
pnpm schema              # regenerate the JSON Schema
```

## Layout

- `src/core/` — the engine. It knows nothing about any panel or annotation (a lint rule enforces this).
- `src/shell/` — the page around the panels.
- `src/panels/`, `src/annotations/` — panel types and annotation plugins, registered in `src/registry.ts`.
- `src/walkthroughs/` — the bundled demo configs.

## License

MIT
