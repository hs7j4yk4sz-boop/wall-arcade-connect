// THE JACKPOT (src/jackpot.ts, src/jackpot-service.ts, src/disperse.ts), on week 1 as it was: 154 credits, 0.0154 ETH.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeDisperse, DISPERSE, encodeDisperse } from '../src/disperse.js';
import { type Game } from '../src/games.js';
import { adminJackpot, bestOf, handleEarnings, readPayment, refreshJackpot, type JackpotDeps, type WeekRecord } from '../src/jackpot-service.js';
import { buildPlan, closedWeeks, earningsOf, ethOf, numberedWeek, type Best } from '../src/jackpot.js';
import { TREASURY } from '../src/pot.js';

const W77 = '0x77d3b23f38968f49d43ab1fe7e3920d7a05b92e2', HEAST = '0x3fbf3747128c03d0715438e6e1fcd9df8aa27b0a';
const BULLY = '0x14076efc88ca7d53594500261ada8185033e6d5b', KANCUNO = '0x41b199a5194c58b29559a482e919331e1c8eef85';
const LAMP = '0xcbb44c0ba937173d1de04210844ae92c80a9a111', NISSLA = '0x92fab452e2f14c7730f79031906e06326c916946', NFC = '0x00000000000000000000000000000000000a11ce';
const uuid = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
const game = (n: number, title: string, artist: string, payoutWallet: string | null, status: Game['status'] = 'live'): Game => ({
  appId: uuid(n), origin: `https://game${n}.srstudio.dev`, slug: title.toLowerCase().replace(/ /g, '-'), title, line: '', artist: { name: artist, panel: null },
  payoutWallet, submittedAt: null, attachedAt: null, status, publishedAt: null, shot: null, order: n,
});
const GAMES = [game(1, 'UNBREAKABLE', 'ON THE WALL', null), game(2, 'FULL ROW', 'ON THE WALL', null), game(3, 'Dirty Signals Radio', 'Bully Meow', BULLY),
  game(4, 'THE MORNING BREW', 'osaykancuno', KANCUNO), game(5, 'ROLL CALL RUN', 'LAMPWRECKED', LAMP), game(6, 'The Frens Forge', 'K4NCUN0', KANCUNO), game(7, 'WALL TAGGER 2000', 'Nissla', NISSLA)];
const CREDITS: Record<string, number> = { [uuid(1)]: 89, [uuid(2)]: 38, [uuid(3)]: 4, [uuid(4)]: 6, [uuid(5)]: 5, [uuid(6)]: 4, [uuid(7)]: 8 };
const heast: Best = { wallet: HEAST, name: 'heast.eth', score: 1 };
const BESTS: Record<string, Best> = { [uuid(1)]: { wallet: W77, name: '0x77d3…92e2', score: 2432 }, [uuid(2)]: heast, [uuid(3)]: heast, [uuid(4)]: heast, [uuid(5)]: heast, [uuid(6)]: heast, [uuid(7)]: heast };
const WEEK1 = numberedWeek(Date.parse('2026-10-29T12:00:00Z'));
const AFTER = Date.parse('2026-11-01T12:00:00Z');
const line = (plan: ReturnType<typeof buildPlan>, w: string): string => ethOf(plan.lines.find((l) => l.wallet === w)?.wei ?? '0');

test('the weeks: week 1 then Friday to Friday, 15:00 Lisbon', () => {
  assert.deepEqual([WEEK1.n, WEEK1.from, WEEK1.to], [1, '2026-10-21T23:00:00.000Z', '2026-10-30T15:00:00.000Z']);
  assert.deepEqual(numberedWeek(AFTER), { n: 2, from: '2026-10-30T15:00:00.000Z', to: '2026-11-05T23:00:00.000Z' });
  assert.equal(numberedWeek(Date.parse('2026-11-05T23:00:00Z')).n, 3);
  assert.equal(numberedWeek(Date.parse('2026-11-12T23:00:00Z')).n, 4);
  assert.equal(numberedWeek(Date.parse('2027-04-01T22:00:00Z')).n, 24);     // past a DST change
  assert.deepEqual(closedWeeks(Date.parse('2026-10-30T14:59:59Z')), []);
  assert.deepEqual(closedWeeks(Date.parse('2026-10-30T15:00:00Z')).map((w) => w.n), [1]);
  assert.deepEqual(closedWeeks(Date.parse('2026-11-12T22:00:00Z')).map((w) => w.n), [1, 2]);
});

test('week 1: 154 credits, 0.0154 ETH, 0x77d3…92e2 0.00445, heast.eth 0.00325, the artists 40%, our games to the wall', () => {
  const plan = buildPlan(WEEK1, CREDITS, GAMES, BESTS);
  assert.equal(plan.credits, 154);
  assert.equal(ethOf(plan.totalWei), '0.0154');
  assert.equal(line(plan, W77), '0.00445');
  assert.equal(line(plan, HEAST), '0.00325');
  assert.equal(line(plan, BULLY), '0.00016');
  assert.equal(line(plan, KANCUNO), '0.0004');              // two games, one wallet: one line
  assert.equal(line(plan, LAMP), '0.0002');
  assert.equal(line(plan, NISSLA), '0.00032');
  assert.equal(ethOf(plan.wallWei), '0.00662');             // 10% of all, 40% of UNBREAKABLE and FULL ROW
  assert.equal(plan.lines.length, 6);
  assert.equal(plan.sendWei, plan.totalWei);                // every share has somewhere to go
  assert.equal(plan.heldWei, '0');
});

test('a share with nowhere to go stays in the treasury and is said', () => {
  const plan = buildPlan(WEEK1, { [uuid(3)]: 10, 'ffffffff-0000-4000-8000-000000000000': 10 }, GAMES, {});
  assert.equal(ethOf(plan.totalWei), '0.002');
  assert.equal(ethOf(plan.heldWei), '0.0014');              // both best scores, the unknown app's artist
  assert.equal(ethOf(plan.sendWei), '0.0006');
  assert.equal(plan.held.length, 3);
});

test('the board: the first wallet on it, its ENS name; nobody is null; a failed board throws', async () => {
  const board = (entries: unknown[], status = 200): typeof fetch => (async () => new Response(JSON.stringify({ entries }), { status })) as typeof fetch;
  const g = GAMES[0] as Game;
  assert.deepEqual(await bestOf(board([{ player: { kind: 'guest', id: 'x' }, score: '9' }, { player: { kind: 'wallet', id: HEAST.toUpperCase().replace('0X', '0x'), ensName: 'heast.eth' }, score: '6753' }]), g, WEEK1), { wallet: HEAST, name: 'heast.eth', score: 6753 });
  assert.equal((await bestOf(board([{ player: { kind: 'wallet', id: W77, ensName: null }, score: '1' }]), g, WEEK1))?.name, '0x77d3…92e2');
  assert.equal(await bestOf(board([]), g, WEEK1), null);
  await assert.rejects(bestOf(board([], 500), g, WEEK1), /HTTP 500/);
});

test('earnings: names and amounts, every live game, no wallet', () => {
  const doc = earningsOf(buildPlan(WEEK1, CREDITS, [...GAMES, game(8, 'GATE RUSH', 'K4NCUN0', KANCUNO)], BESTS, true), '2026-10-29T12:00:00.000Z');
  assert.equal(doc.games.length, 8);
  assert.deepEqual(doc.games[0], { slug: 'unbreakable', title: 'UNBREAKABLE', credits: 89, artist: 'ON THE WALL', artistEth: '0.00356', toWall: true, bestName: '0x77d3…92e2', bestScore: 2432, bestEth: '0.00445' });
  assert.equal(doc.games.at(-1)?.credits, 0);
  assert.ok(!JSON.stringify(doc).includes(KANCUNO));
});

test('Disperse: the call as the contract reads it, back and forth', () => {
  const lines = [{ wallet: W77, wei: 4_450_000_000_000_000n }, { wallet: HEAST, wei: 3_250_000_000_000_000n }];
  const data = encodeDisperse(lines);
  assert.equal(data.slice(0, 10), '0xe63d38ed');
  assert.equal((data.length - 10) / 64, 2 + 1 + 2 + 1 + 2);
  assert.deepEqual(decodeDisperse(data), lines);
  assert.throws(() => decodeDisperse('0xdeadbeef'), /disperseEther/);
});

const HASH = `0x${'ab'.repeat(32)}`, OTHER = `0x${'cd'.repeat(32)}`;
const planLines = (nfc = NFC, plan = buildPlan(WEEK1, CREDITS, GAMES, BESTS)) => [...plan.lines.map((l) => ({ wallet: l.wallet, wei: BigInt(l.wei) })), { wallet: nfc, wei: BigInt(plan.wallWei) }];
function chain(over: Partial<{ from: string; to: string; value: string; input: string }> = {}, status = '0x1', mined = true) {
  const plan = buildPlan(WEEK1, CREDITS, GAMES, BESTS);
  const tx = { from: TREASURY, to: DISPERSE, value: `0x${BigInt(plan.sendWei).toString(16)}`, input: encodeDisperse(planLines()), ...over };
  return async (method: string): Promise<unknown> => (method === 'eth_getTransactionByHash' ? tx : mined ? { status } : null);
}
function stand(rpc: JackpotDeps['rpc'] = chain(), now = AFTER): JackpotDeps & { map: Map<string, string>; calls: { usage: number } } {
  const map = new Map<string, string>(), calls = { usage: 0 };
  map.set('games-list', JSON.stringify(GAMES));
  const fetchStub = (async (url: string) => {
    const u = String(url);
    if (u.includes('/scoring/leaderboard')) {
      const id = /games\/([0-9a-f-]{36})\//.exec(u)?.[1] as string, b = BESTS[id];
      return new Response(JSON.stringify({ entries: b ? [{ player: { kind: 'wallet', id: b.wallet, ensName: b.name.endsWith('.eth') ? b.name : null }, score: String(b.score) }] : [] }));
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
  return {
    map, calls, fetch: fetchStub, now: () => now, token: undefined, rpc, finale: true,
    store: { getText: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } },
    games: { getText: async () => JSON.stringify(GAMES), getBytes: async () => null, set: async () => undefined, delete: async () => undefined },
  };
}
const seedWeek = (deps: ReturnType<typeof stand>, more: Partial<WeekRecord> = {}): void => {
  deps.map.set('week-1.json', JSON.stringify({ plan: buildPlan(WEEK1, CREDITS, GAMES, BESTS), status: 'due', computedAt: 'x', ...more }));
};
const record = (deps: ReturnType<typeof stand>): WeekRecord => JSON.parse(deps.map.get('week-1.json') as string) as WeekRecord;
const paid = (deps: JackpotDeps, hash = HASH) => adminJackpot(deps, { action: 'jackpot-paid', week: 1, hash }, 'admin');

test('a mined payment with exactly the week\'s lines: paid, hash and wall kept, and it cannot be paid twice', async () => {
  const deps = stand(); seedWeek(deps);
  assert.equal((await paid(deps)).status, 200);
  assert.equal(record(deps).status, 'paid'); assert.equal(record(deps).hash, HASH); assert.equal(record(deps).wall, NFC);
  assert.equal((await paid(deps, OTHER)).status, 409);
  assert.equal((await adminJackpot(deps, { action: 'jackpot-recompute', week: 1 }, 'admin')).status, 409);
  assert.equal((await adminJackpot(deps, { action: 'jackpot-clear', week: 1 }, 'admin')).status, 409);
});

test('a send on its way is kept as sent; a reverted one goes back to due; a lost one can be forgotten, never a pending one', async () => {
  const pending = stand(chain({}, '0x1', false)); seedWeek(pending);
  await paid(pending);
  assert.equal(record(pending).status, 'sent'); assert.equal(record(pending).hash, HASH);
  assert.equal((await adminJackpot(pending, { action: 'jackpot-clear', week: 1 }, 'admin')).status, 409);
  const reverted = stand(chain({}, '0x0')); seedWeek(reverted);
  await paid(reverted);
  assert.equal(record(reverted).status, 'due'); assert.equal(record(reverted).hash, undefined); assert.match(record(reverted).note ?? '', /reverted/);
  const lost = stand(async () => null); seedWeek(lost, { status: 'sent', hash: HASH });
  assert.equal((await adminJackpot(lost, { action: 'jackpot-clear', week: 1 }, 'admin')).status, 200);
  assert.equal(record(lost).status, 'due');
});

test('a transaction that is not the week\'s is refused and changes nothing', async () => {
  const plan = buildPlan(WEEK1, CREDITS, GAMES, BESTS);
  const swapped = planLines(); (swapped[0] as { wallet: string }).wallet = NFC;
  const short = planLines(); short.pop();
  const cases: [Parameters<typeof chain>[0], RegExp][] = [
    [{ from: W77 }, /treasury/], [{ to: W77 }, /Disperse/], [{ value: '0x1' }, /amount/], [{ input: '0x1234' }, /Disperse/],
    [{ input: encodeDisperse(swapped) }, /missing or wrong/], [{ input: encodeDisperse(short) }, /wall/],
  ];
  for (const [over, why] of cases) {
    const deps = stand(chain(over)); seedWeek(deps);
    const r = await paid(deps);
    assert.equal(r.status, 400); assert.match((r.body as { error: string }).error, why);
    assert.equal(record(deps).status, 'due');
  }
  assert.equal((await readPayment({ rpc: chain() }, plan, HASH)).state, 'paid');
});

test('one hash pays one week; a week still open or unknown is refused', async () => {
  const deps = stand(chain(), Date.parse('2026-11-08T12:00:00Z')); seedWeek(deps);
  deps.map.set('week-2.json', JSON.stringify({ plan: { ...buildPlan(WEEK1, CREDITS, GAMES, BESTS), n: 2 }, status: 'paid', computedAt: 'x', hash: HASH }));
  assert.equal((await paid(deps)).status, 409);
  assert.equal((await adminJackpot(stand(), { action: 'jackpot-paid', week: 2, hash: HASH }, 'admin')).status, 400);
  assert.equal((await paid(deps, 'nope')).status, 400);
});

test('MARK PAID: a week paid by hand, each hash mined and successful; then no PAY', async () => {
  const h = (i: number): string => `0x${String(i).repeat(64)}`;
  const failed = stand(async (_m, p) => ((p as string[])[0] === h(2) ? { status: '0x0' } : { status: '0x1' })); seedWeek(failed);
  const no = await adminJackpot(failed, { action: 'jackpot-manual', week: 1, hashes: [h(1), h(2)] }, 'admin');
  assert.equal(no.status, 400); assert.equal(record(failed).status, 'due');
  assert.equal((await adminJackpot(failed, { action: 'jackpot-manual', week: 1, hashes: ['nope'] }, 'admin')).status, 400);
  const deps = stand(async () => ({ status: '0x1' })); seedWeek(deps);
  assert.equal((await adminJackpot(deps, { action: 'jackpot-manual', week: 1, hashes: [h(1), ` ${h(3).toUpperCase().replace('0X', '0x')} `, h(1)], note: 'by hand, 31/10' }, 'admin')).status, 200);
  assert.deepEqual([record(deps).status, record(deps).manual, record(deps).hashes, record(deps).note], ['paid', true, [h(1), h(3)], 'by hand, 31/10']);
  assert.equal((await paid(deps)).status, 409);
  assert.equal((await adminJackpot(deps, { action: 'jackpot-manual', week: 1, hashes: [h(4)] }, 'admin')).status, 409);
  const sent = stand(async () => ({ status: '0x1' })); seedWeek(sent, { status: 'sent', hash: HASH });
  assert.equal((await adminJackpot(sent, { action: 'jackpot-manual', week: 1, hashes: [h(1)] }, 'admin')).status, 409);
});

test('with no report the week is not kept, the page says why, and the last earnings stay', async () => {
  const deps = stand();
  const r = await adminJackpot(deps, { action: 'jackpot' }, 'admin');
  assert.deepEqual(((r.body as { weeks: unknown[] }).weeks)[0], { n: 1, error: 'no RARE_PROFILE_TOKEN' });
  assert.equal(deps.map.has('week-1.json'), false);
  deps.map.set('earnings.json', '{"credits":7}');
  await assert.rejects(refreshJackpot(deps));
  assert.equal(await (await handleEarnings(deps)).text(), '{"credits":7}');
  assert.equal((await handleEarnings(stand())).status, 503);
});
