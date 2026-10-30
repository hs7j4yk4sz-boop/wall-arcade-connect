// CAPTURE LINKS (src/capture-link.ts): Sprite Party's partner-capture format. The token verifies against the JWKS (the
// one we publish, and the one online when it can be read), with exactly the header and claims Sprite Party reads.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { AUDIENCE, captureLink, ISSUER, jwks, KID, signCaptureToken, TTL_SECONDS, verifyCaptureToken, type Jwks } from '../src/capture-link.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = Date.parse('2026-10-30T10:00:00Z');
const WALLET = '0xAAAA000000000000000000000000000000000342';
const JTI = 'b7a3a6f0-2f53-4c1e-9d55-0d8a0a7f3c21';
const part = (jwt: string, i: number) => JSON.parse(Buffer.from(jwt.split('.')[i]!, 'base64url').toString());

test('the token: header, claims and lifetime as Sprite Party reads them, verified with our JWKS', () => {
  const jwt = signCaptureToken({ wallet: WALLET, panel: 342, name: 'KARP' }, { privateKey: PEM, now: NOW, jti: JTI });
  assert.deepEqual(part(jwt, 0), { alg: 'RS256', typ: 'JWT', kid: 'potw-2026-10' });
  assert.deepEqual(part(jwt, 1), {
    iss: 'https://wall-arcade-cards.netlify.app', aud: 'spriteparty-partner-capture', party: 'sp_Fr4EW5t7XNjm0E_q',
    recipient_wallet: '0xaaaa000000000000000000000000000000000342', sub: '0xaaaa000000000000000000000000000000000342',
    ref: '342', name: 'KARP', iat: NOW / 1000, exp: NOW / 1000 + 120, jti: JTI,
  });
  assert.equal(ISSUER, 'https://wall-arcade-cards.netlify.app'); assert.equal(AUDIENCE, 'spriteparty-partner-capture');
  assert.equal(KID, 'potw-2026-10'); assert.equal(TTL_SECONDS, 120);
  const claims = verifyCaptureToken(jwt, jwks(PEM), NOW + 60_000);
  assert.equal(claims.ref, '342');
});

test('a fresh jti every time, the name as painted', () => {
  const a = part(signCaptureToken({ wallet: WALLET, panel: 2, name: 'ALPHALABS.XYZ' }, { privateKey: PEM }), 1);
  const b = part(signCaptureToken({ wallet: WALLET, panel: 2, name: 'ALPHALABS.XYZ' }, { privateKey: PEM }), 1);
  assert.match(a.jti, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a.jti, b.jti);
  assert.equal(a.name, 'ALPHALABS.XYZ');
});

test('the link: the capture page of our party, the token in the fragment', () => {
  const jwt = signCaptureToken({ wallet: WALLET, panel: 342, name: 'KARP' }, { privateKey: PEM, now: NOW });
  assert.equal(captureLink(jwt), `https://www.spriteparty.com/p/sp_Fr4EW5t7XNjm0E_q/capture#handoff=${jwt}`);
});

test('expired after 2 minutes; another key, another kid or a changed claim does not verify', () => {
  const jwt = signCaptureToken({ wallet: WALLET, panel: 342, name: 'KARP' }, { privateKey: PEM, now: NOW });
  assert.throws(() => verifyCaptureToken(jwt, jwks(PEM), NOW + 120_000), /expired/);
  assert.throws(() => verifyCaptureToken(jwt, jwks(PEM), NOW + 10 * 60_000), /expired/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.throws(() => verifyCaptureToken(jwt, jwks(other), NOW), /signature/);
  assert.throws(() => verifyCaptureToken(jwt, { keys: [{ ...jwks(PEM).keys[0]!, kid: 'old' }] }, NOW), /no key/);
  const [h, , s] = jwt.split('.');
  const forged = Buffer.from(JSON.stringify({ ...part(jwt, 1), ref: '1' })).toString('base64url');
  assert.throws(() => verifyCaptureToken(`${h}.${forged}.${s}`, jwks(PEM), NOW), /signature/);
});

test('jwks: public members only, with kid, use and alg', () => {
  const [k] = jwks(PEM).keys;
  assert.deepEqual(Object.keys(k!).sort(), ['alg', 'e', 'kid', 'kty', 'n', 'use']);
  assert.equal(k!.kid, KID); assert.equal(k!.use, 'sig'); assert.equal(k!.alg, 'RS256');
});

test('no key: signing refuses; a bad wallet or panel too', () => {
  const saved = process.env.SPRITE_JWT_PRIVATE_KEY;
  delete process.env.SPRITE_JWT_PRIVATE_KEY;
  try { assert.throws(() => signCaptureToken({ wallet: WALLET, panel: 1, name: 'X' }), /SPRITE_JWT_PRIVATE_KEY/); }
  finally { if (saved !== undefined) process.env.SPRITE_JWT_PRIVATE_KEY = saved; }
  assert.throws(() => signCaptureToken({ wallet: 'KARP', panel: 1, name: 'X' }, { privateKey: PEM }), /wallet/);
  assert.throws(() => signCaptureToken({ wallet: WALLET, panel: 0, name: 'X' }, { privateKey: PEM }), /panel/);
});

// Online: the JWKS published at /.well-known/jwks.json. With CAPTURE_TOKEN set (a token from the live /people/capture),
// the token must verify against it; without network, this test says why it is skipped.
test('online: the published JWKS has our key, and a live token verifies against it', async (t) => {
  let online: Jwks;
  try {
    const r = await fetch(`${ISSUER}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
    online = await r.json() as Jwks;
  } catch (error) { t.skip(`the JWKS cannot be read from here (${error instanceof Error ? error.message : error})`); return; }
  const key = online.keys.find((k) => k.kid === KID);
  assert.ok(key, 'kid potw-2026-10 published');
  assert.equal(key!.alg, 'RS256'); assert.equal(key!.kty, 'RSA');
  const live = process.env.CAPTURE_TOKEN;
  if (!live) { t.diagnostic('no CAPTURE_TOKEN: the live token was not checked'); return; }
  const claims = verifyCaptureToken(live, online);
  assert.equal(claims.aud, AUDIENCE);
});
