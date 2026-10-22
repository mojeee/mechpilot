// ISO 286 limits and fits: the deviations of a tolerance class (H7, g6, …) at a nominal size,
// from library/fits/iso-286.json (standard tolerance grades, fundamental deviations and the Δ
// values, with their sources). Everything in mm (product rule 1). A class the data does not
// cover returns null: the app says "not in MechPilot's ISO 286 data" rather than guessing.

import lib from '@library/fits/iso-286.json';

type Row = (number | null)[];
interface FitsLib {
  sizeSteps: { over: number; upTo: number }[];
  itGrades: Record<string, Row>;
  fundamentalDeviations: {
    shaft: Record<string, Row | { 'IT4-IT7': Row; 'upToIT3-aboveIT7': Row }>;
    hole: Record<string, Row | { upToIT8: Row; upToIT8PlusDelta?: boolean; aboveIT8: Row }>;
    delta: Record<string, Row>;
  };
}
const L = lib as unknown as FitsLib;

export interface FitClass {
  letter: string;
  grade: number;
  /** Holes are written with capital letters (ISO 286-1, 4.1). */
  hole: boolean;
}

/** "H7" → { letter: "H", grade: 7, hole: true }; "g6" → shaft. Null when malformed. */
export function parseFitClass(cls: string): FitClass | null {
  const m = /^([A-Za-z]{1,2})(\d{1,2})$/.exec(cls.trim());
  if (!m) return null;
  const letter = m[1];
  const grade = Number(m[2]);
  const hole = letter === letter.toUpperCase();
  if (letter !== letter.toUpperCase() && letter !== letter.toLowerCase()) return null;
  return { letter, grade, hole };
}

/** Index of the nominal size step (0 < nominal ≤ 3 is step 0), or -1 when outside the data. */
export function sizeStepIndex(nominal: number): number {
  if (!(nominal > 0)) return -1;
  return L.sizeSteps.findIndex((s) => nominal > s.over && nominal <= s.upTo);
}

/** Standard tolerance IT<grade> at a nominal size, mm; null when the data has no value. */
export function standardTolerance(grade: number, nominal: number): number | null {
  const i = sizeStepIndex(nominal);
  const row = L.itGrades[`IT${grade}`];
  if (i < 0 || !row) return null;
  return row[i] ?? null;
}

export interface Deviations {
  /** Upper deviation (es / ES), mm. */
  upper: number;
  /** Lower deviation (ei / EI), mm. */
  lower: number;
}

const isRow = (v: unknown): v is Row => Array.isArray(v);
const LETTERS_AFTER_H = ['K', 'M', 'N', 'P', 'R', 'S', 'T', 'U', 'V', 'X', 'Y', 'Z', 'ZA', 'ZB', 'ZC'];

/**
 * Deviations of a class at a nominal size (ISO 286-1:1988, clause 9 and Tables 1 to 3; the rules
 * are quoted in library/fits/iso-286.json `rules`). Null when the data does not cover it.
 */
export function fitDeviations(cls: string, nominal: number): Deviations | null {
  const fc = parseFitClass(cls);
  if (!fc) return null;
  const i = sizeStepIndex(nominal);
  if (i < 0) return null;
  const IT = standardTolerance(fc.grade, nominal);
  if (IT === null) return null;
  const letter = fc.letter;
  // js / JS: symmetric, ±IT/2 (ISO 286-1:1988, 9.3).
  if (letter.toUpperCase() === 'JS') return { upper: IT / 2, lower: -IT / 2 };
  if (!fc.hole) {
    const entry = L.fundamentalDeviations.shaft[letter];
    if (!entry) return null;
    let v: number | null;
    if (isRow(entry)) v = entry[i] ?? null;
    else v = (fc.grade >= 4 && fc.grade <= 7 ? entry['IT4-IT7'][i] : entry['upToIT3-aboveIT7'][i]) ?? null;
    if (v === null) return null;
    // a to h: the fundamental deviation is es (≤ 0), ei = es − IT; k to zc: it is ei (≥ 0), es = ei + IT.
    if (letter <= 'h') return { upper: v, lower: v - IT };
    return { upper: v + IT, lower: v };
  }
  const entry = L.fundamentalDeviations.hole[letter];
  if (!entry) return null;
  let v: number | null;
  let addDelta = false;
  if (isRow(entry)) {
    v = entry[i] ?? null;
    // P to ZC: + Δ in grades up to IT7 (ISO 286-1:1988, Table 3, footnote 3).
    addDelta = LETTERS_AFTER_H.indexOf(letter) >= 3 && fc.grade <= 7;
  } else {
    // K, M, N split at IT8; P to ZC at IT7 (ISO 286-1:1988, Table 3, footnote 3). The table's
    // column for the grades above the limit is the base value; below it Δ is added.
    const o = entry as Record<string, unknown>;
    const limit = 'upToIT8' in o || 'aboveIT8' in o ? 8 : 7;
    const below = (o[`upToIT${limit}`] ?? o[`aboveIT${limit}`]) as Row | undefined;
    const above = (o[`aboveIT${limit}`] ?? o[`upToIT${limit}`]) as Row | undefined;
    const row = fc.grade <= limit ? below : above;
    v = row?.[i] ?? null;
    const flag = o[`upToIT${limit}PlusDelta`];
    addDelta = fc.grade <= limit && (flag === undefined ? true : flag === true);
  }
  if (v === null) return null;
  if (addDelta) {
    const d = L.fundamentalDeviations.delta[`IT${fc.grade}`]?.[i];
    if (d === null || d === undefined) return null;
    v += d;
  }
  // Special case M6, 250 to 315 mm: ES = −9 µm (ISO 286-1:1988, Table 3, footnote 4).
  if (letter === 'M' && fc.grade === 6 && nominal > 250 && nominal <= 315) v = -0.009;
  // A to H: the fundamental deviation is EI (≥ 0), ES = EI + IT; K to ZC: it is ES, EI = ES − IT.
  if (!LETTERS_AFTER_H.includes(letter)) return { upper: v + IT, lower: v };
  return { upper: v, lower: v - IT };
}

/** Does the class exist in the data at this size? (The drawing checker's "fit does not exist".) */
export const fitExists = (cls: string, nominal: number): boolean => fitDeviations(cls, nominal) !== null;

/** Common classes offered in the UI (ISO 286-1:2010 recommends H-based hole-basis fits). */
export const COMMON_HOLE_CLASSES = ['H6', 'H7', 'H8', 'H9', 'H11', 'G7', 'F8', 'E9', 'D10', 'JS7', 'K7', 'M7', 'N7', 'P7'];
export const COMMON_SHAFT_CLASSES = ['h6', 'h7', 'h9', 'h11', 'g6', 'f7', 'e8', 'd9', 'js6', 'k6', 'm6', 'n6', 'p6', 'r6', 's6', 'u6'];
