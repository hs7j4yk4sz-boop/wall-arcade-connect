// The README's table of the arcade's games and their 40% payout wallets, printed from games.json as the card service
// serves it (cards/src/games.ts), between the README's games:start / games:end markers. Usage: npx tsx scripts/readme-games.ts
import { readFile, writeFile } from 'node:fs/promises';

type Game = { appId: string; origin: string; title: string; status: string; order: number; artist: { name: string; wall?: string; panel: number | null };
  payoutWallet: string | null; attachedAt: string | null; publishedAt: string | null };
const response = await fetch('https://wall-arcade-cards.netlify.app/games.json');
if (!response.ok) throw new Error(`games.json: HTTP ${response.status}`);
const all = await response.json() as Game[];
const columns = all.filter((g) => g.status === 'live').sort((a, b) => a.order - b.order).map((g) => g.appId);   // the hub's columns, ours included
const games = all.filter((g) => g.artist.name !== 'ON THE WALL');
const rank = { live: 0, pending: 1, hidden: 2 } as Record<string, number>;
games.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.order - b.order);
const day = (t: string | null): string => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Lisbon' }) : '—');
const rows = games.map((g) => `| ${g.title} | ${g.artist.name ? `${g.artist.name}${g.artist.wall ? ` (${g.artist.wall}` : ' ('}${g.artist.panel ? `${g.artist.wall ? ', ' : ''}panel ${g.artist.panel}` : ''})`.replace(' ()', '') : 'to confirm'} | \`${g.appId}\` | ${g.origin} | ${g.payoutWallet ? `\`${g.payoutWallet}\`` : '—'} | ${day(g.attachedAt)} | ${g.status === 'live' ? `${day(g.publishedAt)}, column ${columns.indexOf(g.appId) + 1}` : g.status} |`);
const table = ['| Game | Artist (name on the wall, panel) | App ID | Origin | 40% paid to | Attached | On the hub |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const marker = /<!-- games:start -->[\s\S]*?<!-- games:end -->/;
if (!marker.test(readme)) throw new Error('README.md: games markers missing');
await writeFile(new URL('../README.md', import.meta.url), readme.replace(marker, () => `<!-- games:start -->\n${table}\n<!-- games:end -->`));
process.stdout.write(`${table}\n`);
