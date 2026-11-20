/**
 * The shape of `feature-walkthrough check --json`, as Zod schemas. The JSON Schema in
 * schema/check-result.schema.json is generated from `CheckResultSchema` (run "pnpm schema:check");
 * a test keeps the two equal. Change a field here and the file, and say so in the changelog:
 * agents parse this.
 */
import { z } from 'zod';

/** Bump when a field is removed or changes meaning. Adding an optional field does not. */
export const CHECK_SCHEMA_VERSION = 1;

const PathSchema = z
  .array(z.union([z.string(), z.number()]))
  .describe('Where in the config, as keys and indexes from the file root.');

const Located = {
  path: PathSchema,
  at: z.string().describe('The path as text, for example steps[2].calls[0].text.'),
};

export const ProblemSchema = z
  .object({
    severity: z.enum(['error', 'warning']),
    rule: z.string().describe('The lint rule id, for example "unknown-id".'),
    ...Located,
    message: z.string(),
  })
  .describe('A problem `lint` reports. An error means the config cannot be shown.');

export const FindingSchema = z
  .object({
    severity: z
      .enum(['warning', 'info'])
      .describe('warning: worth fixing. info: look, and keep it if it is deliberate.'),
    rule: z.string().describe('"design/<name>", or the id a layout provider gives.'),
    group: z.enum(['design', 'layout']),
    ...Located,
    message: z.string().describe('What is wrong and what to do about it.'),
    source: z.string().describe('Which part of the design guidance the rule comes from.'),
    call: z.string().optional().describe('"<step id>.<call id>" when the finding is about a call.'),
  })
  .describe('Feedback on a config that loads: how it could be better, not why it will not load.');

const Count = z.number().int().nonnegative();
const Rounded = z.number().nonnegative();

export const StatsSchema = z
  .object({
    steps: Count,
    calls: Count,
    callsPerStep: z.object({ min: Count, max: Count, mean: Rounded }),
    words: z.object({
      total: Count,
      mean: Rounded.describe('Words per call, over all calls.'),
      median: Rounded,
      longest: z.object({ words: Count, call: z.string().nullable() }),
      overCeiling: Count.describe('Calls over about 40 words, or past three sentences.'),
      withoutText: Count,
    }),
    panes: Count,
    elements: Count.describe('Elements the panes declare, all panes together.'),
    touchedPerCall: z.object({
      mean: Rounded,
      max: Count,
      zero: Count.describe('Calls that touch nothing in any pane.'),
    }),
    perPane: z.array(
      z.object({
        pane: z.string(),
        panel: z.string(),
        role: z.enum(['fixed', 'focus']),
        elements: Count,
        callsTouching: Count.describe('Calls that add, update, read or remove something here.'),
        callsChanging: Count.describe('Calls that add, update or remove something here.'),
      }),
    ),
  })
  .describe('Counts that show the shape of a walkthrough.');

const EffectsSchema = z.object({
  added: z.array(z.string()),
  updated: z.array(z.string()),
  read: z.array(z.string()),
  removed: z.array(z.string()),
});

export const TraceCallSchema = z
  .object({
    step: z.object({
      index: z.number().int().positive().describe('From 1.'),
      id: z.string(),
      title: z.string(),
      text: z.string().optional(),
    }),
    call: z.object({
      index: z.number().int().positive().describe('Within the step, from 1.'),
      id: z.string(),
      key: z.string().describe('"<step id>.<call id>": what --call takes.'),
      label: z.string(),
      from: z.string().optional(),
      to: z.string().optional(),
      text: z.string().optional(),
      where: z.string().optional(),
      words: Count,
    }),
    focus: z.string().optional().describe('The focus pane shown at this call, if any.'),
    stage: z
      .object({
        capacity: z.number().int().positive().describe('How many panes the stage is sized for.'),
        panes: z.array(z.string()).describe('What the Focus view puts on stage, in layout order.'),
        primary: z.string().optional().describe('The pane given the most room.'),
        reasons: z
          .record(z.string(), z.string())
          .describe('Why each pane is on stage: touched, recent, default, swapped, ...'),
      })
      .describe('What the Focus view shows for this call.'),
    panes: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          panel: z.string(),
          role: z.enum(['fixed', 'focus']),
          did: EffectsSchema.describe('What this call does to the pane, by element id.'),
          lines: z
            .array(z.string())
            .describe(
              'The pane as a reader sees it after the call. `>x<` and `x*` mark what the call touched.',
            ),
        }),
      )
      .describe('The panes on screen in the Grid view at this call.'),
    hidden: z.array(z.string()).describe('Focus panes that are not shown at this call.'),
  })
  .describe('What a reader sees at one call.');

export const WalkthroughReviewSchema = z
  .object({
    index: z.number().int().nonnegative().describe('Position in the file, from 0.'),
    id: z.string().nullable().describe('Null when the file gives none.'),
    title: z.string().nullable(),
    path: PathSchema.describe('["walkthroughs", n] in a collection, [] otherwise.'),
    status: z
      .enum(['checked', 'not-checked'])
      .describe('not-checked: it has config errors, so findings, stats and trace were skipped.'),
    problems: z
      .array(ProblemSchema)
      .optional()
      .describe('Config problems: errors and lint warnings.'),
    findings: z.array(FindingSchema).optional(),
    stats: StatsSchema.optional(),
    trace: z.array(TraceCallSchema).optional(),
  })
  .describe('One walkthrough of a file.');

export const FileReviewSchema = z
  .object({
    file: z.string(),
    readError: z.string().optional().describe('The file could not be read or parsed.'),
    problems: z
      .array(ProblemSchema)
      .describe('Problems that belong to no walkthrough, such as a bad collection.'),
    walkthroughs: z.array(WalkthroughReviewSchema),
  })
  .describe('One file.');

export const CheckResultSchema = z
  .object({
    schemaVersion: z.literal(CHECK_SCHEMA_VERSION),
    tool: z.literal('feature-walkthrough'),
    version: z.string(),
    options: z.object({
      only: z.array(z.string()).describe('The groups that were asked for. Empty: all but trace.'),
      call: z.string().nullable(),
      maxWarnings: z.number().int().nonnegative().nullable(),
      stageCapacity: z.number().int().positive(),
    }),
    files: z.array(FileReviewSchema),
    summary: z.object({
      files: Count,
      walkthroughs: Count,
      errors: Count.describe('Config errors. Any error makes the exit code 1.'),
      warnings: Count.describe('Lint warnings and design or layout warnings together.'),
      infos: Count,
      exitCode: z.union([z.literal(0), z.literal(1)]),
      reason: z.string().describe('Why the exit code is not 0; empty when it is.'),
    }),
  })
  .describe('The result of `feature-walkthrough check --json`.');

export type CheckResult = z.infer<typeof CheckResultSchema>;
export type FileReview = z.infer<typeof FileReviewSchema>;
export type WalkthroughReview = z.infer<typeof WalkthroughReviewSchema>;
export type TraceCall = z.infer<typeof TraceCallSchema>;
export type Stats = z.infer<typeof StatsSchema>;

/** The JSON Schema of `check --json`. */
export function checkResultJsonSchema(): unknown {
  return z.toJSONSchema(CheckResultSchema, { io: 'output', unrepresentable: 'any' });
}
