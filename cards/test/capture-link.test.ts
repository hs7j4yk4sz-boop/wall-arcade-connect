// CAPTURE LINKS (src/capture-link.ts): the JWT verifies against the published JWKS, with the header and claims Sprite Party reads.
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import { ISSUER, jwks, KID, signCaptureLink, TTL_SECONDS } from '../src/capture-link.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = Date.parse('2026-10-29T22:00:00Z');
const part = (jwt: string, i: number) => JSON.parse(Buffer.from(jwt.split('.')[i]!, 'base64url').toString());

test('signCaptureLink: RS256 JWT that the JWKS key verifies, kid in the header, exp 15 min', () => {
  const jwt = signCaptureLink({ address: '0xAAAA000000000000000000000000000000000342', name: 'NISSLA', panel: 40 }, { privateKey: PEM, now: NOW });
  assert.deepEqual(part(jwt, 0), { alg: 'RS256', typ: 'JWT', kid: KID });
  const claims = part(jwt, 1);
  assert.deepEqual(claims, { iss: ISSUER, iat: NOW / 1000, exp: NOW / 1000 + TTL_SECONDS, address: '0xaaaa000000000000000000000000000000000342', name: 'NISSLA', panel: 40 });
  const [h, p, s] = jwt.split('.');
  const key = createPublicKey({ key: jwks(PEM).keys[0]!, format: 'jwk' });
  assert.ok(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s!, 'base64url')));
});

test('jwks: public members only, with kid, use and alg', () => {
  const [k] = jwks(PEM).keys;
  assert.deepEqual(Object.keys(k!).sort(), ['alg', 'e', 'kid', 'kty', 'n', 'use']);
  assert.equal(k!.kid, KID); assert.equal(k!.use, 'sig'); assert.equal(k!.alg, 'RS256');
});

test('no key: signing refuses', () => {
  const saved = process.env.SPRITE_JWT_PRIVATE_KEY;
  delete process.env.SPRITE_JWT_PRIVATE_KEY;
  try { assert.throws(() => signCaptureLink({ address: '0x1', name: 'X', panel: 1 }), /SPRITE_JWT_PRIVATE_KEY/); }
  finally { if (saved !== undefined) process.env.SPRITE_JWT_PRIVATE_KEY = saved; }
});
