// POST /api/clip: a clip filmed by the nightly GitHub Action (.github/workflows/clips.yml, scripts/clips-night.ts). No secret
// anywhere: the Action shows the OIDC token GitHub signs for it, checked here against GitHub's public keys (issuer, audience,
// this repository's main branch, this workflow). A clip that is not one, or a game that is not listed, is refused.
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { readGames, slugOf, writeGames, type GamesStore } from './games.js';
import { CLIP } from './clip.js';

export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const OIDC_AUDIENCE = 'wall-arcade-cards';
export const OIDC_REPOSITORY = 'hs7j4yk4sz-boop/wall-arcade-connect';
export const OIDC_WORKFLOW = `${OIDC_REPOSITORY}/.github/workflows/clips.yml@refs/heads/main`;
const MAX_POSTER = 512 * 1024;

export type GitHubKeys = { keys: (JsonWebKey & { kid?: string })[] };
type Claims = { iss?: string; aud?: string; repository?: string; ref?: string; workflow_ref?: string; exp?: number; nbf?: number };
export type ClipUploadDeps = { games: GamesStore; now(): number; keys(): Promise<GitHubKeys> };

const part = <T>(s: string | undefined): T => JSON.parse(Buffer.from(s ?? '', 'base64url').toString()) as T;

/** The claims of a GitHub OIDC token for our workflow on main; throws for anything else. */
export function checkOidc(token: string, jwks: GitHubKeys, now: number): Claims {
  const [head, body, signature] = token.split('.');
  const header = part<{ alg?: string; kid?: string }>(head);
  if (header.alg !== 'RS256') throw new Error('alg');
  const key = jwks.keys.find((k) => k.kid === header.kid);
  if (!key) throw new Error('no key');
  if (!verify('RSA-SHA256', Buffer.from(`${head}.${body}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature ?? '', 'base64url'))) throw new Error('signature');
  const claims = part<Claims>(body);
  if (claims.iss !== OIDC_ISSUER || claims.aud !== OIDC_AUDIENCE) throw new Error('issuer or audience');
  if (claims.repository !== OIDC_REPOSITORY || claims.ref !== 'refs/heads/main' || claims.workflow_ref !== OIDC_WORKFLOW) throw new Error('not our workflow');
  if (typeof claims.exp !== 'number' || now >= claims.exp * 1000 || (claims.nbf ?? 0) * 1000 > now + 60_000) throw new Error('expired');
  return claims;
}

export const isMp4 = (b: Uint8Array): boolean => b.byteLength > 12 && Buffer.from(b.subarray(4, 8)).toString('latin1') === 'ftyp';
export const isJpeg = (b: Uint8Array): boolean => b.byteLength > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function handleClipUpload(request: Request, deps: ClipUploadDeps): Promise<Response> {
  const answer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return answer({ error: 'POST only' }, 405);
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  try { checkOidc(token ?? '', await deps.keys(), deps.now()); } catch { return answer({ error: 'not our workflow' }, 401); }
  let body: { slug?: unknown; mp4?: unknown; jpg?: unknown };
  try { body = await request.json() as typeof body; } catch { return answer({ error: 'JSON body' }, 400); }
  const slug = typeof body.slug === 'string' ? slugOf(body.slug) : '';
  const mp4 = Buffer.from(typeof body.mp4 === 'string' ? body.mp4 : '', 'base64'), jpg = Buffer.from(typeof body.jpg === 'string' ? body.jpg : '', 'base64');
  if (!isMp4(mp4) || mp4.byteLength > CLIP.maxBytes || !isJpeg(jpg) || jpg.byteLength > MAX_POSTER) return answer({ error: 'an mp4 and a jpg, within the limits' }, 400);
  const games = await readGames(deps.games);
  if (!games.some((g) => g.slug === slug)) return answer({ error: 'no such game' }, 404);
  await deps.games.set(`clips/${slug}.mp4`, new Uint8Array(mp4));
  await deps.games.set(`clips/${slug}.jpg`, new Uint8Array(jpg));
  await writeGames(deps.games, games.map((g) => (g.slug === slug ? (({ clipError: _, ...rest }) => ({ ...rest, clip: `/games/${slug}.mp4` }))(g) : g)));
  return answer({ ok: true, clip: `/games/${slug}.mp4` }, 200);
}
