// SUBMIT YOUR GAME (hub/submit.html) and the admin page (hub/admin.html), independent of Netlify:
//   GET  /games.json          the arcade's games (cards/src/games.ts), public, CORS *, cached 60 s
//   GET  /games/<appId>.png   a game's 1080 × 1080 capture (netlify/functions/games-shot-background.mts)
//   POST /api/submit          an artist's game: who they are (their SuperRare Connect session, checked with SuperRare),
//                             the eight checks below, each green or red with its remedy; all green: attached to the
//                             credit group at 1 credit per play, recorded as pending, captured, John told by mail
//   POST /api/admin           John (a wallet of ADMIN_WALLET, by its Connect session): PUT IT ON THE HUB, HIDE, the
//                             order of the columns, EDIT, ATTACH again, a new capture
// Who is who: the page sends its Connect access token (`accessToken`, the opaque session id the Connect SDK hands out);
// SuperRare answers which wallet it belongs to (GET /v1/connect/session). It is used for that one question and never
// kept. No signature, no transaction, no credit on either page.
import { applyAdmin, APP_ID, AUTO_PUBLISH, freeSlug, GROUP_ID, LIMITS, readGames, SITE, STUDIO_ORIGIN, WALLET, writeGames, type AdminAction, type Game, type GamesStore } from './games.js';
import type { Person } from './people.js';

export const CONNECT_SESSION = 'https://api.superrare.com/v1/connect/session';
export const HUB_ORIGINS = ['https://6972mvu4.srstudio.dev', 'https://thewallarcade.superrare.com'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export type Check = { n: number; ok: boolean | null; label: string; fix?: string };
export type SubmitDeps = {
  fetch: typeof fetch; now(): number; games: GamesStore;
  people: { getText(key: string): Promise<string | null> };
  /** the app ids of the credit group, as /stats last read them; [] if unknown */
  groupApps(): Promise<string[]>;
  /** credit-group add-game, 1 credit per play (the SDK, RARE_PROFILE_TOKEN); throws with the platform's reason */
  attach(game: { appId: string; origin: string }): Promise<void>;
  /** starts the 1080 × 1080 capture (a background function); never throws */
  shoot(appId: string): Promise<void>;
  /** tells John (mail); never throws */
  notify(game: Game): Promise<void>;
  admins: string[];
};

const cors = (origin: string | null): Record<string, string> =>
  origin && (HUB_ORIGINS.includes(origin) || LOCAL.test(origin)) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The wallet a Connect access token belongs to, as SuperRare answers it; null for anyone else. */
export async function walletOf(fetchImpl: typeof fetch, token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 4096 || /\s/.test(token)) return null;
  try {
    const r = await fetchImpl(CONNECT_SESSION, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const body = await r.json() as { data?: { authenticated?: boolean; session?: { address?: string } } };
    const address = body?.data?.session?.address;
    return body?.data?.authenticated === true && typeof address === 'string' && WALLET.test(address) ? address.toLowerCase() : null;
  } catch { return null; }
}

/** The names of the wall a wallet holds (people.json: one object per named panel, its owner). */
export async function namesOf(deps: Pick<SubmitDeps, 'people'>, wallet: string): Promise<{ name: string; panel: number; handle: string | null }[]> {
  const people = JSON.parse((await deps.people.getText('people.json')) ?? '[]') as Person[];
  return people.filter((p) => p.wallet === wallet).map((p) => ({ name: p.name, panel: p.panel, handle: p.handle }));
}

export type Submission = { origin: string; appId: string; title: string; line: string; payoutWallet: string; panel: number | null; agree: boolean };
/** The form as typed: an address with one trailing slash is the same address. */
export function readForm(body: Record<string, unknown>): { form: Submission; errors: Record<string, string> } {
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const form: Submission = {
    origin: s(body.origin).replace(/\/$/, '').toLowerCase(), appId: s(body.appId).toLowerCase(), title: s(body.title), line: s(body.line),
    payoutWallet: s(body.payoutWallet), panel: Number.isInteger(body.panel) ? body.panel as number : null, agree: body.agree === true,
  };
  const errors: Record<string, string> = {};
  if (!form.origin) errors.origin = 'Your game address: https://<host>.srstudio.dev';
  if (!APP_ID.test(form.appId)) errors.appId = 'App ID: the UUID SuperRare Studio gave your app';
  if (!form.title || form.title.length > LIMITS.title) errors.title = `Title: 1 to ${LIMITS.title} characters`;
  if (!form.line || form.line.length > LIMITS.line) errors.line = `One line: 1 to ${LIMITS.line} characters`;
  if (!WALLET.test(form.payoutWallet)) errors.payoutWallet = 'Payout wallet: 0x and 40 hex digits';
  if (!form.agree) errors.agree = 'Tick the box: 1 credit per play, the credit line, one edition';
  return { form, errors };
}

async function get(fetchImpl: typeof fetch, url: string): Promise<{ status: number; text: string }> {
  try {
    const r = await fetchImpl(url, { headers: { 'User-Agent': 'THE WALL ARCADE submit check' }, redirect: 'manual', signal: AbortSignal.timeout(6000) });
    return { status: r.status, text: (await r.text()).slice(0, 500_000) };
  } catch { return { status: 0, text: '' }; }
}
/** A key of config.json that looks like a secret, at any depth: its name says token, secret or key; its value starts slk_. */
export function secretsIn(value: unknown, path = ''): string[] {
  const at = (k: string): string => (path ? `${path}.${k}` : k);
  if (Array.isArray(value)) return value.flatMap((v, i) => secretsIn(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return [...new Set(Object.entries(value).flatMap(([k, v]) => [...(/token|secret|key/i.test(k) ? [at(k)] : []), ...secretsIn(v, at(k))]))];
  return typeof value === 'string' && value.startsWith('slk_') ? [path || '(value)'] : [];
}

/** The eight checks, in order, each with its remedy; a check that cannot run until an earlier one is fixed is null. */
export async function runChecks(deps: Pick<SubmitDeps, 'fetch' | 'games' | 'groupApps'>, form: Submission, holder: { name: string; panel: number } | null): Promise<Check[]> {
  const o = form.origin, okOrigin = STUDIO_ORIGIN.test(o);
  const [page, config, scoring, board] = okOrigin
    ? await Promise.all([get(deps.fetch, `${o}/`), get(deps.fetch, `${o}/config.json`), get(deps.fetch, `${o}/scoring-config.json`), get(deps.fetch, `${o}/api/v1/games/${form.appId}/scoring/leaderboard`)])
    : [null, null, null, null];
  const checks: Check[] = [];
  const add = (n: number, ok: boolean | null, label: string, fix: string): void => { checks.push({ n, ok, label, ...(ok === true ? {} : { fix }) }); };
  const LATER = 'Fix the game address first.';

  add(1, Boolean(holder), holder ? `Your name on the wall: ${holder.name}, panel ${holder.panel}` : 'Your name on the wall',
    'The arcade is for the people of the wall. Your name on the wall is the ticket. Mint closes Friday Oct 30, 3pm Lisbon: https://onthewall.nfcsummit.com');
  const pageOk = page?.status === 200;
  add(2, okOrigin ? pageOk : false, 'Game address answers',
    okOrigin ? `The game address must be your srstudio.dev origin, no path. ${o} answers ${page?.status ? `HTTP ${page.status}` : 'nothing'}: publish it on SuperRare Studio first.` : 'The game address must be your srstudio.dev origin, no path (https://<host>.srstudio.dev).');

  let cfg: Record<string, unknown> | null = null;
  try { cfg = pageOk && config?.status === 200 ? JSON.parse(config.text) as Record<string, unknown> : null; } catch { cfg = null; }
  const reach = okOrigin && pageOk;                            // the address answers: the rest can be checked
  if (!reach) add(3, null, "config.json: the arcade's group, your app ID", LATER);
  else if (!cfg || typeof cfg !== 'object') add(3, false, "config.json: the arcade's group, your app ID", `config.json: not found or not JSON at ${o}/config.json. The ZIP must hold it at its root.`);
  else if (cfg.groupId !== GROUP_ID) add(3, false, "config.json: the arcade's group, your app ID", `config.json: groupId is ${GROUP_ID}, put the arcade's group ID (yours says ${String(cfg.groupId ?? 'nothing').slice(0, 60)}).`);
  else if (cfg.appId !== form.appId) add(3, false, "config.json: the arcade's group, your app ID", `appId in config.json differs: it says ${String(cfg.appId ?? 'nothing').slice(0, 60)}, the form says ${form.appId}.`);
  else add(3, true, "config.json: the arcade's group, your app ID", '');

  const secrets = cfg ? secretsIn(cfg) : [];
  add(4, cfg ? secrets.length === 0 : null, 'No secret in config.json', cfg ? `Remove secrets from config.json (${secrets.slice(0, 4).join(', ')}), then app update. config.json is public.` : reach ? 'config.json first.' : LATER);
  add(5, reach ? scoring?.status === 200 : null, 'scoring-config.json: server-scored', reach ? 'scoring-config.json missing: the game must be server-scored. The ZIP must hold it at its root.' : LATER);
  const credit = pageOk && /remix the wall experiment/i.test(page.text) && /nfcsummit\.com/i.test(page.text);
  add(6, pageOk ? credit : null, "The wall's credit line, linked", pageOk ? 'Add the wall\'s credit line, linked: "A Remix The Wall experiment · NFC Summit 2027 · Lisbon", a link to https://onthewall.nfcsummit.com.' : LATER);
  add(7, reach ? board?.status === 200 : null, 'Leaderboard answers', reach ? `The leaderboard doesn't answer (HTTP ${board?.status || 'none'}): run app update with --max-attempts 10000.` : LATER);

  const games = await readGames(deps.games), group = await deps.groupApps().catch(() => [] as string[]);
  const seen = games.find((g) => g.appId === form.appId || g.origin === o);
  add(8, !seen && !group.includes(form.appId), 'Not submitted yet',
    seen ? `Already submitted: ${seen.title}, ${seen.status === 'pending' ? 'waiting for John\'s test play' : seen.status === 'live' ? 'on the hub' : 'hidden'}.` : 'Already attached to the arcade\'s group: ask John.');
  return checks;
}

export async function handleSubmit(request: Request, deps: SubmitDeps): Promise<Response> {
  const origin = request.headers.get('origin'), h = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, h);
  if (!h['Access-Control-Allow-Origin']) return json({ error: 'from the hub only' }, 403, h);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: 'JSON body' }, 400, h); }
  const wallet = await walletOf(deps.fetch, body.accessToken);
  if (!wallet) return json({ error: 'Sign in again: your SuperRare session is not valid any more.' }, 401, h);
  const names = await namesOf(deps, wallet);
  if (body.step === 'names') return json({ wallet, names }, 200, h);
  const { form, errors } = readForm(body);
  if (Object.keys(errors).length) return json({ ok: false, errors }, 400, h);
  const holder = names.find((n) => n.panel === form.panel) ?? (form.panel === null ? names[0] : undefined) ?? null;
  const checks = await runChecks(deps, form, holder);
  if (!checks.every((c) => c.ok)) return json({ ok: false, checks }, 200, h);

  // all green: attached to the group, recorded, captured, John told
  const now = new Date(deps.now()).toISOString();
  let attachedAt: string | null = now, attachError: string | undefined;
  try { await deps.attach({ appId: form.appId, origin: form.origin }); } catch (error) { attachedAt = null; attachError = error instanceof Error ? error.message.slice(0, 200) : 'attach failed'; }
  const games = await readGames(deps.games);
  if (games.some((g) => g.appId === form.appId || g.origin === form.origin)) return json({ ok: false, checks: checks.map((c) => (c.n === 8 ? { ...c, ok: false, fix: 'Already submitted.' } : c)) }, 200, h);
  const h1 = holder as { name: string; panel: number; handle: string | null };
  const live = AUTO_PUBLISH && attachedAt !== null;
  const game: Game = {
    appId: form.appId, origin: form.origin, slug: freeSlug(form.title, games), title: form.title, line: form.line,
    artist: { name: h1.name, panel: h1.panel, ...(h1.handle ? { handle: h1.handle } : {}) }, payoutWallet: form.payoutWallet,
    submittedAt: now, attachedAt, status: live ? 'live' : 'pending', publishedAt: live ? now : null, shot: null,
    order: Math.max(0, ...games.filter((g) => g.status === 'live').map((g) => g.order)) + 1, by: wallet, ...(attachError ? { attachError } : {}),
  };
  await writeGames(deps.games, [...games, game]);
  await deps.shoot(game.appId);
  await deps.notify(game);
  return json({ ok: true, checks, game: { appId: game.appId, title: game.title, status: game.status, attached: attachedAt !== null } }, 200, h);
}

export async function handleAdmin(request: Request, deps: SubmitDeps): Promise<Response> {
  const origin = request.headers.get('origin'), h = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, h);
  if (!h['Access-Control-Allow-Origin']) return json({ error: 'from the hub only' }, 403, h);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: 'JSON body' }, 400, h); }
  const wallet = await walletOf(deps.fetch, body.accessToken);
  if (!wallet) return json({ error: 'Sign in again.' }, 401, h);
  if (!deps.admins.includes(wallet)) return json({ error: 'Not an admin wallet.', wallet }, 403, h);
  const games = await readGames(deps.games);
  if (body.action === 'whoami') return json({ admin: true, wallet, games }, 200, h);
  const appId = typeof body.appId === 'string' ? body.appId : '';
  if (body.action === 'attach' || body.action === 'shoot') {
    const game = games.find((g) => g.appId === appId);
    if (!game) return json({ error: 'no such game' }, 404, h);
    if (body.action === 'shoot') { await deps.shoot(appId); return json({ ok: true, games }, 200, h); }
    try { await deps.attach({ appId, origin: game.origin }); } catch (error) {
      const next = games.map((g) => (g === game ? { ...g, attachError: error instanceof Error ? error.message.slice(0, 200) : 'attach failed' } : g));
      await writeGames(deps.games, next);
      return json({ error: `The group refused it: ${next.find((g) => g.appId === appId)?.attachError}`, games: next }, 502, h);
    }
    const next = games.map((g) => (g === game ? (({ attachError: _, ...rest }) => ({ ...rest, attachedAt: new Date(deps.now()).toISOString() }))(g) : g));
    await writeGames(deps.games, next);
    return json({ ok: true, games: next }, 200, h);
  }
  const action = (body.action === 'order' ? { action: 'order', appIds: Array.isArray(body.appIds) ? body.appIds.filter((x): x is string => typeof x === 'string') : [] }
    : body.action === 'edit' ? { action: 'edit', appId, fields: (body.fields ?? {}) as Extract<AdminAction, { action: 'edit' }>['fields'] }
    : body.action === 'publish' || body.action === 'hide' ? { action: body.action, appId } : null) as AdminAction | null;
  if (!action) return json({ error: 'action: whoami, publish, hide, order, edit, attach or shoot' }, 400, h);
  const next = applyAdmin(games, action, deps.now());
  if ('error' in next) return json({ error: next.error, games }, 400, h);
  await writeGames(deps.games, next);
  return json({ ok: true, games: next }, 200, h);
}

/** GET /games.json and /games/<appId>.png. */
export async function handleGames(request: Request, deps: Pick<SubmitDeps, 'games'>): Promise<Response> {
  const path = new URL(request.url).pathname, open = { 'Access-Control-Allow-Origin': '*' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...open, 'Access-Control-Allow-Methods': 'GET' } });
  if (path === '/games.json') return new Response(JSON.stringify(await readGames(deps.games)), { headers: { ...open, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
  const shot = /^\/games\/([0-9a-f-]{36})\.png$/.exec(path);
  if (shot) {
    const png = await deps.games.getBytes(`shots/${shot[1]}.png`);
    return png ? new Response(png, { headers: { ...open, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } }) : new Response('not found', { status: 404, headers: open });
  }
  return new Response('not found', { status: 404, headers: open });
}

/** The mail to John for a green submission (Resend's API, RESEND_API_KEY; without it, no mail: the admin page lists it). */
export function mailOf(game: Game, hub = 'https://thewallarcade.superrare.com'): { subject: string; html: string } {
  const e = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  return {
    subject: `SUBMIT YOUR GAME: ${game.title} by ${game.artist.name} (panel ${game.artist.panel ?? '?'})`,
    html: `<p><b>${e(game.title)}</b> by ${e(game.artist.name)}, panel ${game.artist.panel ?? '?'}: every check is green.</p>
<p>${e(game.line)}</p>
<p><img src="${SITE}/games/${game.appId}.png" width="540" height="540" alt="${e(game.title)}"></p>
<p><a href="${e(game.origin)}/">Play it</a> · <a href="${hub}/admin.html?app=${game.appId}">Put it on the hub</a></p>
<p>${game.attachedAt ? 'Attached to the credit group at 1 credit per play.' : `Not attached: ${e(game.attachError ?? '')}. ATTACH again from the admin page.`}
Payout wallet: ${e(game.payoutWallet ?? '')}. Submitted by ${e(game.by ?? '')}.</p>`,
  };
}
