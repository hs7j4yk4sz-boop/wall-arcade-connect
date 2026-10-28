// A background function (up to 15 minutes): the capture of one game of games.json (cards/src/shot.ts), with Playwright
// and @sparticuz/chromium. POST {"appId"}; only a game already in games.json is captured.
import { chromium as playwright } from 'playwright-core';
import { APP_ID } from '../../src/games.js';
import { gamesStore } from '../../src/games-store.js';
import { shootGame } from '../../src/shot.js';

export default async (request: Request): Promise<void> => {
  const { appId } = await request.json().catch(() => ({})) as { appId?: string };
  if (typeof appId !== 'string' || !APP_ID.test(appId)) return;
  // @sparticuz/chromium unpacks the libraries Chromium needs only where it recognises Amazon Linux 2023 by its Node 20 or
  // 22 runtime name; Netlify's newer runtimes are the same system under another name (without them: exit code 127)
  if (!/(20|22)\.x/.test(`${process.env.AWS_EXECUTION_ENV ?? ''} ${process.env.AWS_LAMBDA_JS_RUNTIME ?? ''}`)) process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
  const { default: chromium } = await import('@sparticuz/chromium');
  await shootGame(gamesStore(), appId, async (url) => {
    chromium.setGraphicsMode = true;                          // WebGL in software (SwiftShader): a 3D game draws too
    const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForTimeout(8000);                        // the game draws its first frames (in software)
      try {
        return new Uint8Array(await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout: 15_000 }));
      } catch {
        // a page that never settles (a game loop): the frame as it is, straight from DevTools
        const cdp = await page.context().newCDPSession(page);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }) as { data: string };
        return new Uint8Array(Buffer.from(data, 'base64'));
      }
    } finally { await browser.close(); }
  });
};
