// SUBMIT YOUR GAME (hub/submit.html), bundled by scripts/build-hub.ts as submit-page.js. SIGN IN with SuperRare Connect
// (popup, sign-in only), then the card service (cards/src/submit.ts) says which names of the wall the wallet holds: none,
// the form stays closed; one or more, the form opens with the name. CHECK & SUBMIT sends the form with the Connect access
// token (the service asks SuperRare whose it is) and shows the eight checks, green or red with the remedy. No payment, no
// signature, no credit here.
import { ConnectPopupBlockedError, createSuperRareClient } from '@rareprotocol/connect';

const API = 'https://wall-arcade-cards.netlify.app/api/submit';
type Name = { name: string; panel: number; handle: string | null };
type Check = { n: number; ok: boolean | null; label: string; fix?: string };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const client = createSuperRareClient({ studioUrl: 'https://studio.superrare.com', apiUrl: 'https://api.superrare.com', connectUrl: 'https://connect.superrare.com' });
const status = $('status'), signIn = $<HTMLButtonElement>('submitSignIn'), send = $<HTMLButtonElement>('send');
const field = (id: string): HTMLInputElement => $<HTMLInputElement>(id);
const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
const show = (id: 'out' | 'noName' | 'formBox' | 'done'): void => { for (const s of ['out', 'noName', 'formBox', 'done']) $(s).hidden = s !== id; };
let names: Name[] = [];

async function call(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const accessToken = await client.auth.getAccessToken();
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, accessToken }) });
  return { status: r.status, data: await r.json().catch(() => ({})) as Record<string, unknown> };
}

/** Who is signed in, and what they hold. */
async function render(): Promise<void> {
  const session = client.auth.getSession();
  if (!session) { show('out'); status.textContent = ''; return; }
  status.textContent = 'Checking your wallet…';
  try {
    const { status: code, data } = await call({ step: 'names' });
    if (code === 401) { await client.auth.logout().catch(() => client.auth.clearSession()); show('out'); status.textContent = 'Sign in again.'; return; }
    if (code !== 200) throw new Error(`HTTP ${code}`);
    names = (data.names as Name[]) ?? [];
    const wallet = String(data.wallet);
    if (!names.length) { show('noName'); $('noNameWallet').textContent = `${short(wallet)} holds no name of the wall.`; status.textContent = ''; return; }
    const select = $<HTMLSelectElement>('panel');
    select.innerHTML = '';
    for (const n of names) select.append(new Option(`${n.name} · panel ${n.panel}`, String(n.panel)));
    $('nameRow').hidden = names.length < 2;
    $('myName').textContent = (names[0] as Name).name;
    if (!field('payoutWallet').value) field('payoutWallet').value = wallet;
    show('formBox'); status.textContent = '';
  } catch {
    show('out'); status.textContent = 'Your wallet could not be checked. Try again in a minute.';
  }
}

$<HTMLSelectElement>('panel').addEventListener('change', (e) => {
  const n = names.find((x) => String(x.panel) === (e.target as HTMLSelectElement).value);
  if (n) $('myName').textContent = n.name;
});

async function login(): Promise<void> {
  signIn.disabled = true;
  status.textContent = 'SuperRare Connect is open in a popup.';
  try {
    if (client.auth.getSession()) await client.auth.logout().catch(() => client.auth.clearSession());
    const result = await client.auth.login();
    if (result.status !== 'authenticated') status.textContent = `Sign-in ${result.status}.`;
    await render();
  } catch (error) {
    status.textContent = error instanceof ConnectPopupBlockedError ? 'Allow pop-ups for this page, then press SIGN IN again.' : 'Sign-in failed. Try again.';
  } finally { signIn.disabled = false; }
}
signIn.addEventListener('click', () => void login());
$('otherWallet').addEventListener('click', () => void login());
void client.auth.prepareLogin().catch(() => undefined);   // the tap opens Connect at once (iOS keeps a blank window otherwise)

function showErrors(errors: Record<string, string>): void {
  for (const el of document.querySelectorAll<HTMLElement>('.err')) el.textContent = errors[el.dataset.for ?? ''] ?? '';
}
function showChecks(checks: Check[]): void {
  const list = $('checks');
  list.innerHTML = '';
  for (const c of checks) {
    const li = document.createElement('li');
    li.className = c.ok === true ? 'ok' : c.ok === false ? 'no' : 'wait';
    const mark = document.createElement('span'); mark.className = 'mark'; mark.textContent = c.ok === true ? '✓' : c.ok === false ? '✕' : '–';
    const label = document.createElement('span'); label.textContent = c.label;
    li.append(mark, label);
    if (c.ok !== true && c.fix) { const fix = document.createElement('span'); fix.className = 'fix'; fix.textContent = c.fix; li.append(fix); }
    list.append(li);
  }
  list.hidden = false;
}

$<HTMLFormElement>('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    panel: Number($<HTMLSelectElement>('panel').value) || null, origin: field('origin').value, appId: field('appId').value,
    title: field('title').value, line: field('line').value, payoutWallet: field('payoutWallet').value, agree: field('agree').checked,
  };
  send.disabled = true; status.textContent = 'Checking your game… (up to 20 seconds)'; showErrors({});
  try {
    const { status: code, data } = await call(body);
    if (code === 401) { status.textContent = 'Your session ended: sign in again.'; show('out'); return; }
    if (code === 400 && data.errors) { showErrors(data.errors as Record<string, string>); status.textContent = 'Fix the fields in red.'; return; }
    if (code !== 200) throw new Error(`HTTP ${code}`);
    showChecks((data.checks as Check[]) ?? []);
    if (data.ok) { show('done'); status.textContent = ''; window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    status.textContent = 'Fix what is red, then CHECK & SUBMIT again.';
    $('checks').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    status.textContent = 'The check could not run. Try again in a minute.';
  } finally { send.disabled = false; }
});

void render();
