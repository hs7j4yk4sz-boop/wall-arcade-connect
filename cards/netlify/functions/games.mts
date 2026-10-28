// THE GAMES: /games.json and the captures, POST /api/submit (SUBMIT YOUR GAME), POST /api/admin (cards/src/submit.ts).
import { handleAdmin, handleGames, handleSubmit } from '../../src/submit.js';
import { submitDeps } from '../../src/submit-netlify.js';

export default async (request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname, deps = submitDeps();
  if (path === '/api/submit') return handleSubmit(request, deps);
  if (path === '/api/admin') return handleAdmin(request, deps);
  return handleGames(request, deps);
};

export const config = { path: ['/games.json', '/games/*', '/api/submit', '/api/admin'] };
