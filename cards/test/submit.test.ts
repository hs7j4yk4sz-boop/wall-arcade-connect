// SUBMIT YOUR GAME (src/submit.ts, src/games.ts): games.json and its seed, each check green and red, the attach, the
// admin page's wallet, /games.json for the hub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAdmin, GROUP_ID, liveGames, newest, parseGames, readGames, SEED, type Game, type GamesStore } from '../src/games.js';
import { CONNECT_SESSION, handleAdmin, handleGames, handleSubmit, mailOf, runChecks, secretsIn, type SubmitDeps } from '../src/submit.js';
import { shootGame } from '../src/shot.js';
import { groupOf } from '../src/group.js';

const HUB = 'https://6972mvu4.srstudio.dev';
const GAME = 'https://abcd1234.srstudio.dev', APP = '0f0f0f0f-1111-4222-8333-444455556666';
const HOLDER = '0xaaaa000000000000000000000000000000000342', STRANGER = '0xbbbb000000000000000000000000000000000001', JOHN = '0xcccc000000000000000000000000000000000001';
const CREDIT = '<p class="credit"><a href="https://onthewall.nfcsummit.com">A Remix The Wall experiment · NFC Summit 2027 · Lisbon</a></p>';

function memory(): GamesStore & { data: Map<string, string | Uint8Array> } {
  const data = new Map<string, string | Uint8Array>();
  return {
    data,
    getText: async (k) => { const v = data.get(k); return typeof v === 'string' ? v : null; },
    getBytes: async (k) => { const v = data.get(k); return v instanceof Uint8Array ? v : null; },
    set: async (k, v) => { data.set(k, v); },
  };
}
/** The world as the service sees it: Connect sessions, an artist's game (its files, changeable per test), the wall. */
function world(site: Record<string, { status?: number; body: string }> = {}) {
  const files: Record<string, { status?: number; body: string }> = {
    '/': { body: `<!doctype html><title>KART · THE WALL ARCADE</title>${CREDIT}` },
    '/config.json': { body: JSON.stringify({ appId: APP, groupId: GROUP_ID, appOrigin: GAME, apiUrl: 'https://api.superrare.com' }) },
    '/scoring-config.json': { body: '{}' },
    [`/api/v1/games/${APP}/scoring/leaderboard`]: { body: '{"entries":[]}' },
    ...site,
  };
  const sessions: Record<string, string> = { 'tok-holder': HOLDER, 'tok-stranger': STRANGER, 'tok-john': JOHN };
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === CONNECT_SESSION) {
      const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
      const address = sessions[token];
      return Response.json(address ? { data: { authenticated: true, session: { sessionId: token, userId: 'u', address: address.toUpperCase().replace('0X', '0x'), expiresAt: '2026-11-01T00:00:00Z' } } } : { data: { authenticated: false } });
    }
    if (url.startsWith(GAME)) { const f = files[url.slice(GAME.length)]; return new Response(f?.body ?? 'App not found', { status: f ? f.status ?? 200 : 404 }); }
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  const people = JSON.stringify([{ panel: 342, name: 'KARP', handle: 'johnkarp', wallet: HOLDER, sprite: null, updatedAt: null },
    { panel: 18, name: 'BULLY-MEOW', handle: null, wallet: '0xdddd000000000000000000000000000000000018', sprite: null, updatedAt: null }]);
  const games = memory(), attached: string[] = [], shot: string[] = [], mailed: Game[] = [];
  let refuse: string | null = null;
  const deps: SubmitDeps = {
    fetch: fetchImpl, now: () => Date.parse('2026-10-29T10:00:00Z'), games, people: { getText: async (k) => (k === 'people.json' ? people : null) },
    groupApps: async () => SEED.map((g) => g.appId),
    attach: async ({ appId, origin }) => { if (refuse) throw new Error(refuse); attached.push(`${appId} ${origin}`); },
    shoot: async (appId) => { shot.push(appId); }, notify: async (g) => { mailed.push(g); }, admins: [JOHN],
  };
  return { deps, files, games, attached, shot, mailed, refuseWith: (r: string | null) => { refuse = r; } };
}
const form = (over: Record<string, unknown> = {}) => ({ accessToken: 'tok-holder', origin: `${GAME}/`, appId: APP, title: 'Wall Kart 2', line: 'Race the names around the wall.', payoutWallet: HOLDER, panel: 342, agree: true, ...over });
const post = (deps: SubmitDeps, path: string, body: unknown, origin = HUB): Promise<Response> =>
  (path === '/api/admin' ? handleAdmin : handleSubmit)(new Request(`https://cards.test${path}`, { method: 'POST', body: JSON.stringify(body), headers: { origin, 'content-type': 'application/json' } }), deps);

test('games.json: seeded on the first read with our games and the five known, one list for the hub', async () => {
  const store = memory();
  const games = await readGames(store);
  assert.equal(store.data.has('games.json'), true, 'written once read');
  assert.deepEqual(games.map((g) => [g.slug, g.status]), [['unbreakable', 'live'], ['full-row', 'live'], ['dirty-signals-radio', 'live'], ['the-morning-brew', 'live'], ['wall-kart', 'pending'], ['tap-the-name', 'hidden']]);
  assert.deepEqual(liveGames(games).map((g) => g.title), ['UNBREAKABLE', 'FULL ROW', 'Dirty Signals Radio', 'THE MORNING BREW']);
  assert.equal(newest(games), '1c10c96c-bf88-471c-88af-7f23a992a7ea', 'NEW: THE MORNING BREW, published last');
  assert.equal(games.find((g) => g.slug === 'the-morning-brew')?.payoutWallet, '0x41b199A5194c58b29559A482E919331E1c8EEF85');
  const res = await handleGames(new Request('https://cards.test/games.json'), { games: store });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(((await res.json()) as Game[]).length, 6);
  assert.equal(parseGames('[{"appId":"x","origin":"https://a.srstudio.dev"},{"appId":"0f0f0f0f-1111-4222-8333-444455556666","origin":"javascript:x"}]')?.length, 0, 'odd entries dropped');
});

test('the card service lets in the pages and games of games.json, the seed before it is written, ours always', async () => {
  let file: string | null = null;
  const group = groupOf({ getText: async () => file });
  assert.ok((await group()).origins.has('https://k6ag9vxz.srstudio.dev'), 'the seed');
  assert.ok((await group()).origins.has('https://thewallarcade.superrare.com'), "the hub's own domain");
  file = JSON.stringify([...SEED, { ...SEED[4], appId: APP, origin: GAME }]);
  const later = groupOf({ getText: async () => file });
  assert.ok((await later()).origins.has(GAME));
  assert.ok((await later()).apps.some((a) => a.id === APP));
});

test('every check green: attached at 1 credit, recorded pending (not on the hub), captured, John mailed', async () => {
  const w = world();
  const res = await post(w.deps, '/api/submit', form());
  const body = await res.json() as { ok: boolean; checks: { n: number; ok: boolean; label: string }[]; game: { status: string; attached: boolean } };
  assert.equal(res.headers.get('access-control-allow-origin'), HUB);
  assert.equal(body.ok, true, JSON.stringify(body.checks));
  assert.deepEqual(body.checks.map((c) => [c.n, c.ok]), [[1, true], [2, true], [3, true], [4, true], [5, true], [6, true], [7, true], [8, true]]);
  assert.equal(body.checks[0]?.label, 'Your name on the wall: KARP, panel 342');
  assert.deepEqual(w.attached, [`${APP} ${GAME}`]);
  const game = (await readGames(w.games)).find((g) => g.appId === APP) as Game;
  assert.deepEqual([game.status, game.slug, game.artist.name, game.artist.panel, game.payoutWallet, game.by, game.attachedAt], ['pending', 'wall-kart-2', 'KARP', 342, HOLDER, HOLDER, '2026-10-29T10:00:00.000Z']);
  assert.deepEqual(liveGames(await readGames(w.games)).map((g) => g.appId).includes(APP), false, 'nothing on the hub without the click');
  assert.deepEqual(w.shot, [APP]);
  assert.deepEqual(w.mailed.map((g) => g.title), ['Wall Kart 2']);
  const mail = mailOf(game);
  assert.match(mail.subject, /Wall Kart 2 by KARP \(panel 342\)/);
  assert.match(mail.html, /admin\.html\?app=0f0f0f0f/);
  // the same game again: check 8
  const again = await (await post(w.deps, '/api/submit', form())).json() as { ok: boolean; checks: { n: number; ok: boolean; fix?: string }[] };
  assert.equal(again.ok, false);
  assert.match(again.checks.find((c) => c.n === 8)?.fix ?? '', /Already submitted: Wall Kart 2, waiting for John's test play/);
});

test('each check red, with its remedy', async () => {
  const red = async (w: ReturnType<typeof world>, over: Record<string, unknown> = {}) => {
    const body = await (await post(w.deps, '/api/submit', form(over))).json() as { ok: boolean; checks: { n: number; ok: boolean | null; fix?: string }[] };
    assert.equal(body.ok, false);
    assert.deepEqual(w.attached, [], 'never attached');
    return (n: number) => body.checks.find((c) => c.n === n) as { ok: boolean | null; fix?: string };
  };
  // 1: no name on the wall (a stranger's session)
  let c = await red(world(), { accessToken: 'tok-stranger', panel: null });
  assert.equal(c(1).ok, false); assert.match(c(1).fix ?? '', /Your name on the wall is the ticket/);
  // 2: a path, another host, a page that does not answer
  c = await red(world(), { origin: `${GAME}/play` });
  assert.equal(c(2).ok, false); assert.match(c(2).fix ?? '', /srstudio\.dev origin, no path/); assert.equal(c(3).ok, null, 'cannot run yet');
  c = await red(world(), { origin: 'https://evil.example' });
  assert.equal(c(2).ok, false);
  c = await red(world({ '/': { status: 404, body: 'App not found' } }));
  assert.equal(c(2).ok, false); assert.match(c(2).fix ?? '', /HTTP 404/);
  assert.deepEqual([3, 4, 5, 6, 7].map((n) => c(n).ok), [null, null, null, null, null], 'the address first, nothing else in red');
  // 3: another group, another app id, no config.json
  c = await red(world({ '/config.json': { body: JSON.stringify({ appId: APP, groupId: '11111111-1111-4111-8111-111111111111' }) } }));
  assert.equal(c(3).ok, false); assert.match(c(3).fix ?? '', /groupId is 60faaf46/);
  c = await red(world({ '/config.json': { body: JSON.stringify({ appId: '99999999-1111-4222-8333-444455556666', groupId: GROUP_ID }) } }));
  assert.match(c(3).fix ?? '', /appId in config\.json differs/);
  c = await red(world({ '/config.json': { status: 404, body: 'no' } }));
  assert.equal(c(3).ok, false); assert.equal(c(4).ok, null);
  // 4: a secret in config.json
  c = await red(world({ '/config.json': { body: JSON.stringify({ appId: APP, groupId: GROUP_ID, studio: { apiKey: 'x' }, other: 'slk_abc' }) } }));
  assert.equal(c(4).ok, false); assert.match(c(4).fix ?? '', /Remove secrets from config\.json \(studio\.apiKey, other\)/);
  // 5: not server-scored
  c = await red(world({ '/scoring-config.json': { status: 404, body: '' } }));
  assert.equal(c(5).ok, false); assert.match(c(5).fix ?? '', /must be server-scored/);
  // 6: no credit line, or not linked
  c = await red(world({ '/': { body: '<title>x</title>A Remix The Wall experiment' } }));
  assert.equal(c(6).ok, false); assert.match(c(6).fix ?? '', /credit line, linked/);
  // 7: the leaderboard
  c = await red(world({ [`/api/v1/games/${APP}/scoring/leaderboard`]: { status: 404, body: '' } }));
  assert.equal(c(7).ok, false); assert.match(c(7).fix ?? '', /--max-attempts/);
  // 8: an app already in the group, by hand
  const inGroup = world(); inGroup.deps.groupApps = async () => [APP];
  c = await red(inGroup);
  assert.equal(c(8).ok, false); assert.match(c(8).fix ?? '', /Already attached/);
  assert.deepEqual(secretsIn({ a: [{ token: 1 }], b: 'fine' }), ['a[0].token']);
});

test('the form and the session first: a bad field is 400, no session 401, another site 403', async () => {
  const w = world();
  const bad = await post(w.deps, '/api/submit', form({ title: 'x'.repeat(25), agree: false }));
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(((await bad.json()) as { errors: object }).errors).sort(), ['agree', 'title']);
  assert.equal((await post(w.deps, '/api/submit', form({ accessToken: 'stolen?' }))).status, 401);
  assert.equal((await post(w.deps, '/api/submit', form(), 'https://evil.example')).status, 403);
  const names = await (await post(w.deps, '/api/submit', { accessToken: 'tok-holder', step: 'names' })).json();
  assert.deepEqual(names, { wallet: HOLDER, names: [{ name: 'KARP', panel: 342, handle: 'johnkarp' }] });
  assert.deepEqual(await (await post(w.deps, '/api/submit', { accessToken: 'tok-stranger', step: 'names' })).json(), { wallet: STRANGER, names: [] });
});

test('the group refuses the attach: recorded all the same, with its reason, and ATTACH again from the admin page', async () => {
  const w = world();
  w.refuseWith('403 forbidden: scope');
  const body = await (await post(w.deps, '/api/submit', form())).json() as { ok: boolean; game: { attached: boolean } };
  assert.deepEqual([body.ok, body.game.attached], [true, false]);
  assert.equal((await readGames(w.games)).find((g) => g.appId === APP)?.attachError, '403 forbidden: scope');
  w.refuseWith(null);
  const again = await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'attach', appId: APP });
  assert.equal(again.status, 200);
  const game = (await readGames(w.games)).find((g) => g.appId === APP) as Game;
  assert.deepEqual([game.attachError, game.attachedAt], [undefined, '2026-10-29T10:00:00.000Z']);
});

test("the admin page: a wallet not in ADMIN_WALLET is refused; John's click puts it on the hub, last, NEW", async () => {
  const w = world();
  await post(w.deps, '/api/submit', form());
  for (const token of ['tok-holder', 'tok-stranger']) {
    const no = await post(w.deps, '/api/admin', { accessToken: token, action: 'publish', appId: APP });
    assert.equal(no.status, 403);
  }
  assert.equal((await post(w.deps, '/api/admin', { accessToken: 'nobody', action: 'whoami' })).status, 401);
  const none = world(); none.deps.admins = [];
  assert.equal((await post(none.deps, '/api/admin', { accessToken: 'tok-john', action: 'whoami' })).status, 403, 'no ADMIN_WALLET: no one');
  assert.equal((await readGames(w.games)).find((g) => g.appId === APP)?.status, 'pending');
  const me = await (await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'whoami' })).json() as { admin: boolean; games: Game[] };
  assert.equal(me.admin, true);
  const res = await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'publish', appId: APP });
  assert.equal(res.status, 200);
  const games = await readGames(w.games);
  assert.deepEqual(liveGames(games).map((g) => g.slug), ['unbreakable', 'full-row', 'dirty-signals-radio', 'the-morning-brew', 'wall-kart-2']);
  assert.equal(newest(games), APP);
  // the order of the columns, HIDE, EDIT
  const order = [APP, ...liveGames(games).filter((g) => g.appId !== APP).map((g) => g.appId)];
  await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'order', appIds: order });
  assert.equal(liveGames(await readGames(w.games))[0]?.appId, APP);
  assert.equal((await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'order', appIds: [APP] })).status, 400);
  await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'hide', appId: APP });
  assert.equal(liveGames(await readGames(w.games)).some((g) => g.appId === APP), false);
  // WALL KART (by hand, its artist unknown): no click until it is named
  const kart = '5444a563-cba8-418c-9add-f367140c9511';
  const blocked = await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'publish', appId: kart });
  assert.equal(blocked.status, 400);
  assert.match(((await blocked.json()) as { error: string }).error, /name the artist/);
  assert.equal((await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'edit', appId: kart, fields: { artistName: 'Someone', panel: 7, line: 'Kart around the wall.' } })).status, 200);
  assert.equal((await post(w.deps, '/api/admin', { accessToken: 'tok-john', action: 'publish', appId: kart })).status, 200);
  assert.ok(liveGames(await readGames(w.games)).some((g) => g.appId === kart));
  assert.deepEqual(applyAdmin(SEED, { action: 'edit', appId: kart, fields: { payoutWallet: 'nope' } }, 0), { error: 'payout wallet: 0x and 40 hex digits' });
});

test('the capture lands in the store and in games.json', async () => {
  const store = memory();
  await readGames(store);
  const kart = '5444a563-cba8-418c-9add-f367140c9511', asked: string[] = [];
  assert.equal(await shootGame(store, kart, async (url) => { asked.push(url); return new Uint8Array([137, 80, 78, 71]); }), true);
  assert.deepEqual(asked, ['https://wxrb8y3y.srstudio.dev/']);
  assert.equal((await readGames(store)).find((g) => g.appId === kart)?.shot, `/games/${kart}.png`);
  const png = await handleGames(new Request(`https://cards.test/games/${kart}.png`), { games: store });
  assert.deepEqual([png.status, png.headers.get('content-type')], [200, 'image/png']);
  assert.equal(await shootGame(store, APP, async () => new Uint8Array()), false, 'not a game of games.json');
  assert.equal(await shootGame(store, kart, async () => { throw new Error('no chromium\n    at x\nCall log:'); }), false);
  assert.equal((await readGames(store)).find((g) => g.appId === kart)?.shotError, 'no chromium', 'the reason, for the admin page');
});

test('runChecks reads games.json for check 8 (the five known are there)', async () => {
  const w = world();
  const checks = await runChecks(w.deps, { origin: 'https://k6ag9vxz.srstudio.dev', appId: '1c10c96c-bf88-471c-88af-7f23a992a7ea', title: 'x', line: 'x', payoutWallet: HOLDER, panel: 342, agree: true }, { name: 'KARP', panel: 342 });
  assert.match(checks.find((c) => c.n === 8)?.fix ?? '', /Already submitted: THE MORNING BREW, on the hub/);
});

test('ADD A GAME (a game sent by DM): John only, the same eight checks, the 40% to the wallet holding the name', async () => {
  const w = world();
  const add = (over: Record<string, unknown> = {}, token = 'tok-john') => post(w.deps, '/api/admin', { accessToken: token, action: 'add', name: 'karp', origin: `${GAME}/`, appId: APP, ...over });
  assert.equal((await add({}, 'tok-holder')).status, 403, 'not an admin wallet');
  assert.equal(w.attached.length, 0);

  const missing = await add({ name: '', appId: 'nope' });
  assert.equal(missing.status, 400);
  assert.deepEqual(Object.keys((await missing.json() as { errors: object }).errors).sort(), ['appId', 'name']);

  const nobody = await (await add({ name: 'NOBODY' })).json() as { ok: boolean; checks: { n: number; ok: boolean; fix?: string }[] };
  assert.equal(nobody.ok, false);
  assert.match(nobody.checks[0]?.fix ?? '', /No name on the wall is "NOBODY"/);
  assert.ok(nobody.checks.slice(1).every((c) => c.ok), 'the game itself is fine');

  w.files['/'] = { body: '<title>KART</title><p>no credit</p>' };
  const red = await (await add()).json() as { ok: boolean; checks: { n: number; ok: boolean }[] };
  assert.deepEqual(red.checks.filter((c) => !c.ok).map((c) => c.n), [6]);
  assert.equal(w.attached.length, 0, 'nothing attached while a check is red');

  w.files['/'] = { body: `<!doctype html><title>WALL TAGGER 2000 · THE WALL ARCADE</title>${CREDIT}` };
  const r = await add({ name: '#342' });
  const body = await r.json() as { ok: boolean; game: Game; games: Game[] };
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(w.attached, [`${APP} ${GAME}`]);
  assert.deepEqual(w.shot, [APP]);
  assert.equal(w.mailed.length, 0, 'no mail: John added it');
  assert.equal(body.game.title, 'WALL TAGGER 2000', "the page's own title");
  assert.equal(body.game.line, '');
  assert.equal(body.game.status, 'pending');
  assert.equal(body.game.payoutWallet, HOLDER.toLowerCase(), 'the 40% to the wallet holding KARP');
  assert.deepEqual(body.game.artist, { name: 'KARP', panel: 342, handle: 'johnkarp' });
  assert.equal(body.game.by, JOHN);
  assert.equal(body.games.length, SEED.length + 1);

  // signed otherwise than the wall: EDIT keeps the name on the wall; no line, not on the hub yet
  let games = await readGames(w.games);
  const blocked = applyAdmin(games, { action: 'publish', appId: APP }, 0);
  assert.deepEqual(blocked, { error: 'give it its one line first (EDIT)' });
  games = applyAdmin(games, { action: 'edit', appId: APP, fields: { artistName: 'Karp', line: 'Tag the names.' } }, 0) as Game[];
  assert.deepEqual(games.find((g) => g.appId === APP)?.artist, { name: 'Karp', wall: 'KARP', panel: 342, handle: 'johnkarp' });

  const again = await (await add()).json() as { ok: boolean; checks: { n: number; ok: boolean }[] };
  assert.equal(again.ok, false);
  assert.equal(again.checks.find((c) => c.n === 8)?.ok, false, 'already in games.json');
});
