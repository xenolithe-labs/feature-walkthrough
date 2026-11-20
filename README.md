# feature-walkthrough

A configurable UI that shows step-by-step walkthroughs of a flow. You describe the flow in a
config; the engine shows it in coordinated panels and a details card, one call at a time.

> **Status: early.** The engine, the page, two panels (`sequence`, `graph`), the `status`
> annotation and one demo (OAuth 2.0 with PKCE) work end to end. More panels and demos are next.

Run `pnpm dev` to see the demo. To show your own flow, write a JSON config and open the page with
`?src=<url of the config>`; if the config has problems, the page lists each one with its path.
`src/walkthroughs/oauth-pkce.ts` is a complete example.

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
