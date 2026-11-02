// The admin page's JACKPOT section (hub/admin.html, hub/admin-jackpot.ts) in the local Chrome, on week 2: the card service and
// SuperRare are stubs, the wallet a stand-in that records what it is asked; nothing touches a chain. PAY is live only for the
// treasury with a balance that covers the week; one click, one send, the hash recorded at once. Week 1, paid by hand: MARK PAID.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { decodeDisperse, DISPERSE } from '../cards/src/disperse.js';
import { buildPlan, ethOf, numberedWeek, type Best } from '../cards/src/jackpot.js';
import type { Game } from '../cards/src/games.js';

const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
const HUB = 'https://thewallarcade.superrare.com';
const TREASURY = '0xb6ede0158e1792ed25e1367edeec05a824d7c9ad', OTHER = '0x38f1dfdcaf2f0d70c29d4af6a4aa9e920efe8b18', NFC = '0x00000000000000000000000000000000000a11ce';
const W77 = '0x77d3b23f38968f49d43ab1fe7e3920d7a05b92e2', HEAST = '0x3fbf3747128c03d0715438e6e1fcd9df8aa27b0a', BULLY = '0x14076efc88ca7d53594500261ada8185033e6d5b';
const HASH = `0x${'ab'.repeat(32)}`;
const uuid = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
const game = (n: number, title: string, artist: string, payoutWallet: string | null): Game => ({ appId: uuid(n), origin: `https://g${n}.srstudio.dev`, slug: `g${n}`, title, line: '', artist: { name: artist, panel: null }, payoutWallet, submittedAt: null, attachedAt: null, status: 'live', publishedAt: null, shot: null, order: n });
const GAMES = [game(1, 'UNBREAKABLE', 'ON THE WALL', null), game(2, 'FULL ROW', 'ON THE WALL', null), game(3, 'Dirty Signals Radio', 'Bully Meow', BULLY)];
const heast: Best = { wallet: HEAST, name: 'heast.eth', score: 6753 };
const WEEK1 = buildPlan(numberedWeek(Date.parse('2026-10-29T12:00:00Z')), { [uuid(1)]: 89, [uuid(2)]: 38, [uuid(3)]: 27 }, GAMES, { [uuid(1)]: { wallet: W77, name: '0x77d3…92e2', score: 2432 }, [uuid(2)]: heast, [uuid(3)]: heast });
const PLAN = { ...WEEK1, n: 2 };                                 // week 1's numbers, as week 2: week 1 itself has no PAY
const SESSION = { credentials: { session: { sessionId: 'session-1', userId: 'user-1', address: OTHER, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, refreshToken: 'refresh-1', refreshExpiresAt: new Date(Date.now() + 86400_000).toISOString() }, lineageId: 'session-1' };

let browser: Browser, html: string, script: string;
before(async () => {
  if (!CHROME) return;
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  html = (await readFile(new URL('../hub/admin.html', import.meta.url), 'utf8')).replace('<title>', '<base href="https://thewallarcade.superrare.com/"><title>');
  const out = await build({ entryPoints: [new URL('../hub/admin-page.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'browser', write: false });
  script = out.outputFiles[0]?.text ?? '';
});
after(() => browser?.close());

type Sent = { method: string; params?: unknown[] };
async function open(wallet: { account: string; balance: bigint; chain?: string; refuse?: boolean; failEstimate?: boolean }, status = 'due', plan = PLAN) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const posts: Record<string, unknown>[] = [];
  let record: Record<string, unknown> = { plan, status, computedAt: 'x' };
  const cors = { 'Access-Control-Allow-Origin': HUB, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await context.route(`${HUB}/**`, (r) => { const path = new URL(r.request().url()).pathname; return r.fulfill(path === '/admin-page.js' ? { contentType: 'text/javascript', body: script } : { contentType: 'text/html', body: html }); });
  await context.route('https://api.superrare.com/**', (r) => (r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Origin': '*' } }) : r.fulfill({ status: 201, headers: { 'Access-Control-Allow-Origin': '*' }, json: { data: { intentId: 'i', url: 'https://connect.superrare.com/x', expiresAt: new Date(Date.now() + 6e5).toISOString() } } })));
  await context.route('https://wall-arcade-cards.netlify.app/api/admin', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = r.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.action === 'whoami') return r.fulfill({ headers: cors, json: { admin: true, wallet: OTHER, games: GAMES } });
    if (body.action === 'jackpot-paid') record = { ...record, status: 'paid', hash: body.hash, wall: NFC, paidAt: '2026-10-31T20:00:00.000Z' };
    if (body.action === 'jackpot-manual') record = { ...record, status: 'paid', manual: true, hashes: body.hashes, paidAt: '2026-11-02T14:00:00.000Z' };
    return r.fulfill({ headers: cors, json: { ok: true, weeks: [record], treasury: TREASURY } });
  });
  const page = await context.newPage();
  await page.addInitScript(`
    var w = ${JSON.stringify({ ...wallet, balance: String(wallet.balance) })}, asked = [];
    localStorage.setItem('superrare.connect.session', ${JSON.stringify(JSON.stringify(SESSION))});
    window.asked = asked;
    window.ethereum = { on: function () {}, request: async function (a) {
      asked.push(a);
      if (a.method === 'eth_accounts' || a.method === 'eth_requestAccounts') return [w.account];
      if (a.method === 'eth_chainId') return w.chain || '0x1';
      if (a.method === 'eth_getBalance') return '0x' + BigInt(w.balance).toString(16);
      if (a.method === 'eth_estimateGas') { if (w.failEstimate) throw new Error('execution reverted'); return '0x15a00'; }
      if (a.method === 'eth_sendTransaction') { if (w.refuse) throw Object.assign(new Error('denied'), { code: 4001 }); return '${HASH}'; }
      if (a.method === 'eth_getTransactionReceipt') return { status: '0x1' };
      throw new Error('unexpected ' + a.method);
    } };
  `);
  await page.goto(`${HUB}/admin.html`);
  await page.locator(`#week-${plan.n}`).waitFor();
  await page.click('#walletConnect');
  return { context, page, posts };
}
const asked = (page: Page): Promise<Sent[]> => page.evaluate(() => (window as unknown as { asked: Sent[] }).asked);
const pay = (page: Page) => page.getByRole('button', { name: 'Pay', exact: true });
const ENOUGH = 40_000_000_000_000_000n;                          // 0.04 ETH

test('the table says week 2, and PAY stays off until the wallet is the treasury, on mainnet, with the balance and the wall\'s address', { skip: !CHROME }, async () => {
  const stranger = await open({ account: OTHER, balance: ENOUGH });
  const text = await stranger.page.locator('#week-2').innerText();
  assert.match(text, /Week 2: 154 credits, 0\.0154 ETH/i);
  assert.match(text, /UNBREAKABLE\s+89\s+0x77d3…92e2 · 0\.00445/);
  assert.match(text, /0\.00445 ETH → 0x77d3…92e2/);
  assert.match(text, /0\.00325 ETH → heast\.eth/);
  await stranger.page.fill('.wall-address', NFC);
  assert.equal(await pay(stranger.page).isDisabled(), true);
  assert.match(await stranger.page.locator('.why').innerText(), /not the treasury/);
  await stranger.context.close();

  const poor = await open({ account: TREASURY, balance: 15_399_999_999_999_999n });
  await poor.page.fill('.wall-address', NFC);
  assert.equal(await pay(poor.page).isDisabled(), true);
  assert.match(await poor.page.locator('.why').innerText(), /does not cover 0\.0154 ETH/);
  await poor.context.close();

  const elsewhere = await open({ account: TREASURY, balance: ENOUGH, chain: '0x2105' });
  await elsewhere.page.fill('.wall-address', NFC);
  assert.equal(await pay(elsewhere.page).isDisabled(), true);
  await elsewhere.context.close();

  const ready = await open({ account: TREASURY, balance: BigInt(PLAN.sendWei) });
  assert.equal(await pay(ready.page).isDisabled(), true);       // no wall address yet
  await ready.page.fill('.wall-address', 'not an address');
  assert.equal(await pay(ready.page).isDisabled(), true);
  await ready.page.fill('.wall-address', NFC);
  assert.equal(await pay(ready.page).isDisabled(), false);
  await ready.context.close();
});

test('PAY: one send to Disperse with every line and the wall\'s, the hash recorded, the week paid', { skip: !CHROME }, async () => {
  const { page, posts, context } = await open({ account: TREASURY, balance: ENOUGH });
  await page.fill('.wall-address', NFC);
  await pay(page).click();
  await page.getByText('Week 2 is paid.').waitFor();
  const sends = (await asked(page)).filter((a) => a.method === 'eth_sendTransaction');
  assert.equal(sends.length, 1);
  const tx = sends[0]?.params?.[0] as { from: string; to: string; value: string; data: string };
  assert.equal(tx.from, TREASURY); assert.equal(tx.to, DISPERSE); assert.equal(BigInt(tx.value), BigInt(PLAN.sendWei));
  const lines = decodeDisperse(tx.data);
  assert.equal(lines.at(-1)?.wallet, NFC); assert.equal(ethOf(lines.at(-1)?.wei ?? 0n), ethOf(PLAN.wallWei));
  assert.equal(lines.reduce((sum, l) => sum + l.wei, 0n), BigInt(PLAN.sendWei));
  assert.ok(lines.some((l) => l.wallet === W77 && ethOf(l.wei) === '0.00445'));
  assert.ok(lines.some((l) => l.wallet === HEAST && ethOf(l.wei) === '0.00325'));
  assert.deepEqual(posts.filter((p) => p.action === 'jackpot-paid').map((p) => p.hash), [HASH, HASH]);
  assert.match(await page.locator('#week-2').innerText(), /paid/);
  assert.equal(await pay(page).count(), 0);                     // no second PAY
  await context.close();
});

test('a simulation that fails or a refusal in the wallet sends nothing and records nothing', { skip: !CHROME }, async () => {
  const fails = await open({ account: TREASURY, balance: ENOUGH, failEstimate: true });
  await fails.page.fill('.wall-address', NFC);
  await pay(fails.page).click();
  await fails.page.getByText(/The send would fail/).waitFor();
  assert.equal((await asked(fails.page)).filter((a) => a.method === 'eth_sendTransaction').length, 0);
  await fails.context.close();
  const refused = await open({ account: TREASURY, balance: ENOUGH, refuse: true });
  await refused.page.fill('.wall-address', NFC);
  await pay(refused.page).click();
  await refused.page.getByText(/Refused in the wallet/).waitFor();
  assert.equal(refused.posts.filter((p) => p.action === 'jackpot-paid').length, 0);
  await refused.context.close();
});

test('week 1, paid by hand: no PAY ever, MARK PAID with its hashes, then the hashes on the card', { skip: !CHROME }, async () => {
  const { page, posts, context } = await open({ account: TREASURY, balance: ENOUGH }, 'due', WEEK1);
  assert.equal(await pay(page).count(), 0);
  assert.equal(await page.locator('.wall-address').count(), 0);
  const h = [`0x${'12'.repeat(32)}`, `0x${'34'.repeat(32)}`];
  await page.fill('.manual textarea', h.join('\n'));
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Mark paid (manual)' }).click();
  await page.getByText('Paid by hand, 2 transactions:').waitFor();
  assert.deepEqual(posts.filter((p) => p.action === 'jackpot-manual').map((p) => [p.week, p.hashes]), [[1, h]]);
  assert.match(await page.locator('#week-1').innerText(), /paid by hand/);
  assert.equal(await page.locator('.manual').count(), 0);
  assert.equal((await asked(page)).filter((a) => a.method === 'eth_sendTransaction').length, 0);
  await context.close();
});
