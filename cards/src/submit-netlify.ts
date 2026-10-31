// SUBMIT YOUR GAME's dependencies on this site (cards/src/submit.ts): Netlify Blobs, SuperRare's SDK with RARE_PROFILE_TOKEN
// (attach), the capture's background function, Resend for the mail to John (RESEND_API_KEY, NOTIFY_EMAIL; no mail without
// them), ADMIN_WALLET (more admin wallets, comma-separated, beside ADMINS). All Netlify variables, none in the repository.
import { createProfileClient } from '@rareprotocol/rare-profile';
import { GROUP_ID, SITE } from './games.js';
import { gamesStore } from './games-store.js';
import { peopleStore } from './people-store.js';
import { adminJackpot } from './jackpot-service.js';
import { jackpotDeps } from './jackpot-store.js';
import { TREASURY } from './pot.js';
import { statsStore } from './stats-store.js';
import { mailOf, type SubmitDeps } from './submit.js';

/** The admin page's wallets: johnkarp.eth and the treasury. */
export const ADMINS = ['0x38f1dfdcaf2f0d70c29d4af6a4aa9e920efe8b18', TREASURY];

export const submitDeps = (): SubmitDeps => ({
  fetch, now: () => Date.now(), games: gamesStore(), people: peopleStore(),
  groupApps: async () => {
    const group = JSON.parse((await statsStore().getText('group.json')) ?? '{}') as { apps?: { id?: string }[] };
    return (group.apps ?? []).map((a) => String(a.id));
  },
  attach: async ({ appId, origin }) => {
    const token = process.env.RARE_PROFILE_TOKEN;
    if (!token) throw new Error('no RARE_PROFILE_TOKEN on the card service');
    const client = createProfileClient({ baseUrl: 'https://studio.superrare.com', token, fetchImpl: fetch });
    await client.creditGroups.addApp({ groupId: GROUP_ID, appId, origin, creditCost: 1 });
  },
  shoot: async (appId) => {
    try { await fetch(`${SITE}/.netlify/functions/games-shot-background`, { method: 'POST', body: JSON.stringify({ appId }), signal: AbortSignal.timeout(5000) }); } catch { /* the admin page can ask again */ }
  },
  notify: async (game) => {
    const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
    if (!key || !to) return;
    const { subject, html } = mailOf(game);
    try {
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM || 'THE WALL ARCADE <onboarding@resend.dev>', to: [to], subject, html }), signal: AbortSignal.timeout(8000) });
    } catch { /* the admin page lists it anyway */ }
  },
  admins: [...ADMINS, ...(process.env.ADMIN_WALLET ?? '').split(',').map((w) => w.trim().toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w))],
  jackpot: (body, admin) => adminJackpot(jackpotDeps(), body, admin),
});
