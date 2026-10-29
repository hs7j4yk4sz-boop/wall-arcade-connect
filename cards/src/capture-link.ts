// Signed capture links for Sprite Party: a short-lived RS256 JWT (who, which name, which panel) that Sprite Party
// checks against our public key at /.well-known/jwks.json (netlify/functions/jwks.mts). The private key lives only in
// the Netlify variable SPRITE_JWT_PRIVATE_KEY (PEM, PKCS#8); the public key is derived from it, so the two never drift.
// Claim names and the link's format are provisional: they follow Sprite Party's guide once we have it.
import { createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';

export const ISSUER = 'https://wall-arcade-cards.netlify.app';
export const KID = 'potw-2026-10';
export const TTL_SECONDS = 15 * 60;

export type CaptureClaims = { address: string; name: string; panel: number };
export type SignOptions = { privateKey?: string; now?: number };

const b64url = (data: string | Buffer): string => Buffer.from(data).toString('base64url');

function privateKey(pem = process.env.SPRITE_JWT_PRIVATE_KEY): KeyObject {
  if (!pem) throw new Error('SPRITE_JWT_PRIVATE_KEY is not set');
  return createPrivateKey(pem.replace(/\\n/g, '\n'));
}

/** The JWT for one capture link: RS256, kid in the header, iss/iat/exp (15 min) and the address, name, panel. */
export function signCaptureLink({ address, name, panel }: CaptureClaims, opts: SignOptions = {}): string {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat, exp: iat + TTL_SECONDS, address: address.toLowerCase(), name, panel }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey(opts.privateKey));
  return `${header}.${payload}.${b64url(signature)}`;
}

/** The public half of SPRITE_JWT_PRIVATE_KEY as a JWKS (no private member ever leaves). */
export function jwks(pem?: string): { keys: Array<Record<string, string>> } {
  const { kty, n, e } = createPublicKey(privateKey(pem)).export({ format: 'jwk' });
  return { keys: [{ kty: kty!, n: n!, e: e!, kid: KID, use: 'sig', alg: 'RS256' }] };
}
