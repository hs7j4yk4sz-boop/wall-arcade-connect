// The jackpot's store on Netlify Blobs (store "jackpot"): earnings.json and week-<n>.json (cards/src/jackpot-service.ts).
import { getStore } from '@netlify/blobs';
import { gamesStore } from './games-store.js';
import type { JackpotDeps } from './jackpot-service.js';
import { RPCS } from './pot.js';

/** The first public RPC that answers; a null result is an answer (a transaction not seen yet). */
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let last: unknown = new Error('no RPC');
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(5000) });
      const body = await r.json() as { result?: unknown; error?: unknown };
      if (r.ok && 'result' in body) return body.result;
      last = new Error(`${url}: no answer`);
    } catch (error) { last = error; }
  }
  throw last;
}

export function jackpotDeps(): JackpotDeps {
  const store = getStore({ name: 'jackpot', consistency: 'strong' });
  return {
    fetch, now: () => Date.now(), token: process.env.RARE_PROFILE_TOKEN || undefined, rpc, games: gamesStore(),
    store: { getText: (key) => store.get(key, { type: 'text' }), set: async (key, value) => { await store.set(key, value); } },
  };
}
