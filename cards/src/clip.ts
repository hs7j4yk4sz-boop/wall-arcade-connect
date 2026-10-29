// A game's clip, second half: the 10 s the hub plays in the game's column, from the film of its free practice
// (cards/src/autoplay.ts). Where it moves most decides: the 10 s with the most change from frame to frame, and the square
// of the page (its full width) where that change is. 720 × 720, 24 frames a second, muted H.264, under 2 MB, its poster
// the frame at 2 s. ffmpeg does the pictures; this file decides.
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Film } from './autoplay.js';

const run = promisify(execFile);
export const CLIP = { seconds: 10, width: 720, height: 720, fps: 24, maxBytes: 2 * 1024 * 1024, minFps: 6 };
export type Shape = { width: number; height: number; fps: number };
const GRID = { w: 32, h: 64 };                                 // the small grey frames the change is measured on

/** A JPEG's size, from its frame header. */
export function jpegSize(jpg: Uint8Array): { width: number; height: number } {
  for (let i = 2; i + 9 < jpg.length;) {
    if (jpg[i] !== 0xff) { i++; continue; }
    const marker = jpg[i + 1] as number, len = ((jpg[i + 2] as number) << 8) | (jpg[i + 3] as number);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: ((jpg[i + 5] as number) << 8) | (jpg[i + 6] as number), width: ((jpg[i + 7] as number) << 8) | (jpg[i + 8] as number) };
    i += 2 + len;
  }
  throw new Error('not a JPEG');
}

/** Change per frame and per row: |frame k − frame k−1| on the small grey frames (frame 0: none). */
export function changeOf(grey: Uint8Array, frames: number): { perFrame: number[]; perRow: number[][] } {
  const size = GRID.w * GRID.h, perFrame: number[] = [0], perRow: number[][] = [new Array(GRID.h).fill(0)];
  for (let k = 1; k < frames; k++) {
    const rows = new Array(GRID.h).fill(0) as number[];
    for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
      const i = y * GRID.w + x; rows[y] = (rows[y] as number) + Math.abs((grey[k * size + i] as number) - (grey[(k - 1) * size + i] as number));
    }
    perRow.push(rows); perFrame.push(rows.reduce((a, b) => a + b, 0));
  }
  return { perFrame, perRow };
}

/** The `seconds` of the film with the most change: its first and last frame (all of it if shorter). */
export function pickWindow(times: number[], perFrame: number[], seconds = CLIP.seconds): [number, number] {
  // a frame stays on screen until the next: a window is the frames that start within it
  let best: [number, number] = [0, times.length - 1], bestSum = -1;
  for (let a = 0, b = 0, sum = 0; a < times.length; a++) {
    while (b < times.length && (times[b] as number) - (times[a] as number) <= seconds) sum += perFrame[b++] as number;
    if ((times[b - 1] as number) - (times[a] as number) < seconds * 0.98 && a > 0) break;   // windows shorter than 10 s: no
    if (sum > bestSum) { bestSum = sum; best = [a, b - 1]; }
    sum -= perFrame[a] as number;
  }
  return best;
}

/** The top of the 4:3 band (`band` of `height` px) with the most change in frames a..b; a still page: the middle. */
export function pickBand(perRow: number[][], a: number, b: number, height: number, band: number): number {
  const rows = new Array(GRID.h).fill(0) as number[];
  for (let k = Math.max(1, a); k <= b; k++) (perRow[k] as number[]).forEach((v, y) => { rows[y] = (rows[y] as number) + v; });
  const span = Math.max(1, Math.round(band / height * GRID.h)), total = rows.reduce((x, y) => x + y, 0);
  if (band >= height) return 0;
  if (!total) return Math.round((height - band) / 2 / 2) * 2;
  let best = 0, bestSum = -1;
  for (let y = 0; y + span <= GRID.h; y++) { const s = rows.slice(y, y + span).reduce((p, q) => p + q, 0); if (s > bestSum) { bestSum = s; best = y; } }
  return Math.min(height - band, Math.round(best / GRID.h * height / 2) * 2);
}

/** ffmpeg's concat list: each frame for as long as it was on screen, within the window. */
export function concatList(times: number[], a: number, b: number, end: number): string {
  const lines: string[] = [];
  for (let k = a; k <= b; k++) {
    const d = k < b ? (times[k + 1] as number) - (times[k] as number) : Math.max(1 / CLIP.fps, Math.min(end, (times[a] as number) + CLIP.seconds) - (times[k] as number));
    lines.push(`file 'f${String(k).padStart(4, '0')}.jpg'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
  }
  lines.push(`file 'f${String(b).padStart(4, '0')}.jpg'`);    // the concat demuxer's last entry
  return `${lines.join('\n')}\n`;
}

/** The clip and its poster, from the film. */
export async function makeClip(film: Film, ffmpeg: string, dir: string, shape: Shape = CLIP): Promise<{ mp4: Uint8Array; jpg: Uint8Array; seconds: number }> {
  if (film.frames.length < 2) throw new Error(`the film has ${film.frames.length} frame: nothing moved, the still capture stays`);
  await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
  try {
    await Promise.all(film.frames.map((f, k) => writeFile(join(dir, `f${String(k).padStart(4, '0')}.jpg`), f)));
    const { stdout } = await run(ffmpeg, ['-loglevel', 'error', '-i', join(dir, 'f%04d.jpg'), '-vf', `scale=${GRID.w}:${GRID.h},format=gray`, '-f', 'rawvideo', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
    const { perFrame, perRow } = changeOf(new Uint8Array(stdout), film.frames.length);
    const [a, b] = pickWindow(film.times, perFrame);
    const rate = (b - a) / Math.max(0.1, (film.times[b] as number) - (film.times[a] as number));
    if (rate < CLIP.minFps) throw new Error(`the free practice played at ${rate.toFixed(1)} frames a second here : too jerky for a clip, the still capture stays`);
    if (perFrame.slice(a + 1, b + 1).reduce((x, y) => x + y, 0) < GRID.w * GRID.h * 20) throw new Error('nothing moved in the free practice: the still capture stays');
    const { width, height } = jpegSize(film.frames[0] as Uint8Array);
    const band = Math.min(height, Math.round(width * shape.height / shape.width / 2) * 2), top = pickBand(perRow, a, b, height, band);
    await writeFile(join(dir, 'list.txt'), concatList(film.times, a, b, film.end));
    const out = join(dir, 'clip.mp4');
    for (const crf of [26, 29, 32, 35]) {
      await run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
        '-vf', `crop=${width - (width % 2)}:${band}:0:${top},scale=${shape.width}:${shape.height}:flags=lanczos,fps=${shape.fps}`, '-t', String(CLIP.seconds),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out]);
      if ((await readFile(out)).byteLength < CLIP.maxBytes) break;
    }
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '2', '-i', out, '-frames:v', '1', '-q:v', '3', join(dir, 'poster.jpg')]);
    return { mp4: new Uint8Array(await readFile(out)), jpg: new Uint8Array(await readFile(join(dir, 'poster.jpg'))), seconds: Math.min(CLIP.seconds, film.end - (film.times[a] as number)) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
