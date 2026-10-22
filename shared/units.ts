// Lengths are stored in mm. The UI shows them with their unit, always (product rule 1).

export type LengthUnit = 'mm' | 'in';

/** Exact definition: 1 in = 25.4 mm (ISO 80000-1 and the international yard and pound agreement). */
export const MM_PER_INCH = 25.4;

export const toUnit = (mm: number, unit: LengthUnit): number => (unit === 'in' ? mm / MM_PER_INCH : mm);
export const fromUnit = (value: number, unit: LengthUnit): number => (unit === 'in' ? value * MM_PER_INCH : value);

/** "12.5 mm": trailing zeros trimmed, up to `decimals` digits, unit always shown. */
export function formatLength(mm: number, unit: LengthUnit = 'mm', decimals = unit === 'in' ? 4 : 3): string {
  const v = toUnit(mm, unit);
  const s = v.toFixed(decimals).replace(/\.?0+$/, '');
  return `${s === '-0' ? '0' : s} ${unit}`;
}

/** Parse "12.5", "12,5", "12.5mm", "1/2 in", "0.5in" into mm. Null when not a length. */
export function parseLength(text: string, defaultUnit: LengthUnit = 'mm'): number | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+(?:[.,]\d+)?))?\s*(mm|in|")?\s*$/i.exec(text);
  if (!m) return null;
  let v = Number(m[1].replace(',', '.'));
  if (m[2]) v /= Number(m[2].replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const unit: LengthUnit = m[3] ? (m[3].toLowerCase() === 'mm' ? 'mm' : 'in') : defaultUnit;
  return fromUnit(v, unit);
}

/** "12.5, 40" or "12.5 40" into a point in mm. */
export function parsePoint(text: string, unit: LengthUnit = 'mm'): { x: number; y: number } | null {
  const parts = text.trim().split(/\s*[,;]\s*|\s+/);
  if (parts.length !== 2) return null;
  const x = parseLength(parts[0], unit);
  const y = parseLength(parts[1], unit);
  return x === null || y === null ? null : { x, y };
}
