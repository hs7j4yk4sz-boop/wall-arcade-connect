// THE GAMES: /games.json and the captures, POST /api/submit (SUBMIT YOUR GAME), POST /api/admin (cards/src/submit.ts),
// POST /api/clip (a clip from the nightly GitHub Action, cards/src/clip-upload.ts).
import { handleClipUpload, OIDC_ISSUER, type GitHubKeys } from '../../src/clip-upload.js';
import { handleAdmin, handleGames, handleSubmit } from '../../src/submit.js';
import { submitDeps } from '../../src/submit-netlify.js';

export default async (request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname, deps = submitDeps();
  if (path === '/api/submit') return handleSubmit(request, deps);
  if (path === '/api/admin') return handleAdmin(request, deps);
  if (path === '/api/clip') return handleClipUpload(request, { games: deps.games, now: deps.now, keys: async () => await (await fetch(`${OIDC_ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(6000) })).json() as GitHubKeys });
  return handleGames(request, deps);
};

export const config = { path: ['/games.json', '/games/*', '/api/submit', '/api/admin', '/api/clip'] };
