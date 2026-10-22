// The demo script (docs/demo.md) played against the REAL model, for two reasons: to prove the
// assistant works end to end with a key, and to take the website's demo screenshots
// (site/img/demo-1.png … demo-5.png). Not a CI test: it runs only with MP_DEMO=1 and a key in the
// environment or in .env.local, after `npm run build`:
//   MP_DEMO=1 npx playwright test -c e2e/playwright.config.ts demo
// It prints the conversation, so the transcript can be read afterwards.
/// <reference lib="dom" />
import { _electron as electron, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, menu } from './app';

const root = join(__dirname, '..');
const outDir = join(root, 'site', 'img');
const WIDTH = 1440;
const HEIGHT = 900;
/** Pauses and typing for a watchable run (MP_DEMO_FAST=1 skips them). */
const PACE = !process.env.MP_DEMO_FAST;

type Proposal = { id: string; title: string; summary: string; state: string; claims: { text: string; source: { kind: string } }[] };
type Turn = { id: string; role: string; text: string; proposals?: Proposal[]; error?: { message: string; hint?: string } };
type Store = {
  editor: { doc: { entityOrder: string[]; partOrder: string[]; sheetOrder: string[] } };
  activePart: string | null;
  activeSheet: string | null;
  build: { mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; faceIds: Uint32Array } | null; properties: { volume: number } | null } | null;
  building: boolean;
  message: { kind: string; text: string } | null;
  select(ids: string[]): void;
  setActivePart(id: string | null): void;
  updateSettings(patch: { theme?: 'dark' | 'light'; canvas?: 'dark' | 'white' }): Promise<void>;
  assistant: {
    busy: boolean;
    turns: Turn[];
    references: { kind: string; label: string }[];
    send(text: string): Promise<void>;
    acceptProposal(turnId: string, proposalId: string): void;
    addReference(ref: unknown): void;
    useSelection(): void;
    setPanelOpen(open: boolean): void;
  };
};
const store = (page: Page) => page.evaluate(() => (window as unknown as { __mp: Store }).__mp);

function keyFromEnvLocal(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const p = join(root, '.env.local');
  if (!existsSync(p)) return null;
  const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(p, 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

async function shot(page: Page, name: string): Promise<void> {
  await page.mouse.move(WIDTH - 2, 2);
  await settle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

/** Send a message through the panel, wait for the answer, print it, return the last assistant turn. */
async function ask(page: Page, text: string): Promise<Turn> {
  console.log(`\n>>> ${text}`);
  const input = page.locator('.ai-input');
  await input.click();
  // Typed at a reading pace, so a viewer sees the request before the answer.
  await input.pressSequentially(text, { delay: PACE ? 22 : 0 });
  await page.waitForTimeout(PACE ? 900 : 0);
  await input.press('Enter');
  await expect.poll(async () => (await store(page)).assistant.busy, { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await store(page)).assistant.busy, { timeout: 300_000 }).toBe(false);
  // Time to read the answer and look at the ghost preview.
  await page.waitForTimeout(PACE ? 3500 : 300);
  const turns = (await store(page)).assistant.turns;
  const last = turns[turns.length - 1];
  console.log(`<<< ${last.text}`);
  if (last.error) console.log(`!!! ${last.error.message} ${last.error.hint ?? ''}`);
  for (const p of last.proposals ?? []) {
    console.log(`  [proposal] ${p.title}: ${p.summary}`);
    for (const c of p.claims) console.log(`    - (${c.source.kind}) ${c.text}`);
  }
  return last;
}

/** Accept every pending proposal of a turn, in order, waiting for the part to rebuild. */
async function acceptAll(page: Page, turn: Turn): Promise<number> {
  let n = 0;
  for (const p of turn.proposals ?? []) {
    if (p.state !== 'pending') continue;
    await page.waitForTimeout(PACE ? 1200 : 0);
    await page.evaluate(([t, id]) => (window as unknown as { __mp: Store }).__mp.assistant.acceptProposal(t, id), [turn.id, p.id] as const);
    n++;
    await page.waitForTimeout(300);
    await expect.poll(async () => (await store(page)).building, { timeout: 120_000 }).toBe(false);
    await page.waitForTimeout(PACE ? 2500 : 200);
  }
  console.log(`  accepted ${n} proposal(s)`);
  return n;
}

/** Ask, and if the assistant only asked a question, answer it with `answer` and accept what comes. */
async function askAndAccept(page: Page, text: string, answer?: string): Promise<Turn> {
  let turn = await ask(page, text);
  if (!(turn.proposals ?? []).length && !turn.error && answer) turn = await ask(page, answer);
  expect(turn.error, `assistant error on "${text}"`).toBeUndefined();
  expect((turn.proposals ?? []).length, `no proposal for "${text}"`).toBeGreaterThan(0);
  await acceptAll(page, turn);
  return turn;
}

test.skip(!process.env.MP_DEMO, 'The real-model demo runs only with MP_DEMO=1');

test('the demo script against the real model', async () => {
  test.setTimeout(40 * 60_000);
  const key = keyFromEnvLocal();
  test.skip(!key, 'No ANTHROPIC_API_KEY in the environment or .env.local');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(root, 'out', 'demo-video'), { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'mp-demo-'));
  const saveDir = mkdtempSync(join(tmpdir(), 'mp-demo-save-'));
  const app = await electron.launch({
    args: ['.', '--no-sandbox', '--force-device-scale-factor=1'],
    cwd: root,
    env: { ...process.env, ANTHROPIC_API_KEY: key ?? '', MP_PROFILE: profile, MP_SAVE_DIR: saveDir },
  });
  let recorder: ChildProcess | null = null;
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.topbar', { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(size.w, size.h);
    }, { w: WIDTH, h: HEIGHT });
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([WIDTH, HEIGHT]);
    await page.evaluate(() => (window as unknown as { __mp: Store }).__mp.updateSettings({ theme: 'dark', canvas: 'dark' }));
    // The real window, on screen, recorded by ffmpeg (out/demo-video/demo-raw.mp4, not committed).
    const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setPosition(0, 0);
      win.setAlwaysOnTop(true);
      win.focus();
      const b = win.getContentBounds();
      const d = screen.getPrimaryDisplay();
      return { content: b, scale: d.scaleFactor, screen: d.size, workArea: d.workArea };
    });
    console.log(`window content bounds ${JSON.stringify(bounds)}`);
    writeFileSync(join(root, 'out', 'demo-video', 'bounds.json'), JSON.stringify(bounds));
    await page.waitForTimeout(800);
    recorder = startRecorder(join(root, 'out', 'demo-video', 'demo-raw.mp4'));
    await page.waitForTimeout(1500);
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    await page.locator('.canvas').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+Shift+A');
    await expect(page.locator('.right-panel .tab.on')).toHaveText('Assistant');

    // 1. A part from one sentence: the proposal card and its ghost preview, then Accept.
    const t1 = await ask(page, 'A mounting plate 160 × 100 mm, R12 corners, four clearance holes for M8 on a 130 × 70 pattern, and a Ø40 H7 bore in the centre.');
    const first = t1.proposals?.length ? t1 : await ask(page, 'Use the medium series for the clearance holes, holes and bore centred on the plate, the plate centred on the origin.');
    expect(first.error, 'assistant error').toBeUndefined();
    expect((first.proposals ?? []).length, 'no proposal for the plate').toBeGreaterThan(0);
    await page.locator('.ai-proposal').first().hover();
    await page.waitForTimeout(500);
    await shot(page, 'demo-1');
    await acceptAll(page, first);
    const entities = (await store(page)).editor.doc.entityOrder.length;
    expect(entities).toBeGreaterThanOrEqual(5);

    // 2. Step by step to a 3D part.
    await askAndAccept(page, 'Make it a 3D part: extrude the outline 12 mm and cut the holes and the bore through.', 'Extrude along +Z from the XY plane; the holes and the bore go through the full thickness.');
    await askAndAccept(page, 'Add a 25 mm tall boss Ø60 around the bore on top, and a 2 mm fillet on the boss edges.', 'The boss is centred on the bore, on the top face (z = 12), and the bore goes through it too.');
    await expect.poll(async () => (await store(page)).activePart, { timeout: 60_000 }).not.toBeNull();
    await expect.poll(async () => (await store(page)).build?.properties?.volume ?? null, { timeout: 120_000 }).not.toBeNull();
    await shot(page, 'demo-2');
    // An impossible request: honesty.
    const bad = await ask(page, 'Fillet every edge with 20 mm.');
    console.log(`  (impossible fillet) proposals: ${(bad.proposals ?? []).length}`);
    for (const p of bad.proposals ?? []) await page.evaluate(([t, id]) => (window as unknown as { __mp: Store }).__mp.assistant.acceptProposal(t, id), [bad.id, p.id] as const);
    await page.waitForTimeout(500);
    await expect.poll(async () => (await store(page)).building, { timeout: 120_000 }).toBe(false);
    const after = await store(page);
    await page.locator('.ai-turn.assistant').last().scrollIntoViewIfNeeded();
    await shot(page, 'demo-5');
    console.log(`  build errors after the 20 mm fillet: ${JSON.stringify(after.build && 'errors' in after.build ? (after.build as { errors?: unknown }).errors : null)}`);

    // 3. Point at the top face of the boss and ask for a change.
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      const m = s.build?.mesh;
      if (!m) throw new Error('no mesh');
      // The face with normal +Z whose centre is highest: the top of the boss.
      const faces = new Map<number, { n: number; z: number; x: number; y: number; nz: number; area: number }>();
      for (let t = 0; t < m.indices.length; t += 3) {
        const f = m.faceIds[t / 3];
        const a = m.indices[t] * 3;
        const b = m.indices[t + 1] * 3;
        const c = m.indices[t + 2] * 3;
        const ax = m.positions[b] - m.positions[a];
        const ay = m.positions[b + 1] - m.positions[a + 1];
        const az = m.positions[b + 2] - m.positions[a + 2];
        const bx = m.positions[c] - m.positions[a];
        const by = m.positions[c + 1] - m.positions[a + 1];
        const bz = m.positions[c + 2] - m.positions[a + 2];
        const cx = ay * bz - az * by;
        const cy = az * bx - ax * bz;
        const cz = ax * by - ay * bx;
        const area = Math.hypot(cx, cy, cz) / 2;
        const e = faces.get(f) ?? { n: 0, z: 0, x: 0, y: 0, nz: 0, area: 0 };
        e.n++;
        e.area += area;
        e.x += ((m.positions[a] + m.positions[b] + m.positions[c]) / 3) * area;
        e.y += ((m.positions[a + 1] + m.positions[b + 1] + m.positions[c + 1]) / 3) * area;
        e.z += ((m.positions[a + 2] + m.positions[b + 2] + m.positions[c + 2]) / 3) * area;
        e.nz += cz / 2;
        faces.set(f, e);
      }
      let best: { id: number; z: number; x: number; y: number; area: number } | null = null;
      for (const [id, e] of faces) {
        if (e.area <= 0 || e.nz / e.area < 0.95) continue;
        const z = e.z / e.area;
        if (!best || z > best.z) best = { id, z, x: e.x / e.area, y: e.y / e.area, area: e.area };
      }
      if (!best) throw new Error('no +Z face');
      s.assistant.addReference({ kind: 'face', partId: s.activePart, faceId: best.id, center: [best.x, best.y, best.z], normal: [0, 0, 1], area: best.area, label: `Face ${best.id}, normal +Z, ${(best.area / 100).toFixed(1)} cm²` });
    });
    await askAndAccept(page, 'Chamfer the outer edge of this face 1 × 45°, and make the boss 30 mm tall instead.', 'The chamfer is on the outer circular edge of that face; the boss height goes from 25 to 30 mm.');
    await shot(page, 'demo-3');

    // 4. Change the holes from the 2D selection.
    await page.locator('.sheet-tabs .stab').first().click();
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      const doc = (s.editor.doc as unknown as { entities: Record<string, { type: string; radius?: number }> }).entities;
      const circles = s.editor.doc.entityOrder.filter((id) => doc[id].type === 'circle' && (doc[id].radius ?? 0) < 10);
      s.select(circles);
      s.assistant.useSelection();
    });
    await askAndAccept(page, 'Change these to M10 clearance holes and move the pattern to 136 × 76.', 'Medium series, pattern centred as before.');

    // 5. The drawing and the PDF.
    const t5 = await askAndAccept(page, 'Dimension the plate to ISO 129-1 (outline, hole pattern, bore with its H7 tolerance), put it on an A3 sheet at 1:1 with the title block filled in, and export the PDF.', 'Title: Mounting plate; drawn by MechPilot; material S235JR; scale 1:1; first angle.');
    void t5;
    await expect.poll(async () => (await store(page)).editor.doc.sheetOrder.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.locator('.sheet-tabs .stab', { hasText: 'Sheet' }).first().click();
    await page.waitForTimeout(800);
    await shot(page, 'demo-4');
    if (!readdirSync(saveDir).some((f) => f.endsWith('.pdf'))) await menu(page, 'File', 'Export PDF…');
    await expect.poll(() => readdirSync(saveDir).some((f) => f.endsWith('.pdf')), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(500);
    console.log(`PDF written: ${readdirSync(saveDir).join(', ')}`);
  } finally {
    await page_wait(1500);
    await stopRecorder(recorder);
    await app.close();
  }
});

const page_wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** ffmpeg capturing the app window by its title (Windows gdigrab; on macOS/Linux use the OS recorder). */
function startRecorder(file: string): ChildProcess | null {
  if (process.platform !== 'win32') return null;
  const proc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '20', '-draw_mouse', '1', '-i', 'desktop', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(`recording to ${file}`);
  return proc;
}

async function stopRecorder(proc: ChildProcess | null): Promise<void> {
  if (!proc) return;
  await new Promise<void>((resolve) => {
    proc.once('exit', () => resolve());
    proc.stdin?.write('q');
    setTimeout(resolve, 15_000);
  });
}
