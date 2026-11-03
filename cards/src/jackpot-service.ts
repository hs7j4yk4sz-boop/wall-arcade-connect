// The jackpot on the card service: the sources of cards/src/jackpot.ts, and what is kept of each week (store "jackpot").
//   every 15 minutes (netlify/functions/jackpot-refresh.mts): earnings.json, the week so far; and each week that has just
//                             closed (Friday 23:00 Lisbon) is calculated and kept as week-<n>.json, due; PAY on Saturday
//   GET  /earnings.json       the public page's document (hub/earnings.html), read from the store
//   GET  /finale.json         the hub's live document, read from the sources: the plays of the week and the FINALE block
//   POST /api/admin           jackpot: the weeks; jackpot-recompute: a week not sent yet, again; jackpot-paid: the hash of
//                             the payment; jackpot-clear: forget a send that never went through; finale: the weeks to
//                             come and the games to pick from; finale-pick: a week's game, until its finale starts;
//                             jackpot-manual: a week paid by hand, its hashes (each mined and successful), no PAY after;
//                             finale-top10: a closed finale's top 10 (rank, wallet, ENS, score) as CSV, for the coffees
// No key here: the treasury signs in the admin page, in its own wallet. The service only reads the chain: a week is paid when
// a mined transaction from the treasury to Disperse carries exactly its lines, plus one line of its wall amount (that line's
// address is the wall's, typed in the page). A week with a hash, or marked paid by hand, cannot be paid again.
import { decodeDisperse, DISPERSE } from './disperse.js';
import { readGames, WALLET, type Game, type GamesStore } from './games.js';
import { candidates, csvOf, FINALE_WEI, finaleStage, finaleWindow, PLACES, PRIZES_WEI, playsEth, rowsOf, topFive, topTen, type Entry, type FinalePick, type FinaleRow, type TopRow, type Winner } from './finale.js';
import { buildPlan, closedWeeks, earningsOf, ethOf, numberedWeek, shortWallet, type Best, type NumberedWeek, type Plan } from './jackpot.js';
import { TREASURY } from './pot.js';
import { clientOf, usageOf } from './stats-sources.js';


export type WeekRecord = { plan: Plan; status: 'due' | 'sent' | 'paid'; computedAt: string; hash?: string; wall?: string; by?: string; sentAt?: string; paidAt?: string; note?: string; manual?: true; hashes?: string[] };
export type JackpotDeps = {
  fetch: typeof fetch; now(): number; token: string | undefined;
  store: { getText(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
  games: Pick<GamesStore, 'getText' | 'set' | 'delete' | 'getBytes'>;
  /** one call to a public Ethereum RPC */
  rpc(method: string, params: unknown[]): Promise<unknown>;
  /** a Netlify draft's plays of the week: it has no token (cards/src/jackpot-store.ts); else SuperRare's usage report */
  plays?(): Promise<number>;
  /** the FINALE on the hub and in PAY (FINALE_PUBLIC in cards/src/finale.ts) */
  finale: boolean;
};

/** A game's best score of the week with a wallet behind it; null when it has none. Throws when the board cannot be read. */
export async function bestOf(fetchImpl: typeof fetch, game: Game, week: NumberedWeek): Promise<Best | null> {
  const r = await fetchImpl(`${game.origin}/api/v1/games/${game.appId}/scoring/leaderboard?from=${encodeURIComponent(week.from)}&to=${encodeURIComponent(week.to)}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${game.title}: HTTP ${r.status}`);
  const { entries } = await r.json() as { entries?: Entry[] };
  const top = (entries ?? []).find((e) => e.player?.kind === 'wallet' && WALLET.test(e.player.id ?? ''));
  if (!top?.player?.id) return null;
  const wallet = top.player.id.toLowerCase();
  return { wallet, name: top.player.ensName || shortWallet(wallet), score: Number(top.score) || 0 };
}

const pickKey = (n: number): string => `finale-${n}.json`;
async function readPick(deps: JackpotDeps, n: number): Promise<FinalePick | null> {
  return JSON.parse((await deps.store.getText(pickKey(n))) ?? 'null') as FinalePick | null;
}
/** The board of a finale's seven hours (ten lines at most). Throws when it cannot be read. */
async function boardOf(deps: JackpotDeps, pick: FinalePick, week: NumberedWeek): Promise<Entry[]> {
  const window = finaleWindow(week);
  if (!window) return [];
  const r = await deps.fetch(`${pick.origin}/api/v1/games/${pick.appId}/scoring/leaderboard?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${pick.title}: HTTP ${r.status}`);
  return ((await r.json()) as { entries?: Entry[] }).entries ?? [];
}
/** The top 5 of a finale's seven hours. Throws when the board cannot be read. */
const winnersOf = async (deps: JackpotDeps, pick: FinalePick, week: NumberedWeek): Promise<Winner[]> => topFive(await boardOf(deps, pick, week), pick.artistWallet);

/** The week from the sources. Strict: a report or a board that cannot be read throws, so no week is ever kept with a hole in it. */
async function planOf(deps: JackpotDeps, week: NumberedWeek, opts: { strict: boolean; everyGame: boolean }): Promise<Plan> {
  const client = clientOf({ fetch: deps.fetch, token: deps.token });
  if (!client) throw new Error('no RARE_PROFILE_TOKEN');
  const usage = await usageOf(client, Date.parse(week.from), Math.min(Date.parse(week.to), deps.now() + 1));
  const credits = Object.fromEntries(Object.entries(usage.games).map(([id, g]) => [id, g.credits]));
  const games = await readGames(deps.games as GamesStore);
  const wanted = games.filter((g) => (credits[g.appId] ?? 0) > 0 || (opts.everyGame && g.status === 'live'));
  const bests = Object.fromEntries(await Promise.all(wanted.map(async (g): Promise<[string, Best | null]> => {
    try { return [g.appId, await bestOf(deps.fetch, g, week)]; } catch (error) { if (opts.strict) throw error; return [g.appId, null]; }
  })));
  const pick = opts.strict && deps.finale ? await readPick(deps, week.n) : null;   // a closed week carries its finale
  return buildPlan(week, credits, games, bests, opts.everyGame, pick ? { pick, winners: await winnersOf(deps, pick, week), prizeWei: FINALE_WEI } : undefined);
}

const keyOf = (n: number): string => `week-${n}.json`;
async function readWeek(deps: JackpotDeps, n: number): Promise<WeekRecord | null> {
  return JSON.parse((await deps.store.getText(keyOf(n))) ?? 'null') as WeekRecord | null;
}
const saveWeek = (deps: JackpotDeps, r: WeekRecord): Promise<void> => deps.store.set(keyOf(r.plan.n), JSON.stringify(r));
async function computeWeek(deps: JackpotDeps, week: NumberedWeek): Promise<WeekRecord> {
  const record: WeekRecord = { plan: await planOf(deps, week, { strict: true, everyGame: false }), status: 'due', computedAt: new Date(deps.now()).toISOString() };
  await saveWeek(deps, record);
  return record;
}

/** Every closed week, newest first; one that cannot be calculated yet says why. */
async function allWeeks(deps: JackpotDeps): Promise<(WeekRecord | { n: number; error: string })[]> {
  const weeks = await Promise.all(closedWeeks(deps.now()).map(async (w) => {
    try { return await readWeek(deps, w.n) ?? await computeWeek(deps, w); }
    catch (error) { return { n: w.n, error: error instanceof Error ? error.message.slice(0, 160) : 'unreadable' }; }
  }));
  return weeks.reverse();
}

/** The scheduled pass: the closed weeks, and the week so far (the last good earnings stay if the sources fail). */
export async function refreshJackpot(deps: JackpotDeps): Promise<void> {
  await allWeeks(deps);
  await writeEarnings(deps);
}
async function writeEarnings(deps: JackpotDeps): Promise<string> {
  const body = JSON.stringify(earningsOf(await planOf(deps, numberedWeek(deps.now()), { strict: false, everyGame: true }), new Date(deps.now()).toISOString()));
  await deps.store.set('earnings.json', body);
  return body;
}

export async function handleEarnings(deps: JackpotDeps): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const body = await deps.store.getText('earnings.json') ?? await writeEarnings(deps);
    return new Response(body, { headers: { ...headers, 'Cache-Control': 'public, max-age=60', 'Netlify-CDN-Cache-Control': 'public, s-maxage=60' } });
  } catch {
    return new Response(JSON.stringify({ error: 'not ready' }), { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
  }
}

export type LiveGame = { slug: string; title: string; artist: string; origin: string };
export type LiveFinale = { state: 'before' | 'live' | 'after'; n: number; from: string; to: string; game: LiveGame | null; bonus: string | null; places: number; prizesEth: string[]; top: FinaleRow[]; next: { from: string; to: string; game: LiveGame | null } | null };
export type LiveDoc = { updatedAt: string; week: NumberedWeek; plays: number; finaleEth: string; addEth: string; finale: LiveFinale | null; welcomeLeft: number };
const gameOf = (pick: FinalePick | null): LiveGame | null => (pick ? { slug: pick.slug, title: pick.title, artist: pick.artist, origin: pick.origin } : null);
export const WELCOME_CAP = 100;                                 // new wallets a week (cards/src/credits-service.ts)
export const welcomeKey = (n: number): string => `welcome-week-${n}.json`;

/** The hub's document, from the sources: the week's plays (credits played, SuperRare's usage report) and the FINALE block. */
async function readLive(deps: JackpotDeps): Promise<LiveDoc> {
  const client = clientOf({ fetch: deps.fetch, token: deps.token }), now = deps.now(), week = numberedWeek(now);
  if (!client && !deps.plays) throw new Error('no RARE_PROFILE_TOKEN');
  const plays = client ? (await usageOf(client, Date.parse(week.from), Math.min(Date.parse(week.to), now + 1))).total.credits : await (deps.plays as () => Promise<number>)();
  const previous = week.n > 1 ? numberedWeek(Date.parse(week.from) - 1) : null;
  const [pick, last, count] = await Promise.all([readPick(deps, week.n), previous ? readPick(deps, previous.n) : null, deps.store.getText(welcomeKey(week.n))]);
  const welcomeLeft = Math.max(0, WELCOME_CAP - (Number(count) || 0));
  if (!deps.finale) return { updatedAt: new Date(now).toISOString(), week, plays, finaleEth: '0', addEth: playsEth(plays), welcomeLeft, finale: null };
  const stage = finaleStage(now, week, previous, Boolean(last));
  const shown = stage === 'after' ? previous as NumberedWeek : week, chosen = stage === 'after' ? last : pick, window = finaleWindow(shown);
  if (!window) throw new Error('no finale this week');
  let top: FinaleRow[] = [];
  if (stage === 'after') {
    const kept = await readWeek(deps, shown.n);
    top = rowsOf(kept?.plan.finale?.winners ?? await winnersOf(deps, last as FinalePick, shown));
  } else if (stage === 'live' && pick) top = rowsOf(await winnersOf(deps, pick, week).catch(() => []));
  const coming = finaleWindow(week);
  return {
    updatedAt: new Date(now).toISOString(), week, plays, finaleEth: '0.1000', addEth: playsEth(plays), welcomeLeft,
    finale: { state: stage, n: shown.n, ...window, game: gameOf(chosen), bonus: chosen?.bonus ?? null, places: PLACES, prizesEth: PRIZES_WEI.map(ethOf), top, next: stage === 'after' && coming ? { ...coming, game: gameOf(pick) } : null },
  };
}

/** GET /finale.json. The last good document if a source fails; nothing but an error if there is none. */
export async function handleFinale(deps: JackpotDeps): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const body = JSON.stringify(await readLive(deps));
    await deps.store.set('live.json', body);
    return new Response(body, { headers: { ...headers, 'Cache-Control': 'public, max-age=15', 'Netlify-CDN-Cache-Control': 'public, s-maxage=20' } });
  } catch {
    const last = await deps.store.getText('live.json').catch(() => null);
    if (last) return new Response(last, { headers: { ...headers, 'Cache-Control': 'public, max-age=15' } });
    return new Response(JSON.stringify({ error: 'not ready' }), { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
  }
}

/** The admin page's FINALE section: the finale just closed (its top 10 as CSV), this week and the three to come, each with its game
 *  and its bonus line; a finale that has started stays as it is. */
async function adminFinale(deps: JackpotDeps, body: Record<string, unknown>, admin: string): Promise<{ status: number; body: unknown }> {
  const now = deps.now(), weeks: NumberedWeek[] = [numberedWeek(now)];
  for (let i = 0; i < 3; i++) weeks.push(numberedWeek(Date.parse((weeks[i] as NumberedWeek).to)));
  const last = closedWeeks(now).at(-1);
  if (body.action === 'finale-top10') {
    const week = closedWeeks(now).find((w) => w.n === body.week), pick = week ? await readPick(deps, week.n) : null;
    if (!week || !pick || !finaleWindow(week)) return { status: 400, body: { error: 'No finale closed for that week.' } };
    let rows: TopRow[];
    try { rows = topTen(await boardOf(deps, pick, week), pick.artistWallet); } catch { return { status: 502, body: { error: 'The finale\'s board cannot be read right now: try again.' } }; }
    return { status: 200, body: { ok: true, n: week.n, title: pick.title, rows, csv: csvOf(rows) } };
  }
  const games = await readGames(deps.games as GamesStore), offered = candidates(games);
  const open = (w: NumberedWeek): boolean => { const window = finaleWindow(w); return Boolean(window) && now < Date.parse((window as { from: string }).from); };
  if (body.action === 'finale-pick') {
    const week = weeks.find((w) => w.n === body.week);
    if (!week) return { status: 400, body: { error: 'Not a week to come.' } };
    if (!open(week)) return { status: 409, body: { error: 'This finale has started: its game stays.' } };
    if (body.appId === '') await deps.store.set(pickKey(week.n), 'null');
    else {
      const game = offered.find((g) => g.appId === body.appId);
      if (!game) return { status: 400, body: { error: 'Not an artist\'s live game with a wallet.' } };
      const bonus = typeof body.bonus === 'string' ? body.bonus.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
      const pick: FinalePick = { n: week.n, appId: game.appId, slug: game.slug, title: game.title, origin: game.origin, artist: game.artist.name, artistWallet: (game.payoutWallet as string).toLowerCase(), by: admin, at: new Date(now).toISOString(), ...(bonus ? { bonus } : {}) };
      await deps.store.set(pickKey(week.n), JSON.stringify(pick));
    }
  }
  const shown = last && finaleWindow(last) ? [last, ...weeks] : weeks;
  const rows = await Promise.all(shown.map(async (w) => ({ n: w.n, from: finaleWindow(w)?.from ?? null, to: w.to, open: open(w), closed: Date.parse(w.to) <= now, pick: await readPick(deps, w.n) })));
  return { status: 200, body: { ok: true, finales: rows, offered: offered.map((g) => ({ appId: g.appId, title: g.title, artist: g.artist.name })) } };
}

type Tx = { from?: string; to?: string; value?: string; input?: string };
type Receipt = { status?: string };
export type Payment = { state: 'unseen' | 'pending' | 'reverted' } | { state: 'wrong'; why: string } | { state: 'paid'; wall: string };

/** What the chain says of a hash, against the week's plan. */
export async function readPayment(deps: Pick<JackpotDeps, 'rpc'>, plan: Plan, hash: string): Promise<Payment> {
  const tx = await deps.rpc('eth_getTransactionByHash', [hash]) as Tx | null;
  if (!tx) return { state: 'unseen' };
  const receipt = await deps.rpc('eth_getTransactionReceipt', [hash]) as Receipt | null;
  if (!receipt) return { state: 'pending' };
  if (receipt.status !== '0x1') return { state: 'reverted' };
  if (tx.from?.toLowerCase() !== TREASURY) return { state: 'wrong', why: 'not sent by the treasury' };
  if (tx.to?.toLowerCase() !== DISPERSE) return { state: 'wrong', why: 'not a Disperse payment' };
  if (BigInt(tx.value ?? '0') !== BigInt(plan.sendWei)) return { state: 'wrong', why: 'the amount is not the week\'s' };
  let sent;
  try { sent = decodeDisperse(tx.input ?? ''); } catch { return { state: 'wrong', why: 'not a Disperse payment' }; }
  const rest = sent.map((l) => ({ wallet: l.wallet.toLowerCase(), wei: l.wei }));
  for (const line of plan.lines) {
    const i = rest.findIndex((l) => l.wallet === line.wallet && l.wei === BigInt(line.wei));
    if (i < 0) return { state: 'wrong', why: `${line.name} is missing or wrong` };
    rest.splice(i, 1);
  }
  const wall = rest[0];
  if (rest.length !== 1 || !wall || wall.wei !== BigInt(plan.wallWei)) return { state: 'wrong', why: 'the wall\'s line is missing or wrong' };
  return { state: 'paid', wall: wall.wallet };
}

/** MARK PAID: a week paid by hand, outside PAY. Each hash must be a mined, successful transaction; the amounts are the admin's. */
async function markManual(deps: JackpotDeps, record: WeekRecord, body: Record<string, unknown>, admin: string, done: () => Promise<{ status: number; body: unknown }>): Promise<{ status: number; body: unknown }> {
  if (record.status === 'sent') return { status: 409, body: { error: 'A PAY is on its way for this week: wait for it, or forget it first.' } };
  const hashes = [...new Set((Array.isArray(body.hashes) ? body.hashes : []).map((h) => String(h).trim().toLowerCase()).filter(Boolean))];
  if (!hashes.length || hashes.length > 20 || !hashes.every((h) => /^0x[0-9a-f]{64}$/.test(h))) return { status: 400, body: { error: 'hashes: 1 to 20, each 0x and 64 hex digits' } };
  for (const hash of hashes) {
    let receipt: Receipt | null;
    try { receipt = await deps.rpc('eth_getTransactionReceipt', [hash]) as Receipt | null; } catch { return { status: 502, body: { error: 'The chain cannot be read right now. Nothing changed: try again.' } }; }
    if (receipt?.status !== '0x1') return { status: 400, body: { error: `${hash.slice(0, 10)}…: ${receipt ? 'reverted' : 'not mined'}. Nothing changed.` } };
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
  await saveWeek(deps, { ...record, status: 'paid', manual: true, hashes, by: admin, paidAt: new Date(deps.now()).toISOString(), ...(note ? { note } : {}) });
  return done();
}

/** The admin page's jackpot actions. */
export async function adminJackpot(deps: JackpotDeps, body: Record<string, unknown>, admin: string): Promise<{ status: number; body: unknown }> {
  const done = async (): Promise<{ status: number; body: unknown }> => ({ status: 200, body: { ok: true, weeks: await allWeeks(deps), treasury: TREASURY, disperse: DISPERSE } });
  if (body.action === 'jackpot') return done();
  if (typeof body.action === 'string' && body.action.startsWith('finale')) return adminFinale(deps, body, admin);
  const week = closedWeeks(deps.now()).find((w) => w.n === body.week);
  if (!week) return { status: 400, body: { error: 'no such closed week' } };
  const record = await readWeek(deps, week.n);
  if (body.action === 'jackpot-recompute') {
    if (record && record.status !== 'due') return { status: 409, body: { error: 'A payment went out for this week: it cannot be calculated again.' } };
    try { await computeWeek(deps, week); } catch (error) { return { status: 502, body: { error: `Not recalculated: ${error instanceof Error ? error.message : 'the sources failed'}` } }; }
    return done();
  }
  if (!record) return { status: 404, body: { error: 'This week has not been calculated yet.' } };
  if (record.status === 'paid') return { status: 409, body: { error: 'This week is already paid.' } };
  if (body.action === 'jackpot-manual') return markManual(deps, record, body, admin, done);
  const hash = body.action === 'jackpot-clear' ? record.hash ?? '' : typeof body.hash === 'string' ? body.hash.trim().toLowerCase() : '';
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return { status: 400, body: { error: 'hash: 0x and 64 hex digits' } };
  const others = await Promise.all(closedWeeks(deps.now()).filter((w) => w.n !== week.n).map((w) => readWeek(deps, w.n)));
  if (others.some((r) => r?.hash === hash || r?.hashes?.includes(hash))) return { status: 409, body: { error: 'This hash already paid another week.' } };
  let payment: Payment;
  try { payment = await readPayment(deps, record.plan, hash); } catch { return { status: 502, body: { error: 'The chain cannot be read right now. Nothing changed: try again.' } }; }
  if (body.action === 'jackpot-clear') {
    if (payment.state === 'pending' || payment.state === 'paid') return { status: 409, body: { error: 'This transaction is on its way or mined: it cannot be forgotten.' } };
    const { hash: _h, sentAt: _s, wall: _w, ...rest } = record;
    await saveWeek(deps, { ...rest, status: 'due', note: `${hash} forgotten by ${admin}` });
    return done();
  }
  if (payment.state === 'wrong') return { status: 400, body: { error: `Not this week's payment: ${payment.why}.` } };
  if (payment.state === 'reverted') {
    const { hash: _h, sentAt: _s, wall: _w, ...rest } = record;
    await saveWeek(deps, { ...rest, status: 'due', note: `${hash} reverted: nothing was paid` });
    return done();
  }
  const at = new Date(deps.now()).toISOString();
  await saveWeek(deps, payment.state === 'paid'
    ? { ...record, status: 'paid', hash, wall: payment.wall, by: admin, paidAt: at, sentAt: record.sentAt ?? at }
    : { ...record, status: 'sent', hash, by: admin, sentAt: record.sentAt ?? at });
  return done();
}
