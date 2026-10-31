// Every 15 minutes: the week so far for /earnings.json, and any week just closed (Friday 15:00 Lisbon) calculated and kept.
import { refreshJackpot } from '../../src/jackpot-service.js';
import { jackpotDeps } from '../../src/jackpot-store.js';

export default async (): Promise<void> => { await refreshJackpot(jackpotDeps()); };

export const config = { schedule: '*/15 * * * *' };
