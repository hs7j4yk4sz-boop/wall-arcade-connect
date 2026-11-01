// The Netlify draft's /earnings.json (cards/scripts/deploy-draft.sh): production's public document with the draft's week; nothing is written.
import { SITE } from '../../src/games.js';
import { numberedWeek } from '../../src/jackpot.js';

export default async (): Promise<Response> => {
  const doc = await (await fetch(`${SITE}/earnings.json`, { signal: AbortSignal.timeout(5000) })).json() as Record<string, unknown>;
  return Response.json({ ...doc, week: numberedWeek(Date.now()) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
};

export const config = { path: '/earnings.json' };
