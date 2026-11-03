// THE WEEK'S JACKPOT, the one calculation of the admin page's PAY and the public earnings page. By game: the credits played
// (SuperRare's usage report) × 0.0001 ETH (a pack, 0.005 ETH, is 50 plays); of that, 50% to the week's best score, 40% to the
// artist (their wallet in games.json; our own games: to the wall), 10% to the wall. Credits not played stay in the treasury.
// A share with nowhere to go (a game with credits and no score, an artist with no wallet) stays there too, and is said.
// The week's FINALE (cards/src/finale.ts) goes out with it, in the same lines; it is NFC's 0.1 ETH, not the credits'.
// All amounts are wei, as strings in JSON. Everything here is pure: the sources are in cards/src/jackpot-service.ts.
import type { FinalePick, Winner } from './finale.js';
import type { Game } from './games.js';
import { lisbonWeek, type Week } from './week.js';

export const CREDIT_WEI = 100_000_000_000_000n;                  // 0.0001 ETH
export const OUR_ARTIST = 'ON THE WALL';
const WEEK_MS = 7 * 86_400_000;
export type NumberedWeek = Week & { n: number };
export type Best = { wallet: string; name: string; score: number };
export type GameShare = {
  appId: string; slug: string; title: string; credits: number; wei: string; best: Best | null; artist: string;
  artistWallet: string | null; ours: boolean; bestWei: string; artistWei: string; wallWei: string;
};
export type PayLine = { wallet: string; wei: string; name: string; for: string[] };
export type PlanFinale = { title: string; artist: string; winners: Winner[]; wei: string };
export type Plan = NumberedWeek & { credits: number; totalWei: string; games: GameShare[]; lines: PayLine[]; wallWei: string; sendWei: string; heldWei: string; held: string[]; finale?: PlanFinale };

/** The week holding `now`, numbered as on the hub: week 1 is the long first one, then one a week. */
export function numberedWeek(now: number): NumberedWeek {
  const week = lisbonWeek(now), first = lisbonWeek(0), second = lisbonWeek(Date.parse(first.to));
  if (week.from === first.from) return { ...week, n: 1 };
  if (week.from === second.from) return { ...week, n: 2 };
  return { ...week, n: 3 + Math.round((Date.parse(week.from) - Date.parse(second.to)) / WEEK_MS) };   // weeks 1 and 2 are odd lengths; a DST change moves an end by an hour
}
/** Every week closed at `now`, oldest first. */
export function closedWeeks(now: number): NumberedWeek[] {
  const weeks: NumberedWeek[] = [];
  for (let w = numberedWeek(0); Date.parse(w.to) <= now; w = numberedWeek(Date.parse(w.to))) weeks.push(w);
  return weeks;
}

/** Wei → ETH, every digit that counts: "0.00445". */
export function ethOf(wei: bigint | string): string {
  const w = BigInt(wei), fraction = String(w % 10n ** 18n).padStart(18, '0').replace(/0+$/, '');
  return `${w / 10n ** 18n}${fraction ? `.${fraction}` : ''}`;
}
export const shortWallet = (w: string): string => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** The week: `credits` by app id (the usage report), `games` (games.json), `bests` by app id (each game's top score of the week).
 *  `everyGame` also lists the live games with no credit yet, as the public page shows them. `finale`: the week's finale and its winners. */
export function buildPlan(week: NumberedWeek, credits: Record<string, number>, games: Game[], bests: Record<string, Best | null>, everyGame = false, finale?: { pick: FinalePick; winners: Winner[]; prizeWei: bigint }): Plan {
  const ids = [...new Set([...Object.keys(credits).filter((id) => (credits[id] ?? 0) > 0), ...(everyGame ? games.filter((g) => g.status === 'live').map((g) => g.appId) : [])])];
  const rows = ids.map((appId): GameShare => {
    const game = games.find((g) => g.appId === appId), played = credits[appId] ?? 0, wei = BigInt(played) * CREDIT_WEI;
    const ours = game?.artist.name === OUR_ARTIST;
    return {
      appId, slug: game?.slug ?? appId.slice(0, 8), title: game?.title ?? `App ${appId.slice(0, 8)}`, credits: played, wei: String(wei), best: bests[appId] ?? null,
      artist: game?.artist.name || 'no artist yet', artistWallet: ours ? null : game?.payoutWallet?.toLowerCase() ?? null, ours,
      bestWei: String(wei * 50n / 100n), artistWei: String(wei * 40n / 100n), wallWei: String(wei * 10n / 100n),
    };
  }).sort((a, b) => b.credits - a.credits || a.title.localeCompare(b.title));

  const lines = new Map<string, PayLine>(), held: string[] = [];
  let wall = 0n, heldWei = 0n;
  const pay = (wallet: string, wei: string, name: string, why: string): void => {
    const line = lines.get(wallet) ?? { wallet, wei: '0', name, for: [] };
    lines.set(wallet, { ...line, wei: String(BigInt(line.wei) + BigInt(wei)), for: [...line.for, why] });
  };
  for (const r of rows) {
    if (r.credits === 0) continue;
    wall += BigInt(r.wallWei);
    if (r.best) pay(r.best.wallet, r.bestWei, r.best.name, `${r.title}: best score`);
    else { heldWei += BigInt(r.bestWei); held.push(`${r.title}: no score, ${ethOf(r.bestWei)} ETH stays in the treasury`); }
    if (r.ours) wall += BigInt(r.artistWei);
    else if (r.artistWallet) pay(r.artistWallet, r.artistWei, r.artist, `${r.title}: artist`);
    else { heldWei += BigInt(r.artistWei); held.push(`${r.title}: no artist wallet, ${ethOf(r.artistWei)} ETH stays in the treasury`); }
  }
  if (finale) {
    const won = finale.winners.reduce((sum, w) => sum + BigInt(w.wei), 0n), left = finale.prizeWei - won;
    for (const w of finale.winners) pay(w.wallet, w.wei, w.name, `Finale, ${finale.pick.title}: #${w.rank}`);
    if (left > 0n) { heldWei += left; held.push(`Finale: ${ethOf(left)} ETH with no winner stays in the treasury`); }
  }
  const total = rows.reduce((sum, r) => sum + BigInt(r.wei), 0n), sent = [...lines.values()].reduce((sum, l) => sum + BigInt(l.wei), wall);
  return { n: week.n, from: week.from, to: week.to, credits: rows.reduce((sum, r) => sum + r.credits, 0), totalWei: String(total), games: rows,
    lines: [...lines.values()], wallWei: String(wall), sendWei: String(sent), heldWei: String(heldWei), held,
    ...(finale ? { finale: { title: finale.pick.title, artist: finale.pick.artist, winners: finale.winners, wei: String(finale.prizeWei) } } : {}) };
}

export type Earnings = {
  week: NumberedWeek; updatedAt: string; credits: number; totalEth: string; toWallEth: string;
  games: { slug: string; title: string; credits: number; artist: string; artistEth: string; toWall: boolean; bestName: string | null; bestScore: number | null; bestEth: string }[];
};
/** The public page's document: names and amounts, "if the week ended now". */
export function earningsOf(plan: Plan, updatedAt: string): Earnings {
  return {
    week: { n: plan.n, from: plan.from, to: plan.to }, updatedAt, credits: plan.credits, totalEth: ethOf(plan.totalWei), toWallEth: ethOf(plan.wallWei),
    games: plan.games.map((g) => ({ slug: g.slug, title: g.title, credits: g.credits, artist: g.artist, artistEth: ethOf(g.artistWei), toWall: g.ours, bestName: g.best?.name ?? null, bestScore: g.best?.score ?? null, bestEth: g.best ? ethOf(g.bestWei) : '0' })),
  };
}
