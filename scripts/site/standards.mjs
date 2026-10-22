// The website's standards pages: one page per table in library/ (ISO 286 tolerance grades and
// fits, ISO 5457 sheets, ISO 128-2 lines, ISO 3098 lettering, ISO 1101 symbols, ISO 21920-1
// surface texture, ISO 5455 scales, ISO 129-1 dimensioning, ISO 7200 title block), in English and
// Italian. Every value on these pages is read from the JSON files: nothing is typed here. Each page
// shows the file's source and verification exactly as the file states them. Quotes from the data
// files (sources, rules, notes) are in English on the Italian pages too, marked lang="en".
// Optional library folders (holes/, materials/) get pages when they exist and have a renderer.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitRows, deviations, um } from './fits.mjs';

const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'library');

/** Common ISO 286 hole-basis fits that get a page each (all hole H, as ISO 286-1 favours). */
export const FITS = [
  ['H11', 'c11'],
  ['H9', 'd9'],
  ['H8', 'f7'],
  ['H7', 'g6'],
  ['H7', 'h6'],
  ['H7', 'js6'],
  ['H7', 'k6'],
  ['H7', 'n6'],
  ['H7', 'p6'],
  ['H7', 's6'],
  ['H7', 'u6'],
];

export function standardPages({ lib, t, num, esc, REPO, page, NAV, GUIDES }) {
  const L = (lang) => ({
    t: (en, vars) => t(lang, en, vars),
    n: (v) => num(lang, v),
    /** A quote from a data file: English on every page, marked as such on Italian pages. */
    q: (s) => (lang === 'it' ? `<span lang="en">${esc(s)}</span>` : esc(s)),
    base: lang === 'en' ? '/standards/' : '/it/norme/',
  });
  const guide = (lang, id) => GUIDES.find((g) => g.id === id)[lang];

  /** Signed micrometres with a real minus: +21, 0, −7. */
  const signed = (lang, v) => (v > 0 ? '+' : v < 0 ? '−' : '') + num(lang, Math.abs(v));

  function table(head, rows, { caption = '', cls = '' } = {}) {
    const headRows = Array.isArray(head[0]) ? head : [head];
    return `<div class="table-wrap"><table${cls ? ` class="${cls}"` : ''}>${caption ? `<caption>${caption}</caption>` : ''}
          <thead>${headRows.map((r) => `<tr>${r.map((h) => (typeof h === 'string' ? `<th scope="col">${h}</th>` : `<th scope="col"${h.span ? ` colspan="${h.span}"` : ''}>${h.html}</th>`)).join('')}</tr>`).join('')}</thead>
          <tbody>
            ${rows.map((r) => `<tr>${r.map((c, k) => (k === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('\n            ')}
          </tbody>
        </table></div>`;
  }

  const verifiedItem = (s) => {
    const m = /^(https?:\/\/\S+)(.*)$/.exec(s);
    return m ? `<a href="${esc(m[1])}" rel="nofollow noopener">${esc(m[1])}</a>${esc(m[2])}` : esc(s);
  };

  /** Source, verification and the data file, exactly as the JSON says. */
  function sources(lang, file, d, extra = []) {
    const { t, q } = L(lang);
    const v = d.verification;
    const vText = v === 'primary' ? t('the standard’s own text was seen') : v === 'secondary' ? t('two independent secondary sources agree') : '';
    const rows = [
      [t('Standard'), q(d.source)],
      [t('Verification'), v ? `<code>${esc(v)}</code>${vText ? ` (${esc(vText)})` : ''}` : esc(t('not recorded in this data file'))],
    ];
    if (Array.isArray(d.verifiedFrom)) rows.push([t('Verified from'), `<ul>${d.verifiedFrom.map((s) => `<li${lang === 'it' ? ' lang="en"' : ''}>${verifiedItem(s)}</li>`).join('')}</ul>`]);
    if (Array.isArray(d.verificationNotes)) rows.push([t('Verification notes'), `<ul>${d.verificationNotes.map((s) => `<li>${q(s)}</li>`).join('')}</ul>`]);
    for (const [label, text] of extra) rows.push([label, q(text)]);
    rows.push([t('Data file'), `<a href="${REPO}/blob/main/library/${file}"><code>library/${file}</code></a>`]);
    return `<section class="sources">
        <h2>${esc(t('Source and verification'))}</h2>
        ${lang === 'it' ? `<p class="small">${esc(t('Quotes from the data file are in English, as written there.'))}</p>` : ''}
        <dl>${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>
        <p class="small">${esc(t('Values that could not be checked against the standard are left out and listed in docs/to-verify.md. Check the standard itself before you rely on a value for production, and report any mistake on GitHub.'))} <a href="${REPO}/blob/main/docs/to-verify.md">to-verify.md</a> · <a href="${REPO}/issues">${esc(t('Issues'))}</a></p>
      </section>`;
  }

  const notesList = (lang, notes, title = 'Notes from the data file') =>
    Array.isArray(notes) && notes.length ? `<h2>${esc(L(lang).t(title))}</h2>\n        <ul>${notes.map((s) => `<li>${L(lang).q(s)}</li>`).join('')}</ul>` : '';

  const defs = [];
  const add = (def) => defs.push(def);

  // ---------------------------------------------------------------------------------------------
  // ISO 286: tolerance grades, fits index, one page per fit.
  const f286 = lib('fits/iso-286.json');
  const grades = Object.keys(f286.itGrades);
  const µmGrade = (g) => ['IT01', 'IT0'].includes(g) || Number(g.slice(2)) <= 11;
  const stepIndex = (mm) => f286.sizeSteps.findIndex((s) => mm > s.over && mm <= s.upTo);

  add({
    id: 'iso-286-grades',
    slug: { en: 'iso-286-tolerance-grades', it: 'iso-286-gradi-di-tolleranza' },
    title: 'ISO 286 standard tolerance grades IT01 to IT18',
    blurb: 'Standard tolerance grades IT01 to IT18 for nominal sizes up to 3150 mm.',
    description: 'Values of the ISO 286 standard tolerance grades IT01 to IT18 for nominal sizes up to 3150 mm, with the source and how each value was checked.',
    render(lang) {
      const { t, n } = L(lang);
      // Merge the intermediate size steps that repeat the main step's values (as Table 1 prints them).
      const rows = [];
      f286.sizeSteps.forEach((s, i) => {
        const vals = grades.map((g) => f286.itGrades[g][i]);
        const prev = rows[rows.length - 1];
        if (prev && prev.upTo === s.over && prev.vals.every((v, k) => v === vals[k])) prev.upTo = s.upTo;
        else rows.push({ over: s.over, upTo: s.upTo, vals });
      });
      const head = [
        [{ html: esc(t('Nominal size (mm)')), span: 2 }, ...grades.map((g) => esc(g))],
        [esc(t('over')), esc(t('up to')), ...grades.map((g) => (µmGrade(g) ? 'µm' : 'mm'))],
      ];
      const body = rows.map((r) => [n(r.over), n(r.upTo), ...r.vals.map((v, k) => (v === null ? '—' : n(µmGrade(grades[k]) ? um(v) : v)))]);
      return `<p class="lead">${esc(t('The standard tolerance grade (IT) sets the width of a tolerance zone; the number in a class such as H7 or g6 is its grade. The width grows with the grade and with the nominal size.'))}</p>
        <p>${esc(t('Grades IT01 to IT11 in micrometres, IT12 to IT18 in millimetres, as the standard prints them. “—”: no value in the standard for that size.'))} <a href="${guide(lang, 'iso-fits')}">${esc(t('ISO fits explained'))}</a></p>
        ${table(head, body, { cls: 'num dense' })}
        ${sources(lang, 'fits/iso-286.json', f286, [[t('This table'), f286.itGradesSource]])}`;
    },
  });

  const fitSlug = (h, s) => `${h}-${s}`.toLowerCase();
  const kindLabel = { clearance: 'Clearance', transition: 'Transition', interference: 'Interference' };
  const fitSummary = FITS.map(([h, s]) => {
    const rows = fitRows(f286, h, s);
    const kinds = [...new Set(rows.map((r) => r.kind))];
    return { h, s, rows, kinds };
  });

  add({
    id: 'iso-286-fits',
    slug: { en: 'iso-286-fits', it: 'iso-286-accoppiamenti' },
    title: 'ISO 286 fits: limit deviations and clearances',
    blurb: 'Common hole-basis fits (H7/g6, H7/k6, H7/p6 …) with their deviations and clearances up to 500 mm.',
    description: 'Common ISO 286 hole-basis fits such as H7/g6, H7/h6, H7/k6 and H7/p6: limit deviations of hole and shaft and the resulting clearance or interference up to 500 mm.',
    render(lang) {
      const { t, n, base } = L(lang);
      const at = 25;
      const i = stepIndex(at);
      const step = f286.sizeSteps[i];
      const rows = fitSummary.map(({ h, s, rows, kinds }) => {
        const r = rows.find((x) => x.over <= step.over && x.upTo >= step.upTo);
        return [
          `<a href="${base}${lang === 'en' ? 'iso-286-fits' : 'iso-286-accoppiamenti'}/${fitSlug(h, s)}/">${h}/${s}</a>`,
          esc(kinds.map((k) => t(kindLabel[k])).join(', ')),
          r ? signed(lang, r.max) : '—',
          r ? signed(lang, r.min) : '—',
        ];
      });
      return `<p class="lead">${esc(t('A fit is a hole and a shaft of the same nominal size with their tolerance classes, written hole first: H7/g6. These are common hole-basis fits; each page lists the limit deviations and the resulting clearances for every size step up to 500 mm.'))}</p>
        <p>${esc(t('Values are computed from MechPilot’s ISO 286 data by the rules of ISO 286-1, the same way the app computes them. A negative clearance is an interference.'))} <a href="${guide(lang, 'iso-fits')}">${esc(t('ISO fits explained'))}</a> · <a href="${base}${lang === 'en' ? 'iso-286-tolerance-grades' : 'iso-286-gradi-di-tolleranza'}/">${esc(t('ISO 286 standard tolerance grades IT01 to IT18'))}</a></p>
        ${table([esc(t('Fit')), esc(t('Kind (over the size range)')), esc(t('Max. clearance at {a} mm (µm)', { a: n(at) })), esc(t('Min. clearance at {a} mm (µm)', { a: n(at) }))], rows, { cls: 'num' })}
        <p class="small">${esc(t('At {a} mm: the size step over {o} up to {u} mm.', { a: n(at), o: n(step.over), u: n(step.upTo) }))}</p>
        ${sources(lang, 'fits/iso-286.json', f286)}`;
    },
  });

  for (const { h, s, rows, kinds } of fitSummary) {
    const fit = `${h}/${s}`;
    add({
      id: `fit-${fitSlug(h, s)}`,
      parent: 'iso-286-fits',
      slug: { en: `iso-286-fits/${fitSlug(h, s)}`, it: `iso-286-accoppiamenti/${fitSlug(h, s)}` },
      title: `{fit} fit: limit deviations and clearances (ISO 286)`,
      vars: { fit },
      blurb: '',
      description: 'ISO 286 fit {fit}: limit deviations of the {h} hole and the {s} shaft and the clearances for every size step up to 500 mm, computed from the tolerance grades and fundamental deviations.',
      render(lang) {
        const { t, n, q, base } = L(lang);
        const summary =
          kinds.length === 1
            ? t(`${kindLabel[kinds[0]]} fit at every size step below.`)
            : t('The kind of fit depends on the size: see the last column.');
        const head = [
          [{ html: esc(t('Nominal size (mm)')), span: 2 }, { html: esc(t('Hole {c} (µm)', { c: h })), span: 2 }, { html: esc(t('Shaft {c} (µm)', { c: s })), span: 2 }, { html: esc(t('Clearance (µm)')), span: 2 }, esc(t('Fit'))],
          [esc(t('over')), esc(t('up to')), 'ES', 'EI', 'es', 'ei', esc(t('max.')), esc(t('min.')), ''],
        ];
        const body = rows.map((r) => [n(r.over), n(r.upTo), signed(lang, r.ES), signed(lang, r.EI), signed(lang, r.es), signed(lang, r.ei), signed(lang, r.max), signed(lang, r.min), esc(t(kindLabel[r.kind]))]);
        const i = stepIndex(25);
        const hd = deviations(f286, h, i);
        const sd = deviations(f286, s, i);
        const mm = (v) => n((Math.round((25 + v) * 1e7) / 1e7).toFixed(3));
        const ruleKeys = ['holeAtoH', s.startsWith('js') ? 'jsJS' : s[0] <= 'h' ? 'shaftAtoH' : 'shaftKtoZC', ...(s.startsWith('k') ? ['shaftK'] : [])];
        const others = fitSummary.filter((f) => f.h !== h || f.s !== s).map((f) => `<a href="${base}${lang === 'en' ? 'iso-286-fits' : 'iso-286-accoppiamenti'}/${fitSlug(f.h, f.s)}/">${f.h}/${f.s}</a>`);
        return `<p class="lead">${esc(t('Hole {h} with shaft {s}, hole-basis system. Limit deviations and the resulting clearances for nominal sizes up to 500 mm, in micrometres.', { h, s }))} ${esc(summary)}</p>
        ${table(head, body, { cls: 'num' })}
        <p class="small">${esc(t('Max. clearance = ES − ei, min. clearance = EI − es; a negative clearance is an interference. Above 500 mm MechPilot’s data holds no fundamental deviations, so no values are shown.'))}</p>
        <h2>${esc(t('Example: ⌀25 {fit}', { fit }))}</h2>
        <ul>
          <li>${esc(t('Hole ⌀25 {c}: {lo} to {hi} mm', { c: h, lo: mm(hd.lower), hi: mm(hd.upper) }))}</li>
          <li>${esc(t('Shaft ⌀25 {c}: {lo} to {hi} mm', { c: s, lo: mm(sd.lower), hi: mm(sd.upper) }))}</li>
        </ul>
        <h2>${esc(t('How the values are computed'))}</h2>
        <p>${esc(t('Each deviation comes from the standard tolerance grade (IT) of the class and its fundamental deviation for the size step, combined by these rules of ISO 286-1:'))}</p>
        <ul>${ruleKeys.map((k) => `<li>${q(f286.rules[k])}</li>`).join('')}</ul>
        <p><a href="${guide(lang, 'iso-fits')}">${esc(t('ISO fits explained'))}</a> · <a href="${base}${lang === 'en' ? 'iso-286-tolerance-grades' : 'iso-286-gradi-di-tolleranza'}/">${esc(t('ISO 286 standard tolerance grades IT01 to IT18'))}</a></p>
        <h2>${esc(t('Other fits'))}</h2>
        <p class="chips">${others.join(' ')}</p>
        ${sources(lang, 'fits/iso-286.json', f286, [
          [t('Tolerance grades'), f286.itGradesSource],
          [t('Fundamental deviations'), f286.fundamentalDeviationsSource],
        ])}`;
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ISO 5457 sheets.
  const sheets = lib('sheets/iso-5457.json');
  add({
    id: 'iso-5457',
    slug: { en: 'iso-5457-sheet-sizes', it: 'iso-5457-formati-dei-fogli' },
    title: 'ISO 5457 drawing sheet sizes A0 to A4: frame, borders and grid',
    blurb: 'Sheet sizes A0 to A4, drawing space, borders, frame and grid reference fields.',
    description: 'ISO 5457 drawing sheets A0 to A4: trimmed and untrimmed sizes, drawing space, the 20 and 10 mm borders, frame line width and the grid reference fields.',
    render(lang) {
      const { t, n, q } = L(lang);
      const x = (a, b) => `${n(a)} × ${n(b)}`;
      const ds = sheets.sizes[0].drawingSpace.tolerance;
      const un = sheets.sizes[0].untrimmed.tolerance;
      const body = sheets.sizes.map((s) => [
        esc(s.id),
        x(s.trimmed.a1, s.trimmed.b1),
        x(s.drawingSpace.a2, s.drawingSpace.b2),
        x(s.untrimmed.a3, s.untrimmed.b3),
        `${n(s.frameMargins.left)} / ${n(s.frameMargins.top)}`,
        x(s.zonesX, s.zonesY),
        esc(t(s.orientation === 'landscape' ? 'Landscape' : 'Portrait')),
      ]);
      const z = sheets.zoneField;
      const c = sheets.centringMarks;
      return `<p class="lead">${esc(t('Sheet sizes and layout for technical drawings: the A-series sheet, the drawing space inside the frame, the borders and the grid reference fields.'))}</p>
        ${table(
          [esc(t('Size')), esc(t('Trimmed sheet a1 × b1 (mm)')), esc(t('Drawing space a2 × b2 (mm, ±{v})', { v: n(ds) })), esc(t('Untrimmed sheet a3 × b3 (mm, ±{v})', { v: n(un) })), esc(t('Borders left / others (mm)')), esc(t('Grid fields')), esc(t('Orientation'))],
          body,
          { cls: 'num' },
        )}
        <p class="small">${q(sheets.sizesSource)}</p>
        <h2>${esc(t('Layout'))}</h2>
        <dl class="facts">
          <dt>${esc(t('Frame line width'))}</dt><dd>${n(sheets.frameLineWidth)} mm — ${q(sheets.frameLineWidthSource)}</dd>
          <dt>${esc(t('Borders'))}</dt><dd>${q(sheets.frameMarginsSource)}</dd>
          <dt>${esc(t('Grid reference fields'))}</dt><dd>${esc(t('{l} mm long, labels {h} mm high, line width {w} mm', { l: n(z.length), h: n(z.labelHeight), w: n(z.gridLineWidth) }))} — ${q(z.source)}</dd>
          <dt>${esc(t('Centring marks'))}</dt><dd>${esc(t('{c} marks, recommended line width {w} mm, extending {e} mm beyond the frame', { c: c.count, w: n(c.recommendedLineWidth), e: n(c.recommendedExtentBeyondFrame) }))} — ${q(c.source)}</dd>
          <dt>${esc(t('Trimming marks'))}</dt><dd>${esc(t('{w} × {h} mm', { w: n(sheets.trimmingMarks.width), h: n(sheets.trimmingMarks.height) }))} — ${q(sheets.trimmingMarks.source)}</dd>
          <dt>${esc(t('Title block'))}</dt><dd>${q(sheets.titleBlock.position)} — ${q(sheets.titleBlock.source)}</dd>
        </dl>
        ${notesList(lang, sheets.notes)}
        ${sources(lang, 'sheets/iso-5457.json', sheets)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 128-2 line types.
  const lines = lib('line-types/iso-128-2.json');
  add({
    id: 'iso-128-2',
    slug: { en: 'iso-128-2-line-types', it: 'iso-128-2-tipi-di-linea' },
    title: 'ISO 128-2 line types and line widths for technical drawings',
    blurb: 'Line types with their use and dash patterns, and the line-width series.',
    description: 'ISO 128-2 line types for mechanical drawings (continuous, dashed, long-dashed dotted …) with their typical use and dash lengths, and the line-width series 0.13 to 2 mm.',
    render(lang) {
      const { t, n, q } = L(lang);
      const body = lines.types.map((ty) => [
        esc(ty.id),
        esc(t(ty.name)),
        esc(t(ty.width === 'wide' ? 'Wide' : 'Narrow')),
        ty.pattern ? ty.pattern.map(n).join(', ') : esc(t('continuous')),
        esc(t(ty.use)),
      ]);
      return `<p class="lead">${esc(t('The line types of technical drawings, what each is used for in mechanical engineering, and the widths a line may have.'))}</p>
        <h2>${esc(t('Line widths'))}</h2>
        <p class="chips">${lines.widths.map((w) => `<span>${n(w)} mm</span>`).join(' ')}</p>
        <p>${esc(t('Narrow lines are {r} × the width of wide lines.', { r: n(lines.narrowToWide) }))} <span class="small">${q(lines.widthsSource)}</span></p>
        <h2>${esc(t('Line types'))}</h2>
        ${table([esc(t('No.')), esc(t('Line type')), esc(t('Width')), esc(t('Pattern (multiples of d)')), esc(t('Typical use'))], body)}
        <p class="small">${q(lines.patternSource)}</p>
        <h2>${esc(t('Sources of each line type'))}</h2>
        <ul class="small">${lines.types.map((ty) => `<li><strong>${esc(ty.id)}</strong>: ${q(ty.source)}</li>`).join('')}</ul>
        ${sources(lang, 'line-types/iso-128-2.json', lines)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 3098 lettering.
  const letters = lib('lettering/iso-3098.json');
  add({
    id: 'iso-3098',
    slug: { en: 'iso-3098-lettering', it: 'iso-3098-scrittura' },
    title: 'ISO 3098 lettering: text heights and proportions of type A and B',
    blurb: 'Nominal text heights and the proportions of lettering types A and B.',
    description: 'ISO 3098 lettering for technical drawings: the nominal heights 1.8 to 20 mm and the proportions of type A and type B lettering as multiples of the height h.',
    render(lang) {
      const { t, n, q } = L(lang);
      const A = letters.types.A;
      const B = letters.types.B;
      const fr = (f) => `${n(f)} h`;
      const rows = [
        ['Line width (d)', 'lineWidth'],
        ['Height of lower-case letters', 'lowercaseHeight'],
        ['Tails of lower-case letters', 'tail'],
        ['Stems of lower-case letters', 'stem'],
        ['Area for diacritical marks', 'diacriticalArea'],
        ['Spacing between characters', 'characterSpacing'],
        ['Minimum baseline spacing, with diacritical marks (b1)', 'b1'],
        ['Minimum baseline spacing, upper and lower case (b2)', 'b2'],
        ['Minimum baseline spacing, upper case only (b3)', 'b3'],
        ['Minimum spacing between words', 'wordSpacing'],
      ].map(([label, k]) => {
        const get = (ty) => (k.startsWith('b') && k.length === 2 ? ty.minBaselineSpacing[k] : ty[k]);
        return [esc(t(label)), fr(get(A)), fr(get(B))];
      });
      return `<p class="lead">${esc(t('Text on technical drawings: the nominal heights h (the height of the capital letters) and the proportions of the two lettering types.'))}</p>
        <h2>${esc(t('Nominal heights h'))}</h2>
        <p class="chips">${letters.heights.map((h) => `<span>${n(h)} mm</span>`).join(' ')}</p>
        <p class="small">${q(letters.heightsSource)}</p>
        <h2>${esc(t('Proportions of type A and type B'))}</h2>
        ${table([esc(t('Characteristic')), esc(t('Type A')), esc(t('Type B'))], rows, { cls: 'num' })}
        <p class="small">${q(letters.typesSource)} ${q(B.preferred)}</p>
        <h2>${esc(t('Rules from the data file'))}</h2>
        <ul>
          <li>${q(letters.spacingRule)}</li>
          <li>${q(letters.slope)}</li>
          <li>${q(letters.lineWidthRule)}</li>
          <li>${q(letters.designation.example)} — ${q(letters.designation.source)}</li>
        </ul>
        ${notesList(lang, letters.notes)}
        ${sources(lang, 'lettering/iso-3098.json', letters)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 1101 geometrical tolerance symbols.
  const gdt = lib('gdt/iso-1101.json');
  const groupLabel = { form: 'Form', orientation: 'Orientation', location: 'Location', 'run-out': 'Run-out' };
  const datumLabel = { none: 'No', required: 'Yes', optional: 'No or yes' };
  add({
    id: 'iso-1101',
    slug: { en: 'iso-1101-gdt-symbols', it: 'iso-1101-simboli-tolleranze-geometriche' },
    title: 'ISO 1101 GD&T symbols: geometrical characteristics and the tolerance frame',
    blurb: 'The geometrical characteristics, their symbols, groups and whether a datum is needed.',
    description: 'The ISO 1101 symbols for geometrical tolerances (flatness, position, run-out …): specification group, whether a datum is needed, subclause, and the tolerance frame proportions.',
    render(lang) {
      const { t, n, q } = L(lang);
      const body = gdt.characteristics.map((c) => [
        `<span class="sym" aria-hidden="true">${esc(c.symbol)}</span>`,
        esc(lang === 'it' ? c.nameIt : c.name),
        esc(c.groups.map((g) => t(groupLabel[g])).join(', ')),
        esc(t(datumLabel[c.datum])),
        esc(c.subclause),
        `<code>${esc(c.unicode)}</code>`,
      ]);
      const f = gdt.frame;
      return `<p class="lead">${esc(t('The geometrical characteristics that a tolerance frame can control, with their symbols, the group each belongs to and whether a datum is needed.'))}</p>
        ${table([esc(t('Symbol')), esc(t('Characteristic')), esc(t('Group')), esc(t('Datum needed')), esc(t('Subclause')), esc(t('Unicode character used by MechPilot'))], body)}
        <p class="small">${q(gdt.characteristicsSource)}</p>
        ${lang === 'en' ? `<ul class="small">${gdt.characteristics.filter((c) => c.note).map((c) => `<li><strong>${esc(c.name)}</strong>: ${esc(c.note)}</li>`).join('')}</ul>` : ''}
        <h2>${esc(t('Tolerance frame'))}</h2>
        <dl class="facts">
          <dt>${esc(t('Frame height H'))}</dt><dd>${n(f.heightInH)} h — ${q(f.heightNote)}</dd>
          <dt>${esc(t('Line width d'))}</dt><dd>${n(f.lineWidthInH)} h — ${q(f.lineWidthNote)}</dd>
          <dt>${esc(t('Datum target circle diameter'))}</dt><dd>${n(f.datumTargetCircleDiameterInH)} h</dd>
          <dt>${esc(t('Source'))}</dt><dd>${q(f.source)}</dd>
        </dl>
        <h2>${esc(t('Datum indicator'))}</h2>
        <p>${q(gdt.datumIndicator.form)} — ${q(gdt.datumIndicator.source)}</p>
        ${notesList(lang, gdt.notes)}
        ${sources(lang, 'gdt/iso-1101.json', gdt)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 21920-1 surface texture.
  const surf = lib('surface/iso-21920-1.json');
  add({
    id: 'iso-21920-1',
    slug: { en: 'iso-21920-1-surface-texture', it: 'iso-21920-1-stato-della-superficie' },
    title: 'ISO 21920-1 surface texture symbols and the Ra series',
    blurb: 'The three surface texture symbols, symbol proportions and the Ra values with N grades.',
    description: 'Surface texture indication to ISO 21920-1 (formerly ISO 1302): the three graphical symbols, how Ra is written, symbol proportions and the Ra series 0.025 to 50 µm with N grades.',
    render(lang) {
      const { t, n, q } = L(lang);
      const forms = surf.symbol.forms.map((f) => [esc(f.id), esc(lang === 'it' ? f.meaningIt : f.meaning), esc(f.figure)]);
      const lp = surf.symbol.legacyProportions;
      const prop = lp.table.map((r) => [n(r.h), n(r.lineWidth), n(r.H1), n(r.H2)]);
      const ra = surf.raSeries.map((v, k) => [n(v), esc(surf.raGradeNumbers[k] ?? '—')]);
      return `<p class="lead">${esc(t('How surface texture is indicated on a drawing: the graphical symbol, the parameter and its limit value, such as Ra 1,6.'))}</p>
        <h2>${esc(t('Graphical symbols'))}</h2>
        ${table([esc(t('Symbol')), esc(t('Meaning')), esc(t('Figure'))], forms)}
        <p class="small">${q(surf.symbol.source)}. ${q(surf.symbol.barAbove)}</p>
        <h2>${esc(t('Minimal indication'))}</h2>
        <p>${q(surf.indication.minimal)}</p>
        <p>${esc(t('Parameters with default values:'))} ${surf.indication.parametersWithDefaults.map((p) => `<code>${esc(p)}</code>`).join(' ')} <span class="small">(${q(surf.indication.parametersWithDefaultsSource)})</span></p>
        <h2>${esc(t('Symbol proportions'))}</h2>
        <p>${q(surf.symbol.proportionsNote)}</p>
        ${table([esc(t('Lettering height h (mm)')), esc(t('Line width (mm)')), esc(t('Short leg H1 (mm)')), esc(t('Long leg H2 (mm)'))], prop, { cls: 'num' })}
        <p class="small">${q(lp.source)}. ${q(lp.lineWidthNote)}</p>
        <h2>${esc(t('Ra series'))}</h2>
        ${table([esc(t('Ra ({u})', { u: surf.raSeriesUnit })), esc(t('Roughness grade number'))], ra, { cls: 'num' })}
        <p class="small">${q(surf.raSeriesSource)}</p>
        ${notesList(lang, surf.notes)}
        ${sources(lang, 'surface/iso-21920-1.json', surf)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 5455 scales.
  const scales = lib('scales/iso-5455.json');
  const kindOf = { enlargement: 'Enlargement', full: 'Full size', reduction: 'Reduction' };
  add({
    id: 'iso-5455',
    slug: { en: 'iso-5455-scales', it: 'iso-5455-scale' },
    title: 'ISO 5455 recommended scales for technical drawings',
    blurb: 'The recommended enlargement and reduction scales and how a scale is written.',
    description: 'The ISO 5455 recommended scales for technical drawings, from 50:1 to 1:10000, how a scale is designated and where it is written on the drawing.',
    render(lang) {
      const { t, q } = L(lang);
      const body = scales.scales.map((s) => [esc(s.id.replace(':', ' : ')), esc(t(kindOf[s.kind]))]);
      return `<p class="lead">${esc(t('The scales recommended for technical drawings, and how the scale is designated.'))}</p>
        ${table([esc(t('Scale')), esc(t('Kind'))], body, { cls: 'num' })}
        <p class="small">${q(scales.scalesSource)}</p>
        <h2>${esc(t('Designation and inscription'))}</h2>
        <ul>
          <li>${q(scales.ratioDefinition)}</li>
          <li><code>${esc(scales.designation.format)}</code> — ${q(scales.designation.source)}</li>
          <li>${q(scales.designation.wordMayBeOmitted)}</li>
          <li>${q(scales.inscription.mainScale)} ${q(scales.inscription.otherScales)}</li>
          <li>${q(scales.extension.rule)} — ${q(scales.extension.source)}</li>
        </ul>
        ${notesList(lang, scales.notes)}
        ${sources(lang, 'scales/iso-5455.json', scales)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 129-1 dimensioning.
  const dims = lib('dimensioning/iso-129-1.json');
  const symbolLabel = {
    diameter: 'Diameter',
    radius: 'Radius',
    square: 'Square',
    sphericalDiameter: 'Spherical diameter',
    sphericalRadius: 'Spherical radius',
    arcLength: 'Arc length',
    thickness: 'Thickness',
    depth: 'Depth',
    counterbore: 'Counterbore',
    countersink: 'Countersink',
    between: 'Between',
    developedLength: 'Developed length',
  };
  add({
    id: 'iso-129-1',
    slug: { en: 'iso-129-1-dimensioning', it: 'iso-129-1-quotatura' },
    title: 'ISO 129-1 dimensioning: arrowheads, extension lines and symbols',
    blurb: 'Arrowhead forms and sizes, extension lines, text placement and the dimension symbols.',
    description: 'ISO 129-1 dimensioning on technical drawings: arrowhead forms and sizes, extension lines, where the text goes, the decimal comma and the symbols ⌀, R, □, SR and others.',
    render(lang) {
      const { t, n, q } = L(lang);
      const ah = dims.arrowhead.forms.map((f) => {
        const kind = f.id === 'point' ? t('Dot') : f.id === 'oblique-stroke' ? t('Oblique stroke') : f.filled ? t('Closed and filled') : f.closed ? t('Closed') : t('Open');
        const angle = f.includedAngle !== undefined ? `${n(f.includedAngle)}°` : f.angle !== undefined ? `${n(f.angle)}°` : '—';
        const size = f.lengthInH !== undefined ? t('length {v} h', { v: n(f.lengthInH) }) : f.depthInH !== undefined ? t('depth {v} h', { v: n(f.depthInH) }) : f.diameterInH !== undefined ? t('diameter {v} h', { v: n(f.diameterInH) }) : '—';
        return [`<code>${esc(f.id)}</code>`, esc(kind), angle, esc(size)];
      });
      const syms = Object.entries(symbolLabel)
        .filter(([k]) => dims.symbols[k])
        .map(([k, label]) => {
          const s = dims.symbols[k];
          return [esc(t(label)), s.text === null ? esc(t('graphical symbol, no character')) : `<span class="sym">${esc(s.text)}</span>`, s.unicode ? `<code>${esc(s.unicode)}</code>` : '—'];
        });
      return `<p class="lead">${esc(t('How dimensions are presented on technical drawings: arrowheads, extension lines, the dimension text and the symbols that go in front of the value.'))}</p>
        <h2>${esc(t('Arrowheads'))}</h2>
        ${table([esc(t('Form')), esc(t('Kind')), esc(t('Angle')), esc(t('Size (h = lettering height)'))], ah)}
        <p class="small">${q(dims.arrowhead.edition)}. ${q(dims.arrowhead.oneStylePerDrawing)}</p>
        <h2>${esc(t('Extension lines'))}</h2>
        <ul>
          <li>${esc(t('Overshoot beyond the dimension line: about {v} × the line width', { v: n(dims.extensionLineOvershoot.lineWidths) }))} — ${q(dims.extensionLineOvershoot.source)}</li>
          <li>${esc(t('Permitted gap from the feature: about {v} × the line width', { v: n(dims.extensionLineGap.lineWidths) }))} — ${q(dims.extensionLineGap.source)}</li>
          ${dims.extensionLineRules.map((r) => `<li>${q(r)}</li>`).join('')}
        </ul>
        <h2>${esc(t('Dimension text'))}</h2>
        <ul>
          <li>${q(dims.textPlacement.rule)} — ${q(dims.textPlacement.source)}</li>
          <li>${q(dims.decimalMarker.rule)} — ${q(dims.decimalMarker.source)}</li>
          <li>${q(dims.characterHeight.rule)} — ${q(dims.characterHeight.source)}</li>
          <li>${q(dims.repetition.rule)} — ${q(dims.repetition.source)}</li>
        </ul>
        <h2>${esc(t('Symbols in front of the value'))}</h2>
        ${table([esc(t('Meaning')), esc(t('Indicator')), esc(t('Unicode character used by MechPilot'))], syms)}
        <p class="small">${q(dims.symbols.source)}</p>
        <h2>${esc(t('Tolerances'))}</h2>
        <ul>${dims.tolerances.rules.map((r) => `<li>${q(r)}</li>`).join('')}</ul>
        <p class="small">${q(dims.tolerances.source)}</p>
        ${notesList(lang, dims.notes)}
        ${sources(lang, 'dimensioning/iso-129-1.json', dims)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // ISO 7200 title block.
  const tb = lib('title-blocks/iso-7200.json');
  const groupOf = { identifying: 'Identifying', descriptive: 'Descriptive', administrative: 'Administrative' };
  add({
    id: 'iso-7200',
    slug: { en: 'iso-7200-title-block', it: 'iso-7200-cartiglio' },
    title: 'ISO 7200 title block: the data fields of a drawing',
    blurb: 'The title block data fields, which are mandatory, and their recommended lengths.',
    description: 'The ISO 7200 data fields of a title block: identifying, descriptive and administrative fields, which are mandatory, their recommended number of characters, and the 180 mm width.',
    render(lang) {
      const { t, n, q } = L(lang);
      const ld = (v) => (v === true ? t('Yes') : v === false ? t('No') : v === null ? '—' : t(v));
      const body = tb.fields.map((f) => [
        esc(lang === 'it' ? f.nameIt : f.name),
        esc(t(groupOf[f.group])),
        esc(f.clause),
        esc(f.mandatory ? t('M (mandatory)') : t('O (optional)')),
        f.maxChars === null ? esc(t('unspecified')) : n(f.maxChars),
        esc(ld(f.languageDependent)),
      ]);
      return `<p class="lead">${esc(t('The data fields of a title block or document header: what identifies a drawing, what describes it, and who is responsible for it.'))}</p>
        <p>${esc(t('Total width: {w} mm.', { w: n(tb.maxWidth) }))} <span class="small">${q(tb.maxWidthSource)}</span></p>
        ${table([esc(t('Field')), esc(t('Group')), esc(t('Clause')), esc(t('Mandatory')), esc(t('Recommended characters')), esc(t('Language-dependent'))], body, { cls: 'num-last' })}
        <p class="small">${q(tb.fieldsSource)}</p>
        <p>${q(tb.letteringHeightsNote)}</p>
        ${notesList(lang, tb.notes)}
        ${sources(lang, 'title-blocks/iso-7200.json', tb)}`;
    },
  });

  // ---------------------------------------------------------------------------------------------
  // Holes and materials (M4 on): a page when the file exists. Any other file in these folders is
  // reported, so no table is ever guessed from an unknown schema.
  const optional = (rel) => (existsSync(join(libDir, rel)) ? lib(rel) : null);
  const known = new Set(['holes/iso-273.json', 'holes/tap-drills.json', 'materials/common.json']);
  for (const folder of ['holes', 'materials']) {
    const dir = join(libDir, folder);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith('.json') && !known.has(`${folder}/${f}`)) console.warn(`note: library/${folder}/${f} has no website page yet (scripts/site/standards.mjs)`);
    }
  }

  const clearance = optional('holes/iso-273.json');
  if (clearance) {
    add({
      id: 'iso-273',
      slug: { en: 'iso-273-clearance-holes', it: 'iso-273-fori-di-passaggio' },
      title: 'ISO 273 clearance holes for bolts and screws, M1.6 to M64',
      blurb: 'Clearance hole diameters for metric bolts and screws, fine, medium and coarse series.',
      description: 'ISO 273 clearance hole diameters for metric bolts and screws in the fine, medium and coarse series, with their tolerance classes, the source and how each value was checked.',
      render(lang) {
        const { t, n, q } = L(lang);
        const tc = clearance.toleranceClasses;
        const series = ['fine', 'medium', 'coarse'];
        const label = { fine: 'Fine', medium: 'Medium', coarse: 'Coarse' };
        const body = clearance.holes.map((h) => [esc(h.thread), ...series.map((s) => n(h[s]))]);
        return `<p class="lead">${esc(t('The diameter of the clearance hole for a metric bolt or screw, in three series: fine, medium and coarse.'))}</p>
        ${table([esc(t('Thread')), ...series.map((s) => esc(t('{s} series (mm), {c}', { s: t(label[s]), c: tc[s] })))], body, { cls: 'num' })}
        <p class="small">${q(clearance.holesSource)}</p>
        <p class="small">${esc(t('Tolerance classes:'))} ${q(tc.source)}</p>
        ${notesList(lang, clearance.notes)}
        ${sources(lang, 'holes/iso-273.json', clearance)}`;
      },
    });
  }

  const tap = optional('holes/tap-drills.json');
  if (tap) {
    add({
      id: 'tap-drills',
      slug: { en: 'tap-drill-sizes-metric-coarse', it: 'punte-per-maschiatura-metrica-grossa' },
      title: 'Tap drill sizes for ISO metric coarse threads (ISO 2306)',
      blurb: 'Drill diameters before tapping and the coarse pitches, M1.6 to M56.',
      description: 'Tap drill diameters for ISO metric coarse threads M1.6 to M56 from ISO 2306, with the coarse pitch from ISO 261, the source and how each value was checked.',
      render(lang) {
        const { t, n, q } = L(lang);
        const body = tap.threads.map((r) => [esc(r.thread), n(r.pitch), n(r.drill)]);
        return `<p class="lead">${esc(t('The drill to use before tapping an ISO metric coarse thread, with the thread pitch.'))}</p>
        ${table([esc(t('Thread')), esc(t('Pitch (mm)')), esc(t('Tap drill (mm)'))], body, { cls: 'num' })}
        <p class="small">${q(tap.pitchSource)}. ${q(tap.drillSource)}.</p>
        <p>${q(tap.rule)} — ${q(tap.ruleSource)}</p>
        ${notesList(lang, tap.notes)}
        ${sources(lang, 'holes/tap-drills.json', tap)}`;
      },
    });
  }

  const materials = optional('materials/common.json');
  if (materials) {
    add({
      id: 'materials',
      slug: { en: 'material-densities', it: 'densita-dei-materiali' },
      title: 'Densities of common engineering materials',
      blurb: 'Densities of steels, aluminium, copper alloys, cast iron and plastics, each with its source.',
      description: 'Densities of common engineering materials (structural and stainless steel, aluminium, brass, copper, cast iron, POM, PA 6, PE-HD) as MechPilot uses them for mass, each with its source.',
      render(lang) {
        const { t, n, q } = L(lang);
        const body = materials.materials.map((m) => [
          esc(lang === 'it' ? m.nameIt : m.name),
          esc(m.standard ?? '—'),
          n(m.density),
          `<code>${esc(m.verification ?? '—')}</code>`,
          `<span class="small">${q(m.densitySource)}${m.densityNote ? ` ${q(m.densityNote)}` : ''}</span>`,
        ]);
        return `<p class="lead">${esc(t('The densities MechPilot uses to compute the mass of a part, each with the document it comes from and how it was checked.'))}</p>
        ${table([esc(t('Material')), esc(t('Standard')), esc(t('Density ({u})', { u: materials.unit.replace('m3', 'm³') })), esc(t('Verification')), esc(t('Source'))], body, { cls: 'num-3' })}
        ${notesList(lang, materials.notes)}
        ${sources(lang, 'materials/common.json', materials)}`;
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Emit the pages and the index.
  const pathOf = (def, lang) => `${L(lang).base}${def.slug[lang]}/`;
  const titleOf = (def, lang) => t(lang, def.title, def.vars);
  for (const def of defs) {
    for (const lang of ['en', 'it']) {
      const other = lang === 'en' ? 'it' : 'en';
      const parent = def.parent ? defs.find((d) => d.id === def.parent) : null;
      const title = titleOf(def, lang);
      page({
        lang,
        path: pathOf(def, lang),
        alt: pathOf(def, other),
        title: `${title} · MechPilot`,
        description: t(lang, def.description, { fit: def.vars?.fit, h: def.vars?.fit?.split('/')[0], s: def.vars?.fit?.split('/')[1] }),
        section: 'standards',
        crumbs: [[t(lang, 'Standards'), L(lang).base], ...(parent ? [[titleOf(parent, lang), pathOf(parent, lang)]] : []), [title]],
        body: `<article class="std">
        <h1>${esc(title)}</h1>
        ${def.render(lang)}
      </article>`,
      });
    }
  }
  for (const lang of ['en', 'it']) {
    const top = defs.filter((d) => !d.parent);
    page({
      lang,
      path: L(lang).base,
      alt: L(lang === 'en' ? 'it' : 'en').base,
      title: t(lang, 'Standards tables for mechanical drawing · MechPilot'),
      description: t(lang, 'Tables from the ISO standards behind mechanical drawings, as MechPilot uses them: fits and tolerance grades, sheets, lines, lettering, GD&T, surface texture, scales, dimensioning, title blocks.'),
      section: 'standards',
      crumbs: [[t(lang, 'Standards')]],
      body: `<div class="narrow">
        <h1>${esc(t(lang, 'Standards tables'))}</h1>
        <p class="lead">${esc(t(lang, 'The data MechPilot draws with, one page per table. Every value comes from the library in the repository, which cites the standard and clause and says how the value was checked. Nothing is typed by hand for these pages.'))}</p>
        <ul class="cards">
          ${top.map((d) => `<li><a href="${pathOf(d, lang)}">${esc(titleOf(d, lang))}</a><span>${esc(t(lang, d.blurb))}</span></li>`).join('\n          ')}
        </ul>
        <h2>${esc(t(lang, 'Guides'))}</h2>
        <ul>
          ${GUIDES.map((g) => `<li><a href="${g[lang]}">${esc(t(lang, g.id === 'iso-fits' ? 'ISO fits explained' : 'First angle and third angle projection'))}</a></li>`).join('\n          ')}
        </ul>
      </div>`,
    });
  }

  // Numbers for the guides, from the same data.
  const guideVars = {};
  for (const lang of ['en', 'it']) {
    const n = (v) => num(lang, v);
    const i25 = stepIndex(25);
    const i100 = stepIndex(100);
    const s25 = f286.sizeSteps[i25];
    const s100 = f286.sizeSteps[i100];
    const h = deviations(f286, 'H7', i25);
    const s = deviations(f286, 'g6', i25);
    const mm = (v) => n((Math.round((25 + v) * 1e7) / 1e7).toFixed(3));
    guideVars[lang] = {
      IT7_25: n(um(f286.itGrades.IT7[i25])),
      IT6_25: n(um(f286.itGrades.IT6[i25])),
      IT7_100: n(um(f286.itGrades.IT7[i100])),
      S25_OVER: n(s25.over),
      S25_UPTO: n(s25.upTo),
      S100_OVER: n(s100.over),
      S100_UPTO: n(s100.upTo),
      H7_ES: signed(lang, um(h.upper)),
      H7_EI: signed(lang, um(h.lower)),
      G6_ES: signed(lang, um(s.upper)),
      G6_EI: signed(lang, um(s.lower)),
      H7_MIN: mm(h.lower),
      H7_MAX: mm(h.upper),
      G6_MIN: mm(s.lower),
      G6_MAX: mm(s.upper),
      CL_MAX: n(Math.round((um(h.upper) - um(s.lower)) * 1e4) / 1e4),
      CL_MIN: n(Math.round((um(h.lower) - um(s.upper)) * 1e4) / 1e4),
      GRADES: String(grades.length),
      P_FITS: `${L(lang).base}${lang === 'en' ? 'iso-286-fits' : 'iso-286-accoppiamenti'}/`,
      P_FIT_H7G6: `${L(lang).base}${lang === 'en' ? 'iso-286-fits' : 'iso-286-accoppiamenti'}/h7-g6/`,
      P_GRADES: `${L(lang).base}${lang === 'en' ? 'iso-286-tolerance-grades' : 'iso-286-gradi-di-tolleranza'}/`,
      P_TITLE_BLOCK: `${L(lang).base}${lang === 'en' ? 'iso-7200-title-block' : 'iso-7200-cartiglio'}/`,
      P_DIMS: `${L(lang).base}${lang === 'en' ? 'iso-129-1-dimensioning' : 'iso-129-1-quotatura'}/`,
      P_GUIDE_FITS: guide(lang, 'iso-fits'),
      P_GUIDE_PROJ: guide(lang, 'projection'),
    };
  }
  return { guideVars };
}
