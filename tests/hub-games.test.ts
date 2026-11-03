// The hub draws ALL GAMES from games.json (cards/src/games.ts) and the pots of /finale.json: the hub's own functions (the
// games:start block of hub/src.html, the very code scripts/build-hub.ts runs at build), evaluated as written, on the seed and on
// a game put on the hub from the admin page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const hubSource = readFileSync(new URL('../hub/src.html', import.meta.url), 'utf8');
const block = /\/\* games:start[\s\S]*?\/\* games:end \*\//.exec(hubSource)?.[0] ?? '';
type Pot = { slug: string; plays: number; potEth: string; leader: { name: string; score: number } | null };
type Draw = { gameList(g: unknown, clips: string[], pots: Pot[] | null, skip: string | null): string; gameMedia(g: unknown, clips: string[], cls: string, still: boolean): string; liveGames(g: unknown): { slug: string }[] };
const draw = new Function(`${block}\nreturn { gameList, gameMedia, liveGames };`)() as Draw;
const seed = JSON.parse(readFileSync(new URL('../cards/games/seed.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
const CLIPS = ['dirty-signals-radio', 'full-row', 'the-morning-brew', 'unbreakable'];
const titles = (html: string): string[] => [...html.matchAll(/(<span class="new">NEW<\/span>)?<div><h3>([^<]*)<\/h3>/g)].map((m) => `${m[2]}${m[1] ? ' NEW' : ''}`);

test('the seed at build: the four live games in the hub\'s order, NEW on THE MORNING BREW, a still each, no pot yet', () => {
  const html = draw.gameList(seed, CLIPS, null, null);
  assert.deepEqual(titles(html), ['UNBREAKABLE', 'FULL ROW', 'DIRTY SIGNALS RADIO', 'THE MORNING BREW NEW']);
  assert.equal((html.match(/<img class="th" src="shots\//g) ?? []).length, 4, 'the list shows stills, no video');
  assert.equal((html.match(/Pot <b>— ETH<\/b>/g) ?? []).length, 4);
  assert.match(html, /href="https:\/\/k6ag9vxz\.srstudio\.dev\/" data-app="1c10c96c-bf88-471c-88af-7f23a992a7ea"/);
  assert.match(html, /By osaykancuno/);
  assert.ok(!/WALL KART|TAP THE NAME|YOUR GAME HERE/.test(html), 'pending and hidden games are not on the hub');
});

test('with the pots: the biggest first, the game of the week left out, a game the service does not list last', () => {
  const pots: Pot[] = [{ slug: 'the-morning-brew', plays: 9, potEth: '0.00045', leader: { name: '<i>x</i>', score: 12345 } }, { slug: 'dirty-signals-radio', plays: 4, potEth: '0.00020', leader: null }, { slug: 'unbreakable', plays: 1, potEth: '0.00005', leader: null }];
  const html = draw.gameList(seed, CLIPS, pots, 'dirty-signals-radio');
  assert.deepEqual(titles(html), ['THE MORNING BREW NEW', 'UNBREAKABLE', 'FULL ROW']);
  assert.match(html, /Pot <b>0\.00045 ETH<\/b><\/p><p class="lead">Leader &lt;i&gt;x&lt;\/i&gt; · <b>12,345<\/b>/);
  assert.match(html, /Pot <b>0\.00005 ETH<\/b><\/p><p class="lead">No score yet\. Be the first\./);
});

test('a game put on the hub: NEW moves to it, its capture without a clip, an odd entry ignored', () => {
  const kart = { ...seed.find((g) => g.slug === 'wall-kart'), status: 'live', order: 5, publishedAt: '2026-10-29T10:00:00Z', line: 'Race <the> names.', artist: { name: 'Some<one>', panel: 7 }, shot: '/games/5444a563-cba8-418c-9add-f367140c9511.png' };
  const odd = { appId: 'x', origin: 'javascript:alert(1)', slug: 'x', status: 'live', order: 0, title: 'X' };
  const games = [...seed.filter((g) => g.slug !== 'wall-kart'), kart, odd];
  const html = draw.gameList(games, CLIPS, null, null);
  assert.deepEqual(titles(html), ['UNBREAKABLE', 'FULL ROW', 'DIRTY SIGNALS RADIO', 'THE MORNING BREW', 'WALL KART NEW']);
  assert.match(html, /<img class="th" src="https:\/\/wall-arcade-cards\.netlify\.app\/games\/5444a563-cba8-418c-9add-f367140c9511\.png"/);
  assert.match(html, /By Some&lt;one&gt;/, 'escaped');
  assert.ok(!html.includes('javascript:'));
  assert.equal(draw.liveGames(games).length, 5);
});

test("a game's picture: the hub's own clip first, else the card service's clip and its poster, else its capture", () => {
  const tagger = { appId: 'd321d819-33a3-4c80-8f29-a68983287e33', origin: 'https://92hxxw5w.srstudio.dev', slug: 'wall-tagger-2000', title: 'WALL TAGGER 2000', line: 'Tag.', artist: { name: 'Nissla', panel: 40 },
    status: 'live', order: 5, publishedAt: '2026-10-29T00:50:00Z', shot: '/games/d321d819-33a3-4c80-8f29-a68983287e33.png', clip: '/games/wall-tagger-2000.mp4' };
  assert.match(draw.gameMedia(tagger, CLIPS, 'v', false), /^<video class="v" src="https:\/\/wall-arcade-cards\.netlify\.app\/games\/wall-tagger-2000\.mp4" poster="https:\/\/wall-arcade-cards\.netlify\.app\/games\/wall-tagger-2000\.jpg" autoplay muted loop playsinline/);
  assert.match(draw.gameMedia(tagger, CLIPS, 'th', true), /^<img class="th" src="https:\/\/wall-arcade-cards\.netlify\.app\/games\/wall-tagger-2000\.jpg"/);
  assert.match(draw.gameMedia(tagger, [...CLIPS, 'wall-tagger-2000'], 'v', false), /src="clips\/wall-tagger-2000\.mp4" poster="shots\/wall-tagger-2000\.jpg"/);
  assert.match(draw.gameMedia({ ...tagger, clip: 'javascript:x' }, CLIPS, 'v', false), /^<img class="v" src="https:\/\/wall-arcade-cards\.netlify\.app\/games\/d321d819/);
});
