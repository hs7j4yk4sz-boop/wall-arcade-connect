// The night's clips (.github/workflows/clips.yml): every live game with no clip, one after the other, in software rendering,
// ten minutes at most each (scripts/clip-game.ts). A hand-made clip (hub/clips/) counts, and a game John set to USE THE STILL
// is left alone. A clip that fails changes nothing, the still stays, and the night goes on; the next night tries again.
// npm run clips:night -- <slug> films that game, clip or not.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { parseGames, SITE, type Game } from '../cards/src/games.js';

const ROOT = new URL('..', import.meta.url).pathname;
const MINUTES = 10;

const missing = (games: Game[], handMade: (slug: string) => boolean): Game[] =>
  games.filter((g) => g.status === 'live' && !g.clip && !g.clipError && !handMade(g.slug));

const asked = process.argv[2] || '';
const games = parseGames(await (await fetch(`${SITE}/games.json?fresh=${Date.now()}`)).text()) ?? [];
const list = asked ? games.filter((g) => g.slug === asked) : missing(games, (slug) => existsSync(`${ROOT}hub/clips/${slug}.mp4`));
const lines = [`${list.length} game(s) to film${list.length ? `: ${list.map((g) => g.slug).join(', ')}` : ''}`];
for (const game of list) {
  const run = spawnSync('npx', ['tsx', 'scripts/clip-game.ts', game.slug], { cwd: ROOT, stdio: 'inherit', timeout: (MINUTES + 1) * 60_000, killSignal: 'SIGKILL', env: { ...process.env, CLIP_SOFTWARE: '1', CLIP_MINUTES: String(MINUTES) } });
  lines.push(`${game.slug}: ${run.status === 0 ? 'clip sent' : 'no clip, its still stays'}`);
}
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n\n')}\n`);
process.exit();
