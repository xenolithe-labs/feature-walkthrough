import { renderToStaticMarkup } from 'react-dom/server';
import {
  createFolder,
  type PanelContext,
  type ResolvedPane,
  type ResolvedWalkthrough,
} from '../../src/core';

/** Panels that draw with React Flow need a browser; everything else renders on the server. */
export const NEEDS_BROWSER = new Set(['graph', 'flow']);

export function renderPane(
  w: ResolvedWalkthrough,
  pane: ResolvedPane,
  s: number,
  c: number,
  folder = createFolder(w),
  selected?: string,
): string {
  const view = folder.at(s, c)[pane.id]!;
  const ctx: PanelContext = {
    walkthrough: w,
    pane,
    call: w.steps[s]!.calls[c]!,
    current: view.current,
    selection: { id: selected, select: () => {} },
    theme: 'light',
  };
  const Panel = pane.panel.Component;
  return renderToStaticMarkup(<Panel state={view.state} content={pane.content} ctx={ctx} />);
}

/** Renders every server-renderable pane at every cursor; returns the markup and what React logged. */
export function renderAll(
  w: ResolvedWalkthrough,
  selected?: string,
): { html: string; complaints: string[] } {
  const complaints: string[] = [];
  let html = '';
  const original = console.error;
  console.error = (...args: unknown[]) => complaints.push(String(args[0]).slice(0, 160));
  try {
    const folder = createFolder(w);
    w.steps.forEach((step, s) =>
      step.calls.forEach((_, c) => {
        for (const pane of w.panes) {
          if (NEEDS_BROWSER.has(pane.panel.id)) continue;
          html += renderPane(w, pane, s, c, folder, selected);
        }
      }),
    );
  } finally {
    console.error = original;
  }
  return { html, complaints };
}

export const renderEverything = (w: ResolvedWalkthrough, selected?: string): string[] =>
  renderAll(w, selected).complaints;
