// The hub's PEOPLE section after SIGN IN (hub/people-gate.ts), in the local Chrome on a computer and a phone: the page's
// own section and script at the hub's address, SuperRare's API and popup played by stubs. ADD YOURSELF must appear with
// no reload: the session is saved before login() ends, and a popup or an app switch may leave the page in the background.
// With GATE_LIVE=1 the page and its script are the live hub's; SuperRare and the card service stay stubs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright-core';

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const HUB = 'https://thewallarcade.superrare.com';
const WALLET = '0xaaaa000000000000000000000000000000000342';
const STORE = 'superrare.connect.session';
const CREDENTIALS = (address = WALLET) => ({
  session: { sessionId: 'session-1', userId: 'user-1', address, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
  refreshToken: 'refresh-1', refreshExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
});
/** A session in the page's storage, as the SDK writes it: the same browser signed in elsewhere. */
const saveSession = (page: Page) => page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [STORE, JSON.stringify({ credentials: CREDENTIALS(), lineageId: 'session-1' })]);
const DEVICES: Record<string, BrowserContextOptions> = {
  computer: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
};

let browser: Browser, page$: string, gate: string;
before(async () => {
  if (!CHROME) return;
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const html = await readFile(new URL('../hub/src.html', import.meta.url), 'utf8');
  page$ = `<!doctype html><title>x</title>${/<section class="people"[\s\S]*?<\/section>/.exec(html)![0]}<script src="/people-gate.js"></script>`;
  const out = await build({ entryPoints: [new URL('../hub/people-gate.ts', import.meta.url).pathname], bundle: true, format: 'iife', platform: 'browser', write: false });
  gate = out.outputFiles[0]!.text;
});
after(() => browser?.close());

type Stage = { context: BrowserContext; page: Page; claimable: boolean };
async function stage(device: BrowserContextOptions): Promise<Stage> {
  const context = await browser.newContext(device);
  const s: Stage = { context, page: null as unknown as Page, claimable: false };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (!process.env.GATE_LIVE) await context.route(`${HUB}/**`, (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill(path === '/people-gate.js' ? { contentType: 'text/javascript', body: gate } : { contentType: 'text/html', body: page$ });
  });
  await context.route('https://wall-arcade-cards.netlify.app/**', (r) => r.fulfill({ json: [{ panel: 342, name: 'KARP', wallet: WALLET, sprite: null }], headers: cors }));
  await context.route('https://connect.superrare.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Connect</title>' }));
  await context.route('https://api.superrare.com/**', async (r) => {
    const request = r.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const json = (body: unknown, status = 200) => r.fulfill({ status, json: body, headers: cors });
    if (path === '/v1/connect/intents') return json({ data: { intentId: 'intent-1', url: 'https://connect.superrare.com/login/intent-1', expiresAt: new Date(Date.now() + 600_000).toISOString() } }, 201);
    if (path === '/v1/connect/auth/claim') {
      const body = request.postDataJSON() as { intentId: string; state: string };
      return s.claimable ? json({ data: { code: 'code-1', intentId: body.intentId, state: body.state, expiresAt: new Date(Date.now() + 60_000).toISOString() } }) : json({ error: { code: 'not_completed', message: 'not yet' } }, 409);
    }
    if (path === '/v1/connect/auth/exchange') return json({ data: CREDENTIALS() });
    if (path === '/v1/connect/users/me') return;                 // the profile never comes back in time: login() stays open
    return json({ data: {} });
  });
  s.page = await context.newPage();
  await s.page.goto(`${HUB}/#people`);
  await s.page.locator('#signIn').waitFor();
  return s;
}
const shown = (page: Page, ms: number) => page.locator('#addYourself').waitFor({ state: 'visible', timeout: ms });
async function signIn(s: Stage): Promise<Page> {
  const [popup] = await Promise.all([s.context.waitForEvent('page'), s.page.click('#signIn')]);
  return popup;
}
/** The phone's app switch: the hub's tab goes to the background and back. */
const away = (page: Page, hidden: boolean) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: h ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

for (const [name, device] of Object.entries(DEVICES)) {
  test(`${name}: the popup closes on success, the profile is slow: ADD YOURSELF with no reload`, { skip: !CHROME }, async () => {
    const s = await stage(device);
    const popup = await signIn(s);
    assert.match(await s.page.locator('#gateStatus').innerText(), /open in a popup/i);
    s.claimable = true;
    await popup.close();                                          // the SDK claims the code, saves the session, then waits for the profile
    await shown(s.page, 6000);
    assert.equal(await s.page.locator('#myName').innerText(), 'KARP');
    assert.equal(await s.page.locator('#gateStatus').innerText(), '');
    assert.equal(await s.page.locator('#gateOut').isVisible(), false);
    await s.context.close();
  });

  test(`${name}: back from the background with the popup still open: ADD YOURSELF with no reload`, { skip: !CHROME }, async () => {
    const s = await stage(device);
    await signIn(s);
    await away(s.page, true);
    s.claimable = true;
    await away(s.page, false);                                    // the SDK claims on return
    await shown(s.page, 4000);
    await s.context.close();
  });

  test(`${name}: signed in elsewhere: the page reads the session on focus and from another tab`, { skip: !CHROME }, async () => {
    const s = await stage(device);
    await saveSession(s.page);
    await s.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await shown(s.page, 2000);
    const other = await stage(device);
    const second = await other.context.newPage();
    await second.goto(`${HUB}/#people`);
    await saveSession(second);                                    // another tab of the same browser: the storage event
    await shown(other.page, 2000);
    await s.context.close(); await other.context.close();
  });

  test(`${name}: a focus while the popup is open keeps its line; a second focus does not flash the section`, { skip: !CHROME }, async () => {
    const s = await stage(device);
    await signIn(s);
    await s.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await s.page.waitForTimeout(700);
    assert.match(await s.page.locator('#gateStatus').innerText(), /open in a popup/i);
    await s.context.close();
    const signed = await stage(device);
    await saveSession(signed.page);
    await signed.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await shown(signed.page, 2000);
    const flashed = await signed.page.evaluate(() => {
      const box = document.getElementById('gateIn') as HTMLElement; let hid = false;
      new MutationObserver(() => { if (box.hidden) hid = true; }).observe(box, { attributes: true });
      for (const type of ['focus', 'pageshow']) window.dispatchEvent(new Event(type));
      return new Promise<boolean>((done) => setTimeout(() => done(hid), 300));
    });
    assert.equal(flashed, false);
    await signed.context.close();
  });
}
