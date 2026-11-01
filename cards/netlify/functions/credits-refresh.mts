// Every 15 minutes: the holders' recharge, from Friday 00:00 Lisbon, 25 grants a pass, and the list of the wallets already seen.
import { refreshKnown, rechargeHolders } from '../../src/credits-service.js';
import { creditDeps } from '../../src/credits-store.js';

export default async (): Promise<void> => {
  const deps = creditDeps();
  await refreshKnown(deps);
  await rechargeHolders(deps);
};

export const config = { schedule: '*/15 * * * *' };
