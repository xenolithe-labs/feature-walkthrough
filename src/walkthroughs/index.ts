import type { ConfigInput } from '../core';
import { oauthPkce } from './oauth-pkce';

/** The demos bundled with the page. Each one is plain config. */
export const demos: ConfigInput = { walkthroughs: [oauthPkce] };

export default demos;
