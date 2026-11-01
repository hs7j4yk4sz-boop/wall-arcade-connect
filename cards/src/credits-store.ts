// The free credits' dependencies on this site (cards/src/credits-service.ts): SuperRare's grant with RARE_PROFILE_TOKEN, the
// store "jackpot", people.json, the stats' list of packs, our tags. The token is a Netlify variable, never in the repository.
import { createProfileClient } from '@rareprotocol/rare-profile';
import { getStore } from '@netlify/blobs';
import type { CreditDeps } from './credits-service.js';
import { eventsBetween } from './events.js';
import { peopleStore } from './people-store.js';
import type { Person } from './people.js';
import { GROUP_ID } from './stats-sources.js';
import { LAUNCH, type Pack } from './stats.js';
import { eventStore, statsStore } from './stats-store.js';

export function creditDeps(): CreditDeps {
  const store = getStore({ name: 'jackpot', consistency: 'strong' });
  const token = process.env.RARE_PROFILE_TOKEN;
  return {
    now: () => Date.now(),
    store: { getText: (key) => store.get(key, { type: 'text' }), set: async (key, value) => { await store.set(key, value); } },
    grant: async (input) => {
      if (!token) throw new Error('no RARE_PROFILE_TOKEN on the card service');
      await createProfileClient({ baseUrl: 'https://studio.superrare.com', token, fetchImpl: fetch }).creditGroups.grant({ groupId: GROUP_ID, ...input });
    },
    holders: async () => (JSON.parse((await peopleStore().getText('people.json')) ?? '[]') as Person[]).flatMap((p) => (p.wallet ? [p.wallet] : [])),
    seen: async () => {
      const packs = (JSON.parse((await statsStore().getText('packs.json')) ?? 'null') as { list?: Pack[] } | null)?.list ?? [];
      const events = await eventsBetween(eventStore(), LAUNCH, Date.now() + 1);
      return [...packs.map((p) => p.wallet), ...events.flatMap((e) => (e.w ? [e.w] : []))];
    },
  };
}
