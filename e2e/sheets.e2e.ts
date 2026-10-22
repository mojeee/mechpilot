// M2: dimensions through the command line, the sample sheet, and the PDF export.
/// <reference lib="dom" />
import { test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { command, entityCount, expect, launch, menu } from './app';

test('dimension by command line, show the sample sheet, export a PDF', async () => {
  const { page, saveDir, close } = await launch();
  try {
    await expect(page.locator('.statusbar .worker')).toHaveText(/Worker ready/);
    // A rectangle and a horizontal dimension of its bottom edge.
    await command(page, 'REC');
    await command(page, '0,0');
    await command(page, '100,60');
    await command(page, 'DLI');
    await command(page, '0,0');
    await command(page, '100,0');
    await command(page, '50,-15');
    expect(await entityCount(page)).toBe(2);
    // Select the dimension and check the Properties panel shows it.
    await page.evaluate(() => {
      const s = (window as unknown as { __mp: { select(ids: string[]): void; editor: { doc: { entityOrder: string[] } } } }).__mp;
      s.select([s.editor.doc.entityOrder[1]]);
    });
    await expect(page.locator('.props h3')).toHaveText('Dimension');
    await expect(page.locator('.props .readout', { hasText: 'Kind' })).toContainText('linear');

    // The sample has a sheet: open it, switch to the sheet tab, export PDF.
    await menu(page, 'File', 'Open sample', 'Mounting bracket');
    await expect(page.locator('.sheet-tabs .stab', { hasText: 'Sheet 1' })).toBeVisible();
    await page.locator('.sheet-tabs .stab', { hasText: 'Sheet 1' }).click();
    await expect(page.locator('.right-panel .tab.on')).toHaveText('Sheets');
    await expect(page.locator('.props h3').first()).toHaveText('Sheet 1');
    await menu(page, 'File', 'Export PDF');
    await expect(page.locator('.cl-message')).toContainText('Exported');
    const pdfs = readdirSync(saveDir).filter((f) => f.endsWith('.pdf'));
    expect(pdfs.length).toBe(1);
    const bytes = readFileSync(join(saveDir, pdfs[0]));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // A3 landscape: 420 × 297 mm in points (the file uses compressed object streams, so parse it).
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo((420 * 72) / 25.4, 3);
    expect(height).toBeCloseTo((297 * 72) / 25.4, 3);
    expect(pdf.getTitle()).toBe('Mounting bracket');
  } finally {
    await close();
  }
});
