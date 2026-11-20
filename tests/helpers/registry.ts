import { z } from 'zod';
import {
  IdSchema,
  Registry,
  initElements,
  reduceElements,
  type AnnotationPlugin,
  type ElementsState,
  type PanelType,
  type Problem,
  type WalkthroughInput,
} from '../../src/core';

const ItemsContent = z.strictObject({
  items: z.array(z.strictObject({ id: IdSchema, initial: z.boolean().optional() })),
});
type ItemsContent = z.infer<typeof ItemsContent>;

/** The smallest useful panel: a list of items that are present or not. */
export const itemsPanel: PanelType<ItemsContent, ElementsState> = {
  id: 'items',
  schema: { content: ItemsContent },
  entities: (content) =>
    content.items.map((item) => ({ id: item.id, ...(item.initial ? { initial: true } : {}) })),
  init: (content) =>
    initElements(
      content.items.map((item) => ({ id: item.id, ...(item.initial ? { initial: true } : {}) })),
    ),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: () => null,
  cardSections: ({ state }) => [
    {
      id: 'present',
      title: 'Present',
      kind: 'list',
      items: state.present.map((id) => ({ label: id, entity: id })),
    },
  ],
  lint: (pane) => {
    const content = pane.content as ItemsContent;
    const problems: Problem[] = [];
    content.items.forEach((item, index) => {
      if (item.id.startsWith('bad')) {
        problems.push({
          severity: 'error',
          rule: 'items/bad-name',
          path: ['layout', 'panes', 0, 'content', 'items', index, 'id'],
          message: `item "${item.id}" has a bad name`,
        });
      }
    });
    return problems;
  },
};

/** A panel in which every lane-to-lane call shows up on its own. */
export const messagesPanel: PanelType<undefined, ElementsState> = {
  id: 'messages',
  schema: { content: z.undefined() },
  entities: (_content, walkthrough) =>
    walkthrough.steps.flatMap((step) => step.calls.map((call) => ({ id: call.id }))),
  implicit: (call) => [{ add: call.id }],
  init: () => initElements([]),
  reduce: (state, effect) => reduceElements(state, effect),
  Component: () => null,
};

const MarkConfig = z
  .strictObject({ required: z.boolean().default(false) })
  .default({ required: false });
const MarkData = z.strictObject({ level: z.enum(['must', 'should', 'may']) });

/** A tiny annotation: a level per call, optionally required on every call. */
export const markAnnotation: AnnotationPlugin<
  z.infer<typeof MarkConfig>,
  z.infer<typeof MarkData>
> = {
  id: 'mark',
  schema: { config: MarkConfig, call: MarkData },
  chip: (data) => ({ label: data.level, tone: data.level === 'must' ? 'warn' : 'neutral' }),
  cardSections: (data) => [{ id: 'level', title: 'Level', kind: 'text', text: data.level }],
  lint: (walkthrough, config) => {
    if (!config.required) return [];
    const problems: Problem[] = [];
    walkthrough.steps.forEach((step, s) => {
      step.calls.forEach((call, c) => {
        if (call.annotations?.mark === undefined) {
          problems.push({
            severity: 'error',
            rule: 'mark/missing',
            path: ['steps', s, 'calls', c],
            message: `call "${call.id}" has no mark`,
          });
        }
      });
    });
    return problems;
  },
};

export function testRegistry(): Registry {
  return new Registry()
    .registerPanel(itemsPanel)
    .registerPanel(messagesPanel)
    .registerAnnotation(markAnnotation);
}

/** A valid walkthrough that the tests bend into invalid ones. */
export function baseConfig(): WalkthroughInput {
  return {
    id: 'demo',
    title: 'Demo',
    lead: 'A small flow.',
    lanes: [
      { id: 'client', title: 'Client' },
      { id: 'server', title: 'Server' },
    ],
    layout: {
      panes: [
        {
          id: 'things',
          panel: 'items',
          title: 'Things',
          content: {
            items: [{ id: 'seed', initial: true }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
          },
        },
        { id: 'log', panel: 'messages', role: 'focus' },
        { id: 'other', panel: 'items', role: 'focus', content: { items: [{ id: 'x' }] } },
      ],
    },
    steps: [
      {
        id: 'one',
        title: 'Step one',
        summary: { things: { add: ['a', 'b'], read: ['seed'] }, log: { add: ['ask', 'answer'] } },
        calls: [
          {
            id: 'ask',
            label: 'Ask',
            from: 'client',
            to: 'server',
            text: 'The client asks.',
            request: 'GET /thing',
            effects: { things: [{ read: 'seed' }, { add: 'a' }] },
          },
          {
            id: 'answer',
            label: 'Answer',
            from: 'server',
            to: 'client',
            response: { lang: 'json', text: '{"ok":true}' },
            effects: { things: [{ add: 'b' }] },
          },
        ],
      },
      {
        id: 'two',
        title: 'Step two',
        calls: [
          {
            id: 'change',
            label: 'Change',
            show: 'other',
            effects: {
              things: [{ update: 'a', fields: { state: 'used' } }, { focus: 'a' }],
              other: [{ add: 'x' }],
            },
          },
          { id: 'drop', label: 'Drop', effects: { things: [{ remove: 'b' }, { add: 'c' }] } },
          { id: 'rest', label: 'Rest' },
        ],
      },
    ],
  };
}

export type BaseConfig = WalkthroughInput;
