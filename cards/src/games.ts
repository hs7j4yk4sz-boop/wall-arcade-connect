// THE GAMES OF THE ARCADE, one list: games.json (store "games", public at GET /games.json). The hub draws its columns and
// its boards from it, /stats names the games with it, the card service lets in their pages and their games with it
// (cards/src/group.ts), the README's payout table is printed from it (scripts/readme-games.mjs). Nothing else lists games.
//   pending  attached to the credit group (playable at its address), not on the hub: John plays it, then one click
//   live     on the hub, in `order`; the NEW badge goes to the live game published last
//   hidden   off the hub (and still in the group: a game is never detached here)
// The first read seeds it from games/seed.json: our games, the artists' games handled by hand before SUBMIT YOUR GAME.
import seed from '../games/seed.json' with { type: 'json' };

export type GameStatus = 'pending' | 'live' | 'hidden';
/** `name` signs the game on the hub ("By …"); `wall` is the name on the wall when it differs; `panel` its panel. */
export type Artist = { name: string; wall?: string; panel: number | null; handle?: string | null };
export type Game = {
  appId: string; origin: string; slug: string; title: string; line: string; artist: Artist;
  payoutWallet: string | null; submittedAt: string | null; attachedAt: string | null;
  status: GameStatus; publishedAt: string | null; shot: string | null; order: number;
  by?: string;                 // the wallet that submitted it
  attachError?: string;        // the group refused it: ATTACH again from the admin page
  shotError?: string;          // the capture failed: a new one from the admin page
  clip?: string;               // its 10 s clip of the free practice, made on the Mac (npm run clip -- <slug>): /games/<slug>.mp4
  clipError?: string;          // set aside by John (USE THE STILL): the capture stays on the hub
};
export interface GamesStore {
  getText(key: string): Promise<string | null>;
  getBytes(key: string): Promise<Uint8Array | null>;
  set(key: string, value: string | Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export const GROUP_ID = '60faaf46-ba4b-460c-a82a-adb852371a94';
export const SITE = 'https://wall-arcade-cards.netlify.app';
export const APP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const STUDIO_ORIGIN = /^https:\/\/[a-z0-9]+\.srstudio\.dev$/;
export const WALLET = /^0x[0-9a-fA-F]{40}$/;
export const LIMITS = { title: 24, line: 120 };
/** false: nothing reaches the hub without John's click. true: a game that passes every check is live at once, and John
 *  can still HIDE it. */
export const AUTO_PUBLISH = false;

const STATUSES: GameStatus[] = ['pending', 'live', 'hidden'];
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const time = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** "THE Morning Brew!" → "the-morning-brew". */
export const slugOf = (title: string): string =>
  title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';

/** games.json as stored; an entry that is not a game is dropped (never the whole list). */
export function parseGames(raw: string | null): Game[] | null {
  let list: unknown;
  try { list = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!Array.isArray(list)) return null;
  return list.flatMap((g: Partial<Game> | null): Game[] => {
    if (!g || typeof g.appId !== 'string' || !APP_ID.test(g.appId) || typeof g.origin !== 'string' || !STUDIO_ORIGIN.test(g.origin)) return [];
    const a = (g.artist ?? {}) as Partial<Artist>;
    return [{
      appId: g.appId, origin: g.origin, slug: slugOf(text(g.slug, 40) || text(g.title, 40) || g.appId.slice(0, 8)),
      title: text(g.title, 60) || `App ${g.appId.slice(0, 8)}`, line: text(g.line, 200),
      artist: { name: text(a.name, 60), ...(a.wall ? { wall: text(a.wall, 60) } : {}), panel: Number.isInteger(a.panel) ? a.panel as number : null, ...(a.handle ? { handle: text(a.handle, 40) } : {}) },
      payoutWallet: typeof g.payoutWallet === 'string' && WALLET.test(g.payoutWallet) ? g.payoutWallet : null,
      submittedAt: time(g.submittedAt), attachedAt: time(g.attachedAt), status: STATUSES.includes(g.status as GameStatus) ? g.status as GameStatus : 'pending',
      publishedAt: time(g.publishedAt), shot: typeof g.shot === 'string' && /^\/games\/[0-9a-f-]{36}\.png$/.test(g.shot) ? g.shot : null,
      order: Number.isFinite(g.order) ? Number(g.order) : 999,
      ...(typeof g.by === 'string' && WALLET.test(g.by) ? { by: g.by.toLowerCase() } : {}),
      ...(typeof g.attachError === 'string' && g.attachError ? { attachError: g.attachError.slice(0, 200) } : {}),
      ...(typeof g.shotError === 'string' && g.shotError ? { shotError: g.shotError.slice(0, 600) } : {}),
      ...(typeof g.clip === 'string' && /^\/games\/[a-z0-9-]{1,64}\.mp4$/.test(g.clip) ? { clip: g.clip } : {}),
      ...(typeof g.clipError === 'string' && g.clipError ? { clipError: g.clipError.slice(0, 600) } : {}),
    }];
  });
}
export const SEED: Game[] = parseGames(JSON.stringify(seed)) as Game[];

/** A slug no other game has: "wall-kart", then "wall-kart-2"… */
export function freeSlug(title: string, games: Game[]): string {
  const base = slugOf(title);
  for (let n = 1; ; n++) { const s = n === 1 ? base : `${base}-${n}`; if (!games.some((g) => g.slug === s)) return s; }
}

/** The hub's games: the live ones in order. */
export const liveGames = (games: Game[]): Game[] => games.filter((g) => g.status === 'live').sort((a, b) => a.order - b.order);
/** The live game published last (the NEW badge); ours have no publishedAt. */
export const newest = (games: Game[]): string | null =>
  liveGames(games).filter((g) => g.publishedAt).sort((a, b) => Date.parse(b.publishedAt as string) - Date.parse(a.publishedAt as string))[0]?.appId ?? null;

/** Reads games.json, seeding it on the very first read. */
export async function readGames(store: GamesStore): Promise<Game[]> {
  const stored = parseGames(await store.getText('games.json'));
  if (stored) return stored;
  await store.set('games.json', JSON.stringify(SEED));
  return SEED.map((g) => ({ ...g }));
}
export const writeGames = (store: GamesStore, games: Game[]): Promise<void> => store.set('games.json', JSON.stringify(games));

/** What the admin page can do to one game; each returns the new list or an error for John. */
export type AdminAction =
  | { action: 'publish'; appId: string } | { action: 'hide'; appId: string }
  | { action: 'order'; appIds: string[] } | { action: 'still'; appId: string }
  | { action: 'edit'; appId: string; fields: { title?: string; line?: string; artistName?: string; panel?: number | null; payoutWallet?: string | null } };

export function applyAdmin(games: Game[], a: AdminAction, now: number): Game[] | { error: string } {
  if (a.action === 'order') {
    const live = liveGames(games);
    if (a.appIds.length !== live.length || live.some((g) => !a.appIds.includes(g.appId))) return { error: 'order: every live game, once' };
    return games.map((g) => (a.appIds.includes(g.appId) ? { ...g, order: a.appIds.indexOf(g.appId) + 1 } : g));
  }
  const game = games.find((g) => g.appId === a.appId);
  if (!game) return { error: 'no such game' };
  if (a.action === 'publish') {
    if (!game.artist.name) return { error: 'name the artist first (EDIT)' };
    if (!game.line) return { error: 'give it its one line first (EDIT)' };
    const last = Math.max(0, ...liveGames(games).map((g) => g.order));
    return games.map((g) => (g === game ? { ...g, status: 'live' as const, publishedAt: g.status === 'live' ? g.publishedAt : new Date(now).toISOString(), order: g.status === 'live' ? g.order : last + 1 } : g));
  }
  if (a.action === 'hide') return games.map((g) => (g === game ? { ...g, status: 'hidden' as const } : g));
  if (a.action === 'still') return games.map((g) => (g === game ? (({ clip: _, ...rest }) => ({ ...rest, clipError: 'set aside by John: the still capture' }))(g) : g));
  const f = a.fields, next = { ...game, artist: { ...game.artist } };
  if (f.title !== undefined) { const t = text(f.title, LIMITS.title); if (!t) return { error: 'title: 1 to 24 characters' }; next.title = t; }
  if (f.line !== undefined) { const l = text(f.line, LIMITS.line); if (!l) return { error: 'one line: 1 to 120 characters' }; next.line = l; }
  if (f.artistName !== undefined) {
    const n = text(f.artistName, 60); if (!n) return { error: 'artist: a name' };
    // a game recorded under its name on the wall keeps it as `wall` when the artist signs otherwise (NISSLA → Nissla)
    if (!next.artist.wall && game.artist.name && game.artist.panel && n !== game.artist.name) next.artist.wall = game.artist.name;
    if (next.artist.wall === n) delete next.artist.wall;
    next.artist.name = n;
  }
  if (f.panel !== undefined) { if (f.panel !== null && !(Number.isInteger(f.panel) && f.panel > 0 && f.panel <= 600)) return { error: 'panel: a number' }; next.artist.panel = f.panel; }
  if (f.payoutWallet !== undefined) { if (f.payoutWallet !== null && !WALLET.test(f.payoutWallet)) return { error: 'payout wallet: 0x and 40 hex digits' }; next.payoutWallet = f.payoutWallet; }
  return games.map((g) => (g === game ? next : g));
}
