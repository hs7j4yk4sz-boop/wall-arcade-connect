// Signed capture links for Sprite Party, in their partner-capture format: an RS256 JWT that Sprite Party checks against
// our public key at /.well-known/jwks.json (netlify/functions/jwks.mts), carried in the link's fragment:
//   https://www.spriteparty.com/p/<party>/capture#handoff=<JWT>
// The token is made at the click on ADD YOURSELF (POST /people/capture, cards/src/people-service.ts) and lives 2 minutes:
// long enough to open the link; the capture itself then lasts an hour on Sprite Party's side. A new click makes a new
// token. The private key lives only in the Netlify variable SPRITE_JWT_PRIVATE_KEY (PEM, PKCS#8); the public key is
// derived from it, so the two never drift.
import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { PARTY, SITE, SPRITE_PARTY } from './people.js';

export const ISSUER = SITE;                                      // https://wall-arcade-cards.netlify.app: https, no trailing slash
export const AUDIENCE = 'spriteparty-partner-capture';
export const KID = 'potw-2026-10';
export const TTL_SECONDS = 120;

/** Who the capture is for: their wallet, the panel they hold, its name of the wall (as painted, unchanged). */
export type CaptureSubject = { wallet: string; panel: number; name: string };
export type CaptureClaims = {
  iss: string; aud: string; party: string; recipient_wallet: string; sub: string; ref: string; name: string;
  iat: number; exp: number; jti: string;
};
export type SignOptions = { privateKey?: string; now?: number; jti?: string };
export type Jwks = { keys: Array<Record<string, string>> };

const b64url = (data: string | Buffer): string => Buffer.from(data).toString('base64url');
const WALLET = /^0x[0-9a-f]{40}$/;

function privateKey(pem = process.env.SPRITE_JWT_PRIVATE_KEY): KeyObject {
  if (!pem) throw new Error('SPRITE_JWT_PRIVATE_KEY is not set');
  return createPrivateKey(pem.replace(/\\n/g, '\n'));
}

/** The JWT for one capture: header { alg RS256, typ JWT, kid }, the claims Sprite Party reads, 2 minutes to live. */
export function signCaptureToken({ wallet, panel, name }: CaptureSubject, opts: SignOptions = {}): string {
  const address = wallet.toLowerCase();
  if (!WALLET.test(address)) throw new Error('wallet: 0x and 40 hex digits');
  if (!Number.isSafeInteger(panel) || panel < 1) throw new Error('panel: a positive integer');
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const claims: CaptureClaims = {
    iss: ISSUER, aud: AUDIENCE, party: PARTY, recipient_wallet: address, sub: address, ref: String(panel), name,
    iat, exp: iat + TTL_SECONDS, jti: opts.jti ?? randomUUID(),
  };
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const payload = b64url(JSON.stringify(claims));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey(opts.privateKey));
  return `${header}.${payload}.${b64url(signature)}`;
}

/** The capture link: the token in the fragment (never sent to a server by the browser, nor kept in logs). */
export const captureLink = (jwt: string): string => `${SPRITE_PARTY}/p/${PARTY}/capture#handoff=${jwt}`;

/** The public half of SPRITE_JWT_PRIVATE_KEY as a JWKS (no private member ever leaves). */
export function jwks(pem?: string): Jwks {
  const { kty, n, e } = createPublicKey(privateKey(pem)).export({ format: 'jwk' });
  return { keys: [{ kty: kty!, n: n!, e: e!, kid: KID, use: 'sig', alg: 'RS256' }] };
}

/**
 * What Sprite Party checks, as we understand it: the key by kid in the JWKS, the RS256 signature, iss, aud, party, the
 * time window, sub = recipient_wallet. Throws with the reason; returns the claims. (For our tests and checks: Sprite
 * Party runs its own.)
 */
export function verifyCaptureToken(jwt: string, set: Jwks, now = Date.now()): CaptureClaims {
  const [h, p, s, extra] = jwt.split('.');
  if (!h || !p || !s || extra !== undefined) throw new Error('not a JWT');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg?: string; typ?: string; kid?: string };
  if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('header: RS256 JWT');
  const jwk = set.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`no key ${header.kid} in the JWKS`);
  const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) throw new Error('bad signature');
  const c = JSON.parse(Buffer.from(p, 'base64url').toString()) as CaptureClaims;
  const t = Math.floor(now / 1000);
  if (c.iss !== ISSUER) throw new Error('iss');
  if (c.aud !== AUDIENCE) throw new Error('aud');
  if (c.party !== PARTY) throw new Error('party');
  if (!WALLET.test(c.recipient_wallet) || c.sub !== c.recipient_wallet) throw new Error('sub / recipient_wallet');
  if (!/^[1-9]\d*$/.test(c.ref)) throw new Error('ref');
  if (typeof c.jti !== 'string' || !c.jti) throw new Error('jti');
  if (!(c.iat <= t + 30)) throw new Error('iat in the future');
  if (!(t < c.exp)) throw new Error('expired');
  return c;
}
