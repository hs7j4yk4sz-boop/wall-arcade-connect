// A game's capture, 1080 × 1080, its page as a player first sees it (Playwright and a headless Chromium), for the mail to
// John, the admin page and the hub's column when the game has no clip. Stored as shots/<appId>.png in the store "games";
// games.json then points at it (shot: "/games/<appId>.png").
import { readGames, writeGames, type GamesStore } from './games.js';

export type Shooter = (url: string) => Promise<Uint8Array>;

export async function shootGame(store: GamesStore, appId: string, shoot: Shooter): Promise<boolean> {
  const game = (await readGames(store)).find((g) => g.appId === appId);
  if (!game) return false;
  let png: Uint8Array | null = null, failure = '';
  try { png = await shoot(`${game.origin}/`); } catch (error) { const lines = error instanceof Error ? error.message.split('\n').filter((l) => l.trim() && !/<launching>|Call log|^\s+at /.test(l)) : [];
    failure = lines.length ? [lines[0], ...lines.slice(1).slice(-4)].join(' / ') : 'capture failed'; }
  if (png) await store.set(`shots/${appId}.png`, png);
  const games = await readGames(store);                       // read again: the list may have moved during the capture
  await writeGames(store, games.map((g) => {
    if (g.appId !== appId) return g;
    const { shotError: _, ...rest } = g;
    return png ? { ...rest, shot: `/games/${appId}.png` } : { ...rest, shotError: failure.slice(0, 600) };
  }));
  return Boolean(png);
}
