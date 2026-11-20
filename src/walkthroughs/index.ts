import type { ConfigInput } from '../core';
import { oauthPkce } from './oauth-pkce';
import { reactRender } from './react-render';
import { spreadsheet } from './spreadsheet';
import { terraformApply } from './terraform-apply';

/** The demos bundled with the page. Each one is plain config. */
export const demos: ConfigInput = {
  walkthroughs: [oauthPkce, spreadsheet, reactRender, terraformApply],
};

export default demos;
