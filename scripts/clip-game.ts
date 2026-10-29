// A game's 10 s clip for the hub, made on this Mac:   npm run clip -- <slug>
// The local Chrome (WebGL on the graphics card) plays the game's free practice as a stand-in player would, on a virtual
// clock (cards/src/autoplay.ts); ffmpeg cuts the 10 s and the square where it moves most (cards/src/clip.ts): 720 × 720,
// 24 frames a second, muted H.264, its poster. Both go to the card service's store (clips/<slug>.mp4, .jpg, served at
// /games/<slug>.mp4) and games.json points at it: the hub plays it within a minute. If anything fails, nothing changes:
// the game keeps its still capture. Never more than five minutes on one game.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmPractice, VIEW } from '../cards/src/autoplay.js';
import { CLIP, makeClip } from '../cards/src/clip.js';
import { parseGames, SITE } from '../cards/src/games.js';

const slug = process.argv[2] ?? '';
const CARDS = new URL('../cards/', import.meta.url).pathname, OUT = new URL('../dist/clips/', import.meta.url).pathname;
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const FFMPEG = [process.env.FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => p && existsSync(p));
const netlify = (...args: string[]): string => execFileSync('npx', ['-y', 'netlify-cli@27.9.0', ...args], { cwd: CARDS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function clip(): Promise<string> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw new Error('usage: npm run clip -- <slug> (as in games.json)');
  if (!CHROME) throw new Error('no Google Chrome here (CHROME_PATH)');
  if (!FFMPEG) throw new Error('no ffmpeg here (brew install ffmpeg, or FFMPEG_PATH)');
  const games = parseGames(await (await fetch(`${SITE}/games.json?fresh=${Date.now()}`)).text()) ?? [];
  const game = games.find((g) => g.slug === slug);
  if (!game) throw new Error(`no game "${slug}" in games.json (${games.map((g) => g.slug).join(', ')})`);

  console.log(`${game.title}: its free practice at ${game.origin}/`);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  let film;
  try {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
    film = await filmPractice(page, game.origin, { seconds: 11, seed: Math.floor(Date.now() / 1000) % 97, deadline: Date.now() + 3 * 60_000, fps: CLIP.fps });
  } finally { await browser.close(); }
  console.log(`filmed: ${film.frames.length} frames`);
  const { mp4, jpg } = await makeClip(film, FFMPEG, join(OUT, `.${slug}`));
  await mkdir(OUT, { recursive: true });
  const mp4Path = join(OUT, `${slug}.mp4`), jpgPath = join(OUT, `${slug}.jpg`);
  await writeFile(mp4Path, mp4); await writeFile(jpgPath, jpg);
  console.log(`cut: ${mp4Path} (${(mp4.byteLength / 1024).toFixed(0)} KB)`);

  // into the service's store, then games.json (read again just before: the admin page may have moved it)
  netlify('blobs:set', 'games', `clips/${slug}.mp4`, '--input', mp4Path, '--force');
  netlify('blobs:set', 'games', `clips/${slug}.jpg`, '--input', jpgPath, '--force');
  const now = parseGames(netlify('blobs:get', 'games', 'games.json'));
  if (!now?.some((g) => g.slug === slug)) throw new Error('games.json could not be read back: the clip is stored, games.json unchanged');
  const next = now.map((g) => (g.slug === slug ? (({ clipError: _, ...rest }) => ({ ...rest, clip: `/games/${slug}.mp4` }))(g) : g));
  const listPath = join(OUT, '.games.json');
  await writeFile(listPath, JSON.stringify(next));
  netlify('blobs:set', 'games', 'games.json', '--input', listPath, '--force');
  return `${SITE}/games/${slug}.mp4`;
}

const limit = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('more than five minutes')), 5 * 60_000).unref());
try {
  console.log(`done: ${await Promise.race([clip(), limit])} (the hub plays it within a minute)`);
} catch (error) {
  console.error(`no clip for ${slug}: ${error instanceof Error ? error.message.split('\n')[0] : error}. Nothing changed: its still capture stays.`);
  process.exitCode = 1;
}
process.exit();
