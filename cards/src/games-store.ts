// THE GAMES' store on Netlify Blobs (store "games"): games.json (cards/src/games.ts), each game's 1080 × 1080 capture, its
// 10 s clip and poster (clips/<slug>.mp4, .jpg: made on the Mac, npm run clip -- <slug>).
import { getStore } from '@netlify/blobs';
import type { GamesStore } from './games.js';

export function gamesStore(): GamesStore {
  const store = getStore({ name: 'games', consistency: 'strong' });
  return {
    getText: (key) => store.get(key, { type: 'text' }),
    getBytes: async (key) => { const b = await store.get(key, { type: 'arrayBuffer' }); return b ? new Uint8Array(b) : null; },
    set: async (key, value) => { await store.set(key, typeof value === 'string' ? value : (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer)); },
    delete: (key) => store.delete(key),
  };
}
