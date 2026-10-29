// A game's clip (src/autoplay.ts, src/clip.ts, src/shot.ts): the stand-in's moves and what it never presses, where the
// 10 s and the 4:3 band are taken, a real cut with ffmpeg (when this machine has it), the film and the clip in the store,
// the clip served by byte ranges (Safari).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FREE, moveOf, NOT_FREE, ONWARD, type Film } from '../src/autoplay.js';
import { changeOf, CLIP, concatList, jpegSize, makeClip, pickBand, pickWindow } from '../src/clip.js';
import { SEED, type GamesStore } from '../src/games.js';
import { handleGames } from '../src/submit.js';

function memory(): GamesStore & { data: Map<string, string | Uint8Array> } {
  const data = new Map<string, string | Uint8Array>();
  return { data, getText: async (k) => { const v = data.get(k); return typeof v === 'string' ? v : null; }, getBytes: async (k) => { const v = data.get(k); return v instanceof Uint8Array ? v : null; },
    set: async (k, v) => { data.set(k, v); }, delete: async (k) => { data.delete(k); } };
}
const KART = SEED.find((g) => g.slug === 'wall-kart')!.appId;
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => existsSync(p));

test('the stand-in: the free way in, never a paid play, a sign-in or a link out; its taps stay inside the game', () => {
  for (const t of ['How to play · free', 'Practice, free', 'FREE PRACTICE']) assert.ok(FREE.test(t) && !NOT_FREE.test(t), t);
  for (const t of ['Play · 1 credit', 'PLAY', 'Sign in', 'Buy credits', 'Login', '← THE WALL ARCADE', 'A Remix The Wall experiment · NFC Summit 2027 · Lisbon']) assert.ok(NOT_FREE.test(t), t);
  for (const t of ['SKIP', 'STAY TOY', 'Got it', 'OK']) assert.ok(ONWARD.test(t), t);
  for (let i = 0; i < 300; i++) { const m = moveOf(i, i % 7); if ('tap' in m) assert.ok(m.tap[1] >= 0.3 && m.tap[0] >= 0.15 && m.tap[0] <= 0.85); }
});

test('the 10 s with the most change, the band where it is, each frame for as long as it was on screen', () => {
  const times = Array.from({ length: 140 }, (_, k) => 100 + k * 0.1);           // 14 s at 10 frames a second
  const perFrame = times.map((_, k) => (k >= 40 ? 5 : 1));                        // it starts moving at 4 s
  assert.deepEqual(pickWindow(times, perFrame), [39, 139], '10.0 s: from the frame on screen when it starts moving');
  assert.deepEqual(pickWindow(times.slice(0, 50), perFrame.slice(0, 50)), [0, 49], 'shorter than 10 s: all of it');
  const perRow = times.map(() => Array.from({ length: 64 }, (_, y) => (y >= 48 ? 10 : 0)));   // the change is low on the page
  assert.ok(pickBand(perRow, 0, 139, 873, 378) >= 873 * 48 / 64 + 378 - 873 - 2, 'the band reaches the moving rows');
  assert.equal(pickBand(times.map(() => new Array(64).fill(0)), 0, 139, 873, 378), 248, 'a still page: the middle');
  const list = concatList([1, 1.5, 3], 0, 2, 4);
  assert.match(list, /f0000\.jpg'\nduration 0\.5000\nfile 'f0001\.jpg'\nduration 1\.5000\nfile 'f0002\.jpg'\nduration 1\.0000\nfile 'f0002\.jpg'\n$/);
  const grey = new Uint8Array(2 * 32 * 64); grey.fill(10, 32 * 64);              // frame 1 differs from frame 0 by 10 everywhere
  assert.equal(changeOf(grey, 2).perFrame[1], 10 * 32 * 64);
});

test('a real cut: 566 × 424, 10 s at 30 frames a second, under 1.5 MB, its poster; a still page or a jerky film makes none', { skip: !FFMPEG && 'no ffmpeg here' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clip-'));
  try {
    execFileSync(FFMPEG as string, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=504x872:rate=15', '-t', '13', '-q:v', '4', join(dir, 'f%04d.jpg')]);
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => new Uint8Array(readFileSync(join(dir, f))));
    assert.deepEqual(jpegSize(frames[0]!), { width: 504, height: 872 });
    const film: Film = { frames, times: frames.map((_, k) => 50 + k / 15), end: 50 + frames.length / 15 };
    const clip = await makeClip(film, FFMPEG as string, join(dir, 'work'), { width: 566, height: 424, fps: 30 });
    writeFileSync(join(dir, 'clip.mp4'), clip.mp4);
    let info = '';                                              // ffmpeg -i alone describes the file, then exits 1
    try { execFileSync(FFMPEG as string, ['-hide_banner', '-i', join(dir, 'clip.mp4')], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { info = String((e as { stderr?: Buffer }).stderr ?? ''); }
    assert.match(info, /566x424/); assert.match(info, /30 fps/); assert.match(info, /Duration: 00:00:10\.0/);
    assert.ok(clip.mp4.byteLength < CLIP.maxBytes && clip.jpg[0] === 0xff && clip.jpg[1] === 0xd8);
    const still: Film = { frames: Array.from({ length: 150 }, () => frames[0]!), times: Array.from({ length: 150 }, (_, k) => k / 15), end: 10 };
    await assert.rejects(makeClip(still, FFMPEG as string, join(dir, 'work2')), /nothing moved/);
    const jerky: Film = { frames: frames.slice(0, 7), times: [0, 1, 2, 3, 4, 5, 6], end: 7.2 };   // WALL KART filmed on Netlify
    await assert.rejects(makeClip(jerky, FFMPEG as string, join(dir, 'work3')), /too jerky/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a clip served whole, and by byte ranges for Safari; by its slug', async () => {
  const store = memory();
  await store.set('clips/wall-kart.mp4', new Uint8Array([1, 2, 3])); await store.set('clips/wall-kart.jpg', new Uint8Array([4]));
  const get = (range?: string) => handleGames(new Request('https://cards.test/games/wall-kart.mp4', { headers: range ? { range } : {} }), { games: store });
  const whole = await get();
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4'); assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  const part = await get('bytes=1-');
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 1-2/3'); assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [2, 3]);
  assert.equal((await get('bytes=0-1')).headers.get('content-range'), 'bytes 0-1/3');
  assert.equal((await get('bytes=9-')).status, 416);
  assert.equal((await handleGames(new Request('https://cards.test/games/wall-kart.jpg'), { games: store })).headers.get('content-type'), 'image/jpeg');
  assert.equal((await handleGames(new Request('https://cards.test/games/..%2Fgames.json.mp4'), { games: store })).status, 404);
});

test("USE THE STILL: John sets a clip aside, the capture goes back to the hub", async () => {
  const { applyAdmin } = await import('../src/games.js');
  const games = SEED.map((g) => (g.appId === KART ? { ...g, clip: `/games/${KART}.mp4` } : g));
  const next = applyAdmin(games, { action: 'still', appId: KART }, 0) as typeof games;
  const kart = next.find((g) => g.appId === KART)!;
  assert.equal(kart.clip, undefined); assert.match(kart.clipError ?? '', /set aside/);
});
