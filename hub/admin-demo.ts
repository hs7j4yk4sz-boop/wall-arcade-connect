// The preview's admin page (scripts/build-hub.ts --preview swaps hub/admin-env.ts for this file; never in the real page): the
// card service is a stand-in in memory, with made-up players, and the wallet another: nothing here can reach a chain, a real
// wallet or the service. The numbers come from the real calculation (cards/src/jackpot.ts, cards/src/finale.ts).
import { FINALE_WEI, topFive } from '../cards/src/finale.js';
import type { Game } from '../cards/src/games.js';
import { buildPlan } from '../cards/src/jackpot.js';

const TREASURY = '0xb6ede0158e1792ed25e1367edeec05a824d7c9ad', DISPERSE = '0xd152f549545093347a162dce210e7293f1452150';
const fake = (n: number): string => `0x${String(n).repeat(40).slice(0, 40)}`;
const uuid = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
const game = (n: number, title: string, artist: string, wallet: string | null): Game => ({ appId: uuid(n), origin: `https://demo${n}.srstudio.dev`, slug: `demo-${n}`, title, line: 'A made-up game of the preview.', artist: { name: artist, panel: null }, payoutWallet: wallet, submittedAt: null, attachedAt: null, status: 'live', publishedAt: null, shot: null, order: n });
const GAMES = [game(1, 'UNBREAKABLE', 'ON THE WALL', null), game(2, 'GATE RUSH', 'Demo Artist', fake(9)), game(3, 'ROLL CALL RUN', 'Other Artist', fake(8))];
const WEEK = { n: 2, from: '2026-10-30T15:00:00.000Z', to: '2026-11-05T23:00:00.000Z' };
const PICK = { n: 2, appId: uuid(2), slug: 'demo-2', title: 'GATE RUSH', origin: 'https://demo2.srstudio.dev', artist: 'Demo Artist', artistWallet: fake(9), by: 'demo', at: WEEK.from };
const entry = (n: number, name: string, score: number): { player: { kind: string; id: string; ensName: string }; score: string } => ({ player: { kind: 'wallet', id: fake(n), ensName: name }, score: String(score) });
const WINNERS = topFive([entry(9, 'demo-artist.eth', 9800), entry(1, 'player-one.eth', 9120), entry(2, 'player-two.eth', 8760), entry(3, 'player-three.eth', 7340), entry(4, 'player-four.eth', 6010), entry(5, 'player-five.eth', 5525), entry(6, 'player-six.eth', 900)], fake(9));
const best = (n: number, name: string, score: number): { wallet: string; name: string; score: number } => ({ wallet: fake(n), name, score });
const PLAN = buildPlan(WEEK, { [uuid(1)]: 96, [uuid(2)]: 214, [uuid(3)]: 41 }, GAMES, { [uuid(1)]: best(1, 'player-one.eth', 2432), [uuid(2)]: best(2, 'player-two.eth', 41596), [uuid(3)]: best(6, 'player-six.eth', 870) }, false, { pick: PICK, winners: WINNERS, prizeWei: FINALE_WEI });

let week: Record<string, unknown> = { plan: PLAN, status: 'due', computedAt: WEEK.to };
const later = Date.UTC(2026, 10, 12, 16), finale = (n: number, i: number): { n: number; from: string; to: string; open: boolean; pick: { appId: string; title: string; artist: string } | null } => ({ n, from: new Date(later + i * 7 * 86_400_000).toISOString(), to: new Date(later + i * 7 * 86_400_000 + 7 * 3_600_000).toISOString(), open: true, pick: null });
const finales = [{ n: 2, from: '2026-11-05T16:00:00.000Z', to: WEEK.to, open: false, pick: { appId: uuid(2), title: 'GATE RUSH', artist: 'Demo Artist' } }, finale(3, 0), finale(4, 1), finale(5, 2)];
const offered = GAMES.filter((g) => g.payoutWallet).map((g) => ({ appId: g.appId, title: g.title, artist: g.artist.name }));
const weeks = (): unknown => ({ ok: true, weeks: [week], treasury: TREASURY, disperse: DISPERSE });

export const demo = {
  wallet: {
    async request({ method }: { method: string; params?: unknown[] }): Promise<unknown> {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [TREASURY];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getBalance') return `0x${(BigInt(PLAN.sendWei) + 50_000_000_000_000_000n).toString(16)}`;
      if (method === 'eth_estimateGas') return '0x30000';
      if (method === 'eth_sendTransaction') return `0x${'de'.repeat(32)}`;
      if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
      throw new Error(`Preview: ${method} does not exist here.`);
    },
  },
  async call(body: Record<string, unknown>): Promise<{ code: number; data: unknown }> {
    if (body.action === 'whoami') return { code: 200, data: { wallet: `${TREASURY} (preview)`, games: GAMES } };
    if (body.action === 'finale') return { code: 200, data: { ok: true, finales, offered } };
    if (body.action === 'finale-pick') {
      const row = finales.find((f) => f.n === body.week), chosen = offered.find((g) => g.appId === body.appId) ?? null;
      if (row) row.pick = chosen && { appId: chosen.appId, title: chosen.title, artist: chosen.artist };
      return { code: 200, data: { ok: true, finales, offered } };
    }
    if (body.action === 'jackpot-paid') week = { ...week, status: 'paid', hash: body.hash, wall: '0x00000000000000000000000000000000000a11ce', paidAt: new Date().toISOString() };
    return { code: 200, data: weeks() };
  },
};
