// SUBMIT YOUR GAME's dependencies on this site (cards/src/submit.ts): Netlify Blobs, SuperRare's SDK with RARE_PROFILE_TOKEN
// (attach), the capture's background function, Resend for the mail to John (RESEND_API_KEY, NOTIFY_EMAIL; no mail without
// them), ADMIN_WALLET (the admin page's wallets, comma-separated). All Netlify variables, none in the repository.
import { createProfileClient } from '@rareprotocol/rare-profile';
import { GROUP_ID, SITE } from './games.js';
import { gamesStore } from './games-store.js';
import { peopleStore } from './people-store.js';
import { statsStore } from './stats-store.js';
import { mailOf, type SubmitDeps } from './submit.js';

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
  admins: (process.env.ADMIN_WALLET ?? '').split(',').map((w) => w.trim().toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)),
});
