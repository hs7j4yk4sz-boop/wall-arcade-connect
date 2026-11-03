// THE FINALE block and the prizes counter (hub/src.html) in the local Chrome, on the built pages: the real page with /finale.json
// stubbed, before, during and after; the preview's ?demo=; the real page has no demo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium, type Browser, type Page } from 'playwright-core';

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const HUB = 'https://thewallarcade.superrare.com', DRAFT = 'https://finale--wall-arcade-cards.netlify.app';
const GAME = { slug: 'dirty-signals-radio', title: 'Dirty Signals Radio', artist: 'Bully Meow', origin: 'https://sy3mgnnh.srstudio.dev' };
const row = (rank: number): unknown => ({ rank, name: `<b>p${rank}</b>`, score: 1000 - rank, eth: '0.02' });
const doc = (plays: number, finale: Record<string, unknown>): unknown => ({ updatedAt: 'x', week: { n: 3 }, plays, finaleEth: '0.1000', addEth: (plays * 5 / 1e5).toFixed(5), welcomeLeft: 100, finale: { n: 3, from: new Date(Date.now() + 864e5).toISOString(), to: new Date(Date.now() + 9e7).toISOString(), game: GAME, bonus: null, places: 5, prizesEth: ['0.04', '0.025', '0.015', '0.012', '0.008'], top: [], next: null, ...finale } });

function built(preview: boolean): Record<string, Uint8Array> {
  const out = join(mkdtempSync(join(tmpdir(), 'hub-')), 'hub.zip');
  execFileSync('npx', ['tsx', 'scripts/build-hub.ts', '--output', out, '--offline', ...(preview ? ['--preview', DRAFT] : [])], { stdio: 'pipe' });
  return unzipSync(readFileSync(out));
}
let browser: Browser, real: Record<string, Uint8Array>, draft: Record<string, Uint8Array>;
before(async () => {
  real = built(false); draft = built(true);
  if (CHROME) browser = await chromium.launch({ executablePath: CHROME, headless: true });
});
after(() => browser?.close());

async function open(site: string, files: Record<string, Uint8Array>, path: string, answer: () => unknown, viewport = { width: 1280, height: 900 }, wait = '#finale'): Promise<Page> {
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  await context.route('**/*', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/finale.json')) return r.fulfill({ json: answer(), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === site) { const f = files[url.pathname.slice(1) || 'index.html']; return f ? r.fulfill({ body: Buffer.from(f), contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' }) : r.fulfill({ status: 404 }); }
    return r.abort();
  });
  await page.goto(`${site}${path}`);
  await page.locator(wait).waitFor({ state: 'visible' });
  return page;
}

test('the finale not public: the plays alone, no block, no line in How it works', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => ({ ...doc(3, {}) as object, finaleEth: '0', finale: null }), undefined, '#prizes');
  await page.locator('#prizes', { hasText: '3 plays this week' }).waitFor();
  assert.equal(await page.locator('#prizes').innerText(), 'PRIZES THIS WEEK: 0.00015 ETH · 3 plays this week');
  assert.equal(await page.locator('#finale').isVisible(), false);
  assert.equal(await page.locator('#howFinale').evaluate((p) => (p as HTMLElement).hidden), true);
  assert.ok(!(await page.locator('body').innerText()).includes('0.1'));
  await page.context().close();
});

test('the real page: the prizes in place of the balance, as John wrote them', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(3, { state: 'before' }));
  assert.equal(await page.locator('#prizes').innerText(), 'PRIZES THIS WEEK: 0.1000 + 0.00015 ETH · 3 plays this week');
  assert.equal(await page.locator('#fPrizes').innerText(), 'PRIZES THIS WEEK: 0.1000 + 0.00015 ETH · 3 plays this week');
  assert.equal(await page.locator('#potAmount').count(), 0);
  await page.context().close();
});

test('one play: "1 play"; the counter follows the service', { skip: !CHROME }, async () => {
  let plays = 1;
  const page = await open(HUB, real, '/', () => doc(plays, { state: 'before' }));
  assert.match(await page.locator('#prizes').innerText(), /0\.00005 ETH · 1 play this week/);
  plays = 4;
  await page.evaluate(() => (window as unknown as { loadLive(): void }).loadLive());
  await page.getByText('4 plays this week').first().waitFor();
  assert.match(await page.locator('#prizes').innerText(), /0\.00020 ETH · 4 plays this week\+0\.00015/);
  await page.context().close();
});

test('before: the game, its countdown, PRACTICE; no board', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(0, { state: 'before' }));
  assert.equal(await page.locator('#fGame').innerText(), 'DIRTY SIGNALS RADIO');
  assert.match(await page.locator('#fCount').innerText(), /^OPENS IN 0D 23:59/);
  assert.equal(await page.locator('#fPlay').getAttribute('href'), `${GAME.origin}/`);
  assert.match(await page.locator('#fPlay').innerText(), /PRACTICE/);
  assert.equal(await page.locator('#fTop').isVisible(), false);
  await page.context().close();
});

test('the start in three cities, and the bonus line under the prizes', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(0, { state: 'before', from: '2027-11-12T16:00:00.000Z', to: '2027-11-12T23:00:00.000Z', bonus: '+ 10 coffees by Bully Meow for the top 10' }));
  assert.equal(await page.locator('#fLabel').textContent(), 'The Finale · FRI NOV 12 · 4PM LISBON · 8AM SF · 11AM NY');
  assert.equal(await page.locator('#fBonus').innerText(), '+ 10 coffees by Bully Meow for the top 10');
  await page.context().close();
  // the week the US is still on summer time and Lisbon is not
  const odd = await open(HUB, real, '/', () => doc(0, { state: 'before', from: '2027-11-05T16:00:00.000Z', to: '2027-11-05T23:00:00.000Z' }));
  assert.equal(await odd.locator('#fLabel').textContent(), 'The Finale · FRI NOV 5 · 4PM LISBON · 9AM SF · 12PM NY');
  assert.equal(await odd.locator('#fBonus').isVisible(), false);
  await odd.context().close();
});

test('no game picked: to be announced, no link', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(0, { state: 'before', game: null }));
  assert.match(await page.locator('#fGame').innerText(), /to be announced/i);
  assert.equal(await page.locator('#fPlay').isVisible(), false);
  await page.context().close();
});

test('live: yellow, the top 5, names as text; a board with no score says so', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(0, { state: 'live', from: new Date(Date.now() - 36e5).toISOString(), to: new Date(Date.now() + 72e5).toISOString(), top: [1, 2, 3, 4, 5].map(row) }));
  assert.match(await page.locator('#finale').getAttribute('class') ?? '', /on/);
  assert.equal(await page.locator('#fTop .r').count(), 5);
  assert.equal(await page.locator('#fTop .p').first().innerText(), '<b>p1</b>');
  assert.match(await page.locator('#fPlay').innerText(), /PLAY THE FINALE/);
  assert.match(await page.locator('#fCount').innerText(), /^0D 01:59:\d\d LEFT$/);
  await page.context().close();
  const empty = await open(HUB, real, '/', () => doc(0, { state: 'live', from: new Date(Date.now() - 36e5).toISOString(), to: new Date(Date.now() + 72e5).toISOString() }));
  assert.match(await empty.locator('#fTop').innerText(), /No score yet/);
  await empty.context().close();
});

test('after: the winners with their amounts and the next finale', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(0, { state: 'after', top: [1, 2, 3].map(row), next: { from: '2026-11-20T16:00:00.000Z', to: '2026-11-20T23:00:00.000Z', game: { ...GAME, title: 'NEXT' } } }));
  assert.match(await page.locator('#fLabel').innerText(), /week 3/i);
  assert.equal(await page.locator('#fCount').innerText(), 'CLOSED');
  assert.match(await page.locator('#fWhat').innerText(), /Next Finale: NEXT, FRI NOV 20 · 4PM LISBON · 8AM SF · 11AM NY\./);
  assert.match(await page.locator('#fTop').innerText(), /0\.02 ETH/);
  await page.context().close();
});

test('a phone: no sideways scroll in any state', { skip: !CHROME }, async () => {
  for (const state of ['before', 'live', 'after']) {
    const page = await open(HUB, real, '/', () => doc(1234, { state, top: state === 'before' ? [] : [1, 2, 3, 4, 5].map(row) }), { width: 360, height: 780 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, state);
    await page.context().close();
  }
});

test('the real build has no demo: no file, no bar, ?demo= changes nothing', { skip: !CHROME }, async () => {
  assert.equal(real['demo.js'], undefined);
  assert.ok(!strFromU8(real['index.html'] as Uint8Array).includes('demo.js'));
  assert.ok(!strFromU8(real['admin-page.js'] as Uint8Array).includes('fictitious'));
  assert.ok(strFromU8(real['tag.js'] as Uint8Array).includes('/api/events'));
  const page = await open(HUB, real, '/?demo=live', () => doc(3, { state: 'before' }));
  assert.equal(await page.locator('.demo-bar').count(), 0);
  assert.match(await page.locator('#fCount').innerText(), /OPENS IN/);
  await page.context().close();
});

test('the preview: ?demo= runs by itself, nothing reaches the service, the tags go nowhere, the pages read the draft', { skip: !CHROME }, async () => {
  assert.ok(!strFromU8(draft['tag.js'] as Uint8Array).includes('/api/'));
  assert.ok(!strFromU8(draft['index.html'] as Uint8Array).includes('https://wall-arcade-cards.netlify.app'));
  assert.ok(!strFromU8(draft['admin-page.js'] as Uint8Array).includes('https://wall-arcade-cards.netlify.app'));
  let served = 0;
  const page = await open(DRAFT, draft, '/?demo=live', () => { served++; return {}; });
  await page.locator('.demo-bar').waitFor();
  const first = await page.locator('#prizes').innerText();
  await page.waitForFunction((was) => (document.getElementById('prizes') as HTMLElement).innerText !== was, first, { timeout: 6000 });
  assert.equal(served, 0);
  assert.equal(await page.locator('#fTop .r').count(), 5);
  await page.click('#welcomeClaim');
  assert.match(await page.locator('#welcomeSaid').innerText(), /nothing granted/i);
  await page.context().close();
});
