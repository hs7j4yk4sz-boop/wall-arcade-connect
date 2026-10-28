// POST /api/events: the arcade's tags (cards/src/events.ts), one blob each in the store "events".
import { handleEvents } from '../../src/stats-service.js';
import { eventStore } from '../../src/stats-store.js';
import { groupOf } from '../../src/group.js';
import { gamesStore } from '../../src/games-store.js';

const group = groupOf(gamesStore());                     // the games of games.json and ours (cards/src/group.ts)
export default async (request: Request): Promise<Response> => handleEvents(request, { events: eventStore(), now: () => Date.now(), group });

export const config = { path: '/api/events' };
