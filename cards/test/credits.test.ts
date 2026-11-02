// THE FREE CREDITS (src/credits-service.ts): the holders' Friday recharge, a new wallet's 5 credits. Grants are recorded, none is sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BATCH, handleWelcome, rechargeHolders, refreshKnown, welcome, type CreditDeps, type Grant, type Recharge } from '../src/credits-service.js';

const wallet = (n: number): string => `0x${n.toString(16).padStart(40, '0')}`;
function stand(now: number, holders: string[] = []): CreditDeps & { map: Map<string, string>; grants: Grant[]; fail: number | null; at: { now: number } } {
  const map = new Map<string, string>(), grants: Grant[] = [], at = { now };
  const deps = { map, grants, at, fail: null as number | null, now: () => at.now,
    store: { getText: async (k: string) => map.get(k) ?? null, set: async (k: string, v: string) => { map.set(k, v); } },
    grant: async (g: Grant) => { if (deps.fail !== null && grants.length >= deps.fail) throw new Error('HTML wall'); grants.push(g); },
    holders: async () => holders, seen: async () => [wallet(900).toUpperCase().replace('0X', '0x')] };
  return deps;
}
const FRIDAY = Date.parse('2026-11-06T00:00:00Z');

test('the recharge: nothing before Friday 00:00 Lisbon, nor before the first Thursday week', async () => {
  const holders = [wallet(1)];
  assert.equal(await rechargeHolders(stand(Date.parse('2026-11-05T23:59:59Z'), holders)), null);
  assert.equal(await rechargeHolders(stand(Date.parse('2026-11-01T12:00:00Z'), holders)), null);
  const deps = stand(FRIDAY, holders);
  await rechargeHolders(deps);
  assert.deepEqual(deps.grants, [{ address: wallet(1), credits: 3, idempotencyKey: `wall-holders-week-3-${wallet(1)}`, reason: 'THE WALL holder: 3 free plays' }]);
});

test('25 grants a pass, each wallet once a week, finished once; next Friday again', async () => {
  const holders = Array.from({ length: 60 }, (_, i) => wallet(i + 1)), deps = stand(FRIDAY, [...holders, holders[0] as string]);
  await rechargeHolders(deps);
  assert.equal(deps.grants.length, BATCH);
  await rechargeHolders(deps); await rechargeHolders(deps); await rechargeHolders(deps);
  assert.equal(deps.grants.length, 60);
  assert.equal(new Set(deps.grants.map((g) => g.idempotencyKey)).size, 60);
  assert.equal(deps.map.get('granted.json'), '180');
  assert.ok((JSON.parse(deps.map.get('recharge-3.json') as string) as Recharge).finishedAt);
  deps.at.now = Date.parse('2026-11-13T00:00:00Z');
  await rechargeHolders(deps);
  assert.equal(deps.grants.length, 60 + BATCH);
  assert.ok(deps.grants.at(-1)?.idempotencyKey.startsWith('wall-holders-week-4-'));
});

test('a grant that fails stops the pass; the next one goes on, none lost, none twice', async () => {
  const holders = Array.from({ length: 10 }, (_, i) => wallet(i + 1)), deps = stand(FRIDAY, holders);
  deps.fail = 4;
  const first = await rechargeHolders(deps);
  assert.equal(first?.done.length, 4); assert.equal(first?.error, 'HTML wall');
  deps.fail = null;
  await rechargeHolders(deps);
  assert.equal(deps.grants.length, 10);
  assert.equal(new Set(deps.grants.map((g) => g.address)).size, 10);
});

test('a new wallet: 5 credits, once, ever', async () => {
  const deps = stand(FRIDAY);
  assert.deepEqual(await welcome(deps, wallet(7).toUpperCase().replace('0X', '0x')), { state: 'granted', credits: 5, left: 99 });
  assert.deepEqual(Object.keys(JSON.parse(deps.map.get('welcomed.json') ?? '{}')), [wallet(7)]);   // /stats counts its plays as free
  assert.deepEqual(deps.grants[0], { address: wallet(7), credits: 5, idempotencyKey: `wall-welcome-${wallet(7)}`, reason: 'THE WALL ARCADE: 5 free plays for a new wallet' });
  assert.equal((await welcome(deps, wallet(7))).state, 'already');
  deps.at.now = Date.parse('2026-12-01T12:00:00Z');
  assert.equal((await welcome(deps, wallet(7))).state, 'already');
  assert.equal(deps.grants.length, 1);
});

test('a wallet the arcade knows gets nothing: a holder, a buyer, a tagged player', async () => {
  const deps = stand(FRIDAY, [wallet(1)]);
  await refreshKnown(deps);
  assert.equal((await welcome(deps, wallet(1))).state, 'known');
  assert.equal((await welcome(deps, wallet(900))).state, 'known');
  assert.equal(deps.grants.length, 0);
});

test('100 wallets a week, then next week', async () => {
  const deps = stand(FRIDAY);
  deps.map.set('welcome-week-3.json', '99');
  assert.equal((await welcome(deps, wallet(1))).left, 0);
  assert.equal((await welcome(deps, wallet(2))).state, 'full');
  deps.at.now = Date.parse('2026-11-12T23:00:00Z');
  assert.equal((await welcome(deps, wallet(2))).state, 'granted');
});

test('a grant that fails records nothing: asked again, it goes through', async () => {
  const deps = stand(FRIDAY);
  deps.fail = 0;
  await assert.rejects(welcome(deps, wallet(3)));
  assert.equal(deps.map.size, 0);
  deps.fail = null;
  assert.equal((await welcome(deps, wallet(3))).state, 'granted');
});

const post = (origin: string | null, body: unknown): Request => new Request('https://x/api/welcome', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
test('POST /api/welcome: from the arcade only, with a session SuperRare knows', async () => {
  const deps = stand(FRIDAY), allowed = async (o: string | null): Promise<boolean> => o === 'https://thewallarcade.superrare.com';
  const walletOf = async (t: unknown): Promise<string | null> => (t === 'good' ? wallet(5) : null);
  const go = (r: Request): Promise<Response> => handleWelcome(r, { credits: deps, walletOf, allowed });
  assert.equal((await go(post('https://evil.example', { accessToken: 'good' }))).status, 403);
  assert.equal((await go(post('https://thewallarcade.superrare.com', { accessToken: 'bad' }))).status, 401);
  const ok = await go(post('https://thewallarcade.superrare.com', { accessToken: 'good' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://thewallarcade.superrare.com');
  assert.equal(((await ok.json()) as { state: string }).state, 'granted');
  deps.fail = 0;
  deps.grants.length = 0;
  deps.map.clear();
  assert.equal((await go(post('https://thewallarcade.superrare.com', { accessToken: 'good' }))).status, 502);
});
