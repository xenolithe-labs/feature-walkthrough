import { own } from './effects';
import type { PaneViews } from './fold';
import type { Lane } from './schema';
import type { CardSection, Chip, ResolvedWalkthrough } from './types';

/** Everything the details card shows for one call. All words come from the config. */
export interface CardModel {
  position: { step: number; steps: number; call: number; calls: number };
  stepTitle: string;
  stepText: string | undefined;
  title: string;
  from: Lane | undefined;
  to: Lane | undefined;
  text: string | undefined;
  where: string | undefined;
  chips: Chip[];
  /** In order: the call's own blocks, then panel sections, then annotation sections. */
  sections: CardSection[];
}

function inlineBlock(
  id: string,
  title: string,
  block: string | { lang?: string | undefined; text: string } | undefined,
): CardSection[] {
  if (block === undefined) return [];
  if (typeof block === 'string') return [{ id, title, kind: 'code', text: block }];
  return [
    { id, title, kind: 'code', text: block.text, ...(block.lang ? { lang: block.lang } : {}) },
  ];
}

/** Text for the fixed labels on the card. A walkthrough may override them later. */
export const CARD_LABELS = { request: 'Request', response: 'Response' } as const;

export function buildCard(
  walkthrough: ResolvedWalkthrough,
  s: number,
  c: number,
  paneViews: PaneViews,
): CardModel {
  const step = walkthrough.steps[s];
  const call = step?.calls[c];
  if (step === undefined || call === undefined) {
    throw new RangeError(`no call at step ${s}, call ${c} in "${walkthrough.id}"`);
  }
  const lane = (id: string | undefined) => walkthrough.lanes.find((item) => item.id === id);

  const sections: CardSection[] = [
    ...inlineBlock('request', CARD_LABELS.request, call.request),
    ...inlineBlock('response', CARD_LABELS.response, call.response),
    ...(call.blocks ?? []).map((block, index): CardSection => ({
      id: `block-${index}`,
      title: block.title,
      kind: 'code',
      text: block.text,
      ...(block.lang ? { lang: block.lang } : {}),
    })),
  ];

  for (const pane of walkthrough.panes) {
    const view = paneViews[pane.id];
    if (view === undefined || pane.panel.cardSections === undefined) continue;
    const fromPanel = pane.panel.cardSections({
      state: view.state,
      content: pane.content,
      current: view.current,
      call,
      pane,
    });
    for (const section of fromPanel) sections.push({ ...section, id: `${pane.id}:${section.id}` });
  }

  const chips: Chip[] = [];
  for (const { plugin, config } of walkthrough.annotations) {
    const data: unknown = own(call.annotations, plugin.id);
    if (data === undefined) continue;
    const chip = plugin.chip?.(data, config);
    if (chip !== undefined) chips.push(chip);
    for (const section of plugin.cardSections?.(data, config) ?? []) {
      sections.push({ ...section, id: `${plugin.id}:${section.id}` });
    }
  }

  return {
    position: {
      step: s + 1,
      steps: walkthrough.steps.length,
      call: c + 1,
      calls: step.calls.length,
    },
    stepTitle: step.title,
    stepText: step.text,
    title: call.label,
    from: lane(call.from),
    to: lane(call.to),
    text: call.text,
    where: call.where,
    chips,
    sections,
  };
}

/** The chips of every call in a step, for the step strip. */
export function stepChips(walkthrough: ResolvedWalkthrough, s: number): Chip[] {
  const step = walkthrough.steps[s];
  if (step === undefined) return [];
  const chips: Chip[] = [];
  const seen = new Set<string>();
  for (const call of step.calls) {
    for (const { plugin, config } of walkthrough.annotations) {
      const data: unknown = own(call.annotations, plugin.id);
      if (data === undefined) continue;
      const chip = plugin.chip?.(data, config);
      if (chip === undefined) continue;
      const key = `${chip.tone ?? ''}|${chip.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push(chip);
    }
  }
  return chips;
}
