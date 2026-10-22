// Library data: every value carries its source (product rule 2) and matches the standard's series.

import { describe, expect, it } from 'vitest';
import { LINE_TYPES, LINE_WIDTHS, lineType } from '@shared/library';
import { defaultLayers } from '@shared/doc/document';

describe('ISO 128-2 line types', () => {
  it('has the ISO 128-2 width series with a 2:1 wide-to-narrow ratio', () => {
    expect([...LINE_WIDTHS]).toEqual([0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2]);
    expect(LINE_TYPES.narrowToWide).toBe(0.5);
    expect(LINE_TYPES.unit).toBe('mm');
  });
  it('every type cites its source and has no unverified pattern', () => {
    expect(LINE_TYPES.types.length).toBeGreaterThanOrEqual(7);
    for (const t of LINE_TYPES.types) {
      expect(t.source).toMatch(/^ISO 128-2:2020/);
      expect(['narrow', 'wide']).toContain(t.width);
      expect(t.pattern).toBeUndefined();
    }
  });
  it('the default layers use existing line types and series widths', () => {
    for (const l of defaultLayers()) {
      expect(lineType(l.lineType), l.name).toBeDefined();
      expect(LINE_WIDTHS).toContain(l.lineWidth);
    }
  });
});
