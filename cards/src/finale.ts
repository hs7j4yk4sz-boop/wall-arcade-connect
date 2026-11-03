// THE FINALE: each week from week 2, one artist's game has its last seven hours, Friday 16:00 to 23:00 Lisbon. 0.1 ETH from
// NFC to the top 5 of the scores made in those hours, 0.04 / 0.025 / 0.015 / 0.012 / 0.008 ETH, the game's artist out of their own prizes. A place nobody
// took stays in the treasury. The admin page picks the game (cards/src/jackpot-service.ts); the winners go out with the week,
// in PAY's one send (buildPlan in cards/src/jackpot.ts). Everything here is pure.
import { WALLET, type Game } from './games.js';
import { CREDIT_WEI, OUR_ARTIST, ethOf, shortWallet, type NumberedWeek } from './jackpot.js';
import type { Week } from './week.js';

// Public with the first finale, Dirty Signals Radio by Bully Meow on Friday 6 November. Off: /finale.json has no finale and
// PAY no finale line, so the hub draws neither the block nor the 0.1 ETH. A draft always shows it (cards/src/jackpot-store.ts).
export const FINALE_PUBLIC = true;
export const FINALE_WEI = 100_000_000_000_000_000n;             // 0.1 ETH
export const PRIZES_WEI = [40n, 25n, 15n, 12n, 8n].map((m) => m * 1_000_000_000_000_000n);   // 1st to 5th: 0.1 ETH in all
export const PLACES = PRIZES_WEI.length;
export const PLAY_PRIZE_WEI = CREDIT_WEI / 2n;                  // what a play adds to the prizes: 0.00005 ETH, half of a credit
const HOURS_MS = 3_600_000;
const AFTER_MS = 48 * HOURS_MS;                                 // the winners stay on the hub until Sunday 23:00

/** `bonus`: one line of the admin's under the prizes, "+ 10 coffees by Bully Meow for the top 10". */
export type FinalePick = { n: number; appId: string; slug: string; title: string; origin: string; artist: string; artistWallet: string; by: string; at: string; bonus?: string };
export type Winner = { rank: number; wallet: string; name: string; score: number; wei: string };
export type Entry = { player?: { kind?: string; id?: string; ensName?: string | null }; score?: string };

/** The seven hours of a week's finale; week 1 had none. No DST change falls on a Friday. */
export function finaleWindow(week: NumberedWeek): Week | null {
  if (week.n < 2) return null;
  const to = Date.parse(week.to);
  return { from: new Date(to - 7 * HOURS_MS).toISOString(), to: week.to };
}

/** The games the admin page offers: live, an artist's, with the wallet that keeps the artist out of the prizes. */
export const candidates = (games: Game[]): Game[] => games.filter((g) => g.status === 'live' && g.artist.name !== OUR_ARTIST && g.payoutWallet && WALLET.test(g.payoutWallet));

const players = (entries: Entry[], artistWallet: string): Entry[] =>
  entries.filter((e) => e.player?.kind === 'wallet' && WALLET.test(e.player.id ?? '') && e.player.id?.toLowerCase() !== artistWallet.toLowerCase());

/** The top 5 wallets of a board, its artist left out. The board holds one line per wallet, its best. */
export function topFive(entries: Entry[], artistWallet: string): Winner[] {
  return players(entries, artistWallet).slice(0, PLACES)
    .map((e, i) => {
      const wallet = (e.player?.id as string).toLowerCase();
      return { rank: i + 1, wallet, name: e.player?.ensName || shortWallet(wallet), score: Number(e.score) || 0, wei: String(PRIZES_WEI[i]) };
    });
}

export type TopRow = { rank: number; wallet: string; ens: string; score: number };
/** The top 10 of a finale's board for the admin's CSV (the coffees), its artist left out: the board has ten lines at most, so
 *  nine when the artist is among them. */
export const topTen = (entries: Entry[], artistWallet: string): TopRow[] => players(entries, artistWallet).slice(0, 10)
  .map((e, i) => ({ rank: i + 1, wallet: (e.player?.id as string).toLowerCase(), ens: e.player?.ensName || '', score: Number(e.score) || 0 }));
/** RFC 4180: every field quoted. */
export const csvOf = (rows: TopRow[]): string => ['rank,wallet,ens,score', ...rows.map((r) => [r.rank, r.wallet, r.ens, r.score].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\r\n') + '\r\n';

/** 0.00005 × plays, five decimals: "0.00015". */
export function playsEth(plays: number): string {
  const wei = BigInt(plays) * PLAY_PRIZE_WEI, units = wei / 10_000_000_000_000n;
  return `${units / 100_000n}.${String(units % 100_000n).padStart(5, '0')}`;
}

/** What the hub's FINALE block shows: `after` a finale until Sunday 23:00, then `before` the next one, `live` during it. */
export function finaleStage(now: number, week: NumberedWeek, previous: NumberedWeek | null, previousPicked: boolean): 'before' | 'live' | 'after' {
  const window = finaleWindow(week);
  if (window && now >= Date.parse(window.from)) return 'live';
  return previous && previousPicked && finaleWindow(previous) && now < Date.parse(previous.to) + AFTER_MS ? 'after' : 'before';
}

export type FinaleRow = { rank: number; name: string; score: number; eth: string };
export const rowsOf = (winners: Winner[]): FinaleRow[] => winners.map((w) => ({ rank: w.rank, name: w.name, score: w.score, eth: ethOf(w.wei) }));
