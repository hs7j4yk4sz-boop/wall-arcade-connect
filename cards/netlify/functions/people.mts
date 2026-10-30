// PEOPLE: people.json, the mirrored sprite sheets, stats, unmatched, the zip, refresh, and the signed capture link
// (cards/src/people-service.ts). The capture checks the player's Connect session with SuperRare as /api/submit does
// (cards/src/submit.ts, walletOf) and signs with SPRITE_JWT_PRIVATE_KEY (cards/src/capture-link.ts).
import aliases from '../../people/aliases.json' with { type: 'json' };
import { signCaptureToken } from '../../src/capture-link.js';
import { gamesStore } from '../../src/games-store.js';
import { groupOf, isAllowed } from '../../src/group.js';
import { handlePeople } from '../../src/people-service.js';
import { peopleStore } from '../../src/people-store.js';
import { walletOf } from '../../src/submit.js';

const group = groupOf(gamesStore());                     // the hub and the arcade's games may ask for a capture link
const capture = {
  walletOf: (token: unknown) => walletOf(fetch, token),
  sign: signCaptureToken,
  allowed: async (origin: string | null) => isAllowed(origin, await group()),
};
export default async (request: Request): Promise<Response> => handlePeople(request, { store: peopleStore(), fetch, aliases, now: () => Date.now(), capture });

export const config = { path: ['/people.json', '/people/*'] };
