import { describe, expect, it } from 'vitest';
import { formatLength, MM_PER_INCH, parseLength, parsePoint } from '@shared/units';

describe('units', () => {
  it('always shows the unit', () => {
    expect(formatLength(12.5)).toBe('12.5 mm');
    expect(formatLength(12)).toBe('12 mm');
    expect(formatLength(0.1234567)).toBe('0.123 mm');
    expect(formatLength(MM_PER_INCH, 'in')).toBe('1 in');
    expect(formatLength(-0.00001)).toBe('0 mm');
  });
  it('parses numbers, commas, units and fractions', () => {
    expect(parseLength('12.5')).toBe(12.5);
    expect(parseLength('12,5')).toBe(12.5);
    expect(parseLength('12.5 mm')).toBe(12.5);
    expect(parseLength('1 in')).toBe(25.4);
    expect(parseLength('1/2 in')).toBe(12.7);
    expect(parseLength('0.5"')).toBe(12.7);
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(parseLength('1/0')).toBeNull();
  });
  it('parses points', () => {
    expect(parsePoint('10,20')).toEqual({ x: 10, y: 20 });
    expect(parsePoint('10 20')).toEqual({ x: 10, y: 20 });
    expect(parsePoint('10.5;-2')).toEqual({ x: 10.5, y: -2 });
    expect(parsePoint('10')).toBeNull();
    expect(parsePoint('a,b')).toBeNull();
  });
});
