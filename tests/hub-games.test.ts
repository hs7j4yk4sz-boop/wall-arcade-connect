// The hub draws its columns and boards from games.json (cards/src/games.ts): the hub's own functions (the games:start block
// of hub/src.html, the very code scripts/build-hub.ts runs at build), evaluated as written, on the seed and on a game put
// on the hub from the admin page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const hubSource = readFileSync(new URL('../hub/src.html', import.meta.url), 'utf8');
const block = /\/\* games:start[\s\S]*?\/\* games:end \*\//.exec(hubSource)?.[0] ?? '';
type Draw = { gameCards(g: unknown, clips: string[]): string; gameBoards(g: unknown): string; liveGames(g: unknown): { slug: string }[] };
const draw = new Function(`${block}\nreturn { gameCards, gameBoards, liveGames };`)() as Draw;
const seed = JSON.parse(readFileSync(new URL('../cards/games/seed.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
const CLIPS = ['dirty-signals-radio', 'full-row', 'the-morning-brew', 'unbreakable'];
const titles = (html: string): string[] => [...html.matchAll(/<h3>([^<]*)<\/h3><span class="n">(#\d+)<\/span>(<span class="new">NEW<\/span>)?/g)].map((m) => `${m[1]} ${m[2]}${m[3] ? ' NEW' : ''}`);

test('the seed: the four live games in order, NEW on THE MORNING BREW, YOUR GAME HERE last, a clip each', () => {
  const html = draw.gameCards(seed, CLIPS);
  assert.deepEqual(titles(html), ['UNBREAKABLE #01', 'FULL ROW #02', 'DIRTY SIGNALS RADIO #03', 'THE MORNING BREW #04 NEW', 'YOUR GAME HERE #05']);
  assert.equal((html.match(/<video class="shot" src="clips\//g) ?? []).length, 4);
  assert.match(html, /href="https:\/\/k6ag9vxz\.srstudio\.dev\/" data-app="1c10c96c-bf88-471c-88af-7f23a992a7ea"/);
  assert.match(html, /By osaykancuno/);
  assert.ok(!/WALL KART|TAP THE NAME/.test(html), 'pending and hidden games are not on the hub');
  assert.deepEqual([...draw.gameBoards(seed).matchAll(/data-game="([^"]+)"/g)].map((m) => m[1]), ['unbreakable', 'full-row', 'dirty-signals-radio', 'the-morning-brew']);
});

test('a game put on the hub: its column last, NEW moves to it, its capture without a clip, an odd entry ignored', () => {
  const kart = { ...seed.find((g) => g.slug === 'wall-kart'), status: 'live', order: 5, publishedAt: '2026-10-29T10:00:00Z', line: 'Race <the> names.', artist: { name: 'Someone', panel: 7 }, shot: '/games/5444a563-cba8-418c-9add-f367140c9511.png' };
  const odd = { appId: 'x', origin: 'javascript:alert(1)', slug: 'x', status: 'live', order: 0, title: 'X' };
  const games = [...seed.filter((g) => g.slug !== 'wall-kart'), kart, odd];
  const html = draw.gameCards(games, CLIPS);
  assert.deepEqual(titles(html), ['UNBREAKABLE #01', 'FULL ROW #02', 'DIRTY SIGNALS RADIO #03', 'THE MORNING BREW #04', 'WALL KART #05 NEW', 'YOUR GAME HERE #06']);
  assert.match(html, /<img class="shot" src="https:\/\/wall-arcade-cards\.netlify\.app\/games\/5444a563-cba8-418c-9add-f367140c9511\.png"/);
  assert.match(html, /Race &lt;the&gt; names\./, 'escaped');
  assert.ok(!html.includes('javascript:'));
  assert.equal(draw.liveGames(games).length, 5);
});
