// The arcade's games and pages, as the card service lets them in: every game of games.json (cards/src/games.ts, the one
// list of the arcade's games, whatever its status: a pending game is in the credit group and plays at its address),
// plus our own always (the hub is no game; and while games.json cannot be read, ours are the only ones). Nothing here is
// hard-coded per artist.
//   origins   who may POST /api/cards and /api/events (CORS; /api/events refuses the rest); local development too
//   games     what a tag's `game` and a board card's `game` may name: our keys, or the app id of any app of the group
import { SEED } from './games.js';
import { GAMES } from './validate.js';

export type GroupApp = { id: string; origin: string; title: string };
export type Group = { origins: Set<string>; apps: GroupApp[] };
export type GroupSource = () => Promise<Group>;

export const OUR_ORIGINS = ['https://yfq52eu3.srstudio.dev', 'https://7x2phv5j.srstudio.dev', 'https://6972mvu4.srstudio.dev', 'https://thewallarcade.superrare.com'];
const OUR_APPS: GroupApp[] = Object.values(GAMES).map((g) => ({ id: g.appId, origin: g.url.replace(/\/$/, ''), title: g.title }));
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const AN_ORIGIN = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;      // a bare https origin: no path, no port, nothing else
const AN_APP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ours = (): Group => ({ origins: new Set(OUR_ORIGINS), apps: OUR_APPS });

/** games.json ([{ appId, origin, title, … }]), or a list as the stats refresh once stored it ({ at, apps: [{ id, origin,
 *  title }] }); an unreadable file or entry: none. */
export function parseGroup(text: string | null): GroupApp[] {
  try {
    const raw = JSON.parse(text ?? 'null') as unknown;
    const list = Array.isArray(raw) ? raw.map((g: { appId?: unknown }) => ({ ...g, id: g?.appId })) : (raw as { apps?: unknown } | null)?.apps;
    if (!Array.isArray(list)) return [];
    return list.flatMap((a: Partial<GroupApp>) => (a && typeof a.id === 'string' && AN_APP_ID.test(a.id) && typeof a.origin === 'string' && AN_ORIGIN.test(a.origin)
      ? [{ id: a.id, origin: a.origin, title: typeof a.title === 'string' && a.title.trim() ? a.title.trim().slice(0, 60) : `App ${a.id.slice(0, 8)}` }] : []));
  } catch { return []; }
}

/** Ours plus games.json's, read from the store "games" at most once a minute per instance; the last one read if it fails. */
export function groupOf(store: { getText(key: string): Promise<string | null> }, now: () => number = Date.now): GroupSource {
  let cached: { at: number; group: Group } | null = null;
  return async () => {
    if (cached && now() - cached.at < 60_000) return cached.group;
    let apps: GroupApp[];
    // games.json never written yet: the seed it will be written from
    try { apps = parseGroup((await store.getText('games.json')) ?? JSON.stringify(SEED)); } catch { return cached?.group ?? ours(); }
    const all = [...OUR_APPS, ...apps.filter((a) => !OUR_APPS.some((o) => o.id === a.id))];
    cached = { at: now(), group: { origins: new Set([...OUR_ORIGINS, ...all.map((a) => a.origin)]), apps: all } };
    return cached.group;
  };
}

export const isAllowed = (origin: string | null, group: Group = ours()): boolean => origin !== null && (group.origins.has(origin) || LOCAL.test(origin));

/** A game as a page names it: our key ('full-row', 'unbreakable', which our own games send), or an app id of the group
 *  (ours turned into their key, so /stats counts them with their own tags). Null if it is no game of the arcade. */
export function gameKey(raw: unknown, group: Group = ours()): string | null {
  if (typeof raw !== 'string') return null;
  if (raw in GAMES) return raw;
  const app = group.apps.find((a) => a.id === raw);
  if (!app) return null;
  return (Object.entries(GAMES) as [string, { appId: string }][]).find(([, g]) => g.appId === app.id)?.[0] ?? app.id;
}
/** The artist's app a page belongs to, by its origin (not ours). */
export const artistOf = (origin: string | null, group: Group): GroupApp | null =>
  group.apps.find((a) => a.origin === origin && !Object.values(GAMES).some((g) => g.appId === a.id)) ?? null;
/** An artist's game of the group by its app id (not ours: those have their key). */
export const artistApp = (key: string, group: Group): GroupApp | null => (key in GAMES ? null : group.apps.find((a) => a.id === key) ?? null);
