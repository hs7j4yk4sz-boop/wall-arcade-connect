// PEOPLE's HTTP side (src/people.ts holds the rules), independent of Netlify:
//   GET /people.json            one object per named panel of the wall, its sprite or null (CORS *, cached 60 s)
//   GET /people/stats.json      { names, withSprite, lastSpriteAt }, for the hub's counter
//   GET /people/unmatched.json  sprites whose "Player name" matches no panel (for John: add an alias)
//   GET /people/all.json        every sprite of the event, newest first: the hub's grid (the matched ones with their name
//                               of the wall and panel, the others as guests under their Sprite Party name)
//   GET /people/sprites/<id>.png  a mirrored sprite sheet (CORS *, immutable): games draw it on a canvas
//   GET /people/sprites.zip     every sprite sheet and people.json, rebuilt when they change
//   GET /people/refresh         reads the sources now (also every 5 minutes, netlify/functions/people-refresh.mts)
//   POST /people/capture        { accessToken }: the player's SuperRare Connect session, checked with SuperRare as for
//                               /api/submit. For a wallet that holds a name of the wall: { url, name, panel, expiresAt },
//                               the Sprite Party capture link with a fresh signed token (cards/src/capture-link.ts) for
//                               its first name without a character (else its first name); 401 for a session SuperRare
//                               does not know, 404 for a wallet without a name. Asked at the click on ADD YOURSELF
//                               (the token lives 2 minutes, enough to open the link); a new click asks again. From the
//                               arcade's pages only (CORS: the hub and the games, cards/src/group.ts). The pages never
//                               carry the link.
import { zipSync, strToU8 } from 'fflate';
import { TTL_SECONDS, captureLink, type CaptureSubject } from './capture-link.js';
import { MANIFEST_URL, POSITIONS_URL, SPRITE_PARTY, buildPeople, isSpritePng, keyOf, validSprites, type Mirrored, type Person, type Position } from './people.js';

export interface PeopleStore {
  getText(key: string): Promise<string | null>;
  getBytes(key: string): Promise<Uint8Array | null>;
  set(key: string, value: string | Uint8Array): Promise<void>;
}
/** The capture's needs: who a Connect session is (SuperRare's answer), the signing, which pages may ask. */
export type CaptureDeps = { walletOf(token: unknown): Promise<string | null>; sign(subject: CaptureSubject): string; allowed(origin: string | null): Promise<boolean> };
export type PeopleDeps = { store: PeopleStore; fetch: typeof fetch; aliases: Record<string, string>; now(): number; capture?: CaptureDeps };

const cors = { 'Access-Control-Allow-Origin': '*' };
const json = (body: string, cache = 'public, max-age=60', status = 200): Response =>
  new Response(body, { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': cache } });

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${text.slice(0, 120)}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`${url}: not JSON (${text.slice(0, 120)})`); }
}

/** Reads the wall and the manifest, mirrors the new sprite sheets, writes people.json, stats, unmatched, all and the zip. */
export async function refresh(deps: PeopleDeps): Promise<{ sprites: number; mirroredNow: number; withSprite: number; unmatched: number }> {
  const [raw, manifest] = await Promise.all([getJson<Position[] | { positions: Position[] }>(deps.fetch, POSITIONS_URL), getJson<unknown>(deps.fetch, MANIFEST_URL)]);
  const positions = Array.isArray(raw) ? raw : raw?.positions;      // the wall answers a list, or { positions } (both seen)
  if (!Array.isArray(positions) || positions.length < 500) throw new Error(`positions: not the wall (${JSON.stringify(positions).slice(0, 160)})`);
  const sprites = validSprites(manifest);
  const mirrored = JSON.parse((await deps.store.getText('mirrored.json')) ?? '{}') as Mirrored;
  let mirroredNow = 0;
  for (const s of sprites) {
    if (mirrored[s.id]) continue;
    try {
      const response = await deps.fetch(`${SPRITE_PARTY}${s.src}`, { signal: AbortSignal.timeout(10_000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok || !isSpritePng(bytes)) continue;               // not a 192 × 192 PNG: skipped, tried again later
      await deps.store.set(`sprites/${s.id}.png`, bytes);
      mirrored[s.id] = new Date(deps.now()).toISOString(); mirroredNow++;
    } catch { /* Sprite Party slow or down: the next refresh tries again */ }
  }
  const { people, unmatched, stats, all } = buildPeople(positions, sprites, deps.aliases, mirrored);
  const peopleJson = JSON.stringify(people);
  const changed = mirroredNow > 0 || (await deps.store.getText('people.json')) !== peopleJson || !(await deps.store.getBytes('sprites.zip'));
  await deps.store.set('mirrored.json', JSON.stringify(mirrored));
  await deps.store.set('people.json', peopleJson);
  await deps.store.set('unmatched.json', JSON.stringify(unmatched));
  await deps.store.set('stats.json', JSON.stringify(stats));
  await deps.store.set('all.json', JSON.stringify(all));
  if (changed) {
    const files: Record<string, Uint8Array> = { 'people.json': strToU8(JSON.stringify(people, null, 1)) };
    for (const id of Object.keys(mirrored)) { const png = await deps.store.getBytes(`sprites/${id}.png`); if (png) files[`sprites/${id}.png`] = png; }
    await deps.store.set('sprites.zip', zipSync(files, { level: 6 }));
  }
  return { sprites: sprites.length, mirroredNow, withSprite: stats.withSprite, unmatched: unmatched.length };
}

export async function handlePeople(request: Request, deps: PeopleDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/people/capture') return handleCapture(request, deps);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json('{"error":"GET only"}', 'no-store', 405);
  if (path === '/people/refresh') {
    try { return json(JSON.stringify(await refresh(deps)), 'no-store'); }
    catch (error) { return json(JSON.stringify({ error: error instanceof Error ? error.message : 'refresh failed' }), 'no-store', 502); }
  }
  const doc = ({ '/people.json': 'people.json', '/people/stats.json': 'stats.json', '/people/unmatched.json': 'unmatched.json', '/people/all.json': 'all.json' } as Record<string, string>)[path];
  if (doc) {
    let body = await deps.store.getText(doc);
    if (body === null) { try { await refresh(deps); body = await deps.store.getText(doc); } catch { /* answered below */ } }
    return body === null ? json('{"error":"not ready"}', 'no-store', 503) : json(body);
  }
  const sprite = /^\/people\/sprites\/([0-9a-f-]{36})\.png$/.exec(path);
  if (sprite) {
    const png = await deps.store.getBytes(`sprites/${sprite[1]}.png`);
    return png ? new Response(png, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } })
      : new Response('not found', { status: 404, headers: cors });
  }
  if (path === '/people/sprites.zip') {
    const zip = await deps.store.getBytes('sprites.zip');
    return zip ? new Response(zip, { headers: { ...cors, 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="people-of-the-wall-sprites.zip"', 'Cache-Control': 'public, max-age=300' } })
      : new Response('not ready', { status: 503, headers: cors });
  }
  return new Response('not found', { status: 404, headers: cors });
}

/** POST /people/capture: a fresh capture link for the signed-in holder of a name of the wall (see the top of the file). */
async function handleCapture(request: Request, deps: PeopleDeps): Promise<Response> {
  const origin = request.headers.get('origin'), capture = deps.capture;
  const allowed = capture ? await capture.allowed(origin) : false;
  const h: Record<string, string> = allowed && origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
  const answer = (body: unknown, status: number): Response => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
  if (request.method !== 'POST') return answer({ error: 'POST { accessToken } from the arcade\'s pages' }, 405);
  if (!capture) return answer({ error: 'capture links are not set up' }, 503);
  if (!allowed) return answer({ error: "from the arcade's pages only" }, 403);
  let body: { accessToken?: unknown };
  try { body = await request.json() as { accessToken?: unknown }; } catch { return answer({ error: 'JSON body' }, 400); }
  const wallet = await capture.walletOf(body?.accessToken);
  if (!wallet) return answer({ error: 'Sign in again: your SuperRare session is not valid any more.' }, 401);
  const people = JSON.parse((await deps.store.getText('people.json')) ?? '[]') as Person[];
  const mine = people.filter((p) => p.wallet === wallet);
  if (!mine.length) return answer({ error: 'this wallet holds no name of the wall' }, 404);
  const pick = mine.find((p) => !p.sprite) ?? (mine[0] as Person);
  let jwt: string;
  try { jwt = capture.sign({ wallet, panel: pick.panel, name: pick.name }); } catch { return answer({ error: 'the capture cannot be signed right now' }, 503); }
  const exp = (JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number }).exp;
  return answer({ url: captureLink(jwt), name: pick.name, panel: pick.panel, expiresAt: new Date((exp ?? deps.now() / 1000 + TTL_SECONDS) * 1000).toISOString() }, 200);
}

/** For the cards (src/service.ts): the sprite id of each name (people.json, read at most once a minute) and a mirrored
 *  sheet's bytes, straight from this store. */
export function peopleSprites(store: PeopleStore, now: () => number = Date.now): { idsOf(names: string[]): Promise<(string | null)[]>; sheet(id: string): Promise<Uint8Array | null> } {
  let cache: { at: number; ids: Map<string, string> } | null = null;
  return {
    async idsOf(names) {
      if (!cache || now() - cache.at > 60_000) {
        const people = JSON.parse((await store.getText('people.json')) ?? '[]') as Person[];
        cache = { at: now(), ids: new Map(people.filter((p) => p.sprite).map((p) => [keyOf(p.name), (p.sprite as NonNullable<Person['sprite']>).id])) };
      }
      const ids = cache.ids;
      return names.map((n) => ids.get(keyOf(n)) ?? null);
    },
    sheet: (id) => (/^[0-9a-f-]{36}$/.test(id) ? store.getBytes(`sprites/${id}.png`) : Promise.resolve(null)),
  };
}
