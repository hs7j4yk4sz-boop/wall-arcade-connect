// The hub's first block, the game of the week (hub/src.html), and ALL GAMES, in the local Chrome, on the built pages: the real
// page with /finale.json stubbed, before, during and after the Final, and with no Final (the hottest game); the preview's
// ?demo=; the real page has no demo.
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
const row = (rank: number): unknown => ({ rank, name: `<b>p${rank}</b>`, score: 10000 - rank, eth: '0.02' });
const pot = (slug: string, plays: number, leader: { name: string; score: number } | null = null): unknown => ({ slug, plays, potEth: (plays * 5 / 1e5).toFixed(5), leader });
// the seed's four live games, the biggest pot first
const POTS = [pot('full-row', 30, { name: 'heast.eth', score: 4321 }), pot('dirty-signals-radio', 12, { name: 'one.eth', score: 12340 }), pot('unbreakable', 3, { name: '0x77d3…92e2', score: 980 }), pot('the-morning-brew', 0)];
const doc = (finale: Record<string, unknown> | null, games: unknown[] = POTS): unknown => ({
  updatedAt: 'x', week: { n: 3 }, plays: 45, finaleEth: '0.1000', addEth: '0.00225', welcomeLeft: 100, games,
  finale: finale && { n: 3, from: new Date(Date.now() + 864e5).toISOString(), to: new Date(Date.now() + 9e7).toISOString(), game: GAME, bonus: null, extra: null, space: null, places: 5, prizesEth: ['0.04', '0.025', '0.015', '0.012', '0.008'], top: [], next: null, ...finale },
});

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

async function open(site: string, files: Record<string, Uint8Array>, path: string, answer: () => unknown, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  await context.route('**/*', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/finale.json')) return r.fulfill({ json: answer(), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === site) { const f = files[url.pathname.slice(1) || 'index.html']; return f ? r.fulfill({ body: Buffer.from(f), contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html' }) : r.fulfill({ status: 404 }); }
    return r.abort();
  });
  await page.goto(`${site}${path}`);
  await page.locator('#final').waitFor({ state: 'visible' });
  return page;
}
const text = (page: Page, id: string): Promise<string> => page.locator(`#${id}`).innerText();
const listed = async (page: Page): Promise<string[]> => page.locator('#gameList h3').allInnerTexts();

test('no Final (not public): the hottest game, its pot and leader, no prize, not in ALL GAMES a second time', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc(null));
  assert.match(await text(page, 'wLabel'), /hottest game this week/i);
  assert.equal(await text(page, 'wGame'), 'FULL ROW');
  assert.equal(await page.locator('#wPrize').isVisible(), false);
  assert.match(await text(page, 'fLabel'), /this week's pot · 0\.00150 ETH/i);
  assert.match(await text(page, 'fBeat'), /Score to beat 4,321 · heast\.eth/);
  assert.match(await text(page, 'fCount'), /^CLOSES IN \dD /);
  assert.equal(await page.locator('#fPlay').getAttribute('href'), 'https://yfq52eu3.srstudio.dev/');
  assert.match(await text(page, 'fPlay'), /PLAY FULL ROW/);
  assert.deepEqual(await listed(page), ['DIRTY SIGNALS RADIO', 'UNBREAKABLE', 'THE MORNING BREW']);
  assert.equal(await page.locator('#howFinale').evaluate((p) => (p as HTMLElement).hidden), true);
  assert.equal(await page.locator('#jackpot').count(), 0, 'no global jackpot block');
  assert.ok(!(await page.locator('body').innerText()).includes('0.1 ETH from NFC'));
  await page.context().close();
});

test('no game picked this week: the hottest game too', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc({ state: 'before', game: null }));
  assert.equal(await text(page, 'wGame'), 'FULL ROW');
  assert.equal(await page.locator('#wPrize').isVisible(), false);
  await page.context().close();
});

test('before: the game of the week, its prize, the Final\'s hours in three cities, its countdown, the score to beat, PLAY', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc({ state: 'before', from: '2027-11-12T16:00:00.000Z', to: '2027-11-12T23:00:00.000Z', extra: '10 coffees', bonus: 'Top 10: a Bully Meow coffee NFT' }));
  assert.match(await text(page, 'wLabel'), /game of the week/i);
  assert.equal(await text(page, 'wGame'), 'DIRTY SIGNALS RADIO');
  assert.equal(await text(page, 'wBy'), 'by Bully Meow · panel 18');
  assert.equal(await page.locator('#wClip video').getAttribute('src'), 'clips/dirty-signals-radio.mp4');
  assert.match(await text(page, 'wPrize'), /THIS GAME'S PRIZE\n+0\.1 ETH \+ 10 COFFEES\n+0\.04 \/ 0\.025 \/ 0\.015 \/ 0\.012 \/ 0\.008 ETH\n+Top 10: a Bully Meow coffee NFT\n+Paid by NFC\. Best score during the final wins\./);
  assert.match(await text(page, 'fLabel'), /the final · live on x/i);
  assert.equal(await page.locator('#fWhen').textContent(), 'FRI NOV 12 · 4PM → 11PM LISBON · 8AM SF · 11AM NY');
  assert.match(await text(page, 'fCount'), /^STARTS IN \d+D /);
  assert.equal(await text(page, 'fBeat'), 'Score to beat 12,340 · one.eth');
  assert.equal(await page.locator('#fPlay').getAttribute('href'), `${GAME.origin}/`);
  assert.equal(await text(page, 'fPlay'), 'PLAY DIRTY SIGNALS RADIO →');
  assert.equal(await page.locator('#fPractice').getAttribute('href'), `${GAME.origin}/`);
  assert.equal(await text(page, 'fPractice'), 'Practice for free first');
  assert.equal(await page.locator('#fTop').isVisible(), false);
  assert.equal(await page.locator('#fSpace').isVisible(), false);
  assert.deepEqual(await listed(page), ['FULL ROW', 'UNBREAKABLE', 'THE MORNING BREW'], 'by pot, the game of the week above');
  assert.equal(await page.locator('#howFinale').evaluate((p) => (p as HTMLElement).hidden), false);
  await page.context().close();
  // the week the US is still on summer time and Lisbon is not; no words after the 0.1 ETH, no bonus line
  const odd = await open(HUB, real, '/', () => doc({ state: 'before', from: '2027-11-05T16:00:00.000Z', to: '2027-11-05T23:00:00.000Z' }));
  assert.equal(await odd.locator('#fWhen').textContent(), 'FRI NOV 5 · 4PM → 11PM LISBON · 9AM SF · 12PM NY');
  assert.equal(await text(odd, 'pBig'), '0.1 ETH');
  assert.equal(await odd.locator('#pBonus').isVisible(), false);
  await odd.context().close();
});

test('live: LIVE NOW, the end in, the top 5 of the seven hours, names as text, the space when set', { skip: !CHROME }, async () => {
  const window = { from: new Date(Date.now() - 36e5).toISOString(), to: new Date(Date.now() + 72e5).toISOString() };
  const page = await open(HUB, real, '/', () => doc({ state: 'live', ...window, top: [1, 2, 3, 4, 5].map(row), space: 'https://x.com/i/spaces/1ABCdefGHIjk' }));
  assert.match(await page.locator('#final').getAttribute('class') ?? '', /\bon\b/);
  assert.match(await text(page, 'fLabel'), /live now/i);
  assert.match(await text(page, 'fCount'), /^ENDS IN 0D 01:59:\d\d$/);
  assert.equal(await page.locator('#fTop .r').count(), 5);
  assert.equal(await page.locator('#fTop .p').first().innerText(), '<b>p1</b>');
  assert.equal(await text(page, 'fBeat'), 'Score to beat 9,999 · <b>p1</b>');
  assert.equal(await page.locator('#fSpace').getAttribute('href'), 'https://x.com/i/spaces/1ABCdefGHIjk');
  await page.context().close();
  const empty = await open(HUB, real, '/', () => doc({ state: 'live', ...window, space: 'javascript:alert(1)' }));
  assert.match(await text(empty, 'fTop'), /No score yet/);
  assert.equal(await empty.locator('#fSpace').isVisible(), false, 'only an X space link');
  await empty.context().close();
});

test('after: the 5 winners with their amounts, paid Saturday, and the next Final', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc({ state: 'after', top: [1, 2, 3, 4, 5].map(row), next: { from: '2026-11-20T16:00:00.000Z', to: '2026-11-20T23:00:00.000Z', game: { ...GAME, title: 'NEXT' } } }));
  assert.match(await text(page, 'fLabel'), /final of week 3 · the winners/i);
  assert.equal(await text(page, 'fCount'), 'CLOSED');
  assert.match(await text(page, 'fTop'), /PAID SATURDAY/i);
  assert.match(await text(page, 'fTop'), /0\.02 ETH/);
  assert.equal(await page.locator('#fTop .r').count(), 5);
  assert.equal(await text(page, 'fNext'), 'Next Final: NEXT, FRI NOV 20 · 4PM → 11PM LISBON · 8AM SF · 11AM NY.');
  await page.context().close();
});

test('ALL GAMES: the pot and leader of each, biggest first; a game with no score says so', { skip: !CHROME }, async () => {
  const page = await open(HUB, real, '/', () => doc({ state: 'before' }));
  const first = page.locator('#gameList .g').first();
  assert.match(await first.innerText(), /FULL ROW[\s\S]*Pot 0\.00150 ETH[\s\S]*Leader heast\.eth · 4,321/);
  assert.equal(await first.locator('a.btn').getAttribute('href'), 'https://yfq52eu3.srstudio.dev/');
  assert.match(await page.locator('#gameList .g').last().innerText(), /THE MORNING BREW[\s\S]*Pot 0\.00000 ETH[\s\S]*No score yet/);
  assert.match(await page.locator('#games .intro').innerText(), /Every game has its own pot\. Each play adds 0\.00005 ETH to it, and the best score of the week takes it, every Friday at 11pm Lisbon\./);
  assert.equal(await page.locator('#games a[href="./earnings.html"]').count(), 1);
  await page.context().close();
});

test('a phone: the name, the prize and PLAY in the first screen; no sideways scroll in any state', { skip: !CHROME }, async () => {
  for (const state of ['before', 'live', 'after', 'none']) {
    const page = await open(HUB, real, '/', () => (state === 'none' ? doc(null) : doc({ state, extra: '10 coffees', bonus: 'Top 10: a Bully Meow coffee NFT', top: state === 'before' ? [] : [1, 2, 3, 4, 5].map(row) })), { width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, state);
    if (state === 'before') {
      const bottom = async (sel: string): Promise<number> => (await page.locator(sel).boundingBox())?.y ?? 0;
      assert.ok(await bottom('#wGame') < 300 && await bottom('#pSplit') < 844 && (await bottom('#fPlay')) + 58 <= 844, 'name, prize and PLAY within 844 px');
    }
    await page.context().close();
  }
});

test('the real build has no demo: no file, no bar, ?demo= changes nothing', { skip: !CHROME }, async () => {
  assert.equal(real['demo.js'], undefined);
  assert.ok(!strFromU8(real['index.html'] as Uint8Array).includes('demo.js'));
  assert.ok(!strFromU8(real['admin-page.js'] as Uint8Array).includes('fictitious'));
  assert.ok(strFromU8(real['tag.js'] as Uint8Array).includes('/api/events'));
  const page = await open(HUB, real, '/?demo=live', () => doc({ state: 'before' }));
  assert.equal(await page.locator('.demo-bar').count(), 0);
  assert.match(await text(page, 'fCount'), /STARTS IN/);
  await page.context().close();
});

test('the preview: ?demo= runs by itself, nothing reaches the service, the tags go nowhere, the pages read the draft', { skip: !CHROME }, async () => {
  assert.ok(!strFromU8(draft['tag.js'] as Uint8Array).includes('/api/'));
  assert.ok(!strFromU8(draft['index.html'] as Uint8Array).includes('https://wall-arcade-cards.netlify.app'));
  assert.ok(!strFromU8(draft['admin-page.js'] as Uint8Array).includes('https://wall-arcade-cards.netlify.app'));
  let served = 0;
  const page = await open(DRAFT, draft, '/?demo=live', () => { served++; return {}; });
  await page.locator('.demo-bar').waitFor();
  const first = await page.locator('#fTop').innerText();
  await page.waitForFunction((was) => (document.getElementById('fTop') as HTMLElement).innerText !== was, first, { timeout: 15000 });
  assert.equal(served, 0);
  assert.equal(await page.locator('#fTop .r').count(), 5);
  await page.click('#welcomeClaim');
  assert.match(await text(page, 'welcomeSaid'), /nothing granted/i);
  await page.context().close();
  const none = await open(DRAFT, draft, '/?demo=none', () => ({}));
  assert.match(await text(none, 'wLabel'), /hottest game/i);
  await none.context().close();
});
