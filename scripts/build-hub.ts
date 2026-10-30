// Builds the hub archive: index.html (the player page: the wall and the games), builders.html (artists: make a game on
// the wall), assets.html (THE WALL KIT: the wall's assets to download, hub/kit/), the player page's dragon, game
// screenshots and teaser video. A plain static app: no Connect, no verifier, no config. Both pages' wall grid is embedded as
// a snapshot of the public /positions data; the builders page also gets the Connect Kit (docs/CONNECT-KIT.md) inlined
// behind its COPY THE KIT buttons, after the repository's link.
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';

type Item = { position: number; tier: string; minted: boolean; name?: string };
const { values } = parseArgs({ args: process.argv.slice(2)[0] === '--' ? process.argv.slice(3) : process.argv.slice(2),
  options: { output: { type: 'string' }, force: { type: 'boolean', default: false }, offline: { type: 'boolean', default: false } }, strict: true });
if (!values.output) throw new Error('Usage: npm run build:hub -- --output <hub.zip> [--force] [--offline]');

const html = await readFile(new URL('../hub/src.html', import.meta.url), 'utf8');
const buildersSource = await readFile(new URL('../hub/builders.html', import.meta.url), 'utf8');
const assetsSource = await readFile(new URL('../hub/assets.html', import.meta.url), 'utf8');
const submitPage = await readFile(new URL('../hub/submit.html', import.meta.url), 'utf8');     // SUBMIT YOUR GAME (hub/submit-page.ts)
const adminPage = await readFile(new URL('../hub/admin.html', import.meta.url), 'utf8');       // linked from no page (hub/admin-page.ts)
const walkExample = await readFile(new URL('../hub/kit/walk-a-sprite.html', import.meta.url), 'utf8');
const kitDoc = await readFile(new URL('../docs/CONNECT-KIT.md', import.meta.url), 'utf8');
const kitBlock = /```text\n([\s\S]*?)\n```/.exec(kitDoc);
if (!kitBlock) throw new Error('docs/CONNECT-KIT.md must hold the kit in a ```text block');
const REPO = 'https://github.com/hs7j4yk4sz-boop/wall-arcade-connect';
const kitText = `${REPO}\n\n${kitBlock[1]}\n`;
if (!buildersSource.includes("/*KIT*/''")) throw new Error("hub/builders.html must hold the /*KIT*/'' placeholder");
// JSON is a JavaScript string literal; </ is escaped so the kit can never close the <script>
// the player page's files: the dragon, the games' clips (scripts/capture-hub-clips.ts) and their screenshots as
// posters, one pair per game slug in hub/clips/ and hub/shots/ (a game without one shows its capture), the teaser
// (square, 37 s) and its poster
const ASSETS: Record<string, string> = {
  'dragon.png': '../hub/dragon.png',
  'teaser-1x1.mp4': '../comms/teaser/out/teaser-1x1.mp4', 'teaser-poster.png': '../comms/teaser/out/title-1x1.png',
  'kit/walk-a-sprite.html': '../hub/kit/walk-a-sprite.html', 'kit/palette.svg': '../hub/kit/palette.svg',
  'tag.js': '../hub/tag.js',                                   // the pages' tags for /stats on the card service
};
const shots = new Set((await readdir(new URL('../hub/shots/', import.meta.url))).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)));
const CLIPS = (await readdir(new URL('../hub/clips/', import.meta.url))).filter((f) => f.endsWith('.mp4')).map((f) => f.slice(0, -4)).filter((slug) => shots.has(slug)).sort();
for (const slug of CLIPS) { ASSETS[`clips/${slug}.mp4`] = `../hub/clips/${slug}.mp4`; ASSETS[`shots/${slug}.jpg`] = `../hub/shots/${slug}.jpg`; }
const assets: Record<string, Uint8Array> = {};
for (const [name, path] of Object.entries(ASSETS)) assets[name] = new Uint8Array(await readFile(new URL(path, import.meta.url)));
let rows: (string | number)[];
let wallItems: Item[] = [];                                    // THE WALL KIT's names dataset: /positions as it is
if (values.offline) {
  rows = Array.from({ length: 550 }, () => 0);
} else {
  const response = await fetch('https://otw-arcade.netlify.app/positions', { headers: { 'User-Agent': 'wall-arcade-connect-hub' } });
  if (!response.ok) throw new Error(`/positions: HTTP ${response.status}`);
  const raw = await response.json() as Item[] | { positions: Item[] };
  wallItems = Array.isArray(raw) ? raw : raw.positions;
  const wall = wallItems.filter((item) => item.tier === 'name' || item.tier === 'pfp').sort((a, b) => a.position - b.position);
  if (wall.length !== 550) throw new Error(`Expected 550 bricks, got ${wall.length}`);
  rows = wall.map((item) => (item.minted ? (item.name || 1) : 0));
}
const marker = /\/\*SNAPSHOT:START\*\/.*?\/\*SNAPSHOT:END\*\//s;
if (!marker.test(html)) throw new Error('Snapshot markers missing in hub/src.html');
// THE GAMES: games.json as the card service serves it now (cards/src/games.ts; its seed offline), drawn into the page by
// the page's own functions (the games:start block), so the page shows its games before any request; it redraws only if
// the live list has changed since
type GameRow = { status: string; title: string; slug: string };
let games: GameRow[];
if (values.offline) games = JSON.parse(await readFile(new URL('../cards/games/seed.json', import.meta.url), 'utf8')) as GameRow[];
else {
  const response = await fetch('https://wall-arcade-cards.netlify.app/games.json', { headers: { 'User-Agent': 'wall-arcade-connect-hub' } });
  if (!response.ok) throw new Error(`games.json: HTTP ${response.status}`);
  games = await response.json() as GameRow[];
}
const block = /\/\* games:start[\s\S]*?\/\* games:end \*\//.exec(html);
if (!block) throw new Error('hub/src.html must hold the games:start … games:end block');
const draw = new Function(`${block[0]}\nreturn { gameCards, gameBoards, liveGames };`)() as { gameCards(g: unknown, c: string[]): string; gameBoards(g: unknown): string; liveGames(g: unknown): GameRow[] };
const live = draw.liveGames(games);
if (!live.length) throw new Error('games.json: no live game');
for (const [name, re] of [['GAMES', /<!--GAMES:START-->[\s\S]*?<!--GAMES:END-->/], ['BOARDS', /<!--BOARDS:START-->[\s\S]*?<!--BOARDS:END-->/], ['games', /\/\*GAMES:START\*\/.*?\/\*GAMES:END\*\//s], ['clips', /\/\*CLIPS:START\*\/.*?\/\*CLIPS:END\*\//s]] as const) if (!re.test(html)) throw new Error(`hub/src.html: ${name} markers missing`);
const page = html.replace(marker, () => `/*SNAPSHOT:START*/${JSON.stringify(rows)}/*SNAPSHOT:END*/`)
  .replace(/<!--GAMES:START-->[\s\S]*?<!--GAMES:END-->/, () => `<!--GAMES:START-->${draw.gameCards(games, CLIPS)}<!--GAMES:END-->`)
  .replace(/<!--BOARDS:START-->[\s\S]*?<!--BOARDS:END-->/, () => `<!--BOARDS:START-->${draw.gameBoards(games)}<!--BOARDS:END-->`)
  .replace(/\/\*GAMES:START\*\/.*?\/\*GAMES:END\*\//s, () => `/*GAMES:START*/${JSON.stringify(games).replace(/<\//g, '<\\/')}/*GAMES:END*/`)
  .replace(/\/\*CLIPS:START\*\/.*?\/\*CLIPS:END\*\//s, () => `/*CLIPS:START*/${JSON.stringify(CLIPS)}/*CLIPS:END*/`);
if (!marker.test(buildersSource)) throw new Error('Snapshot markers missing in hub/builders.html');
const builders = buildersSource
  .replace("/*KIT*/''", () => JSON.stringify(kitText).replace(/<\//g, '<\\/'))
  .replace(marker, () => `/*SNAPSHOT:START*/${JSON.stringify(rows)}/*SNAPSHOT:END*/`);   // the same live wall as the hub
// the two pages link to each other with relative links only (the builders page: a discreet ← in its corner)
if (!page.includes('href="./builders.html"')) throw new Error('hub/src.html must link to ./builders.html');
if (!builders.includes('href="./"')) throw new Error('hub/builders.html must link back to ./');
// PEOPLE is token-gated (hub/people-gate.ts, bundled with the Connect SDK): the capture link is never in a page
if (!page.includes("s.src = 'people-gate.js'")) throw new Error('hub/src.html must load people-gate.js');
for (const [name, source] of [['index.html', page], ['builders.html', builders]] as const) if (/spriteparty\.com\/p\/[^/"]+\/capture/.test(source)) throw new Error(`${name} must not hold the Sprite Party capture link`);
const bundle = async (file: string): Promise<Uint8Array> => {
  const out = await build({ entryPoints: [new URL(`../hub/${file}`, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true, write: false, legalComments: 'none' });
  const js = out.outputFiles[0]?.contents;
  if (!js) throw new Error(`${file} did not bundle`);
  return js;
};
const gateJs = await bundle('people-gate.ts');
// SUBMIT YOUR GAME and the admin page: Connect sign-in, then the card service (cards/src/submit.ts) decides
const submitJs = await bundle('submit-page.ts'), adminJs = await bundle('admin-page.ts');
if (!builders.includes('href="./submit.html"')) throw new Error('hub/builders.html must link to ./submit.html');
if (!submitPage.includes('src="./submit-page.js"') || !adminPage.includes('src="./admin-page.js"')) throw new Error('submit.html and admin.html load their scripts');
if (!adminPage.includes('noindex')) throw new Error('hub/admin.html stays out of search engines');
if (!adminPage.includes('id="addForm"')) throw new Error('hub/admin.html has ADD A GAME');
if (/spriteparty\.com\/p\/[^/"]+\/capture/.test(new TextDecoder().decode(gateJs))) throw new Error('people-gate.js must not hold the capture link');
// THE WALL KIT: the example's very text under its live demo, the snapshot's date; linked from the hub and the builders page
for (const marker of ['/*WALK*/', '/*BUILT*/']) if (!assetsSource.includes(marker)) throw new Error(`hub/assets.html must hold ${marker}`);
const escapeHtml = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
const kitPage = assetsSource.replace('/*WALK*/', () => escapeHtml(walkExample.trimEnd()))
  .replace('/*BUILT*/', () => new Date().toISOString().slice(0, 10));
if (!kitPage.includes('href="./"')) throw new Error('hub/assets.html must link back to ./');
for (const source of [page, builders, kitPage, submitPage]) if (source.includes('admin.html')) throw new Error('no page links to admin.html');
for (const [name, source] of [['hub/src.html', page], ['hub/builders.html', builders], ['hub/assets.html', kitPage], ['hub/submit.html', submitPage]] as const) if (!source.includes('<script src="./tag.js" data-view=')) throw new Error(`${name} must load ./tag.js`);
for (const [name, source] of [['hub/src.html', page], ['hub/builders.html', builders]] as const) if (!source.includes('href="./assets.html"')) throw new Error(`${name} must link to ./assets.html`);

const output = resolve(values.output);
let exists = false;
try { await access(output); exists = true; } catch { /* new output expected */ }
if (exists && !values.force) throw new Error(`Output exists: ${output}. Use another path or --force.`);
// the host serves scripts as immutable for a year: a page asks for its script by content, so a change reaches a browser that already has one
const byContent = (js: Uint8Array): string => `?v=${createHash('sha256').update(js).digest('hex').slice(0, 12)}`;
const archive = zipSync({ 'index.html': strToU8(page.replace("s.src = 'people-gate.js'", () => `s.src = 'people-gate.js${byContent(gateJs)}'`)), 'builders.html': strToU8(builders), 'assets.html': strToU8(kitPage),
  'submit.html': strToU8(submitPage.replace('src="./submit-page.js"', () => `src="./submit-page.js${byContent(submitJs)}"`)), 'submit-page.js': submitJs,
  'admin.html': strToU8(adminPage.replace('src="./admin-page.js"', () => `src="./admin-page.js${byContent(adminJs)}"`)), 'admin-page.js': adminJs,
  'kit/wall.json': strToU8(JSON.stringify(wallItems, null, 1)), 'people-gate.js': gateJs, ...assets }, { level: 9 });
await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
try { await writeFile(temporary, archive, { flag: 'wx' }); await rename(temporary, output); } finally { await rm(temporary, { force: true }); }
const minted = rows.filter(Boolean).length;
process.stdout.write(`Hub archive: ${output}\nFiles: index.html, builders.html, assets.html, submit.html, submit-page.js (${submitJs.byteLength} bytes), admin.html, admin-page.js (${adminJs.byteLength} bytes), kit/wall.json, people-gate.js (${gateJs.byteLength} bytes), ${Object.keys(assets).join(', ')}\nBricks: ${rows.length} (${minted} minted)\nGames on the hub: ${live.map((g) => g.title).join(', ')} (clips: ${CLIPS.join(', ')})\nSHA-256: ${createHash('sha256').update(archive).digest('hex')}\nSize: ${archive.byteLength} bytes\n`);
