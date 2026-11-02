// THE FREE CREDITS, on the arcade's credit group, through SuperRare's organizer grant (RARE_PROFILE_TOKEN; a grant moves no
// funds). Kept in the store "jackpot".
//   every 15 minutes (netlify/functions/credits-refresh.mts):
//     the holders' recharge: from Friday 00:00 Lisbon, an hour after the week closes, 3 credits to each wallet holding a name
//     of the wall (people.json, as it is that Friday). SuperRare answers with an HTML wall after about 60 grants in a row, so
//     25 a pass, and the rest at the next one; a retry with the same key never credits twice. The credits add up: there is no
//     balance to read, so a holder who did not play has 6 the next week.
//     known-wallets.json: the wallets the arcade has already seen (holders, pack buyers, our tags).
//   POST /api/welcome  { accessToken }: the hub's GET 5 FREE PLAYS. The session is checked with SuperRare. 5 credits, once a
//     wallet, for a new wallet, 100 wallets a week. From the arcade's pages only (CORS, cards/src/group.ts).
import { WELCOME_CAP, welcomeKey } from './jackpot-service.js';
import { numberedWeek } from './jackpot.js';

export const HOLDER_CREDITS = 3, WELCOME_CREDITS = 5, BATCH = 25;
const HOUR_MS = 3_600_000;
const FIRST_RECHARGE = 3;                                        // Friday 6 November 2026, the first week that opens on a Thursday

export type Grant = { address: string; credits: number; idempotencyKey: string; reason: string };
export type CreditDeps = {
  now(): number;
  store: { getText(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
  grant(input: Grant): Promise<void>;
  /** the wallets holding a name of the wall, now */
  holders(): Promise<string[]>;
  /** the wallets seen by the arcade: pack buyers, our tags */
  seen(): Promise<string[]>;
};
export type Recharge = { n: number; startedAt: string; wallets: string[]; done: string[]; error?: string; finishedAt?: string };

/** One pass: the week's recharge goes on where it stopped; the first error waits for the next pass. */
export async function rechargeHolders(deps: CreditDeps): Promise<Recharge | null> {
  const now = deps.now(), week = numberedWeek(now), key = `recharge-${week.n}.json`;
  if (week.n < FIRST_RECHARGE || now < Date.parse(week.from) + HOUR_MS) return null;
  const record = JSON.parse((await deps.store.getText(key)) ?? 'null') as Recharge | null
    ?? { n: week.n, startedAt: new Date(now).toISOString(), wallets: [...new Set((await deps.holders()).map((w) => w.toLowerCase()))].sort(), done: [] };
  if (record.finishedAt) return record;
  const left = record.wallets.filter((w) => !record.done.includes(w)).slice(0, BATCH);
  delete record.error;
  let given = 0;
  for (const address of left) {
    try { await deps.grant({ address, credits: HOLDER_CREDITS, idempotencyKey: `wall-holders-week-${week.n}-${address}`, reason: 'THE WALL holder: 3 free plays' }); record.done.push(address); given += HOLDER_CREDITS; }
    catch (error) { record.error = error instanceof Error ? error.message.slice(0, 160) : 'the grant failed'; break; }
  }
  await addGiven(deps, given);
  if (record.done.length === record.wallets.length) record.finishedAt = new Date(deps.now()).toISOString();
  await deps.store.set(key, JSON.stringify(record));
  return record;
}

/** What /stats shows as given since the first grant of 570: granted.json. */
async function addGiven(deps: CreditDeps, credits: number): Promise<void> {
  if (credits > 0) await deps.store.set('granted.json', String((Number(await deps.store.getText('granted.json')) || 0) + credits));
}

export async function refreshKnown(deps: CreditDeps): Promise<void> {
  const known = new Set([...await deps.holders(), ...await deps.seen()].map((w) => w.toLowerCase()));
  await deps.store.set('known-wallets.json', JSON.stringify([...known]));
}

export type Welcome = { state: 'granted' | 'already' | 'known' | 'full'; credits: number; left: number };
/** A signed-in wallet asks for its 5 credits. A grant that fails records nothing; asked again, the same key never credits twice. */
export async function welcome(deps: CreditDeps, wallet: string): Promise<Welcome> {
  const address = wallet.toLowerCase(), week = numberedWeek(deps.now()), cap = welcomeKey(week.n);
  const count = Number(await deps.store.getText(cap)) || 0, left = Math.max(0, WELCOME_CAP - count), mine = `welcome/${address}.json`;
  if (await deps.store.getText(mine)) return { state: 'already', credits: 0, left };
  const known = JSON.parse((await deps.store.getText('known-wallets.json')) ?? '[]') as string[];
  if (known.includes(address)) return { state: 'known', credits: 0, left };
  if (left === 0) return { state: 'full', credits: 0, left };
  await deps.grant({ address, credits: WELCOME_CREDITS, idempotencyKey: `wall-welcome-${address}`, reason: 'THE WALL ARCADE: 5 free plays for a new wallet' });
  await deps.store.set(mine, JSON.stringify({ at: new Date(deps.now()).toISOString(), week: week.n }));
  await deps.store.set(cap, String(count + 1));
  const welcomed = JSON.parse((await deps.store.getText('welcomed.json')) ?? '{}') as Record<string, string>;
  await deps.store.set('welcomed.json', JSON.stringify({ ...welcomed, [address]: new Date(deps.now()).toISOString() }));   // for /stats: free plays
  await addGiven(deps, WELCOME_CREDITS);
  return { state: 'granted', credits: WELCOME_CREDITS, left: left - 1 };
}

export type WelcomeDeps = { credits: CreditDeps; walletOf(token: unknown): Promise<string | null>; allowed(origin: string | null): Promise<boolean> };
export async function handleWelcome(request: Request, deps: WelcomeDeps): Promise<Response> {
  const origin = request.headers.get('origin');
  if (!await deps.allowed(origin)) return new Response(JSON.stringify({ error: 'not from the arcade' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin as string, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST' }), { status: 405, headers });
  const body = await request.json().catch(() => null) as { accessToken?: unknown } | null;
  const wallet = await deps.walletOf(body?.accessToken);
  if (!wallet) return new Response(JSON.stringify({ error: 'Sign in again.' }), { status: 401, headers });
  try { return new Response(JSON.stringify(await welcome(deps.credits, wallet)), { headers }); }
  catch { return new Response(JSON.stringify({ error: 'The plays could not be added. Try again in a minute.' }), { status: 502, headers }); }
}
