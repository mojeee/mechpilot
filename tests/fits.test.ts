// ISO 286 deviations from the library: the standard's own worked examples and the rules.

import { describe, expect, it } from 'vitest';
import { fitDeviations, fitExists, parseFitClass, sizeStepIndex, standardTolerance } from '@shared/fits';

const um = (d: { upper: number; lower: number } | null) => (d ? { upper: Math.round(d.upper * 1e6) / 1e3, lower: Math.round(d.lower * 1e6) / 1e3 } : null);

describe('ISO 286 fits', () => {
  it('parses classes', () => {
    expect(parseFitClass('H7')).toEqual({ letter: 'H', grade: 7, hole: true });
    expect(parseFitClass('g6')).toEqual({ letter: 'g', grade: 6, hole: false });
    expect(parseFitClass('ZC11')).toEqual({ letter: 'ZC', grade: 11, hole: true });
    expect(parseFitClass('Hx')).toBeNull();
    expect(parseFitClass('hH7')).toBeNull();
  });
  it('finds the size step and the standard tolerance', () => {
    expect(sizeStepIndex(25)).toBe(6); // 0-3, 3-6, 6-10, 10-14, 14-18, 18-24, 24-30
    expect(sizeStepIndex(3)).toBe(0);
    expect(sizeStepIndex(0)).toBe(-1);
    expect(standardTolerance(7, 25)).toBe(0.021);
    expect(standardTolerance(6, 25)).toBe(0.013);
  });
  it('H7/g6 at 25 mm: the worked example of the library (ISO 286-1)', () => {
    expect(um(fitDeviations('H7', 25))).toEqual({ upper: 21, lower: 0 });
    expect(um(fitDeviations('g6', 25))).toEqual({ upper: -7, lower: -20 });
  });
  it('K7 and S6 at 18 to 30 mm use the Δ rule (ISO 286-1:1988, Table 3, footnote 3)', () => {
    // K7: ES = -2 + Δ(IT7 = 8) = +6 µm; EI = 6 - 21 = -15 µm.
    expect(um(fitDeviations('K7', 20))).toEqual({ upper: 6, lower: -15 });
    // S6: ES = -35 + Δ(IT6 = 4) = -31 µm; EI = -31 - 13 = -44 µm.
    expect(um(fitDeviations('S6', 20))).toEqual({ upper: -31, lower: -44 });
  });
  it('js and JS are symmetric', () => {
    expect(um(fitDeviations('js6', 25))).toEqual({ upper: 6.5, lower: -6.5 });
    expect(um(fitDeviations('JS7', 25))).toEqual({ upper: 10.5, lower: -10.5 });
  });
  it('shaft k depends on the grade; h7 is 0 / -IT', () => {
    expect(um(fitDeviations('k6', 25))).toEqual({ upper: 15, lower: 2 });
    expect(um(fitDeviations('h7', 25))).toEqual({ upper: 0, lower: -21 });
  });
  it('M6 at 250 to 315 mm is the special case -9 µm', () => {
    const d = um(fitDeviations('M6', 300));
    expect(d?.upper).toBe(-9);
  });
  it('says no for what the data does not cover instead of guessing', () => {
    expect(fitDeviations('H7', 0)).toBeNull();
    expect(fitDeviations('H7', 5000)).toBeNull();
    expect(fitDeviations('J7', 25)).toBeNull();
    expect(fitDeviations('Q7', 25)).toBeNull();
    expect(fitExists('H7', 25)).toBe(true);
    expect(fitExists('H99', 25)).toBe(false);
  });
});
