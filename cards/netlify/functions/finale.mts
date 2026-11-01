// GET /finale.json: the plays of the week and the FINALE block, for the hub (cards/src/jackpot-service.ts). Public, cached 20 s.
import { handleFinale } from '../../src/jackpot-service.js';
import { jackpotDeps } from '../../src/jackpot-store.js';

export default async (): Promise<Response> => handleFinale(jackpotDeps());

export const config = { path: '/finale.json' };
