import type { ConfigInput, WalkthroughInput } from '../core';
import colours from './colours.generated.json' with { type: 'json' };
import { awsScpInheritance } from './aws-scp-inheritance';
import { awsVpcRequest } from './aws-vpc-request';
import { binarySearchDemos } from './algorithms/binary-search';
import { bfsDemo } from './algorithms/bfs';
import { editDistanceDemo } from './algorithms/edit-distance';
import { quicksortDemo } from './algorithms/quicksort';
import { consistentHashing } from './consistent-hashing';
import { bstInsertDemo } from './algorithms/bst-insert';
import { hashTableDemo } from './algorithms/hash-table';
import { reverseListDemo } from './algorithms/reverse-list';
import { eventbridgeRouting } from './eventbridge-routing';
import { gitCommit } from './git-commit';
import { kafkaBrokerFailure } from './kafka-broker-failure';
import { jweCompact } from './jwe-compact';
import { kafkaConsumerGroup } from './kafka-consumer-group';
import { oauthPkce } from './oauth-pkce';
import { reactRender } from './react-render';
import { retryBackoff } from './retry-backoff';
import { spreadsheet } from './spreadsheet';
import { tcpHandshake } from './tcp-handshake';
import { temporalHeartbeat } from './temporal-heartbeat';
import { terraformApply } from './terraform-apply';

/** The demos as written, before syntax colours are added. */
export const plainDemos: WalkthroughInput[] = [
  oauthPkce,
  retryBackoff,
  spreadsheet,
  reactRender,
  terraformApply,
  gitCommit,
  ...binarySearchDemos,
  quicksortDemo,
  bfsDemo,
  editDistanceDemo,
  reverseListDemo,
  bstInsertDemo,
  hashTableDemo,
  kafkaConsumerGroup,
  kafkaBrokerFailure,
  temporalHeartbeat,
  eventbridgeRouting,
  awsScpInheritance,
  tcpHandshake,
  jweCompact,
  consistentHashing,
  awsVpcRequest,
];

/** Where a source's colours are kept in colours.generated.json. */
export const colourKey = (walkthrough: string, pane: string, source: string) =>
  `${walkthrough}/${pane}/${source}`;

/**
 * The demos with the syntax colours that `pnpm colours` worked out for them. The viewer has no
 * highlighter, so the colours are generated ahead of time and bundled as data.
 */
function coloured(walkthrough: WalkthroughInput): WalkthroughInput {
  const stored = colours as Record<string, unknown>;
  return {
    ...walkthrough,
    layout: {
      ...walkthrough.layout,
      panes: walkthrough.layout.panes.map((pane) => {
        const content = pane.content as { sources?: { id: string }[] } | undefined;
        if (pane.panel !== 'code' || content?.sources === undefined) return pane;
        return {
          ...pane,
          content: {
            ...content,
            sources: content.sources.map((source) => {
              const key = colourKey(walkthrough.id, pane.id, source.id);
              const tokens = stored[key];
              const baseTokens = stored[`${key}#base`];
              return {
                ...source,
                ...(tokens === undefined ? {} : { tokens }),
                ...(baseTokens === undefined ? {} : { baseTokens }),
              };
            }),
          },
        };
      }),
    },
  };
}

/** The demos bundled with the page. Each one is plain config. */
export const demos: ConfigInput = { walkthroughs: plainDemos.map(coloured) };

export default demos;
