// M7: the assistant against the scripted fake provider (MP_AI_FAKE=1). A message becomes a proposal
// card with a ghost preview; Accept applies it as one undo step; a selection becomes a reference
// chip; "thicker" on a part previews the rebuilt body and changes the extrusion; a provider failure
// is shown in plain words and changes nothing.
/// <reference lib="dom" />
import { test, type Page } from '@playwright/test';
import { command, expect, launch } from './app';

type Doc = { entityOrder: string[]; entities: Record<string, { type: string }>; partOrder: string[]; parts: Record<string, { features: { id: string; kind: string; distance?: number }[] }> };
type Preview = { proposalId: string; doc: unknown; error: string | null; diff: { added: string[]; changed: string[]; deleted: string[]; parts: string[] } | null; part: { building: boolean; mesh: unknown; error: string | null } | null } | null;
type Store = {
  editor: { doc: Doc; history: { undo: unknown[] } };
  activePart: string | null;
  build: { properties: { volume: number } | null } | null;
  building: boolean;
  select(ids: string[]): void;
  assistant: { available: boolean; busy: boolean; turns: { role: string; proposals?: { state: string }[]; error?: { message: string } }[]; references: { kind: string; label: string }[]; preview: Preview; panelOpen: boolean };
};
const store = (page: Page) => page.evaluate(() => (window as unknown as { __mp: Store }).__mp);
const count = async (page: Page) => (await store(page)).editor.doc.entityOrder.length;
const undoDepth = async (page: Page) => (await store(page)).editor.history.undo.length;
const preview = async (page: Page) => {
  const p = (await store(page)).assistant.preview;
  return p ? { added: p.diff?.added.length ?? -1, deleted: p.diff?.deleted.length ?? -1, error: p.error, hasDoc: p.doc !== null, part: p.part ? { building: p.part.building, mesh: p.part.mesh !== null, error: p.part.error } : null } : null;
};

async function send(page: Page, text: string): Promise<void> {
  const input = page.locator('.ai-input');
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect.poll(async () => (await store(page)).assistant.busy, { timeout: 60_000 }).toBe(false);
}

test('assistant: proposal, preview, accept as one undo step, references, thicker, failure', async () => {
  const { page, close } = await launch({ aiFake: true });
  try {
    // Ctrl+Shift+A opens the Assistant tab and focuses its input.
    await page.locator('.canvas').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('Control+Shift+A');
    await expect(page.locator('.right-panel .tab.on')).toHaveText('Assistant');
    await expect(page.locator('.ai-input')).toBeFocused();
    expect((await store(page)).assistant.available).toBe(true);
    await expect(page.locator('.ai-empty')).toContainText('120 × 80 plate');
    // Esc clears the input.
    await page.locator('.ai-input').fill('draft');
    await page.locator('.ai-input').press('Escape');
    await expect(page.locator('.ai-input')).toHaveValue('');

    // 1. A plate: one proposal card, previewed as a ghost (5 entities added, nothing applied yet).
    const before = await count(page);
    const depth = await undoDepth(page);
    await send(page, 'a 120 × 80 plate with four holes');
    await expect(page.locator('.ai-proposal')).toHaveCount(1);
    const card = page.locator('.ai-proposal').first();
    await expect(card.locator('.ai-state')).toHaveText('Pending');
    await expect(card.locator('.ai-diff')).toContainText('1 polyline');
    await expect(card.locator('.ai-diff')).toContainText('4 circles');
    await expect(card.locator('.ai-source.library')).toBeVisible();
    await expect(card.locator('.ai-source.suggestion')).toBeVisible();
    await expect(page.locator('.ai-turn.assistant .ai-toollog').first()).toContainText('library');
    await expect.poll(() => preview(page)).toMatchObject({ added: 5, deleted: 0, error: null, hasDoc: true });
    await expect(card).toHaveClass(/previewed/);
    expect(await count(page)).toBe(before);

    // Accept: the entities arrive as ONE undo step; undo removes all of them, redo brings them back.
    await card.getByRole('button', { name: 'Accept' }).click();
    await expect(card.locator('.ai-state')).toHaveText('Accepted');
    await expect.poll(() => count(page)).toBe(before + 5);
    expect(await undoDepth(page)).toBe(depth + 1);
    await expect.poll(() => preview(page)).toBeNull();
    await command(page, 'U');
    await expect.poll(() => count(page)).toBe(before);
    await command(page, 'REDO');
    await expect.poll(() => count(page)).toBe(before + 5);

    // 2. The selection as a reference chip, then a part from the outline and "thicker".
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      s.select(s.editor.doc.entityOrder);
    });
    await page.getByRole('button', { name: 'Use selection' }).click();
    await expect(page.locator('.ai-composer .ai-chip')).toHaveCount(1);
    await expect(page.locator('.ai-composer .ai-chip')).toContainText('4 circles, 1 polyline');
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: Store }).__mp;
      const doc = s.editor.doc;
      s.select(doc.entityOrder.filter((id) => doc.entities[id].type === 'polyline'));
    });
    await command(page, 'SKETCH');
    await command(page, 'EXTRUDE 10');
    await expect.poll(async () => (await store(page)).activePart, { timeout: 20_000 }).not.toBeNull();
    await expect.poll(async () => {
      const s = await store(page);
      return s.building || !s.build?.properties ? null : Math.round(s.build.properties.volume);
    }, { timeout: 120_000 }).toBe(120 * 80 * 10);
    // The chat stays on the Assistant tab while the part opens.
    await expect(page.locator('.right-panel .tab.on')).toHaveText('Assistant');
    await send(page, 'make it thicker');
    await expect(page.locator('.ai-turn.user').last().locator('.ai-chip')).toContainText('4 circles, 1 polyline');
    await expect(page.locator('.ai-composer .ai-chip')).toHaveCount(0);
    const thick = page.locator('.ai-proposal').last();
    await expect(thick.locator('.ai-diff')).toContainText(/Extrude.*10 mm.*→ 15 mm/);
    await expect(thick.locator('.ai-source.measured')).toBeVisible();
    // The 3D preview rebuilds the part from the preview document.
    await expect.poll(() => preview(page), { timeout: 120_000 }).toMatchObject({ part: { building: false, mesh: true, error: null } });
    await expect(page.locator('.viewer-hud')).toContainText('Preview of the proposal');
    await thick.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(async () => {
      const s = await store(page);
      return s.editor.doc.parts[s.activePart!].features.find((f) => f.kind === 'extrude')?.distance;
    }).toBe(15);
    await expect.poll(async () => {
      const s = await store(page);
      return s.building || !s.build?.properties ? null : Math.round(s.build.properties.volume);
    }, { timeout: 120_000 }).toBe(120 * 80 * 15);

    // Alt+click on the body adds the face under the pointer, measured on the mesh; Shift+Alt+click a point.
    const canvas = page.locator('.viewer-wrap canvas').first();
    const box = (await canvas.boundingBox())!;
    const centre = { x: box.width / 2, y: box.height / 2 };
    await canvas.click({ position: centre, modifiers: ['Alt'] });
    await expect(page.locator('.ai-composer .ai-chip.face')).toContainText(/Face \d+ of Part 1, normal/);
    const face = (await store(page)).assistant.references.find((r) => r.kind === 'face') as unknown as { area: number; normal: number[] };
    expect(face.area).toBeGreaterThan(100);
    expect(Math.hypot(...face.normal)).toBeCloseTo(1, 3);
    await canvas.click({ position: centre, modifiers: ['Alt', 'Shift'] });
    await expect(page.locator('.ai-composer .ai-chip.point')).toContainText(/Point \(/);

    // 3. A provider failure: the error in plain words, nothing changes.
    const n = await count(page);
    const d = await undoDepth(page);
    const cards = await page.locator('.ai-proposal').count();
    await send(page, 'fail');
    const err = page.locator('.ai-turn.assistant.failed .ai-error').last();
    await expect(err).toBeVisible();
    expect(((await err.textContent()) ?? '').trim().length).toBeGreaterThan(10);
    expect(await count(page)).toBe(n);
    expect(await undoDepth(page)).toBe(d);
    await expect(page.locator('.ai-proposal')).toHaveCount(cards);
  } finally {
    await close();
  }
});
