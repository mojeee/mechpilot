// Every sample project (product rule 10) opens, is in canonical form, and round-trips exactly.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, serialize, FILE_EXTENSION } from '@shared/doc/file';
import { documentBox } from '@shared/doc/document';

const dir = join(__dirname, '..', 'samples');
const files = readdirSync(dir).filter((f) => f.endsWith(FILE_EXTENSION));

describe('samples', () => {
  it('ships the mounting bracket', () => {
    expect(files).toContain('mounting-bracket' + FILE_EXTENSION);
  });
  for (const f of files) {
    it(`${f} parses, has a description, and is written in canonical form`, () => {
      const text = readFileSync(join(dir, f), 'utf8');
      const r = parse(text);
      expect(r.ok, r.ok ? '' : r.error.message).toBe(true);
      if (!r.ok) return;
      expect(r.doc.description).toBeTruthy();
      expect(r.doc.entityOrder.length).toBeGreaterThan(0);
      expect(documentBox(r.doc)).not.toBeNull();
      expect(serialize(r.doc)).toBe(text.replace(/\r\n/g, '\n'));
    });
  }
});
