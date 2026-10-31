// The clip from the nightly Action (src/clip-upload.ts): only this repository's workflow on main, only an mp4 and a jpg, only a
// game of the list. Tokens are signed here with a test key, as GitHub signs its own.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { checkOidc, handleClipUpload, OIDC_AUDIENCE, OIDC_ISSUER, OIDC_REPOSITORY, OIDC_WORKFLOW, type GitHubKeys } from '../src/clip-upload.js';
import { readGames, SEED, writeGames, type GamesStore } from '../src/games.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS: GitHubKeys = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] };
const NOW = Date.parse('2026-11-01T02:30:00Z');
const GOOD = { iss: OIDC_ISSUER, aud: OIDC_AUDIENCE, repository: OIDC_REPOSITORY, ref: 'refs/heads/main', workflow_ref: OIDC_WORKFLOW, exp: NOW / 1000 + 300 };
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object, kid = 'k1', key = privateKey): string => {
  const head = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
};
function memory(): GamesStore & { map: Map<string, string | Uint8Array> } {
  const map = new Map<string, string | Uint8Array>();
  return { map, getText: async (k) => (map.get(k) as string) ?? null, getBytes: async (k) => (map.get(k) as Uint8Array) ?? null, set: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } };
}
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(64)]).toString('base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const post = (token: string, body: unknown): Request => new Request('https://x/api/clip', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const deps = (games: GamesStore) => ({ games, now: () => NOW, keys: async () => KEYS });

test('only our workflow on main, signed by GitHub, in time', () => {
  assert.equal(checkOidc(jwt(GOOD), KEYS, NOW).repository, OIDC_REPOSITORY);
  assert.throws(() => checkOidc(jwt({ ...GOOD, repository: 'someone/fork' }), KEYS, NOW), /not our workflow/);
  assert.throws(() => checkOidc(jwt({ ...GOOD, ref: 'refs/heads/other' }), KEYS, NOW), /not our workflow/);
  assert.throws(() => checkOidc(jwt({ ...GOOD, workflow_ref: `${OIDC_REPOSITORY}/.github/workflows/other.yml@refs/heads/main` }), KEYS, NOW), /not our workflow/);
  assert.throws(() => checkOidc(jwt({ ...GOOD, aud: 'another' }), KEYS, NOW), /audience/);
  assert.throws(() => checkOidc(jwt({ ...GOOD, exp: NOW / 1000 - 1 }), KEYS, NOW), /expired/);
  assert.throws(() => checkOidc(jwt(GOOD, 'k2'), KEYS, NOW), /no key/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => checkOidc(jwt(GOOD, 'k1', other), KEYS, NOW), /signature/);
  const [h, , s] = jwt(GOOD).split('.');
  assert.throws(() => checkOidc(`${h}.${b64({ ...GOOD, repository: OIDC_REPOSITORY, aud: OIDC_AUDIENCE, exp: 9e9 })}.${s}`, KEYS, NOW), /signature/);
});

test('a clip is stored and the game points at it; a stranger, a non-mp4 or an unknown game changes nothing', async () => {
  const store = memory();
  await writeGames(store, SEED);
  assert.equal((await handleClipUpload(post('nope', { slug: 'full-row', mp4: MP4, jpg: JPG }), deps(store))).status, 401);
  assert.equal((await handleClipUpload(post(jwt(GOOD), { slug: 'full-row', mp4: JPG, jpg: JPG }), deps(store))).status, 400);
  assert.equal((await handleClipUpload(post(jwt(GOOD), { slug: 'nobody', mp4: MP4, jpg: JPG }), deps(store))).status, 404);
  assert.equal(store.map.size, 1);
  const ok = await handleClipUpload(post(jwt(GOOD), { slug: 'full-row', mp4: MP4, jpg: JPG }), deps(store));
  assert.equal(ok.status, 200);
  assert.ok(store.map.get('clips/full-row.mp4'));
  assert.equal((await readGames(store)).find((g) => g.slug === 'full-row')?.clip, '/games/full-row.mp4');
});
