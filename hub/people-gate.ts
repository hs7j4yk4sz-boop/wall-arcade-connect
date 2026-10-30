// The hub's PEOPLE section, token-gated: ADD YOURSELF only for a player signed in with SuperRare Connect whose wallet
// holds a name of the wall (the card service's people.json, public). Bundled by scripts/build-hub.ts as people-gate.js.
// The Sprite Party capture link is never in the page: at the click on ADD YOURSELF the page sends its Connect session to
// the card service (POST /people/capture), which checks it with SuperRare and answers a link with a token signed for
// that wallet's name, valid 2 minutes. The link opens in the instant of the click (a window opened at once, sent to the
// link when it arrives); another click asks for a new token. Anyone else keeps "People of the wall only." and SIGN IN.
// Sign-in only: no game authorization, no credit, no payment on this page. Connect opens in a popup on the click.
import { ConnectPopupBlockedError, createSuperRareClient } from '@rareprotocol/connect';

const CARDS = 'https://wall-arcade-cards.netlify.app';
const CAPTURE = /^https:\/\/www\.spriteparty\.com\/p\/[A-Za-z0-9_-]+\/capture#handoff=[\w-]+\.[\w-]+\.[\w-]+$/;
type Person = { panel: number; name: string; wallet?: string; sprite: unknown };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const out = $('gateOut'), inside = $('gateIn'), signIn = $<HTMLButtonElement>('signIn'), status = $('gateStatus');
const add = $<HTMLButtonElement>('addYourself'), myName = $('myName'), hint = $('gateHint');

const client = createSuperRareClient({ studioUrl: 'https://studio.superrare.com', apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com' });
const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The name a capture would go to: the wallet's first name without a character, else its first (as the card service picks). */
async function nameOf(wallet: string): Promise<Person | null> {
  const response = await fetch(`${CARDS}/people.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const list = await response.json() as Person[];
  const mine = Array.isArray(list) ? list.filter((p) => p && p.wallet === wallet && typeof p.name === 'string') : [];
  return mine.find((p) => !p.sprite) ?? mine[0] ?? null;
}

/** Shows the section for whoever is signed in: a holder gets their name, the button and the instruction. */
async function render(): Promise<void> {
  const wallet = client.auth.getSession()?.address.toLowerCase();
  inside.hidden = true; out.hidden = false;
  if (!wallet) { status.textContent = ''; return; }
  status.textContent = 'Checking your wallet…';
  try {
    const person = await nameOf(wallet);
    if (client.auth.getSession()?.address.toLowerCase() !== wallet) return;
    if (!person) { status.textContent = `${short(wallet)} holds no name of the wall.`; return; }
    myName.textContent = person.name;
    hint.textContent = `Your character goes on ${person.name}. If Sprite Party asks for a Player name, type ${person.name}.`;
    out.hidden = true; inside.hidden = false; status.textContent = '';
  } catch {
    status.textContent = 'Your wallet could not be checked. Try again in a minute.';
  }
}

// ADD YOURSELF: the window opens in the instant of the click (no popup blocker), then goes to the freshly signed link
add.addEventListener('click', async () => {
  const win = window.open('', '_blank');
  add.disabled = true; status.textContent = 'Opening Sprite Party…';
  try {
    const accessToken = await client.auth.getAccessToken();
    const response = await fetch(`${CARDS}/people/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken }) });
    const data = await response.json().catch(() => ({})) as { url?: unknown; error?: unknown };
    if (!response.ok || typeof data.url !== 'string' || !CAPTURE.test(data.url)) {
      throw new Error(response.status === 401 ? 'Sign in again: your SuperRare session is not valid any more.' : typeof data.error === 'string' ? data.error : 'The link could not be made. Try again.');
    }
    if (win && !win.closed) { win.opener = null; win.location.href = data.url; } else window.location.href = data.url;
    status.textContent = '';
  } catch (error) {
    win?.close();
    status.textContent = error instanceof Error ? error.message : 'The link could not be made. Try again.';
  } finally {
    add.disabled = false;
  }
});

// prepared when the section comes into view, so the tap opens Connect at once (iOS keeps a blank window otherwise)
let prepared = false;
new IntersectionObserver((entries, observer) => {
  if (!entries.some((e) => e.isIntersecting) || prepared || client.auth.getSession()) return;
  prepared = true; observer.disconnect();
  void client.auth.prepareLogin().catch(() => { prepared = false; });
}).observe($('people'));

signIn.addEventListener('click', async () => {
  signIn.disabled = true;
  status.textContent = 'SuperRare Connect is open in a popup.';
  try {
    if (client.auth.getSession()) await client.auth.logout().catch(() => client.auth.clearSession());   // another wallet
    const result = await client.auth.login();
    if (result.status !== 'authenticated') status.textContent = `Sign-in ${result.status}.`;
    await render();
  } catch (error) {
    status.textContent = error instanceof ConnectPopupBlockedError ? 'Allow pop-ups for this page, then press SIGN IN again.' : 'Sign-in failed. Try again.';
  } finally {
    signIn.disabled = false;
  }
});
void render();
