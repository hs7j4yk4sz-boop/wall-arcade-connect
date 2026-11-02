// THE FINALE (src/finale.ts) and its place in the week: the plan, PAY's check, the admin page's pick, the hub's /finale.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISPERSE, encodeDisperse } from '../src/disperse.js';
import { candidates, finaleStage, finaleWindow, FINALE_WEI, playsEth, topFive, type Entry, type FinalePick } from '../src/finale.js';
import type { Game } from '../src/games.js';
import { adminJackpot, handleFinale, readPayment, type JackpotDeps, type LiveDoc, type LiveFinale, type WeekRecord } from '../src/jackpot-service.js';
import { buildPlan, ethOf, numberedWeek } from '../src/jackpot.js';
import { TREASURY } from '../src/pot.js';

const wallet = (n: number): string => `0x${String(n).padStart(2, '0').repeat(20)}`;
const ARTIST = wallet(9), NFC = '0x00000000000000000000000000000000000a11ce', HASH = `0x${'ab'.repeat(32)}`;
const uuid = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
const game = (n: number, title: string, artist: string, payoutWallet: string | null, status: Game['status'] = 'live'): Game => ({ appId: uuid(n), origin: `https://game${n}.srstudio.dev`, slug: title.toLowerCase().replace(/ /g, '-'), title, line: '', artist: { name: artist, panel: null }, payoutWallet, submittedAt: null, attachedAt: null, status, publishedAt: null, shot: null, order: n });
const GAMES = [game(1, 'UNBREAKABLE', 'ON THE WALL', null), game(2, 'GATE RUSH', 'K4NCUN0', ARTIST), game(3, 'NO WALLET', 'Someone', null), game(4, 'NOT LIVE', 'Other', wallet(8), 'pending')];
const entry = (n: number, score: number, ensName: string | null = null): Entry => ({ player: { kind: 'wallet', id: wallet(n), ensName }, score: String(score) });
const WEEK2 = numberedWeek(Date.parse('2026-11-01T12:00:00Z')), WEEK3 = numberedWeek(Date.parse('2026-11-08T12:00:00Z'));
const PICK: FinalePick = { n: 3, appId: uuid(2), slug: 'gate-rush', title: 'GATE RUSH', origin: 'https://game2.srstudio.dev', artist: 'K4NCUN0', artistWallet: ARTIST, by: 'admin', at: 'x' };
const board = [entry(9, 9999, 'artist.eth'), entry(1, 900, 'one.eth'), entry(2, 800), entry(3, 700), entry(4, 600), entry(5, 500), entry(6, 400)];

test('the seven hours: Thursday 16:00 to 23:00 Lisbon, in winter and in summer; week 1 had none', () => {
  assert.deepEqual(finaleWindow(WEEK2), { from: '2026-11-05T16:00:00.000Z', to: '2026-11-05T23:00:00.000Z' });
  assert.deepEqual(finaleWindow(numberedWeek(Date.parse('2027-06-01T12:00:00Z'))), { from: '2027-06-03T15:00:00.000Z', to: '2027-06-03T22:00:00.000Z' });
  assert.equal(finaleWindow(numberedWeek(Date.parse('2026-10-25T12:00:00Z'))), null);
});

test('the top 5: the artist is out, the sixth comes up, 0.04 / 0.025 / 0.015 / 0.012 / 0.008 ETH', () => {
  const top = topFive(board, ARTIST);
  assert.deepEqual(top.map((w) => w.wallet), [1, 2, 3, 4, 5].map(wallet));
  assert.deepEqual(top.map((w) => w.rank), [1, 2, 3, 4, 5]);
  assert.equal(top[0]?.name, 'one.eth');
  assert.equal(top[1]?.name, '0x0202…0202');
  assert.deepEqual(top.map((w) => ethOf(w.wei)), ['0.04', '0.025', '0.015', '0.012', '0.008']);
  assert.equal(top.reduce((s, w) => s + BigInt(w.wei), 0n), FINALE_WEI);
  assert.equal(topFive([{ player: { kind: 'guest', id: 'x' }, score: '1' }, entry(9, 2)], ARTIST.toUpperCase().replace('0X', '0x')).length, 0);
});

test('the admin page offers the artists\' live games with a wallet, not ours', () => {
  assert.deepEqual(candidates(GAMES).map((g) => g.title), ['GATE RUSH']);
});

test('the block: before, live for seven hours, after for 72 hours, then before the next', () => {
  const at = (iso: string): 'before' | 'live' | 'after' => { const t = Date.parse(iso), week = numberedWeek(t); return finaleStage(t, week, numberedWeek(Date.parse(week.from) - 1), true); };
  assert.equal(at('2026-11-02T12:00:00Z'), 'before');
  assert.equal(at('2026-11-05T15:59:59Z'), 'before');
  assert.equal(at('2026-11-05T16:00:00Z'), 'live');
  assert.equal(at('2026-11-05T22:59:59Z'), 'live');
  assert.equal(at('2026-11-05T23:00:00Z'), 'after');
  assert.equal(at('2026-11-08T22:59:59Z'), 'after');
  assert.equal(at('2026-11-08T23:00:00Z'), 'before');
  const t = Date.parse('2026-11-06T00:00:00Z'), week = numberedWeek(t);
  assert.equal(finaleStage(t, week, numberedWeek(Date.parse(week.from) - 1), false), 'before');   // no game that week: nothing to show
});

test('a play adds 0.00005 ETH', () => {
  assert.equal(playsEth(0), '0.00000');
  assert.equal(playsEth(3), '0.00015');
  assert.equal(playsEth(20_000), '1.00000');
});

const finalePlan = (winners = topFive(board, ARTIST)) => buildPlan(WEEK3, { [uuid(2)]: 100 }, GAMES, { [uuid(2)]: { wallet: wallet(1), name: 'one.eth', score: 5000 } }, false, { pick: PICK, winners, prizeWei: FINALE_WEI });

test('the plan: the finale in the week\'s lines, one line for a winner of both, the send covers both', () => {
  const plan = finalePlan();
  assert.equal(ethOf(plan.totalWei), '0.01');               // the credits alone
  const one = plan.lines.find((l) => l.wallet === wallet(1));
  assert.equal(ethOf(one?.wei ?? '0'), '0.045');            // 0.04 + the game's best score, 0.005
  assert.deepEqual(one?.for, ['GATE RUSH: best score', 'Finale, GATE RUSH: #1']);
  assert.equal(ethOf(plan.sendWei), '0.11');
  assert.equal(plan.lines.length, 6);                       // five winners, the artist
  assert.equal(plan.finale?.winners.length, 5);
});

test('a place nobody took stays in the treasury and is said', () => {
  const plan = finalePlan(topFive(board.slice(0, 3), ARTIST));
  assert.equal(ethOf(plan.sendWei), '0.075');               // two winners, 0.04 + 0.025, and 0.01 of credits
  assert.equal(ethOf(plan.heldWei), '0.035');
  assert.match(plan.held.join(), /Finale: 0.035 ETH with no winner/);
});

function stand(now: number, rpc: JackpotDeps['rpc'] = async () => null): JackpotDeps & { map: Map<string, string>; asked: string[] } {
  const map = new Map<string, string>(), asked: string[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === 'https://studio.superrare.com/auth/cli/exchange') return Response.json({ sessionToken: 'jwt_test' });
    if (u.includes('/scoring/leaderboard')) { asked.push(u); return Response.json({ entries: board }); }
    const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; from?: string };
    if (body.action === 'get-credit-group-usage') return Response.json({ groupId: '60faaf46-ba4b-460c-a82a-adb852371a94', from: body.from, to: body.from, page: { hasMore: false, nextCursor: null }, totals: { capturedPlays: '3', completedPlays: '3', creditsConsumed: '3' }, games: [] });
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
  return { map, asked, fetch: fetchStub, now: () => now, token: 'slk_test', rpc, finale: true, store: { getText: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } },
    games: { getText: async () => JSON.stringify(GAMES), getBytes: async () => null, set: async () => undefined, delete: async () => undefined } };
}

test('the pick: an artist\'s live game for a week to come; a game of ours or a finale started is refused', async () => {
  const deps = stand(Date.parse('2026-11-01T12:00:00Z'));
  const list = await adminJackpot(deps, { action: 'finale' }, 'admin') as { body: { finales: { n: number; open: boolean }[]; offered: { title: string }[] } };
  assert.deepEqual(list.body.finales.map((f) => f.n), [2, 3, 4, 5]);
  assert.deepEqual(list.body.offered.map((g) => g.title), ['GATE RUSH']);
  assert.equal((await adminJackpot(deps, { action: 'finale-pick', week: 3, appId: uuid(2) }, '0xadmin')).status, 200);
  assert.equal((JSON.parse(deps.map.get('finale-3.json') as string) as FinalePick).artistWallet, ARTIST);
  assert.equal((await adminJackpot(deps, { action: 'finale-pick', week: 3, appId: uuid(1) }, 'admin')).status, 400);
  assert.equal((await adminJackpot(deps, { action: 'finale-pick', week: 99, appId: uuid(2) }, 'admin')).status, 400);
  const late = stand(Date.parse('2026-11-05T16:00:00Z'));
  assert.equal((await adminJackpot(late, { action: 'finale-pick', week: 2, appId: uuid(2) }, 'admin')).status, 409);
});

const live = async (deps: JackpotDeps): Promise<LiveDoc & { finale: LiveFinale }> => await (await handleFinale(deps)).json() as LiveDoc & { finale: LiveFinale };

test('/finale.json before: the week\'s plays and X, the game picked, no board read', async () => {
  const deps = stand(Date.parse('2026-11-08T12:00:00Z'));
  deps.map.set('finale-3.json', JSON.stringify(PICK));
  deps.map.set('welcome-week-3.json', '29');
  deps.map.set('finale-2.json', 'null');
  const d = await live(deps);
  assert.deepEqual([d.plays, d.finaleEth, d.addEth, d.welcomeLeft], [3, '0.1000', '0.00015', 71]);
  assert.equal(d.finale.state, 'before');
  assert.equal(d.finale.game?.title, 'GATE RUSH');
  assert.equal(d.finale.from, '2026-11-12T16:00:00.000Z');
  assert.equal(deps.asked.length, 0);
  assert.ok(!JSON.stringify(d).includes(wallet(1)) && !JSON.stringify(d).includes(ARTIST));
});

test('/finale.json with the finale not public: the plays only, and a closed week pays no finale', async () => {
  const deps = { ...stand(Date.parse('2026-11-13T10:00:00Z')), finale: false };
  deps.map.set('finale-3.json', JSON.stringify(PICK));
  const d = await live(deps);
  assert.deepEqual([d.finale, d.finaleEth, d.addEth], [null, '0', '0.00015']);
  assert.ok(!JSON.stringify(d).includes('GATE RUSH'));
  deps.map.set('week-1.json', '{"plan":{"n":1},"status":"paid"}'); deps.map.set('week-2.json', '{"plan":{"n":2},"status":"paid"}');
  const r = await adminJackpot(deps, { action: 'jackpot' }, 'admin') as { body: { weeks: WeekRecord[] } };
  assert.equal(r.body.weeks.find((w) => w.plan?.n === 3)?.plan.finale, undefined);
  assert.equal(deps.asked.filter((u) => u.includes('16%3A00')).length, 0);
});

test('/finale.json live: the board of the seven hours only, the artist out', async () => {
  const deps = stand(Date.parse('2026-11-12T18:00:00Z'));
  deps.map.set('finale-3.json', JSON.stringify(PICK));
  const d = await live(deps);
  assert.equal(d.finale.state, 'live');
  assert.deepEqual(d.finale.top.map((r) => [r.rank, r.name, r.eth]).slice(0, 2), [[1, 'one.eth', '0.04'], [2, '0x0202…0202', '0.025']]);
  assert.match(deps.asked[0] as string, /from=2026-11-12T16%3A00%3A00.000Z&to=2026-11-12T23%3A00%3A00.000Z/);
});

test('/finale.json after: the winners kept with the week, and the next finale', async () => {
  const deps = stand(Date.parse('2026-11-13T10:00:00Z'));
  deps.map.set('finale-3.json', JSON.stringify(PICK));
  deps.map.set('finale-4.json', JSON.stringify({ ...PICK, n: 4, title: 'NEXT ONE' }));
  deps.map.set('week-3.json', JSON.stringify({ plan: finalePlan(), status: 'due', computedAt: 'x' }));
  const d = await live(deps);
  assert.equal(d.finale.state, 'after');
  assert.equal(d.finale.n, 3);
  assert.equal(d.finale.top.length, 5);
  assert.equal(d.finale.next?.game?.title, 'NEXT ONE');
  assert.equal(d.finale.next?.from, '2026-11-19T16:00:00.000Z');
  assert.equal(deps.asked.length, 0);
});

test('/finale.json: a source that fails serves the last good document; with none, 503', async () => {
  const deps = stand(Date.parse('2026-11-08T12:00:00Z'));
  await live(deps);
  const down = { ...deps, token: undefined };
  assert.equal((await live(down)).plays, 3);
  deps.map.clear();
  assert.equal((await handleFinale(down)).status, 503);
});

test('/finale.json on a draft: no token, its plays from where it is told', async () => {
  const deps = stand(Date.parse('2026-11-08T12:00:00Z'));
  assert.equal((await live({ ...deps, token: undefined, plays: async () => 41 })).addEth, '0.00205');
});

test('PAY\'s check: the week\'s send with the finale is paid, a send without it is refused', async () => {
  const plan = finalePlan();
  const lines = [...plan.lines.map((l) => ({ wallet: l.wallet, wei: BigInt(l.wei) })), { wallet: NFC, wei: BigInt(plan.wallWei) }];
  const rpc = (input: string, value: string) => async (method: string): Promise<unknown> => (method === 'eth_getTransactionByHash' ? { from: TREASURY, to: DISPERSE, value, input } : { status: '0x1' });
  const value = `0x${BigInt(plan.sendWei).toString(16)}`;
  assert.deepEqual(await readPayment({ rpc: rpc(encodeDisperse(lines), value) }, plan, HASH), { state: 'paid', wall: NFC });
  assert.equal((await readPayment({ rpc: rpc(encodeDisperse(lines.slice(1)), value) }, plan, HASH)).state, 'wrong');
});

test('a closed week carries its finale: PAY\'s week is calculated with the winners of the seven hours', async () => {
  const deps = stand(Date.parse('2026-11-13T10:00:00Z'));
  deps.map.set('finale-3.json', JSON.stringify(PICK));
  deps.map.set('week-1.json', '{"plan":{"n":1},"status":"paid"}'); deps.map.set('week-2.json', '{"plan":{"n":2},"status":"paid"}');
  const r = await adminJackpot(deps, { action: 'jackpot' }, 'admin') as { body: { weeks: WeekRecord[] } };
  const week3 = r.body.weeks.find((w) => w.plan?.n === 3);
  assert.equal(week3?.plan.finale?.winners.length, 5);
  assert.equal(ethOf(week3?.plan.sendWei ?? '0'), '0.1');
  assert.ok(deps.asked.some((u) => u.includes('from=2026-11-12T16%3A00')));
});
