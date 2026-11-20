import type { ComponentType } from 'react';
import type { ZodType } from 'zod';
import type { Call, Effect, Lane, Step, Walkthrough } from './schema';

export type PathSegment = string | number;

export interface Problem {
  severity: 'error' | 'warning';
  /** Stable rule id, for example "unknown-id" or "summary-mismatch". */
  rule: string;
  /** Where in the config the problem is. */
  path: PathSegment[];
  message: string;
}

/** An element a pane can show. `initial` elements are present before the first call. */
export interface EntityDecl {
  id: string;
  /** A name to show for the element, for example on the card. */
  label?: string;
  initial?: boolean;
}

export interface Selection {
  id: string | undefined;
  select(id: string | undefined): void;
}

export interface PanelContext {
  walkthrough: ResolvedWalkthrough;
  pane: ResolvedPane;
  call: Call;
  /** The effects of the call at the cursor, for this pane. */
  current: Effect[];
  selection: Selection;
  theme: 'light' | 'dark';
}

export type CardSection = { id: string; title: string } & (
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'list'; items: { label: string; entity?: string; mark?: string }[] }
  | { kind: 'fields'; rows: { key: string; value: string }[] }
);

/**
 * A panel type: a reusable view that is driven only by its pane's `content`
 * and by the effects of the calls up to the cursor.
 */
export interface PanelType<Content = unknown, State = unknown> {
  id: string;
  schema: {
    content: ZodType<Content>;
    /** Extra validation of this panel's effects. The shared effect shape is always checked. */
    effect?: ZodType<Effect>;
  };
  /** Every element the pane can show, so that lint and selection know the ids. */
  entities(content: Content, walkthrough: Walkthrough): EntityDecl[];
  /** Effects a call has on this pane without the author writing them. */
  implicit?(call: Call, content: Content): Effect[];
  /** State before the first call. */
  init(content: Content, walkthrough: Walkthrough): State;
  /** Pure: must return a new state and never change the one passed in. */
  reduce(state: State, effect: Effect, call: Call): State;
  Component: ComponentType<{ state: State; content: Content; ctx: PanelContext }>;
  cardSections?(args: {
    state: State;
    content: Content;
    current: Effect[];
    call: Call;
    pane: ResolvedPane;
  }): CardSection[];
  /**
   * A few short lines of plain text that say what a reader sees in this pane: its state after the
   * call at the cursor, with what that call touched marked. Used by `feature-walkthrough check`
   * to show an agent what it cannot see. Pure and cheap; no React, no DOM. Conventions: a value
   * the call touched is written `>value<`, a named thing it touched ends in `*`. Without it the
   * trace describes the pane from its element state alone.
   */
  describe?(
    state: State,
    content: Content,
    current: Effect[],
    /** The call at the cursor, for panes whose picture depends on it (a sequence's message). */
    call?: Call,
  ): string[];
  /**
   * Panel-specific problems. `elementIds` holds every element id of every pane, for panels
   * whose content can point at elements elsewhere.
   */
  lint?(pane: ResolvedPane, walkthrough: Walkthrough, elementIds: ReadonlySet<string>): Problem[];
}

// Panels differ in their Content and State types; the registry holds them all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPanel = PanelType<any, any>;

export interface Chip {
  label: string;
  tone?: 'neutral' | 'info' | 'good' | 'warn' | 'bad';
  title?: string;
}

/**
 * An annotation plugin: an overlay on calls that the core knows nothing about.
 * It can add a chip to the step buttons and sections to the details card.
 */
export interface AnnotationPlugin<PluginConfig = unknown, Data = unknown> {
  id: string;
  schema: {
    config: ZodType<PluginConfig>;
    call: ZodType<Data>;
  };
  chip?(data: Data, config: PluginConfig): Chip | undefined;
  cardSections?(data: Data, config: PluginConfig): CardSection[];
  lint?(walkthrough: Walkthrough, config: PluginConfig): Problem[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAnnotation = AnnotationPlugin<any, any>;

export interface ResolvedPane {
  id: string;
  title: string;
  role: 'fixed' | 'focus';
  panel: AnyPanel;
  /** Parsed by the panel's content schema. */
  content: unknown;
  entities: EntityDecl[];
}

export interface ResolvedAnnotation {
  plugin: AnyAnnotation;
  /** Parsed by the plugin's config schema. */
  config: unknown;
}

/** A walkthrough whose panes and annotations are bound to registered types. */
export interface ResolvedWalkthrough {
  source: Walkthrough;
  id: string;
  title: string;
  lead: string | undefined;
  lanes: Lane[];
  panes: ResolvedPane[];
  annotations: ResolvedAnnotation[];
  steps: Step[];
}
