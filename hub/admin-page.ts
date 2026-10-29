// The admin page (hub/admin.html), bundled by scripts/build-hub.ts as admin-page.js. John signs in with SuperRare Connect;
// the card service (POST /api/admin, cards/src/submit.ts) answers only to a wallet of its ADMIN_WALLET variable, with
// games.json. Each button sends the Connect access token again, the service checks it with SuperRare every time.
// PUT IT ON THE HUB: live, last column, NEW. HIDE: off the hub. ↑ ↓: the order of the columns. ?app=<appId>: that game first.
// ADD A GAME: a game sent by DM (the name on the wall, the address, the app ID), the same eight checks as SUBMIT YOUR GAME.
import { ConnectPopupBlockedError, createSuperRareClient } from '@rareprotocol/connect';

const API = 'https://wall-arcade-cards.netlify.app/api/admin', SITE = 'https://wall-arcade-cards.netlify.app';
type Check = { n: number; ok: boolean | null; label: string; fix?: string };
type Game = {
  appId: string; origin: string; slug: string; title: string; line: string; artist: { name: string; wall?: string; panel: number | null; handle?: string | null };
  payoutWallet: string | null; submittedAt: string | null; attachedAt: string | null; status: 'pending' | 'live' | 'hidden';
  publishedAt: string | null; shot: string | null; order: number; by?: string; attachError?: string; shotError?: string;
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const client = createSuperRareClient({ studioUrl: 'https://studio.superrare.com', apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com' });
const status = $('status'), signIn = $<HTMLButtonElement>('adminSignIn');
const focus = new URLSearchParams(location.search).get('app');
let games: Game[] = [];

async function call(body: Record<string, unknown>): Promise<{ code: number; data: { games?: Game[]; error?: string; wallet?: string; ok?: boolean; checks?: Check[]; errors?: Record<string, string>; game?: Game } }> {
  const accessToken = await client.auth.getAccessToken();
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, accessToken }) });
  return { code: r.status, data: await r.json().catch(() => ({})) };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
};
const day = (t: string | null): string => (t ? new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Lisbon', dateStyle: 'medium', timeStyle: 'short' }) : '—');

function card(g: Game, live: Game[]): HTMLElement {
  const box = el('div', { class: `g${g.appId === focus ? ' focus' : ''}`, id: `g-${g.appId}` });
  box.append(g.shot ? el('img', { src: `${SITE}${g.shot}?v=${Date.now() % 1e6}`, alt: g.title, loading: 'lazy' }) : el('div', { class: 'noshot' }, g.shotError ? 'capture failed' : 'no capture yet'));
  const body = el('div');
  body.append(el('h3', {}, g.title));
  const meta = el('div', { class: 'meta' });
  const line = (label: string, value: string, warn = false): void => { const p = el('p', warn ? { class: 'warn' } : {}); p.append(el('b', {}, `${label} `), document.createTextNode(value)); meta.append(p); };
  line('by', g.artist.name ? `${g.artist.name}${g.artist.wall ? ` (${g.artist.wall})` : ''}${g.artist.panel ? `, panel ${g.artist.panel}` : ''}` : 'unknown: EDIT before putting it on the hub', !g.artist.name);
  line('line', g.line || 'none: EDIT before putting it on the hub', !g.line);
  const play = el('p'); play.append(el('b', {}, 'play ')); play.append(el('a', { href: `${g.origin}/`, target: '_blank', rel: 'noopener' }, g.origin)); meta.append(play);
  line('app', g.appId);
  line('40% to', g.payoutWallet ?? 'no wallet yet', !g.payoutWallet && g.artist.name !== 'ON THE WALL');
  line('submitted', `${day(g.submittedAt)}${g.by ? ` by ${g.by}` : ''}`);
  line('group', g.attachError ? `NOT attached: ${g.attachError}` : g.attachedAt ? `attached ${day(g.attachedAt)}` : 'ours', Boolean(g.attachError));
  if (g.status === 'live') line('on the hub', `column ${live.indexOf(g) + 1}${g.publishedAt ? `, since ${day(g.publishedAt)}` : ''}`);
  if (g.shotError) line('capture', g.shotError, true);
  body.append(meta);

  const acts = el('div', { class: 'acts' });
  const button = (label: string, cls: string, run: () => Promise<void>): void => {
    const b = el('button', { class: `btn ${cls}`, type: 'button' }, label);
    b.addEventListener('click', async () => { b.disabled = true; await run(); b.disabled = false; });
    acts.append(b);
  };
  if (g.status !== 'live') button('Put it on the hub', 'blue', async () => {
    const missing = [!g.artist.name && 'the artist', !g.line && 'its one line'].filter(Boolean).join(' and ');
    if (missing) { form.hidden = false; say(`Give it ${missing} first (below), SAVE, then PUT IT ON THE HUB.`, true); (form.querySelector<HTMLInputElement>(!g.line ? '[name=line]' : '[name=artistName]'))?.focus(); return; }
    await act({ action: 'publish', appId: g.appId }, `${g.title} is on the hub: the hub shows it within a minute.`, g.appId);
  });
  if (g.status === 'live') {
    const i = live.indexOf(g);
    if (i > 0) button('↑', '', () => move(i, -1));
    if (i < live.length - 1) button('↓', '', () => move(i, 1));
  }
  if (g.status !== 'hidden') button('Hide', 'ink', () => act({ action: 'hide', appId: g.appId }, `${g.title} is hidden.`, g.appId));
  if (g.attachError) button('Attach again', '', () => act({ action: 'attach', appId: g.appId }, `${g.title} is attached.`, g.appId));
  button('New capture', '', async () => { await act({ action: 'shoot', appId: g.appId }, 'Capturing: about a minute, then reload.', g.appId); });
  button('Edit', '', async () => { form.hidden = !form.hidden; });
  body.append(acts);
  // what a button did, or why not, right under the buttons
  const note = el('p', { class: 'note', id: `note-${g.appId}`, 'aria-live': 'polite' });
  const say = (text: string, bad = false): void => { note.textContent = text; note.className = `note${bad ? ' bad' : ''}`; };
  body.append(note);

  const form = el('form', { hidden: '' });
  const input = (name: string, label: string, value: string, wide = false): void => {
    const l = el('label', wide ? { class: 'wide' } : {}, label); l.append(el('input', { name, value })); form.append(l);
  };
  input('title', 'Title (24)', g.title); input('artistName', 'Artist', g.artist.name);
  input('line', 'One line (120)', g.line, true);
  input('panel', 'Panel', g.artist.panel ? String(g.artist.panel) : ''); input('payoutWallet', 'Payout wallet', g.payoutWallet ?? '');
  const save = el('button', { class: 'btn ink', type: 'submit' }, 'Save'); form.append(save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form), v = (k: string): string => String(f.get(k) ?? '').trim();
    const fields: Record<string, unknown> = {};               // an empty field stays as it is
    for (const k of ['title', 'line', 'artistName', 'payoutWallet']) if (v(k)) fields[k] = v(k);
    if (v('panel')) fields.panel = Number(v('panel'));
    await act({ action: 'edit', appId: g.appId, fields }, `Saved.${g.status !== 'live' ? ' Now PUT IT ON THE HUB.' : ''}`, g.appId);
  });
  body.append(form);
  box.append(body);
  return box;
}

function draw(): void {
  const live = games.filter((g) => g.status === 'live').sort((a, b) => a.order - b.order);
  for (const s of ['pending', 'live', 'hidden'] as const) {
    const list = $(s), mine = s === 'live' ? live : games.filter((g) => g.status === s).sort((a, b) => Date.parse(b.submittedAt ?? '0') - Date.parse(a.submittedAt ?? '0'));
    list.replaceChildren(...(mine.length ? mine.map((g) => card(g, live)) : [el('p', { class: 'empty' }, 'None.')]));
  }
  $('board').hidden = false; $('addOpen').hidden = false;
  if (focus) document.getElementById(`g-${focus}`)?.scrollIntoView({ block: 'center' });
}

// ADD A GAME
const addForm = $<HTMLFormElement>('addForm'), addSend = $<HTMLButtonElement>('addSend'), addChecks = $('addChecks'), addNote = $('addNote');
const tell = (text: string, bad = false): void => { status.textContent = addNote.textContent = text; addNote.className = `note${bad ? ' bad' : ''}`; };
$('addOpen').addEventListener('click', () => { $('addBox').hidden = !$('addBox').hidden; if (!$('addBox').hidden) $<HTMLInputElement>('addName').focus(); });
function showChecks(checks: Check[]): void {
  addChecks.replaceChildren(...checks.map((c) => {
    const li = el('li', { class: c.ok === true ? 'ok' : c.ok === false ? 'no' : 'wait' });
    li.append(el('span', { class: 'mark' }, c.ok === true ? '✓' : c.ok === false ? '✕' : '–'), el('span', {}, c.label));
    if (c.ok !== true && c.fix) li.append(el('span', { class: 'fix' }, c.fix));
    return li;
  }));
  addChecks.hidden = false;
}
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = (id: string): string => $<HTMLInputElement>(id).value.trim();
  for (const err of addForm.querySelectorAll<HTMLElement>('.err')) err.textContent = '';
  addChecks.hidden = true; addSend.disabled = true; tell('Checking the game… (up to 20 seconds)');
  try {
    const { code, data } = await call({ action: 'add', name: v('addName'), origin: v('addOrigin'), appId: v('addAppId') });
    if (code === 400 && data.errors) {
      for (const err of addForm.querySelectorAll<HTMLElement>('.err')) err.textContent = data.errors[err.dataset.for ?? ''] ?? '';
      tell('Fix the fields in red.', true); return;
    }
    if (code !== 200) { tell(data.error ?? `HTTP ${code}`, true); return; }
    if (data.checks) showChecks(data.checks);
    if (!data.ok || !data.game) { tell('A check is red: see its remedy below.', true); return; }
    if (data.games) { games = data.games; draw(); }
    addForm.reset();
    const g = data.game;
    tell(`${g.title} added: pending${g.attachError ? `, NOT attached (${g.attachError}): ATTACH again` : ', attached to the group'}, capture in about a minute. EDIT its line, then put it on the hub.`);
    document.getElementById(`g-${g.appId}`)?.scrollIntoView({ block: 'center' });
  } catch { tell('The card service did not answer. Try again.', true); } finally { addSend.disabled = false; }
});

async function act(body: Record<string, unknown>, done: string, appId?: string): Promise<void> {
  const show = (text: string, bad: boolean): void => {
    status.textContent = text;
    const note = appId ? document.getElementById(`note-${appId}`) : null;
    if (note) { note.textContent = text; note.className = `note${bad ? ' bad' : ''}`; note.scrollIntoView({ block: 'nearest' }); }
  };
  show('Saving…', false);
  try {
    const { code, data } = await call(body);
    if (data.games) { games = data.games; draw(); }
    show(code === 200 ? done : data.error ?? `HTTP ${code}`, code !== 200);
  } catch { show('The card service did not answer. Try again.', true); }
}
async function move(i: number, by: -1 | 1): Promise<void> {
  const live = games.filter((g) => g.status === 'live').sort((a, b) => a.order - b.order).map((g) => g.appId);
  [live[i], live[i + by]] = [live[i + by] as string, live[i] as string];
  await act({ action: 'order', appIds: live }, 'Order saved: the hub follows within a minute.', live[i + by]);
}

async function render(): Promise<void> {
  if (!client.auth.getSession()) { $('board').hidden = true; $('addOpen').hidden = true; $('addBox').hidden = true; return; }
  status.textContent = 'Checking your wallet…';
  try {
    const { code, data } = await call({ action: 'whoami' });
    if (code === 403) { status.textContent = `Not an admin wallet${data.wallet ? ` (${data.wallet})` : ''}.`; $('board').hidden = true; $('addOpen').hidden = true; $('addBox').hidden = true; return; }
    if (code === 401) { status.textContent = 'Sign in again.'; return; }
    if (code !== 200 || !data.games) throw new Error(`HTTP ${code}`);
    games = data.games; draw(); status.textContent = `Signed in as ${data.wallet}.`;
  } catch { status.textContent = 'The card service did not answer. Try again.'; }
}

signIn.addEventListener('click', async () => {
  signIn.disabled = true;
  try {
    if (client.auth.getSession()) await client.auth.logout().catch(() => client.auth.clearSession());
    const result = await client.auth.login();
    if (result.status !== 'authenticated') status.textContent = `Sign-in ${result.status}.`;
    await render();
  } catch (error) {
    status.textContent = error instanceof ConnectPopupBlockedError ? 'Allow pop-ups for this page, then SIGN IN again.' : 'Sign-in failed. Try again.';
  } finally { signIn.disabled = false; }
});
void client.auth.prepareLogin().catch(() => undefined);
void render();
