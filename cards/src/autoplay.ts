// A game's clip, first half: its free practice played by a stand-in player and filmed. The page opens at a phone's size,
// the stand-in presses the free entry ("How to play · free", "Practice, free"…), then for a few seconds sends what most
// arcade games answer to: the arrows, Space, Enter, digits, taps inside the game. The page runs on a virtual clock (its
// timers, requestAnimationFrame, Date): one frame at a time, a picture after each, every frame sharp. Run on the Mac
// (scripts/clip-game.ts, the local Chrome: WebGL on the graphics card). It never signs in, never pays: a paid play needs a wallet, it has
// none. It stays on the game's own address: a link elsewhere is blocked, a popup closed. cards/src/clip.ts cuts the clip.
import type { Page } from 'playwright-core';

export const VIEW = { width: 504, height: 960 };
export type Film = { frames: Uint8Array[]; times: number[]; end: number };

/** The free way in, as a player sees it: never a paid one, a sign-in or a link out. */
export const FREE = /practice|how to play|free|try it|demo|tutorial/i;
export const NOT_FREE = /credit|buy|pay|purchase|sign|log ?in|wallet|connect|superrare|←|back|hub|remix the wall|^\s*play\b(?!.*(free|practice))/i;
/** What closes a dialog or moves a tutorial on, as a player would. */
export const ONWARD = /^(skip|stay toy|got it|ok|okay|continue|next|start|go|let'?s go|retry|try again|play again|again|close|✕|×)$/i;

/** What the stand-in does at step `i`: a key, or a tap at a fraction of the game's area. Deterministic, varied. */
export function moveOf(i: number, seed = 0): { key: string } | { tap: [number, number] } {
  const keys = ['ArrowUp', 'Space', 'ArrowRight', 'ArrowUp', 'Enter', 'ArrowLeft', 'Digit1', 'ArrowUp', 'Space', 'ArrowDown', 'Digit2', 'ArrowRight', 'Digit3'];
  if (i % 3 !== 2) return { key: keys[(i + seed) % keys.length] as string };
  const n = Math.floor(i / 3) + seed, r = (k: number): number => ((Math.sin((n + 1) * 12.9898 * k) * 43758.5453) % 1 + 1) % 1;
  return { tap: [0.15 + 0.7 * r(1), 0.3 + 0.6 * r(2)] };          // inside, away from the top bar and its back arrow
}

/** Plays and films `seconds` of the game's free practice. */
export async function filmPractice(page: Page, origin: string, { seconds = 11, seed = 0, deadline = Infinity, fps = 24 } = {}): Promise<Film> {
  const FPS = fps, STEP = 1000 / FPS;
  await page.route('**/*', (route) => {
    const r = route.request();
    return r.isNavigationRequest() && r.frame() === page.mainFrame() && new URL(r.url()).origin !== origin ? route.abort() : route.continue();
  });
  page.context().on('page', (p) => { if (p !== page) void p.close().catch(() => undefined); });
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 50);
  // the page's time moves only when the stand-in moves it; the network answers in real time meanwhile
  const settle = async (ms: number): Promise<void> => { for (let t = 0; t < ms; t += 100) { await page.clock.runFor(100); await page.waitForTimeout(60); } };
  await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);   // its pictures and sounds, in real time
  await settle(3500);

  // the free way in: a button or a link whose words say free, nothing that costs or leaves
  const entries = page.locator('button:visible, a:visible, [role=button]:visible');
  for (let k = 0, n = await entries.count(); k < n; k++) {
    const e = entries.nth(k), text = ((await e.innerText().catch(() => '')) || (await e.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (FREE.test(text) && !NOT_FREE.test(text)) { await e.click({ timeout: 3000 }).catch(() => undefined); await e.evaluate((x) => x.setAttribute('data-free-entry', '')).catch(() => undefined); break; }
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await settle(1500);
  // the keys play the game, they don't scroll the page (the game hears them first); the game in view: its big canvas
  await page.evaluate(() => {
    window.addEventListener('keydown', (e) => { if ([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) e.preventDefault(); });
    const big = [...document.querySelectorAll('canvas')].map((c) => ({ c, r: c.getBoundingClientRect() })).filter(({ r }) => r.width * r.height > innerWidth * innerHeight * 0.3)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
    if (big) { if (big.r.top < 0 || big.r.bottom > innerHeight) big.c.scrollIntoView({ block: 'center' }); return; }
    document.querySelector('[data-free-entry]')?.scrollIntoView({ block: 'start' });   // a game of the page itself: from its free entry down
  }).catch(() => undefined);

  const cdp = await page.context().newCDPSession(page);
  const frames: Uint8Array[] = [], times: number[] = [], every = Math.round(450 / STEP);   // a move every 0.45 s
  const began = Date.now();
  let f = 0;
  for (let i = 0; f < seconds * FPS && Date.now() < deadline; f++) {
    if (f % every === 0) {
      if (i % 4 === 0) await onward(page);
      const m = moveOf(i++, seed);
      if ('key' in m) {
        await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur(); }).catch(() => undefined);
        await page.keyboard.press(m.key).catch(() => undefined);
      } else {
        const [x, y] = [VIEW.width * m.tap[0], VIEW.height * m.tap[1]];
        if (await safeAt(page, x, y)) await page.mouse.click(x, y).catch(() => undefined);
      }
    }
    await page.clock.runFor(STEP);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 }) as { data: string };
    frames.push(new Uint8Array(Buffer.from(data, 'base64'))); times.push(f / FPS);
  }
  // a 3D game drawn in software: as many seconds as the time allows, at least four
  if (f < 4 * FPS) throw new Error(`the game draws too slowly here (${(f / FPS).toFixed(1)} s of play filmed in ${Math.round((Date.now() - began) / 60000)} min, a 3D game in software): the still capture stays`);
  return { frames, times, end: f / FPS };
}

/** A tap at (x, y) lands on the game, not on a paid play, a sign-in, a link out or a text field. */
async function safeAt(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(([px, py, notFree]) => {
    const e = document.elementFromPoint(px as number, py as number);
    if (!e || e.closest('input,textarea,select,iframe')) return false;
    const c = e.closest('a,button,[role=button]') as HTMLElement | null;
    return !c || !new RegExp(notFree as string, 'i').test((c.innerText || c.getAttribute('aria-label') || '').trim());
  }, [x, y, NOT_FREE.source] as const).catch(() => false);
}
/** A dialog or a tutorial step in the way: its button that moves on (never a paid one). */
async function onward(page: Page): Promise<void> {
  const buttons = page.locator('button:visible, [role=button]:visible');
  for (let k = 0, n = Math.min(await buttons.count().catch(() => 0), 30); k < n; k++) {
    const b = buttons.nth(k), text = ((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (ONWARD.test(text) && !NOT_FREE.test(text)) { await b.click({ timeout: 1000 }).catch(() => undefined); return; }
  }
}
