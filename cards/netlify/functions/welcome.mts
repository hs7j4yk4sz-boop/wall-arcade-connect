// POST /api/welcome: a new wallet's 5 free plays (cards/src/credits-service.ts). The session is checked with SuperRare (walletOf).
import { handleWelcome } from '../../src/credits-service.js';
import { creditDeps } from '../../src/credits-store.js';
import { gamesStore } from '../../src/games-store.js';
import { groupOf, isAllowed } from '../../src/group.js';
import { walletOf } from '../../src/submit.js';

const group = groupOf(gamesStore());
export default async (request: Request): Promise<Response> => handleWelcome(request, {
  credits: creditDeps(), walletOf: (token) => walletOf(fetch, token), allowed: async (origin) => isAllowed(origin, await group()),
});

export const config = { path: '/api/welcome' };
