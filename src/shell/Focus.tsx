import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  planStage,
  stageCapacity,
  type Folder,
  type PaneActivity,
  type PaneViews,
  type PanelContext,
  type ResolvedPane,
  type ResolvedWalkthrough,
  type Selection,
} from '../core';
import type { Call } from '../core';

/** A short, plain description of what a call does to a pane: "2 added · 1 read". */
export function describeActivity(activity: PaneActivity | undefined): string {
  if (activity === undefined || activity.total === 0) return 'not touched';
  return (
    [
      ['added', activity.added],
      ['changed', activity.updated],
      ['read', activity.read],
      ['removed', activity.removed],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([word, count]) => `${count} ${word}`)
    .join(' · ');
}

/** The size of an element, kept up to date. Measured before the first paint. */
function useBoxSize<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  { width: number; height: number },
] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

interface FocusProps {
  walkthrough: ResolvedWalkthrough;
  folder: Pick<Folder, 'focusPane'>;
  s: number;
  c: number;
  call: Call;
  views: PaneViews;
  selection: Selection;
  theme: 'light' | 'dark';
  /** The card, which sits beside (or above) the stage. */
  children: React.ReactNode;
}

/**
 * The Focus view: the panes the current call touches large on a stage, and a bar that lists every
 * pane with what the call does to it. Only the panes on stage are rendered.
 */
export function Focus({
  walkthrough,
  folder,
  s,
  c,
  call,
  views,
  selection,
  theme,
  children,
}: FocusProps) {
  const [stageBox, size] = useBoxSize<HTMLDivElement>();
  const capacity = stageCapacity(size.width, size.height);
  const [pins, setPins] = useState<string[]>([]);

  const plan = useMemo(
    () => planStage(walkthrough, folder, s, c, { capacity, pinned: pins, selection: selection.id }),
    [walkthrough, folder, s, c, capacity, pins, selection.id],
  );
  const onStage = new Set(plan.stage.ids);
  const pinned = pins.filter((id) => plan.visible.some((pane) => pane.id === id));

  const toggle = useCallback(
    (id: string) =>
      setPins((old) =>
        old.includes(id) ? old.filter((x) => x !== id) : [...old, id].slice(-capacity),
      ),
    [capacity],
  );

  const staged = plan.visible.filter((pane) => onStage.has(pane.id));
  const touchedOffStage = plan.visible.filter(
    (pane) => !onStage.has(pane.id) && (plan.activity[pane.id]?.total ?? 0) > 0,
  );
  const swappedTitle =
    plan.swappedIn === undefined
      ? undefined
      : plan.visible.find((pane) => pane.id === plan.swappedIn)?.title;

  return (
    <div className="fw-body fw-focus-body">
      <div className="fw-workspace">
        <div className="fw-rail-wrap">
          <ul className="fw-rail" aria-label="Panes: what this call does to each">
            {plan.visible.map((pane) => {
              const activity = plan.activity[pane.id];
              const here = onStage.has(pane.id);
              const isPinned = pinned.includes(pane.id);
              const summary = describeActivity(activity);
              return (
                <li key={pane.id}>
                  <button
                    type="button"
                    className="fw-rail-item"
                    data-pane={pane.id}
                    data-on-stage={here ? 'true' : 'false'}
                    data-touched={(activity?.total ?? 0) > 0 ? 'true' : 'false'}
                    aria-pressed={isPinned}
                    onClick={() => toggle(pane.id)}
                  >
                    <span className="fw-rail-title">
                      <span className="fw-rail-dot" aria-hidden="true" />
                      {pane.title}
                      {plan.swappedIn === pane.id && (
                        <span className="fw-rail-new">Swapped in</span>
                      )}
                    </span>
                    <span className="fw-rail-summary">{summary}</span>
                    <span className="fw-visually-hidden">
                      {here ? ', on stage' : ', not on stage'}
                      {isPinned ? ', pinned' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="fw-rail-note">
            <span>
              {pinned.length > 0 ? 'Pinned. ' : ''}
              {touchedOffStage.length > 0
                ? `Also touched, not shown: ${touchedOffStage.map((pane) => pane.title).join(', ')}.`
                : pinned.length === 0
                  ? 'Select a pane to pin it.'
                  : ''}
            </span>
            {pinned.length > 0 && (
              <button type="button" className="fw-copy" onClick={() => setPins([])}>
                Follow the call
              </button>
            )}
          </p>
        </div>

        <div
          className="fw-stage"
          ref={stageBox}
          data-count={staged.length}
          style={{ '--fw-stage-count': staged.length } as React.CSSProperties}
        >
          {staged.map((pane) => (
            <StagePane
              key={pane.id}
              pane={pane}
              walkthrough={walkthrough}
              call={call}
              view={views[pane.id]!}
              activity={plan.activity[pane.id]}
              swapped={plan.swappedIn === pane.id}
              primary={plan.stage.primary === pane.id}
              pinned={pinned.includes(pane.id)}
              selection={selection}
              theme={theme}
            />
          ))}
        </div>
        <p className="fw-visually-hidden" aria-live="polite">
          {swappedTitle === undefined ? '' : `${swappedTitle} is now shown`}
        </p>
      </div>
      {children}
    </div>
  );
}

function StagePane({
  pane,
  walkthrough,
  call,
  view,
  activity,
  swapped,
  primary,
  pinned,
  selection,
  theme,
}: {
  pane: ResolvedPane;
  walkthrough: ResolvedWalkthrough;
  call: Call;
  view: PaneViews[string];
  activity: PaneActivity | undefined;
  swapped: boolean;
  primary: boolean;
  pinned: boolean;
  selection: Selection;
  theme: 'light' | 'dark';
}) {
  const ctx: PanelContext = { walkthrough, pane, call, current: view.current, selection, theme };
  const Panel = pane.panel.Component;
  const touched = (activity?.total ?? 0) > 0;
  return (
    <section
      className="fw-pane fw-stage-pane"
      data-pane={pane.id}
      data-panel={pane.panel.id}
      data-touched={touched ? 'true' : 'false'}
      data-swapped={swapped ? 'true' : 'false'}
      data-primary={primary ? 'true' : 'false'}
    >
      <h2 className="fw-pane-title">
        <span className="fw-pane-name">{pane.title}</span>
        <span className="fw-pane-tags">
          {swapped && <span className="fw-tag is-swapped">Swapped in</span>}
          {pinned && <span className="fw-tag">Pinned</span>}
          <span className={`fw-tag${touched ? ' is-touched' : ''}`}>
            {describeActivity(activity)}
          </span>
        </span>
      </h2>
      <div className="fw-pane-body">
        <Panel state={view.state} content={pane.content} ctx={ctx} />
      </div>
    </section>
  );
}
