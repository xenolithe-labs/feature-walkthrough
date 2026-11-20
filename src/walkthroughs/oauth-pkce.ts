import { defineWalkthrough } from '../core';

/**
 * OAuth 2.0 authorization code flow with PKCE (RFC 6749, RFC 7636), as one run in which a
 * malicious app reads both URLs that pass through the browser and still gets no token.
 *
 * The values are the RFCs' own examples, so a reader can check them against the text:
 * the verifier and challenge are RFC 7636 Appendix B, the code and the access token are the
 * examples of RFC 6749 sections 4.1.2 and 5.1. `tests/unit/oauth-pkce.test.ts` recomputes the two
 * hashes with SHA-256 and checks that every card and cell shows them. Hosts and the client id
 * are made up.
 */
export const pkce = {
  verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  /** BASE64URL(SHA-256(verifier)): what the app sends and the server stores. */
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  /** BASE64URL(SHA-256(challenge)): what the server computes when the challenge is sent as the verifier. */
  hashOfChallenge: 'DSmbHrVIcI0EU05-BQxCe1bt-hXRNjejSEvdYbq_g4Q',
  code: 'SplxlOBeZQQYbYS6WxSbIA',
  accessToken: '2YotnFZFEjr1zCsicMWpAA',
  clientId: 'notes-app',
  redirectUri: 'com.example.notes:/callback',
} as const;

/** How a long value is written in card text and in the table: its first six characters. */
export const short = (value: string) => `${value.slice(0, 6)}…`;

const verifier = short(pkce.verifier);
const challenge = short(pkce.challenge);
const wrongHash = short(pkce.hashOfChallenge);
const code = short(pkce.code);
const token = short(pkce.accessToken);

const HELD = 'has it';
const NOT_HELD = '—';

const tokenRequest = (codeVerifier: string) =>
  [
    'POST /token HTTP/1.1',
    'Host: auth.example',
    'Content-Type: application/x-www-form-urlencoded',
    '',
    'grant_type=authorization_code',
    `&code=${pkce.code}`,
    `&redirect_uri=${encodeURIComponent(pkce.redirectUri)}`,
    `&client_id=${pkce.clientId}`,
    `&code_verifier=${codeVerifier}`,
  ].join('\n');

export const oauthPkce = defineWalkthrough({
  id: 'oauth-pkce',
  title: 'OAuth 2.0: authorization code with PKCE',
  lead: 'A notes app signs a user in through the browser, and a malicious app on the same phone reads every URL the browser handles. Follow four values and see why the code it steals is useless. PKCE: proof key for code exchange.',
  tags: ['oauth', 'security'],

  lanes: [
    { id: 'app', title: 'App (client)' },
    { id: 'browser', title: 'Browser (user)' },
    { id: 'as', title: 'Authorization server' },
    { id: 'mal', title: 'Malicious app' },
  ],

  layout: {
    panes: [
      {
        id: 'exchange',
        panel: 'sequence',
        title: 'Messages',
        content: {
          // Requests are calls, answers are replies (dashed).
          styles: {
            'redirect-back': 'reply',
            'token-error': 'reply',
            'token-response': 'reply',
          },
          fragments: [
            {
              id: 'race',
              kind: 'alt',
              label: 'the malicious app posts first',
              from: 'stolen-request',
              to: 'token-response',
              branches: [{ at: 'token-request', label: 'the app posts first' }],
            },
          ],
          notes: [
            {
              id: 'verifier-note',
              at: 'make-verifier',
              over: 'app',
              text: 'stays in the app until POST /token',
            },
            { id: 'leak-challenge', at: 'open-browser', over: 'mal', text: 'reads this URL' },
            { id: 'leak-code', at: 'callback', over: 'mal', text: 'reads this URL' },
            {
              id: 'used-note',
              at: 'token-response',
              over: 'mal',
              text: 'a later POST with this code is refused: a code works once',
            },
          ],
        },
      },
      {
        id: 'holders',
        panel: 'table',
        title: 'Who holds what',
        content: {
          columns: [
            { id: 'value', label: 'Value', mono: true },
            { id: 'app', label: 'App' },
            { id: 'browser', label: 'Browser' },
            { id: 'as', label: 'Server' },
            { id: 'mal', label: 'Malicious app' },
          ],
          rows: [
            {
              id: 'verifier',
              initial: false,
              cells: {
                value: 'code_verifier',
                app: HELD,
                browser: NOT_HELD,
                as: NOT_HELD,
                mal: NOT_HELD,
              },
            },
            {
              id: 'challenge',
              initial: false,
              cells: {
                value: 'code_challenge',
                app: HELD,
                browser: NOT_HELD,
                as: NOT_HELD,
                mal: NOT_HELD,
              },
            },
            {
              id: 'code',
              initial: false,
              cells: {
                value: 'code',
                app: NOT_HELD,
                browser: NOT_HELD,
                as: HELD,
                mal: NOT_HELD,
              },
            },
            {
              id: 'access',
              initial: false,
              cells: {
                value: 'access_token',
                app: HELD,
                browser: NOT_HELD,
                as: HELD,
                mal: NOT_HELD,
              },
            },
          ],
          legend: {
            [HELD]: { tone: 'good', label: 'has seen the value' },
            [NOT_HELD]: { tone: 'muted', label: 'has never seen it' },
          },
        },
      },
    ],
  },

  annotations: {
    status: {
      title: 'Requirement',
      statuses: {
        required: { label: 'Required', tone: 'warn' },
      },
    },
  },

  steps: [
    {
      id: 'prepare',
      title: 'Make a one-time secret',
      text: 'The app prepares two values before it opens the browser.',
      calls: [
        {
          id: 'make-verifier',
          label: 'Make code_verifier',
          from: 'app',
          to: 'app',
          text: `The app makes a random 43-character secret, the code verifier \`${verifier}\`, new for every sign-in. It shows it to no one yet.`,
          where: 'RFC 7636 §4.1',
          blocks: [
            { title: 'code_verifier', text: pkce.verifier },
            {
              title: 'Left out',
              text: 'Sign-in and consent screens, state, scopes, refresh tokens, using the token, and whether a code still works after a refused attempt (the RFCs do not say). Described: RFC 6749 with RFC 7636, checked November 2026.',
            },
          ],
          effects: { holders: [{ add: 'verifier' }] },
          annotations: {
            status: {
              status: 'required',
              note: 'Public clients must use PKCE (RFC 9700 §2.1.1).',
            },
          },
        },
        {
          id: 'make-challenge',
          label: 'Hash it into code_challenge',
          from: 'app',
          to: 'app',
          text: `The code challenge is the SHA-256 hash of the verifier, written as URL-safe text: \`${challenge}\`. A hash cannot be run backwards to recover the verifier.`,
          where: 'RFC 7636 §4.2, Appendix B',
          blocks: [
            {
              title: 'code_challenge',
              text: `BASE64URL(SHA256(code_verifier))\n= ${pkce.challenge}`,
            },
          ],
          effects: {
            holders: [{ read: 'verifier', cells: ['app'] }, { add: 'challenge' }],
          },
        },
      ],
    },
    {
      id: 'authorize',
      title: 'Ask for an authorization code',
      text: 'Everything in this step travels in URLs through the browser.',
      calls: [
        {
          id: 'open-browser',
          label: 'Open the browser at /authorize',
          from: 'app',
          to: 'browser',
          text: `The URL carries \`code_challenge=${challenge}\` and \`code_challenge_method=S256\` (SHA-256), not the verifier. The malicious app reads the URL.`,
          where: 'RFC 6749 §4.1.1, RFC 7636 §4.3; the leak: RFC 7636 §1 (4b)',
          blocks: [
            {
              title: 'URL',
              text: [
                'https://auth.example/authorize',
                '  ?response_type=code',
                `  &client_id=${pkce.clientId}`,
                `  &redirect_uri=${encodeURIComponent(pkce.redirectUri)}`,
                `  &code_challenge=${pkce.challenge}`,
                '  &code_challenge_method=S256',
              ].join('\n'),
            },
          ],
          effects: {
            holders: [{ update: 'challenge', fields: { browser: HELD, mal: HELD } }],
          },
        },
        {
          id: 'authorize-request',
          label: 'GET /authorize',
          from: 'browser',
          to: 'as',
          text: 'The browser sends the same URL to the authorization server.',
          where: 'RFC 6749 §4.1.1',
          effects: { holders: [{ update: 'challenge', fields: { as: HELD } }] },
        },
        {
          id: 'issue-code',
          label: 'Issue a code, keep the challenge',
          from: 'as',
          to: 'as',
          text: `After the user approves, the server makes authorization code \`${code}\` and stores challenge \`${challenge}\` with it, to test whoever redeems the code.`,
          where: 'RFC 6749 §4.1.2, RFC 7636 §4.4',
          effects: {
            holders: [{ add: 'code' }, { read: 'challenge', cells: ['as'] }],
          },
        },
        {
          id: 'redirect-back',
          label: '302 to com.example.notes:/callback',
          from: 'as',
          to: 'browser',
          text: `The server redirects the browser to the app’s redirect URI, a \`com.example.notes:\` URL that the phone hands to the app, with \`code=${code}\`.`,
          where: 'RFC 6749 §4.1.2, RFC 8252 §7.1',
          response: {
            lang: 'http',
            text: `HTTP/1.1 302 Found\nLocation: ${pkce.redirectUri}\n  ?code=${pkce.code}`,
          },
          effects: { holders: [{ update: 'code', fields: { browser: HELD } }] },
        },
        {
          id: 'callback',
          label: 'Redirect opens the app',
          from: 'browser',
          to: 'app',
          text: `The phone opens the app, which receives code \`${code}\`. The malicious app reads this URL too. What can the malicious app send the server to get a token?`,
          where: 'RFC 6749 §10.5, RFC 8252 §8.1, RFC 9700 §3 (A3)',
          effects: {
            holders: [
              { update: 'code', fields: { app: HELD, mal: HELD } },
              { read: 'challenge', cells: ['mal'] },
            ],
          },
        },
      ],
    },
    {
      id: 'stolen',
      title: 'A stolen code',
      text: 'First possibility: the malicious app posts to /token before the app does.',
      calls: [
        {
          id: 'stolen-request',
          label: 'POST /token, challenge as verifier',
          from: 'mal',
          to: 'as',
          text: `The malicious app has no verifier, so with \`code=${code}\` it sends the challenge in the verifier’s place: \`code_verifier=${challenge}\`.`,
          where: 'RFC 7636 §4.5',
          request: { lang: 'http', text: tokenRequest(pkce.challenge) },
          effects: {
            holders: [
              { read: 'code', cells: ['mal'] },
              { read: 'challenge', cells: ['mal'] },
            ],
          },
        },
        {
          id: 'stolen-verify',
          label: 'Hash and compare: no match',
          from: 'as',
          to: 'as',
          text: `The server hashes the received \`code_verifier\` and gets \`${wrongHash}\`. The challenge stored with code \`${code}\` is \`${challenge}\`. They differ.`,
          where: 'RFC 7636 §4.6',
          blocks: [
            {
              title: 'Check',
              text: `BASE64URL(SHA256("${pkce.challenge}"))\n= ${pkce.hashOfChallenge}\n≠ ${pkce.challenge}`,
            },
          ],
          effects: {
            holders: [
              { read: 'code', cells: ['as'] },
              { read: 'challenge', cells: ['as'] },
            ],
          },
        },
        {
          id: 'token-error',
          label: '400 invalid_grant',
          from: 'as',
          to: 'mal',
          text: `No token is issued. Only the verifier hashes to \`${challenge}\`, and the malicious app never saw it.`,
          where: 'RFC 7636 §4.6, RFC 6749 §5.2',
          response: {
            lang: 'http',
            text: 'HTTP/1.1 400 Bad Request\nContent-Type: application/json;charset=UTF-8\nCache-Control: no-store\nPragma: no-cache\n\n{\n  "error": "invalid_grant"\n}',
          },
          effects: { holders: [{ read: 'verifier', cells: ['mal'] }] },
        },
      ],
    },
    {
      id: 'token',
      title: 'The app’s own request',
      text: 'Second possibility, instead of the first: the app posts to /token first.',
      calls: [
        {
          id: 'token-request',
          label: 'POST /token with code and verifier',
          from: 'app',
          to: 'as',
          text: `The verifier \`${verifier}\` leaves the app for the first time: straight to the server over TLS, not in a URL through the browser.`,
          where: 'RFC 7636 §4.5, RFC 6749 §4.1.3, §3.2',
          request: { lang: 'http', text: tokenRequest(pkce.verifier) },
          effects: {
            holders: [
              { update: 'verifier', fields: { as: HELD } },
              { read: 'code', cells: ['app'] },
            ],
          },
        },
        {
          id: 'verify',
          label: 'Hash and compare: match',
          from: 'as',
          to: 'as',
          text: `The server hashes \`${verifier}\` and gets \`${challenge}\`, the stored challenge.`,
          where: 'RFC 7636 §4.6, Appendix B',
          effects: {
            holders: [
              { read: 'verifier', cells: ['as'] },
              { read: 'challenge', cells: ['as'] },
              { read: 'code', cells: ['as'] },
            ],
          },
        },
        {
          id: 'token-response',
          label: '200 with access token',
          from: 'as',
          to: 'app',
          text: `The server returns access token \`${token}\`. The malicious app held the same code and challenge, but the verifier was never in a URL the malicious app could read: the stolen code is useless.`,
          where: 'RFC 6749 §5.1, §4.1.2 (a code works once), RFC 9700 §4.5.3.1',
          response: {
            lang: 'json',
            text: `{\n  "access_token": "${pkce.accessToken}",\n  "token_type": "Bearer",\n  "expires_in": 3600\n}`,
          },
          effects: {
            holders: [{ add: 'access' }, { read: 'verifier', cells: ['mal'] }],
          },
        },
      ],
    },
  ],
});

export default oauthPkce;
