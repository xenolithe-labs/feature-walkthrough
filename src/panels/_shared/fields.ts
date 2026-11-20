import {
  effectTarget,
  writtenEffects,
  type Problem,
  type ResolvedPane,
  type Walkthrough,
} from '../../core';
import { TONES } from './changes';

/**
 * Problems with the `fields` of updates in one pane: a field the element does not have (a
 * misspelling would otherwise change nothing, silently), a tone that is not a tone, and a value
 * that is not text where text is shown.
 *
 * `allowed` gives the field names an element takes, or undefined for an element this check
 * should leave alone.
 */
export function fieldProblems(
  pane: ResolvedPane,
  walkthrough: Walkthrough,
  allowed: (id: string) => readonly string[] | undefined,
): Problem[] {
  const problems: Problem[] = [];
  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      writtenEffects(call, pane.id).forEach((effect, e) => {
        if (effect.fields === undefined) return;
        const { id } = effectTarget(effect);
        const names = allowed(id);
        if (names === undefined) return;
        for (const [field, value] of Object.entries(effect.fields)) {
          const path = ['steps', s, 'calls', c, 'effects', pane.id, e, 'fields', field];
          if (!names.includes(field)) {
            problems.push({
              severity: 'error',
              rule: `${pane.panel.id}/unknown-field`,
              path,
              message:
                names.length === 0
                  ? `"${id}" takes no fields`
                  : `"${id}" has no field "${field}". It takes: ${names.join(', ')}`,
            });
          } else if (field === 'tone' && !(TONES as readonly unknown[]).includes(value)) {
            problems.push({
              severity: 'error',
              rule: `${pane.panel.id}/bad-tone`,
              path,
              message: `a tone is one of: ${TONES.join(', ')}`,
            });
          } else if (field !== 'tone' && typeof value !== 'string') {
            problems.push({
              severity: 'error',
              rule: `${pane.panel.id}/bad-field`,
              path,
              message: `the field "${field}" takes text`,
            });
          }
        }
      });
    });
  });
  return problems;
}
