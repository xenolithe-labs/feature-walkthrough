# Changelog

## 0.1.0

The first release.

- **Viewer**: a walkthrough is one JSON config, shown as coordinated panes and a details card that
  the reader steps through one call at a time. Two layouts (a grid, and a focus view that stages the
  panes a call touches), light and dark themes, deep links to any call, opt-in motion and a Play
  control.
- **Panels**: `sequence`, `graph`, `flow`, `boxes`, `table`, `code`, `payload`, `schema`, `array`,
  `bus`, `timeline`, `tree`, `bytes` and `ring`, plus a `status` annotation.
- **Command line**: `feature-walkthrough <file>` serves a config; `lint` checks it; `check` adds
  design and layout findings, stats and a text trace for agents; `build` writes one self-contained
  HTML file; `highlight` adds syntax colours; `schema` prints the JSON Schema; `skills` lists and
  installs the agent skills; `help [command]` explains each one.
- **Library**: the `Walkthrough` component, the engine, the registry of panels, a recorder that turns
  a real run of an algorithm into a config, and the checker, for use in a React app.
- **Agent skills**: `feature-walkthrough` (the config and the write, check, fix, show loop) and
  `walkthrough-design` (what a walkthrough should show, and how).

The config contract may still change before 1.0.
