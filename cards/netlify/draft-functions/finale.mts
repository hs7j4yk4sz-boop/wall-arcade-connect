// The Netlify draft's /finale.json (cards/scripts/deploy-draft.sh): the real code and the real sources, with a store that writes nothing.
import { handleFinale } from '../../src/jackpot-service.js';
import { draftDeps } from '../../src/jackpot-store.js';

export default async (): Promise<Response> => handleFinale(draftDeps());

export const config = { path: '/finale.json' };
