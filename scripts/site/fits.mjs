// ISO 286 limit deviations for the website's fit pages, computed from library/fits/iso-286.json
// (standard tolerance grades, fundamental deviations and Δ values, each with its source) by the
// rules quoted in that file's `rules` (ISO 286-1:1988, clause 9 and Tables 2 and 3). This is the
// same method as the app's shared/fits.ts; the build cross-checks the file's worked example.
// Everything in mm, as in the data. null = the data does not cover it: the page says so, never
// guesses.

const LETTERS_AFTER_H = ['K', 'M', 'N', 'P', 'R', 'S', 'T', 'U', 'V', 'X', 'Y', 'Z', 'ZA', 'ZB', 'ZC'];

/** "H7" -> { letter: "H", grade: 7, hole: true }; "g6" -> shaft. Null when malformed. */
export function parseClass(cls) {
  const m = /^([A-Za-z]{1,2})(\d{1,2})$/.exec(cls);
  if (!m) return null;
  const letter = m[1];
  if (letter !== letter.toUpperCase() && letter !== letter.toLowerCase()) return null;
  return { letter, grade: Number(m[2]), hole: letter === letter.toUpperCase() };
}

/** Upper and lower deviation (mm) of a class in size step i of lib.sizeSteps, or null. */
export function deviations(lib, cls, i) {
  const fc = parseClass(cls);
  if (!fc) return null;
  const IT = lib.itGrades[`IT${fc.grade}`]?.[i] ?? null;
  if (IT === null) return null;
  const { letter, grade } = fc;
  // js / JS: symmetric, ±IT/2 (ISO 286-1:1988, 9.3).
  if (letter.toUpperCase() === 'JS') return { upper: IT / 2, lower: -IT / 2 };
  if (!fc.hole) {
    const entry = lib.fundamentalDeviations.shaft[letter];
    if (!entry) return null;
    const v = Array.isArray(entry) ? entry[i] ?? null : (grade >= 4 && grade <= 7 ? entry['IT4-IT7'][i] : entry['upToIT3-aboveIT7'][i]) ?? null;
    if (v === null) return null;
    // a to h: the fundamental deviation is es, ei = es - IT; k to zc: it is ei, es = ei + IT (9.1).
    return letter <= 'h' ? { upper: v, lower: v - IT } : { upper: v + IT, lower: v };
  }
  const entry = lib.fundamentalDeviations.hole[letter];
  if (!entry) return null;
  let v;
  let addDelta = false;
  if (Array.isArray(entry)) {
    v = entry[i] ?? null;
    // P to ZC: + Δ in grades up to IT7 (ISO 286-1:1988, Table 3, footnote 3).
    addDelta = LETTERS_AFTER_H.indexOf(letter) >= 3 && grade <= 7;
  } else {
    // K, M, N split at IT8; P to ZC at IT7 (Table 3, footnote 3).
    const limit = 'upToIT8' in entry || 'aboveIT8' in entry ? 8 : 7;
    const below = entry[`upToIT${limit}`] ?? entry[`aboveIT${limit}`];
    const above = entry[`aboveIT${limit}`] ?? entry[`upToIT${limit}`];
    v = (grade <= limit ? below : above)?.[i] ?? null;
    const flag = entry[`upToIT${limit}PlusDelta`];
    addDelta = grade <= limit && (flag === undefined ? true : flag === true);
  }
  if (v === null) return null;
  if (addDelta) {
    const d = lib.fundamentalDeviations.delta[`IT${grade}`]?.[i];
    if (d === null || d === undefined) return null;
    v += d;
  }
  // Special case M6, 250 to 315 mm: ES = -9 µm (Table 3, footnote 4).
  const step = lib.sizeSteps[i];
  if (letter === 'M' && grade === 6 && step.over >= 250 && step.upTo <= 315) v = -0.009;
  // A to H: the fundamental deviation is EI, ES = EI + IT; K to ZC: it is ES, EI = ES - IT (9.2).
  return LETTERS_AFTER_H.includes(letter) ? { upper: v, lower: v - IT } : { upper: v + IT, lower: v };
}

/** mm -> µm without floating-point noise (0.021000000000000001 -> 21). Display only. */
export const um = (mm) => Math.round(mm * 1e7) / 1e4;

/**
 * The rows of a hole/shaft fit: one per size step, consecutive steps with identical values merged
 * (as the standard's own tables print main steps). Clearances in µm: max = ES - ei, min = EI - es.
 */
export function fitRows(lib, hole, shaft) {
  const rows = [];
  lib.sizeSteps.forEach((step, i) => {
    const h = deviations(lib, hole, i);
    const s = deviations(lib, shaft, i);
    if (!h || !s) return;
    const row = { over: step.over, upTo: step.upTo, ES: um(h.upper), EI: um(h.lower), es: um(s.upper), ei: um(s.lower) };
    row.max = Math.round((row.ES - row.ei) * 1e4) / 1e4;
    row.min = Math.round((row.EI - row.es) * 1e4) / 1e4;
    row.kind = row.min >= 0 ? 'clearance' : row.max <= 0 ? 'interference' : 'transition';
    const prev = rows[rows.length - 1];
    if (prev && prev.upTo === row.over && ['ES', 'EI', 'es', 'ei'].every((k) => prev[k] === row[k])) prev.upTo = row.upTo;
    else rows.push(row);
  });
  return rows;
}
