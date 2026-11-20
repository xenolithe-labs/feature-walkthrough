import { defineWalkthrough } from '../core';

/**
 * OAuth 2.0 authorization code flow with PKCE (RFC 6749, RFC 7636).
 * All hosts, ids and tokens are made-up example values.
 */
export const oauthPkce = defineWalkthrough({
  id: 'oauth-pkce',
  title: 'OAuth 2.0: authorization code with PKCE',
  lead: 'How an app gets an access token for a user without ever seeing the password, and how PKCE stops a stolen authorization code from being used.',
  tags: ['oauth', 'security'],

  lanes: [
    { id: 'browser', title: 'Browser (user)' },
    { id: 'app', title: 'App (client)' },
    { id: 'as', title: 'Authorization server' },
    { id: 'api', title: 'API (resource server)' },
  ],

  layout: {
    panes: [
      { id: 'exchange', panel: 'sequence', title: 'Exchange' },
      {
        id: 'artefacts',
        panel: 'graph',
        title: 'What exists now',
        content: {
          direction: 'DOWN',
          nodes: [
            { id: 'verifier', label: 'code_verifier', sub: 'secret, stays in the app' },
            { id: 'challenge', label: 'code_challenge', sub: 'hash of the verifier' },
            { id: 'state', label: 'state', sub: 'ties the reply to this browser' },
            { id: 'authreq', label: 'authorization request', sub: 'travels through the browser' },
            { id: 'pending', label: 'pending authorization', sub: 'kept by the server' },
            { id: 'consent', label: 'user consent', sub: 'sign-in and approval' },
            { id: 'code', label: 'authorization code', sub: 'short-lived, single use' },
            { id: 'access', label: 'access token', sub: 'sent to the API' },
            { id: 'refresh', label: 'refresh token', sub: 'kept by the app' },
          ],
          edges: [
            { id: 'derives', from: 'verifier', to: 'challenge', label: 'SHA-256' },
            { id: 'sends-challenge', from: 'challenge', to: 'authreq', label: 'sent in' },
            { id: 'sends-state', from: 'state', to: 'authreq', label: 'sent in' },
            { id: 'records', from: 'authreq', to: 'pending', label: 'recorded as' },
            { id: 'approves', from: 'consent', to: 'pending', label: 'approves' },
            { id: 'issues', from: 'pending', to: 'code', label: 'issues' },
            { id: 'to-access', from: 'code', to: 'access', label: 'exchanged for' },
            { id: 'to-refresh', from: 'code', to: 'refresh', label: 'exchanged for' },
          ],
        },
      },
    ],
  },

  annotations: {
    status: {
      title: 'Requirement',
      statuses: {
        required: { label: 'Required', tone: 'warn' },
        recommended: { label: 'Recommended', tone: 'info' },
        optional: { label: 'Optional', tone: 'neutral' },
      },
    },
  },

  steps: [
    {
      id: 'prepare',
      title: 'Prepare',
      text: 'Before it sends the user anywhere, the app creates the values it will later use to prove that it started this request.',
      calls: [
        {
          id: 'make-verifier',
          label: 'Create code_verifier',
          from: 'app',
          to: 'app',
          text: 'The app creates a high-entropy random string, 43 to 128 characters long. It never leaves the app until the token request.',
          where: 'RFC 7636 §4.1',
          blocks: [
            {
              title: 'code_verifier',
              text: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
            },
          ],
          effects: { artefacts: [{ add: 'verifier' }] },
          annotations: {
            status: {
              status: 'required',
              note: 'Public clients must use PKCE (RFC 9700 §2.1.1).',
            },
          },
        },
        {
          id: 'make-challenge',
          label: 'Derive code_challenge',
          from: 'app',
          to: 'app',
          text: 'The challenge is the SHA-256 hash of the verifier, base64url-encoded. The hash can be shown to anyone: it cannot be turned back into the verifier.',
          where: 'RFC 7636 §4.2',
          blocks: [
            {
              title: 'code_challenge',
              text: 'BASE64URL(SHA256(code_verifier))\n= E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
            },
          ],
          effects: {
            artefacts: [{ read: 'verifier' }, { add: 'challenge' }, { add: 'derives' }],
          },
        },
        {
          id: 'make-state',
          label: 'Create state',
          from: 'app',
          to: 'app',
          text: 'A second random value, stored in the user’s session. When the reply comes back, the app checks that it carries the same value, so that a reply forged by another site is rejected.',
          where: 'RFC 6749 §10.12',
          effects: { artefacts: [{ add: 'state' }] },
          annotations: {
            status: {
              status: 'recommended',
              note: 'RFC 6749 §4.1.1 marks the state parameter as RECOMMENDED.',
            },
          },
        },
      ],
    },
    {
      id: 'authorize',
      title: 'Ask the user',
      text: 'The app sends the user to the authorization server. Only the server sees the user’s credentials.',
      calls: [
        {
          id: 'redirect-out',
          label: 'Redirect to /authorize',
          from: 'app',
          to: 'browser',
          text: 'The app answers with a redirect. The URL carries the challenge and the state, but not the verifier.',
          where: 'RFC 6749 §4.1.1, RFC 7636 §4.3',
          response: {
            lang: 'http',
            text: 'HTTP/1.1 302 Found\nLocation: https://auth.example/authorize\n  ?response_type=code\n  &client_id=s6BhdRkqt3\n  &redirect_uri=https%3A%2F%2Fapp.example%2Fcallback\n  &scope=photos.read\n  &state=xyzABC123\n  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM\n  &code_challenge_method=S256',
          },
          effects: {
            artefacts: [
              { read: 'challenge' },
              { read: 'state' },
              { add: 'authreq' },
              { add: 'sends-challenge' },
              { add: 'sends-state' },
            ],
          },
        },
        {
          id: 'authorize-request',
          label: 'GET /authorize',
          from: 'browser',
          to: 'as',
          text: 'The browser follows the redirect. The server checks the client id and the redirect URI against what the app registered, then remembers the challenge for later.',
          where: 'RFC 7636 §4.4',
          effects: {
            artefacts: [{ read: 'authreq' }, { add: 'pending' }, { add: 'records' }],
          },
        },
        {
          id: 'login-page',
          label: 'Sign-in and consent page',
          from: 'as',
          to: 'browser',
          text: 'The server shows its own page. It names the app and lists what the app is asking for.',
          effects: { artefacts: [{ read: 'pending' }] },
        },
        {
          id: 'approve',
          label: 'Sign in and approve',
          from: 'browser',
          to: 'as',
          text: 'The user proves who they are to the server and approves the request. The app takes no part in this.',
          effects: {
            artefacts: [{ add: 'consent' }, { add: 'approves' }, { update: 'pending' }],
          },
        },
      ],
    },
    {
      id: 'code',
      title: 'Return a code',
      text: 'The server sends the browser back to the app with a one-time code.',
      calls: [
        {
          id: 'redirect-back',
          label: 'Redirect back with code',
          from: 'as',
          to: 'browser',
          text: 'The server creates an authorization code, binds it to the stored challenge, and redirects to the registered URI with the code and the unchanged state.',
          where: 'RFC 6749 §4.1.2',
          response: {
            lang: 'http',
            text: 'HTTP/1.1 302 Found\nLocation: https://app.example/callback\n  ?code=SplxlOBeZQQYbYS6WxSbIA\n  &state=xyzABC123',
          },
          effects: {
            artefacts: [{ read: 'pending' }, { add: 'code' }, { add: 'issues' }],
          },
        },
        {
          id: 'callback',
          label: 'GET /callback?code&state',
          from: 'browser',
          to: 'app',
          text: 'The browser delivers the code. Anything that can see this URL can see the code, which is why the code alone must not be enough.',
          effects: { artefacts: [{ read: 'code' }] },
        },
        {
          id: 'check-state',
          label: 'Check state',
          from: 'app',
          to: 'app',
          text: 'The app compares the returned state with the one in the session. If they differ it stops here. The state has done its job and is discarded.',
          where: 'RFC 6749 §10.12',
          effects: { artefacts: [{ remove: 'state' }] },
        },
      ],
    },
    {
      id: 'token',
      title: 'Exchange the code',
      text: 'The app trades the code for tokens over a direct connection, and proves it is the one that started the flow.',
      calls: [
        {
          id: 'token-request',
          label: 'POST /token',
          from: 'app',
          to: 'as',
          text: 'The app sends the code together with the verifier. This is the first time the verifier leaves the app.',
          where: 'RFC 6749 §4.1.3, RFC 7636 §4.5',
          request: {
            lang: 'http',
            text: 'POST /token HTTP/1.1\nHost: auth.example\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code\n&code=SplxlOBeZQQYbYS6WxSbIA\n&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback\n&client_id=s6BhdRkqt3\n&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
          },
          effects: { artefacts: [{ read: 'code' }, { read: 'verifier' }] },
        },
        {
          id: 'verify',
          label: 'Verify the code_verifier',
          from: 'as',
          to: 'as',
          text: 'The server hashes the verifier it received and compares the result with the challenge it stored. Someone who only stole the code cannot pass this check.',
          where: 'RFC 7636 §4.6',
          effects: { artefacts: [{ read: 'pending' }, { read: 'code' }] },
        },
        {
          id: 'consume',
          label: 'Use up the code',
          from: 'as',
          to: 'as',
          text: 'A code works once. The server marks it as used; a second request with the same code is refused and should revoke the tokens issued from it.',
          where: 'RFC 6749 §4.1.2',
          effects: {
            artefacts: [
              {
                update: 'code',
                fields: { sub: 'used, cannot be reused', tone: 'muted' },
              },
              { remove: 'pending' },
            ],
          },
        },
        {
          id: 'token-response',
          label: 'Token response',
          from: 'as',
          to: 'app',
          text: 'The server answers with an access token and, here, a refresh token.',
          where: 'RFC 6749 §5.1',
          response: {
            lang: 'json',
            text: '{\n  "access_token": "2YotnFZFEjr1zCsicMWpAA",\n  "token_type": "Bearer",\n  "expires_in": 3600,\n  "refresh_token": "tGzv3JOkF0XG5Qx2TlKWIA",\n  "scope": "photos.read"\n}',
          },
          effects: {
            artefacts: [
              { add: 'access' },
              { add: 'refresh' },
              { add: 'to-access' },
              { add: 'to-refresh' },
            ],
          },
        },
        {
          id: 'discard',
          label: 'Discard verifier and challenge',
          from: 'app',
          to: 'app',
          text: 'The PKCE values were for this one exchange. The app throws them away.',
          effects: { artefacts: [{ remove: 'verifier' }, { remove: 'challenge' }] },
        },
      ],
    },
    {
      id: 'use',
      title: 'Use and refresh',
      text: 'The app calls the API with the access token, and gets a new one when it expires.',
      calls: [
        {
          id: 'api-request',
          label: 'GET /photos',
          from: 'app',
          to: 'api',
          text: 'The app presents the access token as a bearer token.',
          where: 'RFC 6750 §2.1',
          request: {
            lang: 'http',
            text: 'GET /photos HTTP/1.1\nHost: api.example\nAuthorization: Bearer 2YotnFZFEjr1zCsicMWpAA',
          },
          effects: { artefacts: [{ read: 'access' }] },
        },
        {
          id: 'api-response',
          label: '200 OK',
          from: 'api',
          to: 'app',
          text: 'The API checks that the token is valid and covers this request, then answers.',
        },
        {
          id: 'refresh-request',
          label: 'POST /token (refresh)',
          from: 'app',
          to: 'as',
          text: 'When the access token expires, the app asks for a new one with the refresh token. The user is not involved.',
          where: 'RFC 6749 §6',
          request: {
            lang: 'http',
            text: 'POST /token HTTP/1.1\nHost: auth.example\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=refresh_token\n&refresh_token=tGzv3JOkF0XG5Qx2TlKWIA\n&client_id=s6BhdRkqt3',
          },
          effects: { artefacts: [{ read: 'refresh' }] },
          annotations: {
            status: {
              status: 'optional',
              note: 'A server may choose not to issue refresh tokens (RFC 6749 §5.1).',
            },
          },
        },
        {
          id: 'refresh-response',
          label: 'New tokens',
          from: 'as',
          to: 'app',
          text: 'The server issues a fresh access token and replaces the refresh token, so that a stolen refresh token stops working once the real app has used it.',
          where: 'RFC 9700 §2.2.2',
          effects: {
            artefacts: [
              { update: 'access', fields: { sub: 'new token' } },
              { update: 'refresh', fields: { sub: 'rotated' } },
            ],
          },
        },
      ],
    },
  ],
});
