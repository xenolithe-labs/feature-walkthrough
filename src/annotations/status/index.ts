/**
 * status: one status per call, from a list the walkthrough defines.
 *
 * The plugin has no words of its own. The statuses, their labels and the
 * section title all come from the config.
 */
import { z } from 'zod';
import { IdSchema, type AnnotationPlugin, type Problem, own } from '../../core';

const StatusConfig = z.strictObject({
  /** Title of the card section. */
  title: z.string().min(1).default('Status'),
  statuses: z.record(
    IdSchema,
    z.strictObject({
      label: z.string().min(1),
      tone: z.enum(['neutral', 'info', 'good', 'warn', 'bad']).default('neutral'),
    }),
  ),
  /** When true, every call must have a status. */
  required: z.boolean().default(false),
});
type StatusConfig = z.infer<typeof StatusConfig>;

const StatusData = z.strictObject({
  status: IdSchema,
  note: z.string().optional(),
});
type StatusData = z.infer<typeof StatusData>;

export const statusAnnotation: AnnotationPlugin<StatusConfig, StatusData> = {
  id: 'status',
  schema: { config: StatusConfig, call: StatusData },
  chip: (data, config) => {
    const status = own(config.statuses, data.status);
    if (status === undefined) return undefined;
    return { label: status.label, tone: status.tone, ...(data.note ? { title: data.note } : {}) };
  },
  cardSections: (data, config) => {
    const label = own(config.statuses, data.status)?.label ?? data.status;
    return [
      {
        id: 'status',
        title: config.title,
        kind: 'text',
        text: data.note === undefined ? label : `${label}. ${data.note}`,
      },
    ];
  },
  lint: (walkthrough, config) => {
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        const data = call.annotations?.status as StatusData | undefined;
        const path = ['steps', s, 'calls', c];
        if (data === undefined) {
          if (config.required) {
            problems.push({
              severity: 'error',
              rule: 'status/missing',
              path,
              message: `call "${call.id}" has no status`,
            });
          }
          return;
        }
        if (typeof data.status === 'string' && own(config.statuses, data.status) === undefined) {
          problems.push({
            severity: 'error',
            rule: 'status/unknown',
            path: [...path, 'annotations', 'status', 'status'],
            message: `status "${data.status}" is not defined. Defined: ${Object.keys(config.statuses).join(', ')}`,
          });
        }
      });
    });
    return problems;
  },
};
