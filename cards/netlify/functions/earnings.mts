// GET /earnings.json: the week so far, by game, for hub/earnings.html (cards/src/jackpot-service.ts). Public, cached 60 s.
import { handleEarnings } from '../../src/jackpot-service.js';
import { jackpotDeps } from '../../src/jackpot-store.js';

export default async (): Promise<Response> => handleEarnings(jackpotDeps());

export const config = { path: '/earnings.json' };
