import type { ConfigInput } from '../core';
import { binarySearchDemos } from './algorithms/binary-search';
import { bfsDemo } from './algorithms/bfs';
import { editDistanceDemo } from './algorithms/edit-distance';
import { quicksortDemo } from './algorithms/quicksort';
import { gitCommit } from './git-commit';
import { kafkaConsumerGroup } from './kafka-consumer-group';
import { oauthPkce } from './oauth-pkce';
import { reactRender } from './react-render';
import { spreadsheet } from './spreadsheet';
import { terraformApply } from './terraform-apply';

/** The demos bundled with the page. Each one is plain config. */
export const demos: ConfigInput = {
  walkthroughs: [
    oauthPkce,
    spreadsheet,
    reactRender,
    terraformApply,
    gitCommit,
    ...binarySearchDemos,
    quicksortDemo,
    bfsDemo,
    editDistanceDemo,
    kafkaConsumerGroup,
  ],
};

export default demos;
