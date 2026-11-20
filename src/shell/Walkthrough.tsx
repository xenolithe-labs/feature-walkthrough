import { useCallback, useEffect, useMemo } from 'react';
import {
  buildCard,
  clamp,
  createFolder,
  formatPath,
  isFirst,
  isLast,
  loadConfig,
  nextCall,
  nextStep,
  prevCall,
  prevStep,
  shapeOf,
  stepChips,
  type PanelContext,
  type Problem,
  type Registry,
  type ResolvedWalkthrough,
  type Selection,
} from '../core';
import { Card } from './Card';
import { useCursor, useTheme, type Theme } from './hooks';
import './shell.css';

export function Problems({ problems, title }: { problems: Problem[]; title: string }) {
  return (
    <main className="fw fw-problems">
      <h1>{title}</h1>
      <p>Fix these in the config and reload.</p>
      <ul>
        {problems.map((problem, index) => (
          <li key={index} className={`is-${problem.severity}`}>
            <code>{formatPath(problem.path)}</code>
            <span className="fw-problem-rule">{problem.rule}</span>
            <span>{problem.message}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

const LEGEND = [
  ['added', 'Added by this call'],
  ['updated', 'Changed by this call'],
  ['read', 'Read by this call'],
  ['removed', 'Removed by this call'],
  ['faded', 'Not touched by this call'],
] as const;

function Shell({
  walkthroughs,
  theme,
  onToggleTheme,
}: {
  walkthroughs: ResolvedWalkthrough[];
  theme: Theme;
  onToggleTheme(): void;
}) {
  const [cursor, setCursor] = useCursor(walkthroughs);
  const walkthrough = walkthroughs.find((item) => item.id === cursor.w) ?? walkthroughs[0]!;
  const shape = useMemo(() => shapeOf(walkthrough), [walkthrough]);
  const folder = useMemo(() => createFolder(walkthrough), [walkthrough]);
  const { s, c } = clamp(shape, cursor.s, cursor.c);

  const go = useCallback(
    (to: { s: number; c: number }) => setCursor({ ...cursor, w: walkthrough.id, ...to }),
    [cursor, setCursor, walkthrough.id],
  );
  const select = useCallback(
    (id: string | undefined) => {
      const next = { w: walkthrough.id, s, c };
      setCursor(id === undefined ? next : { ...next, sel: id });
    },
    [setCursor, walkthrough.id, s, c],
  );
  const selection: Selection = useMemo(() => ({ id: cursor.sel, select }), [cursor.sel, select]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight') {
        go(event.shiftKey ? nextStep(shape, s, c) : nextCall(shape, s, c));
      } else if (event.key === 'ArrowLeft') {
        go(event.shiftKey ? prevStep(shape, s) : prevCall(shape, s, c));
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, shape, s, c]);

  const views = useMemo(() => folder.at(s, c), [folder, s, c]);
  const card = useMemo(() => buildCard(walkthrough, s, c, views), [walkthrough, s, c, views]);
  const focusId = folder.focusPane(s, c);
  const step = walkthrough.steps[s]!;
  const call = step.calls[c]!;
  const visible = walkthrough.panes.filter((pane) => pane.role === 'fixed' || pane.id === focusId);

  const selectedLabel = useMemo(() => {
    if (cursor.sel === undefined) return undefined;
    for (const pane of walkthrough.panes) {
      const entity = pane.entities.find((item) => item.id === cursor.sel);
      if (entity?.label !== undefined) return entity.label;
    }
    return undefined;
  }, [cursor.sel, walkthrough]);

  return (
    <div className="fw" data-walkthrough={walkthrough.id} data-step={s + 1} data-call={c + 1}>
      <header className="fw-head">
        <div className="fw-head-text">
          {walkthroughs.length > 1 ? (
            <label className="fw-picker">
              <span className="fw-visually-hidden">Walkthrough</span>
              <select
                value={walkthrough.id}
                onChange={(event) => setCursor({ w: event.target.value, s: 0, c: 0 })}
              >
                {walkthroughs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <h1>{walkthrough.title}</h1>
          {walkthrough.lead !== undefined && <p className="fw-lead">{walkthrough.lead}</p>}
        </div>
        <button type="button" className="fw-theme" onClick={onToggleTheme}>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </header>

      <nav className="fw-steps" aria-label="Steps">
        <ol>
          {walkthrough.steps.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className="fw-step"
                aria-current={index === s ? 'step' : undefined}
                onClick={() => go({ s: index, c: 0 })}
              >
                <span className="fw-step-number">{index + 1}</span>
                <span className="fw-step-title">{item.title}</span>
                {stepChips(walkthrough, index).map((chip, position) => (
                  <span key={position} className={`fw-chip is-${chip.tone ?? 'neutral'}`}>
                    {chip.label}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="fw-nav">
        <button
          type="button"
          className="fw-arrow"
          aria-label="Previous call"
          disabled={isFirst(s, c)}
          onClick={() => go(prevCall(shape, s, c))}
        >
          ←
        </button>
        <ol className="fw-dots" aria-label="Calls in this step">
          {step.calls.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className="fw-dot"
                aria-label={`Call ${index + 1}: ${item.label}`}
                aria-current={index === c ? 'true' : undefined}
                title={item.label}
                onClick={() => go({ s, c: index })}
              />
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="fw-arrow"
          aria-label="Next call"
          disabled={isLast(shape, s, c)}
          onClick={() => go(nextCall(shape, s, c))}
        >
          →
        </button>
        <span className="fw-hint">← → one call · Shift ← → one step</span>
      </div>

      <div className="fw-body">
        <div className="fw-panes" data-count={visible.length}>
          {visible.map((pane) => {
            const view = views[pane.id]!;
            const ctx: PanelContext = {
              walkthrough,
              pane,
              call,
              current: view.current,
              selection,
              theme,
            };
            const Panel = pane.panel.Component;
            return (
              <section
                key={pane.id}
                className="fw-pane"
                data-pane={pane.id}
                data-panel={pane.panel.id}
              >
                <h2 className="fw-pane-title">{pane.title}</h2>
                <div className="fw-pane-body">
                  <Panel state={view.state} content={pane.content} ctx={ctx} />
                </div>
              </section>
            );
          })}
        </div>
        <Card card={card} selection={selection} selectedLabel={selectedLabel} />
      </div>

      <footer className="fw-legend" aria-label="Legend">
        {LEGEND.map(([mark, label]) => (
          <span key={mark} className={`fw-legend-item is-${mark}`}>
            <span className="fw-swatch" aria-hidden="true" />
            {label}
          </span>
        ))}
      </footer>
    </div>
  );
}

/**
 * The single entry point: hand it a config (one walkthrough or a list) and
 * the registry of panel types, and it shows the walkthrough or says exactly
 * what is wrong with the config.
 */
export function Walkthrough({ config, registry }: { config: unknown; registry: Registry }) {
  const { theme, toggle } = useTheme();
  const result = useMemo(() => loadConfig(config, registry), [config, registry]);
  if (!result.ok || result.walkthroughs.length === 0) {
    return <Problems problems={result.problems} title="This config has problems" />;
  }
  return <Shell walkthroughs={result.walkthroughs} theme={theme} onToggleTheme={toggle} />;
}
