/**
 * The config contract.
 *
 * A config answers three questions:
 *   1. Which flow is this?            -> id, title, lead, lanes, tags
 *   2. What shows in each panel?      -> layout.panes[] (panel type + content)
 *   3. Which step, and in what state? -> steps[].calls[] (card text + effects per pane)
 *
 * This file validates the shape that every walkthrough shares. Pane `content`,
 * panel-specific effect fields and annotation data are validated afterwards
 * against the registered panel types and annotation plugins (see lint.ts).
 */
import { z } from 'zod';

export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'ids use letters, digits, ".", "_", ":" or "-"');

export const EFFECT_VERBS = ['add', 'update', 'read', 'remove', 'focus', 'set'] as const;
export type EffectVerb = (typeof EFFECT_VERBS)[number];

/**
 * One change to one pane. Exactly one verb per effect:
 *   { add: id }                 the element appears
 *   { update: id, fields? }     the element changes
 *   { read: id }                the element is read
 *   { remove: id }              the element goes away
 *   { focus: id }               centre on the element
 *   { set: value }              replace the pane's free-form value outright
 * Panels may accept extra keys next to the verb.
 */
export const EffectSchema = z
  .looseObject({
    add: IdSchema.optional(),
    update: IdSchema.optional(),
    read: IdSchema.optional(),
    remove: IdSchema.optional(),
    focus: IdSchema.optional(),
    set: z.unknown().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((effect, ctx) => {
    const used = EFFECT_VERBS.filter((verb) => effect[verb] !== undefined);
    if (used.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          used.length === 0
            ? `an effect needs one of: ${EFFECT_VERBS.join(', ')}`
            : `an effect takes one verb, found: ${used.join(', ')}`,
      });
    }
    if (effect.fields !== undefined && effect.update === undefined) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: '"fields" belongs to "update"' });
    }
  });
export type Effect = z.infer<typeof EffectSchema>;

export const LaneSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
});
export type Lane = z.infer<typeof LaneSchema>;

export const BlockSchema = z.strictObject({
  title: z.string().min(1),
  lang: z.string().optional(),
  text: z.string(),
});
export type Block = z.infer<typeof BlockSchema>;

const InlineBlockSchema = z.union([
  z.string(),
  z.strictObject({ lang: z.string().optional(), text: z.string() }),
]);

export const CallSchema = z.strictObject({
  id: IdSchema,
  /** Short name of the call: shown on the card and, for lane-to-lane calls, in sequence views. */
  label: z.string().min(1),
  from: IdSchema.optional(),
  to: IdSchema.optional(),
  text: z.string().optional(),
  /** A pointer to where this happens (a file, an endpoint, a section of a spec). */
  where: z.string().optional(),
  request: InlineBlockSchema.optional(),
  response: InlineBlockSchema.optional(),
  blocks: z.array(BlockSchema).optional(),
  /** Which focus pane to show from this call on. Carries forward until changed. */
  show: IdSchema.optional(),
  /** Effects keyed by pane id. */
  effects: z.record(IdSchema, z.array(EffectSchema)).optional(),
  /** Annotation data keyed by plugin id. */
  annotations: z.record(IdSchema, z.unknown()).optional(),
});
export type Call = z.infer<typeof CallSchema>;

const IdListSchema = z.array(IdSchema);

export const StepSummarySchema = z.strictObject({
  add: IdListSchema.optional(),
  update: IdListSchema.optional(),
  read: IdListSchema.optional(),
  remove: IdListSchema.optional(),
});
export type StepSummary = z.infer<typeof StepSummarySchema>;

export const StepSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1),
  text: z.string().optional(),
  /**
   * Optional hand-written summary per pane. When present, lint checks that it
   * equals the union of the step's call effects.
   */
  summary: z.record(IdSchema, StepSummarySchema).optional(),
  calls: z.array(CallSchema).min(1),
});
export type Step = z.infer<typeof StepSchema>;

export const PaneSchema = z.strictObject({
  id: IdSchema,
  /** Registered panel type id, for example "sequence" or "graph". */
  panel: z.string().min(1),
  title: z.string().optional(),
  /**
   * fixed: always visible. focus: shares one slot with the other focus panes;
   * a call's `show` picks which one is visible.
   */
  role: z.enum(['fixed', 'focus']).default('fixed'),
  /** Everything this pane can ever show. Validated by the panel type. */
  content: z.unknown().optional(),
});
export type Pane = z.infer<typeof PaneSchema>;

export const LayoutSchema = z.strictObject({
  panes: z.array(PaneSchema).min(1),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const WalkthroughSchema = z.strictObject({
  $schema: z.string().optional(),
  id: IdSchema,
  title: z.string().min(1),
  lead: z.string().optional(),
  tags: z.array(z.string()).optional(),
  lanes: z.array(LaneSchema).optional(),
  layout: LayoutSchema,
  /** Annotation plugin config keyed by plugin id. */
  annotations: z.record(IdSchema, z.unknown()).optional(),
  steps: z.array(StepSchema).min(1),
});
export type Walkthrough = z.infer<typeof WalkthroughSchema>;
/** What an author writes: defaults (such as a pane's role) may be left out. */
export type WalkthroughInput = z.input<typeof WalkthroughSchema>;

export const CollectionSchema = z.strictObject({
  $schema: z.string().optional(),
  walkthroughs: z.array(WalkthroughSchema).min(1),
});

/** A config file holds one walkthrough or a list of them. */
export const ConfigSchema = z.union([WalkthroughSchema, CollectionSchema]);
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

/** Identity helper for typed TypeScript configs. It returns exactly the JSON you pass in. */
export function defineWalkthrough(walkthrough: WalkthroughInput): WalkthroughInput {
  return walkthrough;
}

/** JSON Schema of the shared config shape, for editors and other generators. */
export function configJsonSchema(): unknown {
  return z.toJSONSchema(ConfigSchema, { io: 'input', unrepresentable: 'any' });
}
