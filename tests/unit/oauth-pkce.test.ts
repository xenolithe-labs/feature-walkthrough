import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFolder, formatProblem, loadConfig, type ElementsState } from '../../src/core';
import { createRegistry } from '../../src/registry';
import { oauthPkce, pkce, short } from '../../src/walkthroughs/oauth-pkce';

/** RFC 7636 section 4.2: code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier))). */
const s256 = (text: string) => createHash('sha256').update(text, 'ascii').digest('base64url');

const loaded = loadConfig(oauthPkce, createRegistry());
const calls = oauthPkce.steps.flatMap((step) => step.calls);
const call = (id: string) => calls.find((item) => item.id === id)!;
const body = (id: string, part: 'request' | 'response') => {
  const value = call(id)[part];
  return typeof value === 'string' ? value : (value?.text ?? '');
};
const blocks = (id: string) =>
  (call(id).blocks ?? []).map((block) => `${block.title}\n${block.text}`).join('\n');

describe('oauth-pkce demo', () => {
  it('lints clean', () => {
    expect(loaded.problems.map(formatProblem)).toEqual([]);
  });

  it('shows the challenge that SHA-256 and base64url give for the verifier', () => {
    // RFC 7636 Appendix B: the 32 octets, the verifier they encode to, and its challenge.
    const octets = [
      116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
      105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
    ];
    expect(Buffer.from(octets).toString('base64url')).toBe(pkce.verifier);
    expect(s256(pkce.verifier)).toBe(pkce.challenge);
    // RFC 7636 section 4.1: 43 to 128 characters from the unreserved set.
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(pkce.verifier).toHaveLength(43);

    expect(blocks('make-verifier')).toContain(pkce.verifier);
    expect(blocks('make-challenge')).toContain(`= ${pkce.challenge}`);
    expect(blocks('open-browser')).toContain(`&code_challenge=${pkce.challenge}`);
    expect(blocks('open-browser')).toContain('&code_challenge_method=S256');
    expect(blocks('open-browser')).not.toContain(pkce.verifier);
  });

  it('shows what the server really computes when the challenge is sent as the verifier', () => {
    expect(s256(pkce.challenge)).toBe(pkce.hashOfChallenge);
    expect(pkce.hashOfChallenge).not.toBe(pkce.challenge);
    expect(body('stolen-request', 'request')).toContain(`&code_verifier=${pkce.challenge}`);
    expect(body('stolen-request', 'request')).not.toContain(pkce.verifier);
    expect(blocks('stolen-verify')).toContain(`= ${pkce.hashOfChallenge}`);
    expect(call('stolen-verify').text).toContain(short(pkce.hashOfChallenge));
    expect(body('token-error', 'response')).toContain('"error": "invalid_grant"');
  });

  it('sends the verifier only in the app’s token request, with the same code the thief used', () => {
    const everything = (id: string) =>
      [call(id).text, body(id, 'request'), body(id, 'response'), blocks(id)].join('\n');
    const carriers = calls.filter((item) => everything(item.id).includes(pkce.verifier));
    expect(carriers.map((item) => item.id)).toEqual(['make-verifier', 'token-request']);
    for (const id of ['stolen-request', 'token-request']) {
      expect(body(id, 'request')).toContain(`&code=${pkce.code}`);
      expect(body(id, 'request')).toContain(
        `&redirect_uri=${encodeURIComponent(pkce.redirectUri)}`,
      );
    }
    expect(body('token-request', 'request')).toContain(`&code_verifier=${pkce.verifier}`);
    expect(body('redirect-back', 'response')).toContain(`?code=${pkce.code}`);
    expect(JSON.parse(body('token-response', 'response'))).toMatchObject({
      access_token: pkce.accessToken,
    });
  });

  it('writes each value the same way on every card, under the names the messages use', () => {
    const rows = (
      oauthPkce.layout.panes.find((pane) => pane.id === 'holders')!.content as {
        rows: { id: string; cells: Record<string, string> }[];
      }
    ).rows;
    // The table names each value as the requests and responses do.
    expect(rows.map((row) => row.cells.value)).toEqual([
      'code_verifier',
      'code_challenge',
      'code',
      'access_token',
    ]);
    // The short forms cannot be mistaken for one another.
    const forms = [
      pkce.verifier,
      pkce.challenge,
      pkce.code,
      pkce.accessToken,
      pkce.hashOfChallenge,
    ].map(short);
    expect(new Set(forms).size).toBe(forms.length);
    // Every short form in a card is one of them.
    for (const item of calls) {
      for (const [found] of item.text!.matchAll(/[A-Za-z0-9_-]{6}…/g)) {
        expect(forms, `${item.id}: ${found}`).toContain(found);
      }
    }
  });

  it('ends with the malicious app holding the code and the challenge, and never the verifier', () => {
    const folder = createFolder(loaded.walkthroughs[0]!);
    const last = oauthPkce.steps.length - 1;
    const state = folder.at(last, oauthPkce.steps[last]!.calls.length - 1).holders!
      .state as ElementsState;
    const declared = Object.fromEntries(
      (
        oauthPkce.layout.panes.find((pane) => pane.id === 'holders')!.content as {
          rows: { id: string; cells: Record<string, string> }[];
        }
      ).rows.map((row) => [row.id, row.cells]),
    );
    expect(state.present).toEqual(['verifier', 'challenge', 'code', 'access']);
    const holds = (row: string) => {
      const cells = { ...declared[row], ...state.patches[row] } as Record<string, string>;
      return ['app', 'browser', 'as', 'mal'].filter((column) => cells[column] === 'has it');
    };
    expect(holds('verifier')).toEqual(['app', 'as']);
    expect(holds('challenge')).toEqual(['app', 'browser', 'as', 'mal']);
    expect(holds('code')).toEqual(['app', 'browser', 'as', 'mal']);
    expect(holds('access')).toEqual(['app', 'as']);
  });
});
