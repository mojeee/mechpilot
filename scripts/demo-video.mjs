#!/usr/bin/env node
// Turns the raw demo recording (out/demo-video/demo-raw.mp4, the whole desktop captured while
// e2e/demo.e2e.ts ran) into the website's video: cropped to the app window's content area, scaled
// to 1280 px wide, as VP9 WebM and H.264 MP4 under 20 MB each (Cloudflare Pages serves files up to
// 25 MB), plus a poster frame. Needs ffmpeg on the PATH. Run:
//   node scripts/demo-video.mjs [--start 0] [--end 999]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'out', 'demo-video', 'demo-raw.mp4');
const boundsFile = join(root, 'out', 'demo-video', 'bounds.json');
const outDir = join(root, 'site', 'video');
if (!existsSync(raw)) throw new Error(`no recording at ${raw}; run MP_DEMO=1 npx playwright test -c e2e/playwright.config.ts demo first`);
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const start = opt('start', 0);
const end = opt('end', 0);

// The window content in physical pixels: Electron reports DIP bounds and the display scale.
let crop = '';
if (existsSync(boundsFile)) {
  const b = JSON.parse(readFileSync(boundsFile, 'utf8'));
  const s = b.scale ?? 1;
  const w = Math.round(b.content.width * s);
  const h = Math.round(b.content.height * s);
  const x = Math.round(b.content.x * s);
  const y = Math.round(b.content.y * s);
  crop = `crop=${w}:${h}:${x}:${y},`;
  console.log(`crop ${w}x${h} at ${x},${y} (scale ${s})`);
}
const vf = `${crop}scale=1280:-2:flags=lanczos`;
const trim = [...(start ? ['-ss', String(start)] : []), ...(end ? ['-to', String(end)] : [])];

function run(a) {
  console.log('ffmpeg ' + a.join(' '));
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { stdio: 'inherit' });
}
run([...trim, '-i', raw, '-vf', vf, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-an', join(outDir, 'demo.webm')]);
run([...trim, '-i', raw, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(outDir, 'demo.mp4')]);
run(['-ss', String(start + 8), '-i', raw, '-vf', vf, '-frames:v', '1', join(root, 'site', 'img', 'demo-poster.png')]);
for (const f of ['demo.webm', 'demo.mp4']) {
  const mb = statSync(join(outDir, f)).size / 1e6;
  console.log(`${f}: ${mb.toFixed(1)} MB${mb > 20 ? '  (over 20 MB: raise the crf or trim)' : ''}`);
}
