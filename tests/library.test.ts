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
  it('every type cites its source; patterns follow Table 4 (dash 12d, gap 3d, long dash 24d, dot ≤ d)', () => {
    expect(LINE_TYPES.types.length).toBeGreaterThanOrEqual(7);
    for (const t of LINE_TYPES.types) {
      expect(t.source).toMatch(/^ISO 128-2:2020/);
      expect(['narrow', 'wide']).toContain(t.width);
      if (t.id.startsWith('01')) expect(t.pattern).toBeUndefined();
      else {
        expect(t.pattern, t.id).toBeDefined();
        expect(t.source).toContain('Table 4');
        for (let i = 1; i < t.pattern!.length; i += 2) expect(t.pattern![i]).toBe(3); // every gap is 3d
      }
    }
    expect(lineType('02.1')?.pattern).toEqual([12, 3]);
    expect(lineType('04.1')?.pattern).toEqual([24, 3, 1, 3]);
    expect(lineType('05.1')?.pattern).toEqual([24, 3, 1, 3, 1, 3]);
  });
  it('the default layers use existing line types and series widths', () => {
    for (const l of defaultLayers()) {
      expect(lineType(l.lineType), l.name).toBeDefined();
      expect(LINE_WIDTHS).toContain(l.lineWidth);
    }
  });
});
