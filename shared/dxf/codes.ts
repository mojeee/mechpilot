// Tables shared by the DXF reader and writer: versions, $INSUNITS, the ISO 128-2 ↔ DXF line type
// mapping, the AutoCAD Color Index and the text escapes. Group codes are cited from the
// DXF Reference (Autodesk); see docs/dxf.md for the user-facing summary.

import { LINE_WIDTHS } from '../library';
import { t } from '../i18n';

export type DxfVersion = 'R12' | '2000';

/** The DXF versions MechPilot writes. `acadver` is the HEADER $ACADVER value
 *  (DXF Reference (Autodesk), HEADER section, $ACADVER: AC1009 = R11/R12, AC1015 = AutoCAD 2000). */
export const DXF_VERSIONS: readonly { id: DxfVersion; acadver: string; label: string }[] = [
  { id: 'R12', acadver: 'AC1009', label: 'DXF R12 (AC1009)' },
  { id: '2000', acadver: 'AC1015', label: 'DXF 2000 (AC1015)' },
];

/** A note for the user about an import or export: one per kind, with how many items it concerns. */
export interface DxfWarning {
  code: string;
  message: string;
  count: number;
}

// ---------------------------------------------------------------------------------------------
// Units: DXF Reference (Autodesk), HEADER section, $INSUNITS (code 70): "Default drawing units for
// AutoCAD DesignCenter blocks". Factors are the exact definitions of each unit in millimetres.
// ---------------------------------------------------------------------------------------------

/** $INSUNITS value for millimetres. */
export const INSUNITS_MM = 4;

/** Millimetres per drawing unit, by $INSUNITS code. 0 (unitless) is not listed: MechPilot assumes mm. */
export const INSUNITS_TO_MM: Readonly<Record<number, number>> = {
  1: 25.4, // inch: exactly 25.4 mm (international yard and pound, 1959)
  2: 304.8, // foot = 12 in
  3: 1609344, // mile = 5280 ft
  4: 1, // millimetre
  5: 10, // centimetre
  6: 1000, // metre
  7: 1e6, // kilometre
  8: 25.4e-6, // microinch = 1e-6 in
  9: 0.0254, // mil = 0.001 in
  10: 914.4, // yard = 3 ft
  11: 1e-7, // ångström = 1e-10 m
  12: 1e-6, // nanometre
  13: 1e-3, // micrometre (micron)
  14: 100, // decimetre
  15: 1e4, // decametre
  16: 1e5, // hectometre
  17: 1e12, // gigametre
  18: 149597870700e3, // astronomical unit = 149 597 870 700 m (IAU 2012, Resolution B2)
  19: 9460730472580800e3, // light-year = c × 365.25 d (IAU)
  20: (149597870700e3 * 648000) / Math.PI, // parsec = 648000/π au (IAU 2015, Resolution B2)
  21: 1200000 / 3937, // US survey foot = 1200/3937 m
  22: 100000 / 3937, // US survey inch = 1/12 US survey foot
  23: 3600000 / 3937, // US survey yard = 3 US survey feet
  24: 6336000000 / 3937, // US survey mile = 5280 US survey feet
};

/** The unit's name for a warning, in the user's language. */
export function insunitsName(code: number): string {
  switch (code) {
    case 1: return t('inches');
    case 2: return t('feet');
    case 3: return t('miles');
    case 4: return t('millimetres');
    case 5: return t('centimetres');
    case 6: return t('metres');
    case 7: return t('kilometres');
    case 8: return t('microinches');
    case 9: return t('mils (thousandths of an inch)');
    case 10: return t('yards');
    case 11: return t('ångströms');
    case 12: return t('nanometres');
    case 13: return t('micrometres');
    case 14: return t('decimetres');
    case 15: return t('decametres');
    case 16: return t('hectometres');
    case 17: return t('gigametres');
    case 18: return t('astronomical units');
    case 19: return t('light-years');
    case 20: return t('parsecs');
    case 21: return t('US survey feet');
    case 22: return t('US survey inches');
    case 23: return t('US survey yards');
    case 24: return t('US survey miles');
    default: return String(code);
  }
}

// ---------------------------------------------------------------------------------------------
// Line types. ISO 128-2 ids are those of library/line-types/iso-128-2.json.
// ---------------------------------------------------------------------------------------------

export type DxfLineTypeName = 'CONTINUOUS' | 'HIDDEN' | 'CENTER' | 'PHANTOM' | 'DASHED';

/** ISO 128-2 line type id → the DXF line type written on export. */
export const ISO_TO_DXF_LINETYPE: Readonly<Record<string, DxfLineTypeName>> = {
  '01.1': 'CONTINUOUS',
  '01.1-freehand': 'CONTINUOUS',
  '01.1-zigzag': 'CONTINUOUS',
  '01.2': 'CONTINUOUS',
  '02.1': 'HIDDEN',
  '02.2': 'HIDDEN',
  '04.1': 'CENTER',
  '04.2': 'CENTER',
  '05.1': 'PHANTOM',
};

export const dxfLineTypeFor = (isoId: string): DxfLineTypeName => ISO_TO_DXF_LINETYPE[isoId] ?? 'CONTINUOUS';

/**
 * The LTYPE table entries MechPilot writes (DXF Reference (Autodesk), TABLES section, LTYPE:
 * 2 name, 3 description, 72 alignment code 65, 73 number of elements, 40 total pattern length,
 * 49 element length, positive = dash, negative = gap, 0 = dot).
 * The dash patterns are display conventions of DXF viewers (the values of AutoCAD's acadiso.lin,
 * in mm), not ISO 128-2 values: they only control how other programs draw the dashes, so they need
 * no standard citation. MechPilot itself draws from the ISO line type of the layer.
 */
export const DXF_LINETYPES: readonly { name: DxfLineTypeName; description: string; pattern: number[] }[] = [
  { name: 'CONTINUOUS', description: 'Solid line', pattern: [] },
  { name: 'HIDDEN', description: 'Hidden __ __ __ __', pattern: [6.35, -3.175] },
  { name: 'CENTER', description: 'Center ____ _ ____ _', pattern: [31.75, -6.35, 6.35, -6.35] },
  { name: 'PHANTOM', description: 'Phantom ____ _ _ ____', pattern: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] },
  { name: 'DASHED', description: 'Dashed __ __ __ __', pattern: [12.7, -6.35] },
];

/** The width at or above which a DXF line type is read as the wide ISO variant (01.2, 02.2, 04.2):
 *  0.5 mm is the wide line of the default 0.5/0.25 pair (ISO 128-2:2020, 5). */
export const WIDE_FROM_MM = 0.5;

/**
 * The ISO 128-2 line type for a DXF line type name, or null when the name is unknown.
 * `lineweightMm` is the layer's lineweight (code 370) when the file gives one.
 */
export function isoLineTypeFor(dxfName: string, lineweightMm: number | undefined, layerName: string): string | null {
  const n = dxfName.trim().toUpperCase();
  const wide = lineweightMm !== undefined ? lineweightMm >= WIDE_FROM_MM : undefined;
  switch (n) {
    case 'CONTINUOUS':
    case 'BYLAYER': // not meaningful on a layer; treated as continuous
    case 'BYBLOCK':
    case '':
      return (wide ?? layerName === '0') ? '01.2' : '01.1';
    case 'HIDDEN':
    case 'HIDDEN2':
    case 'HIDDENX2':
    case 'DASHED':
    case 'DASHED2':
    case 'DASHEDX2':
    case 'ACAD_ISO02W100': // acadiso.lin names carry the ISO 128 line type number
      return wide === true ? '02.2' : '02.1';
    case 'CENTER':
    case 'CENTER2':
    case 'CENTERX2':
    case 'ACAD_ISO04W100':
      return wide === true ? '04.2' : '04.1';
    case 'PHANTOM':
    case 'PHANTOM2':
    case 'PHANTOMX2':
    case 'DASHDOT':
    case 'DASHDOT2':
    case 'DASHDOTX2':
    case 'ACAD_ISO05W100':
      return '05.1';
    default:
      return null;
  }
}

/** The nearest value of the ISO 128-2 width series (ISO 128-2:2020, 5). */
export function snapLineWidth(mm: number): number {
  let best = LINE_WIDTHS[0];
  for (const w of LINE_WIDTHS) if (Math.abs(w - mm) < Math.abs(best - mm)) best = w;
  return best;
}

/** DXF lineweight (code 370, hundredths of a millimetre; DXF Reference (Autodesk), Common Group
 *  Codes for Entities, 370) for a width in mm. */
export const lineweightOf = (mm: number): number => Math.round(mm * 100);

// ---------------------------------------------------------------------------------------------
// Colours: AutoCAD Color Index (ACI, code 62) and true colour (code 420, 0x00RRGGBB).
// DXF Reference (Autodesk), Common Group Codes for Entities, 62 and 420; TABLES section, LAYER.
// ---------------------------------------------------------------------------------------------

/**
 * The fixed ACI colours: 1–7 the basic colours, 8–9 greys, 250–255 the grey ramp, as shown in
 * AutoCAD's Select Color dialog. 7 is "white or black, whichever contrasts with the background",
 * which MechPilot reads as the layer colour "auto". (Values listed in docs/dxf.md.)
 */
const ACI_FIXED: Readonly<Record<number, number>> = {
  1: 0xff0000,
  2: 0xffff00,
  3: 0x00ff00,
  4: 0x00ffff,
  5: 0x0000ff,
  6: 0xff00ff,
  7: 0xffffff,
  8: 0x808080,
  9: 0xc0c0c0,
  250: 0x333333,
  251: 0x505050,
  252: 0x696969,
  253: 0x828282,
  254: 0xbebebe,
  255: 0xffffff,
};

/** Value levels of the ACI hue rows (index % 10 >> 1) and the saturation of odd indices. */
const ACI_VALUES = [255, 204, 153, 127, 76];

/**
 * RGB (0xRRGGBB) of an ACI index 1..255. Indices 10–249 form 24 hues 15° apart (index / 10 − 1),
 * each with five value levels; even indices are fully saturated, odd ones half saturated.
 */
export function aciToRgb(index: number): number {
  const i = Math.abs(Math.trunc(index));
  const fixed = ACI_FIXED[i];
  if (fixed !== undefined) return fixed;
  if (i < 10 || i > 249) return 0xffffff;
  const hue = (Math.floor(i / 10) - 1) * 15;
  const sub = i % 10;
  const v = ACI_VALUES[sub >> 1];
  const s = sub % 2 === 1 ? 0.5 : 1;
  const h = hue / 60;
  const sector = Math.floor(h);
  const f = h - sector;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const tt = v * (1 - s * (1 - f));
  const rgb: [number, number, number][] = [
    [v, tt, p],
    [q, v, p],
    [p, v, tt],
    [p, q, v],
    [tt, p, v],
    [v, p, q],
  ];
  const [r, g, b] = rgb[sector % 6];
  return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
}

export const rgbToHex = (rgb: number): string => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

/** 0xRRGGBB from "#rrggbb" or "#rgb"; null for anything else ("auto", names). */
export function hexToRgb(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return parseInt(h, 16);
}

/** The ACI index nearest to a colour (RGB distance). 7 is kept for "auto", so it is never chosen. */
export function nearestAci(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i <= 255; i++) {
    if (i === 7) continue;
    const c = aciToRgb(i);
    const d = (((c >> 16) & 0xff) - r) ** 2 + (((c >> 8) & 0xff) - g) ** 2 + ((c & 0xff) - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Text escapes. DXF Reference (Autodesk), TEXT: control codes %%d (degree), %%p (plus/minus),
// %%c (diameter), %%% (percent), %%u / %%o (underline / overline toggles); \U+XXXX for Unicode
// characters outside the drawing code page.
// ---------------------------------------------------------------------------------------------

/** Text for a DXF string value: one line, ASCII only (°, ±, Ø as %% codes, the rest as \U+XXXX). */
export function encodeDxfText(s: string): string {
  let out = '';
  for (const ch of s.replace(/\r\n|\r|\n/g, ' ')) {
    const cp = ch.codePointAt(0) ?? 32;
    if (ch === '°') out += '%%d';
    else if (ch === '±') out += '%%p';
    else if (ch === 'Ø' || ch === '⌀') out += '%%c';
    else if (cp < 32) out += ' ';
    else if (cp <= 0x7e) out += ch;
    else if (cp <= 0xffff) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    else for (let i = 0; i < ch.length; i++) out += '\\U+' + ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/** The inverse of encodeDxfText, plus the other %% codes of TEXT. */
export function decodeDxfText(s: string): string {
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%(\d{3})/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/%%([dDpPcCuUoOkK%])/g, (_, c: string) => {
      switch (c.toLowerCase()) {
        case 'd': return '°';
        case 'p': return '±';
        case 'c': return 'Ø';
        case '%': return '%';
        default: return ''; // underline, overline, strike-through toggles
      }
    });
}

/**
 * Plain text from MTEXT content (DXF Reference (Autodesk), MTEXT, "Inline codes"): paragraph
 * breaks \P and non-breaking spaces \~ become spaces; \\ \{ \} become the character; formatting
 * codes with a value (\f \F \H \W \A \C \c \Q \T \p) and toggles (\L \l \O \o \K \k) are dropped;
 * stacked fractions \S1/2; keep their text; braces that group formatting are removed.
 */
export function stripMtext(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{' || ch === '}') {
      i++;
      continue;
    }
    if (ch !== '\\' || i + 1 >= s.length) {
      out += ch;
      i++;
      continue;
    }
    const c = s[i + 1];
    switch (c) {
      case 'P':
      case 'N': // column break
      case '~':
        out += ' ';
        i += 2;
        break;
      case '\\':
      case '{':
      case '}':
        out += c;
        i += 2;
        break;
      case 'L':
      case 'l':
      case 'O':
      case 'o':
      case 'K':
      case 'k':
        i += 2;
        break;
      case 'f':
      case 'F':
      case 'H':
      case 'W':
      case 'A':
      case 'C':
      case 'c':
      case 'Q':
      case 'T':
      case 'p': {
        const end = s.indexOf(';', i + 2);
        i = end === -1 ? s.length : end + 1;
        break;
      }
      case 'S': {
        const end = s.indexOf(';', i + 2);
        const body = s.slice(i + 2, end === -1 ? s.length : end);
        out += body.replace(/[#^]/g, '/');
        i = end === -1 ? s.length : end + 1;
        break;
      }
      case 'U': {
        const m = /^\\U\+([0-9a-fA-F]{4})/.exec(s.slice(i));
        if (m) {
          out += String.fromCharCode(parseInt(m[1], 16));
          i += m[0].length;
        } else {
          out += c;
          i += 2;
        }
        break;
      }
      case 'M': {
        // \M+nXXXX: a multibyte character in a code page; not decodable without the page.
        const m = /^\\M\+\d[0-9a-fA-F]{4}/.exec(s.slice(i));
        i += m ? m[0].length : 2;
        break;
      }
      default:
        out += c;
        i += 2;
    }
  }
  return decodeDxfText(out).replace(/\s+/g, ' ').trim();
}
