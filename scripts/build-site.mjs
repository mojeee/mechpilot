#!/usr/bin/env node
// Builds the static website in site/ (English at /, Italian at /it/): landing page, "For
// companies", the docs rendered from docs/*.md, the changelog, one page per standards table in
// library/, two guides, 404, robots.txt, sitemap.xml, _headers and _redirects. Run
// `npm run build:site` after editing scripts/site/*, docs/*.md, CHANGELOG.md or library/.
//
// Output is committed, because Cloudflare Pages serves site/ as it is (no build step), and CI
// checks that the committed output is up to date. The build is deterministic: no dates, no
// randomness, stable ordering; running it twice gives the same bytes. It fails on a missing
// Italian text and on a broken internal link (scripts/check-site.mjs). No JavaScript on any page,
// no request to a third party, no tracking.
//
// Screenshots (site/img/*.png) are not built here: e2e/screenshots.e2e.ts takes them from the
// real app. A missing screenshot is replaced by an SVG placeholder.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { IT, IT_TEXT } from './site/i18n-it.mjs';
import { escapeHtml as esc, inline, markdown } from './site/markdown.mjs';
import { standardPages } from './site/standards.mjs';
import { checkSite } from './check-site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = 'https://mechpilot.agentflowbind.com';
const REPO = 'https://github.com/mojeee/mechpilot';
const RELEASES = `${REPO}/releases/latest`;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const siteDir = join(root, 'site');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------------------------------------
// Italian texts. Generated pages call t(lang, english) and template pages carry data-i18n keys;
// either way a missing Italian text fails the build, with the full list.

const missing = new Set();
/** The text in the page's language; `{name}` placeholders are filled from `vars`. */
function t(lang, en, vars = {}) {
  let s = en;
  if (lang === 'it') {
    if (!(en in IT_TEXT)) missing.add(en);
    else s = IT_TEXT[en];
  }
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Numbers as the language writes them: 0.13 in English, 0,13 in Italian (ISO uses the comma). */
const num = (lang, v) => (lang === 'it' ? String(v).replace('.', ',') : String(v));

/** Replace the text of every data-i18n element, and data-i18n-content / -alt attributes. */
function translate(html, dict) {
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, _tag, key, _inner, close) => {
    if (!(key in dict)) {
      missing.add(`[key] ${key}`);
      return m;
    }
    return open + dict[key] + close;
  });
  return html.replace(/data-i18n-(content|alt)="([^"]+)"(\s+[^>]*?)?\s(content|alt)="[^"]*"/g, (m, _a, key, mid = '', attr) => {
    if (!(key in dict)) {
      missing.add(`[key] ${key}`);
      return m;
    }
    return `data-i18n-${attr}="${key}"${mid} ${attr}="${esc(dict[key])}"`;
  });
}

// ---------------------------------------------------------------------------------------------
// Project status, read from docs/roadmap.md: a milestone is done when every box under it is ticked.

// Headings are "## M4 3D parts"; a milestone may be split ("## M7-AI Assistant", "## M7-Checks"):
// its parts count together.
const milestones = {};
const sections = [];
{
  let cur = null;
  for (const line of read('docs/roadmap.md').split('\n')) {
    const h = /^## (M\d+)\b[- ]*(.*)$/.exec(line);
    if (h) {
      cur = { id: h[1], title: h[2].trim(), boxes: 0, ticked: 0 };
      sections.push(cur);
      continue;
    }
    if (/^## /.test(line)) cur = null;
    const box = /^- \[( |x)\]/.exec(line);
    if (cur && box) {
      cur.boxes++;
      if (box[1] === 'x') cur.ticked++;
    }
  }
  for (const sec of sections) {
    const m = (milestones[sec.id] ??= { id: sec.id, boxes: 0, ticked: 0 });
    m.boxes += sec.boxes;
    m.ticked += sec.ticked;
  }
}
const done = (id) => {
  const m = milestones[id];
  if (!m) throw new Error(`docs/roadmap.md has no milestone ${id}`);
  return m.boxes > 0 && m.ticked === m.boxes;
};
const milestoneIds = Object.keys(milestones).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const doneIds = milestoneIds.filter(done);
const lastMilestone = milestoneIds[milestoneIds.length - 1];
/** The first release is out when the roadmap's release section is done. */
const releaseSection = sections.find((sec) => /^release\b/i.test(sec.title));
const releaseMilestone = releaseSection ? releaseSection.id : lastMilestone;
const releaseOut = releaseSection ? releaseSection.boxes > 0 && releaseSection.ticked === releaseSection.boxes : done(lastMilestone);

// ---------------------------------------------------------------------------------------------
// Assets: content hashes for cache busting, image sizes from the PNG header.

const hash = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 10);
const css = read('scripts/site/style.css');
const CSS_URL = `/style.css?v=${hash(css)}`;

/** The screenshots the pages use; each falls back to an SVG placeholder when the PNG is missing. */
const SHOTS = ['hero-dark', 'hero-light', 'sheet-dark', 'sheet-light', 'sketch-dark', 'sketch-light', 'part-dark', 'part-light'];
const images = {};
function placeholderSvg(name) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" width="1440" height="900">` +
    `<rect width="1440" height="900" fill="#15191e"/><rect width="1440" height="44" fill="#11151a"/>` +
    `<rect x="1120" y="44" width="320" height="800" fill="#1b2027"/><rect y="44" width="56" height="800" fill="#11151a"/>` +
    `<text x="588" y="460" fill="#a3afbb" font-family="sans-serif" font-size="28" text-anchor="middle">Screenshot not taken yet: ${esc(name)}</text></svg>\n`
  );
}

// ---------------------------------------------------------------------------------------------
// Output registry: every page and file goes through here, so the sitemap and the link check see
// everything, and nothing stale survives a rebuild.

const files = new Map(); // site-relative path -> content
const pages = []; // { path, lang, alt, index }
function emit(rel, content) {
  if (files.has(rel)) throw new Error(`site/${rel} written twice`);
  files.set(rel, content);
}

const HOME = { en: '/', it: '/it/' };
const NAV = [
  { key: 'docs', en: '/docs/', it: '/it/documentazione/', label: 'Docs' },
  { key: 'standards', en: '/standards/', it: '/it/norme/', label: 'Standards' },
  { key: 'guides', en: '/guides/', it: '/it/guide/', label: 'Guides' },
  { key: 'companies', en: '/companies/', it: '/it/aziende/', label: 'For companies' },
  { key: 'changelog', en: '/changelog/', it: '/it/novita/', label: 'Changelog' },
];
const HERO_ALT = 'The MechPilot window with the mounting bracket sample: a dimensioned plate with holes, tolerances and geometrical tolerance frames.';

/**
 * A full page. `alt` is the same page in the other language (null when there is none: then no
 * hreflang is claimed and the language link goes to the other home page). `noindex` keeps thin
 * pages out of search engines and the sitemap.
 */
function page({ lang, path, alt = null, title, description, body, section = '', noindex = false, crumbs = [] }) {
  const other = lang === 'en' ? 'it' : 'en';
  const altHref = alt ?? HOME[other];
  const head = [];
  if (noindex) head.push('<meta name="robots" content="noindex" />');
  else head.push(`<link rel="canonical" href="${SITE}${path}" />`);
  if (alt) {
    head.push(`<link rel="alternate" hreflang="${lang}" href="${SITE}${path}" />`);
    head.push(`<link rel="alternate" hreflang="${other}" href="${SITE}${alt}" />`);
    head.push(`<link rel="alternate" hreflang="x-default" href="${SITE}${lang === 'en' ? path : alt}" />`);
  }
  const og = images['hero-dark'];
  const nav = NAV.map((n) => `<a href="${n[lang]}"${n.key === section ? ' aria-current="page"' : ''}>${esc(t(lang, n.label))}</a>`).join('\n        ');
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="${esc(t(lang, 'Breadcrumb'))}"><ol>${[[t(lang, 'Home'), HOME[lang]], ...crumbs]
        .map(([label, href], k, all) => (k === all.length - 1 ? `<li aria-current="page">${esc(label)}</li>` : `<li><a href="${href}">${esc(label)}</a></li>`))
        .join('')}</ol></nav>\n      `
    : '';
  const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    ${head.join('\n    ')}
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0f1216" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="MechPilot" />
    <meta property="og:locale" content="${lang === 'en' ? 'en_GB' : 'it_IT'}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${SITE}${path}" />
    <meta property="og:image" content="${SITE}${og.src.replace(/\?.*$/, '')}" />
    <meta property="og:image:width" content="${og.width}" />
    <meta property="og:image:height" content="${og.height}" />
    <meta property="og:image:alt" content="${esc(t(lang, HERO_ALT))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="${CSS_URL}" />
  </head>
  <body>
    <a class="skip" href="#main">${esc(t(lang, 'Skip to content'))}</a>
    <header class="top">
      <a class="logo" href="${HOME[lang]}"><img src="/logo.svg" alt="" width="28" height="28" /> MechPilot</a>
      <nav aria-label="${esc(t(lang, 'Main'))}">
        ${nav}
        <a href="${REPO}">GitHub</a>
        <a class="lang" href="${altHref}"${alt ? ` hreflang="${other}"` : ''} lang="${other}">${other === 'it' ? 'Italiano' : 'English'}</a>
      </nav>
    </header>
    <main id="main">
      ${crumbHtml}${body.trim()}
    </main>
    <footer>
      <nav aria-label="${esc(t(lang, 'Footer'))}">
        ${NAV.map((n) => `<a href="${n[lang]}">${esc(t(lang, n.label))}</a>`).join(' · ')} · <a href="${REPO}">GitHub</a> · <a href="${REPO}/discussions">${esc(t(lang, 'Discussions'))}</a>
      </nav>
      <p>${esc(t(lang, 'Copyright Mojtaba Amini. Apache-2.0.'))} ${esc(t(lang, 'Version {v}.', { v: pkg.version }))}</p>
      <p class="small">${esc(t(lang, 'This site sets no cookies, runs no scripts and loads nothing from third parties.'))}</p>
    </footer>
  </body>
</html>
`;
  emit(path.replace(/^\//, '') + 'index.html', html);
  pages.push({ path, lang, alt, index: !noindex });
}

function figureImg(name, alt, { lazy = true, cls = '' } = {}) {
  const im = images[name];
  return `<img${cls ? ` class="${cls}"` : ''} src="${im.src}" width="${im.width}" height="${im.height}" alt="${esc(alt)}"${lazy ? ' loading="lazy" decoding="async"' : ''} />`;
}

// ---------------------------------------------------------------------------------------------
// Landing page and "For companies": prose in scripts/site/*.template.html (data-i18n keys,
// Italian in i18n-it.mjs), generated blocks filled in through {{PLACEHOLDERS}}.

const contiguous = doneIds.every((id, k) => id === `M${k}`);
const doneText = doneIds.length === 0 ? '—' : contiguous && doneIds.length > 1 ? `${doneIds[0]}–${doneIds[doneIds.length - 1]}` : doneIds.join(', ');
const statusText = (lang) =>
  t(lang, 'Version {v}, in development: milestones {done} of {all} are done.', { v: pkg.version, done: doneText, all: `M0–${lastMilestone}` }) +
  (releaseOut ? '' : ' ' + t(lang, 'The first release is not out yet.'));

/** "Yes" once the milestone is done, "Planned (M4)" while it is open. */
const planned = (lang, id, yes = 'Yes') => (done(id) ? { text: t(lang, yes), cls: 'yes' } : { text: t(lang, 'Planned ({m})', { m: id }), cls: 'planned' });
const cell = (lang, text, cls = '') => ({ text: t(lang, text), cls });

function pillarTag(lang, ids) {
  const open = ids.filter((id) => !done(id));
  if (open.length === 0) return `<span class="tag ok">${esc(t(lang, 'Available'))}</span>`;
  return `<span class="tag planned">${esc(t(lang, 'In development ({m})', { m: open.join(', ') }))}</span>`;
}

function gallery(lang) {
  const shots = [
    ['hero', 'The drawing', 'The mounting bracket sample in model space: a 120 × 80 mm plate with holes, dimensions with tolerances, an H7 fit, a surface texture symbol, geometrical tolerance frames and datums.'],
    ['sheet', 'The sheet', 'The same drawing on an A3 sheet to ISO 5457, with frame, grid zones and an ISO 7200 title block, ready for vector PDF export.'],
    ['sketch', 'The constrained sketch', 'The sketch solved by its constraints: fully constrained entities in green, the constraint list in the Checks tab, the degrees of freedom left in the status bar.'],
    ['part', 'The 3D part', 'The stepped shaft sample in the 3D tab: its half profile revolved and chamfered by the feature tree in the Features tab, with volume, size and centre of mass measured on the body.'],
  ];
  const figs = shots
    .map(([n, cap, alt]) => {
      const a = t(lang, alt);
      return `<figure>${figureImg(`${n}-dark`, a, { cls: 't-dark' })}${figureImg(`${n}-light`, `${a} ${t(lang, '(Light theme.)')}`, { cls: 't-light' })}<figcaption>${esc(t(lang, cap))}</figcaption></figure>`;
    })
    .join('\n          ');
  return `<input type="radio" name="shot-theme" id="shot-dark" class="vh" checked />
        <input type="radio" name="shot-theme" id="shot-light" class="vh" />
        <p class="switch"><span>${esc(t(lang, 'Theme:'))}</span> <label for="shot-dark">${esc(t(lang, 'Dark'))}</label><label for="shot-light">${esc(t(lang, 'Light'))}</label></p>
        <div class="shots">
          ${figs}
        </div>`;
}

const tdOf = (v) => (typeof v === 'string' ? `<td>${v}</td>` : `<td class="${v.cls}">${esc(v.text)}</td>`);

function formatsTable(lang) {
  const P = '/docs/';
  const rows = [
    ['MechPilot drawing (.mechpilot.json)', cell(lang, 'Yes', 'yes'), cell(lang, 'Yes', 'yes'), `<a href="${P}file-format/" hreflang="en">${esc(t(lang, 'Open, documented JSON'))}</a>`],
    ['DXF (R12 and 2000)', planned(lang, 'M1'), planned(lang, 'M1'), `<a href="${P}dxf/" hreflang="en">${esc(t(lang, 'For drawings; round-trip tested'))}</a>`],
    ['PDF (vector, true scale)', cell(lang, 'No', 'no'), planned(lang, 'M2'), `<a href="${P}pdf/" hreflang="en">${esc(t(lang, 'For the shop floor; one page per sheet'))}</a>`],
    ['STEP', planned(lang, 'M4'), planned(lang, 'M4'), esc(t(lang, 'For 3D parts'))],
    ['STL and 3MF', cell(lang, 'No', 'no'), planned(lang, 'M4'), esc(t(lang, 'For 3D printing'))],
    ['DWG', cell(lang, 'No', 'no'), cell(lang, 'No', 'no'), esc(t(lang, 'The only free DWG library is GPL; DXF covers the exchange.'))],
  ];
  return `<div class="table-wrap"><table class="matrix">
          <thead><tr><th scope="col">${esc(t(lang, 'Format'))}</th><th scope="col">${esc(t(lang, 'Open'))}</th><th scope="col">${esc(t(lang, 'Save or export'))}</th><th scope="col">${esc(t(lang, 'Notes'))}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><th scope="row">${esc(t(lang, r[0]))}</th>${tdOf(r[1])}${tdOf(r[2])}${tdOf(r[3])}</tr>`).join('\n          ')}</tbody>
        </table></div>`;
}

function downloads(lang) {
  const os = [
    ['macOS', 'Apple silicon (arm64)'],
    ['macOS', 'Intel (x64)'],
    ['Windows', 'x64 installer'],
    ['Linux', 'x64 AppImage'],
  ];
  const note = releaseOut
    ? ''
    : `<p class="notice"><strong>${esc(t(lang, 'The first release is not out yet.'))}</strong> ${esc(
        t(lang, 'Installers for macOS, Windows and Linux come with milestone {m}; until then these buttons open an empty releases page. You can build MechPilot from source today:', { m: releaseMilestone }),
      )} <a href="${REPO}#contribute-in-30-minutes">${esc(t(lang, 'how to build it'))}</a>.</p>`;
  return `${note}
        <div class="downloads">
          ${os.map(([name, sub]) => `<a class="btn dl" href="${RELEASES}"><strong>${name}</strong><span>${esc(t(lang, sub))}</span></a>`).join('\n          ')}
        </div>
        <p class="small">${esc(t(lang, 'Builds are unsigned for now: macOS and Windows will ask you to confirm the first start.'))}</p>`;
}

function compareTable(lang) {
  const tools = ['MechPilot', 'AutoCAD LT', 'DraftSight', 'FreeCAD', 'LibreCAD', 'SolidWorks'];
  const Y = (x = 'Yes') => cell(lang, x, 'yes');
  const N = (x = 'No') => cell(lang, x, 'no');
  const U = () => ({ text: '—', cls: 'unknown' });
  const P = (x) => cell(lang, x, 'plain');
  const rows = [
    ['Licence and price', [Y('Apache-2.0, free'), P('Proprietary, subscription'), P('Proprietary, paid'), Y('LGPL-2.0-or-later, free'), Y('GPL-2.0, free'), P('Proprietary, paid')]],
    ['Platforms', [P('macOS, Windows, Linux'), P('Windows, macOS'), P('Windows'), P('Windows, macOS, Linux'), P('Windows, macOS, Linux'), P('Windows')]],
    ['Open, documented native file format', [Y('Yes (JSON)'), N('No (DWG)'), N('No (DWG)'), Y('Yes (FCStd)'), Y('Yes (DXF)'), N()]],
    ['DXF in and out', [planned(lang, 'M1'), Y(), Y(), Y(), Y(), Y()]],
    ['Parametric sketches (constraints)', [planned(lang, 'M3'), U(), U(), Y(), N(), Y()]],
    ['3D solid parts', [planned(lang, 'M4'), N(), U(), Y(), N(), Y()]],
    ['STEP in and out', [planned(lang, 'M4'), U(), U(), Y(), N(), Y()]],
    ['ISO dimensioning', [planned(lang, 'M2', 'Yes (ISO 129-1)'), Y('Yes (ISO-25 style)'), U(), Y('Yes (TechDraw)'), U(), Y()]],
    ['Runs offline, no account', [Y(), N('No (Autodesk account)'), U(), Y(), Y(), U()]],
  ];
  return `<div class="table-wrap"><table class="matrix compare">
          <thead><tr><th scope="col"><span class="vh">${esc(t(lang, 'Feature'))}</span></th>${tools.map((x, k) => `<th scope="col"${k === 0 ? ' class="us"' : ''}>${x}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(([label, cells]) => `<tr><th scope="row">${esc(t(lang, label))}</th>${cells.map(tdOf).join('')}</tr>`).join('\n          ')}</tbody>
        </table></div>
        <p class="small">${esc(
          t(lang, 'Other tools as described by their makers in October 2026; check their sites before you decide. “—” means we have not verified it, so we make no claim. “Planned” means not built yet: the milestone is in the roadmap. Corrections are welcome on GitHub.'),
        )}</p>`;
}

function templatePage(def, lang) {
  let html = read(`scripts/site/${def.template}`);
  const meta = {};
  html = html.replace(/<!--\s*(title|description):\s*([\s\S]*?)-->\n?/g, (_, k, v) => {
    meta[k] = v.trim();
    return '';
  });
  if (lang === 'it') html = translate(html, IT);
  const blocks = {
    STATUS: () => esc(statusText(lang)),
    GALLERY: () => gallery(lang),
    FORMATS: () => formatsTable(lang),
    DOWNLOADS: () => downloads(lang),
    COMPARE: () => compareTable(lang),
    HERO_IMG: () => figureImg('hero-dark', t(lang, HERO_ALT), { lazy: false }),
    TAG_2D: () => pillarTag(lang, ['M1', 'M2']),
    TAG_3D: () => pillarTag(lang, ['M4', 'M5']),
    TAG_CHECKS: () => pillarTag(lang, ['M3', 'M7']),
  };
  const simple = {
    REPO,
    VERSION: pkg.version,
    RELEASES,
    P_DOCS: NAV[0][lang],
    P_STANDARDS: NAV[1][lang],
    P_GUIDES: NAV[2][lang],
    P_COMPANIES: NAV[3][lang],
    P_FITS_GUIDE: lang === 'en' ? '/guides/iso-fits-explained/' : '/it/guide/accoppiamenti-iso-spiegati/',
    P_PROJ_GUIDE: lang === 'en' ? '/guides/first-angle-vs-third-angle-projection/' : '/it/guide/proiezione-primo-diedro-terzo-diedro/',
    P_FITS: lang === 'en' ? '/standards/iso-286-fits/' : '/it/norme/iso-286-accoppiamenti/',
  };
  html = html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
    if (blocks[k]) return blocks[k]();
    if (k in simple) return simple[k];
    throw new Error(`${def.template}: unknown placeholder ${m}`);
  });
  page({ lang, path: def[lang], alt: def[lang === 'en' ? 'it' : 'en'], title: t(lang, meta.title), description: t(lang, meta.description), body: html, section: def.section });
}

// ---------------------------------------------------------------------------------------------
// Docs from docs/*.md (English only: the Italian docs page says so and links to them).

const DOCS = [
  { slug: 'getting-started', file: 'docs/getting-started.md', blurb: 'Build and run MechPilot, the first ten minutes, dimensions, sheets, constraints and the keyboard.' },
  { slug: 'file-format', file: 'docs/file-format.md', blurb: 'The open .mechpilot.json format: every field, the versions and the migrations.' },
  { slug: 'dxf', file: 'docs/dxf.md', blurb: 'What DXF import and export read and write, units, precision and the known limits.' },
  { slug: 'pdf', file: 'docs/pdf.md', blurb: 'Vector PDF at true scale: line widths, fonts and characters.' },
  { slug: 'sketches', file: 'docs/sketches.md', blurb: 'Sketch constraints and driving dimensions: the solver, what takes part, the messages.' },
  { slug: 'standards', file: 'docs/standards.md', blurb: 'Which ISO standards MechPilot uses, what it takes from each, and how the values were checked.' },
];
const docBySource = new Map(DOCS.map((d) => [d.file.replace(/^docs\//, ''), d]));

/** Links inside a Markdown file: docs we render go to their page, other repo files to GitHub. */
const linkFrom = (dir) => (href) => {
  if (/^[a-z]+:/i.test(href)) return { href, external: true };
  if (href.startsWith('#')) return { href, external: false };
  const [file, anchor] = href.split('#');
  const d = dir === 'docs' ? docBySource.get(file) : file.startsWith('docs/') ? docBySource.get(file.slice(5)) : undefined;
  if (d) return { href: `/docs/${d.slug}/${anchor ? `#${anchor}` : ''}`, external: false };
  const path = dir ? `${dir}/${file}` : file;
  return { href: `${REPO}/blob/main/${path}${anchor ? `#${anchor}` : ''}`, external: true };
};

const plain = (md) => md.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const firstParagraph = (src) => {
  const para = src.split(/\n\s*\n/).find((b) => b.trim() && !/^\s*(#|```|\||- |\d+\. )/.test(b));
  return plain((para ?? '').replace(/\s+/g, ' ').trim());
};
const clip = (s, n = 158) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:.]$/, '') + '…');

function docPages() {
  const titles = new Map(DOCS.map((d) => [d.slug, /^# (.*)$/m.exec(read(d.file))[1].trim()]));
  const side = (current) =>
    `<nav class="doc-nav" aria-label="Docs"><ul>${DOCS.map(
      (d) => `<li><a href="/docs/${d.slug}/"${d.slug === current ? ' aria-current="page"' : ''}>${esc(titles.get(d.slug))}</a></li>`,
    ).join('')}</ul></nav>`;
  for (const d of DOCS) {
    const src = read(d.file);
    const title = titles.get(d.slug);
    page({
      lang: 'en',
      path: `/docs/${d.slug}/`,
      title: `${title} · MechPilot docs`,
      description: clip(firstParagraph(src.replace(/^# .*\n/, ''))),
      section: 'docs',
      crumbs: [['Docs', '/docs/'], [title]],
      body: `<div class="doc-layout">
      ${side(d.slug)}
      <article class="prose">
        <h1>${esc(title)}</h1>
        ${markdown(src, { link: linkFrom('docs'), skipTitle: true })}
        <p class="edit"><a href="${REPO}/blob/main/${d.file}">Source of this page on GitHub</a></p>
      </article>
      </div>`,
    });
  }
  for (const lang of ['en', 'it']) {
    const list = DOCS.map((d) => `<li><a href="/docs/${d.slug}/"${lang === 'it' ? ' hreflang="en"' : ''}>${esc(titles.get(d.slug))}</a><span>${esc(t(lang, d.blurb))}</span></li>`).join('\n          ');
    page({
      lang,
      path: NAV[0][lang],
      alt: NAV[0][lang === 'en' ? 'it' : 'en'],
      title: t(lang, 'MechPilot documentation'),
      description: t(lang, 'How to use MechPilot and how it works: getting started, the open file format, DXF, PDF, sketch constraints and the standards behind the drawings.'),
      section: 'docs',
      crumbs: [[t(lang, 'Docs')]],
      body: `<div class="narrow">
        <h1>${esc(t(lang, 'Documentation'))}</h1>
        ${lang === 'it' ? `<p class="notice">${esc(t(lang, 'The documentation is in English for now; the pages below open the English version.'))}</p>` : ''}
        <ul class="cards">
          ${list}
        </ul>
        <p>${esc(t(lang, 'Design decisions, the roadmap and the progress log are in the repository:'))} <a href="${REPO}/tree/main/docs">docs/</a></p>
      </div>`,
    });
  }
}

function changelogPages() {
  const src = read('CHANGELOG.md');
  page({
    lang: 'en',
    path: '/changelog/',
    title: 'Changelog · MechPilot',
    description: `What changed in each MechPilot version, milestone by milestone. Current version: ${pkg.version}.`,
    section: 'changelog',
    crumbs: [['Changelog']],
    body: `<article class="prose narrow">
        <h1>Changelog</h1>
        ${markdown(src, { link: linkFrom(''), skipTitle: true })}
      </article>`,
  });
  // The Italian page is a pointer, not a translation: no hreflang pair, not indexed.
  page({
    lang: 'it',
    path: '/it/novita/',
    title: t('it', 'What is new · MechPilot'),
    description: t('it', 'The MechPilot changelog is in English.'),
    section: 'changelog',
    noindex: true,
    crumbs: [[t('it', 'Changelog')]],
    body: `<div class="narrow">
        <h1>${esc(t('it', 'Changelog'))}</h1>
        <p>${esc(t('it', 'The list of changes is kept in English. Current version: {v}.', { v: pkg.version }))} <a href="/changelog/" hreflang="en" lang="en">Changelog</a></p>
      </div>`,
  });
}

// ---------------------------------------------------------------------------------------------
// Guides: Markdown in scripts/site/guides/<id>.<lang>.md; the Italian file is required. Numbers
// in {{PLACEHOLDERS}} come from the library, never typed by hand. [[FIG:name]] inserts a figure.

const lib = (rel) => JSON.parse(read(`library/${rel}`));
const GUIDES = [
  { id: 'iso-fits', en: '/guides/iso-fits-explained/', it: '/it/guide/accoppiamenti-iso-spiegati/' },
  { id: 'projection', en: '/guides/first-angle-vs-third-angle-projection/', it: '/it/guide/proiezione-primo-diedro-terzo-diedro/' },
];

/** Figures for the projection guide: simplified drawings, not to the standard's proportions. */
const figures = {
  'projection-layout': (lang) => {
    const box = (x, y, label) => `<rect x="${x}" y="${y}" width="120" height="70" rx="4" class="fig-box"/><text x="${x + 60}" y="${y + 40}" class="fig-text">${esc(label)}</text>`;
    const layout = (title, first) => {
      const fy = first ? 50 : 140;
      return `<svg viewBox="0 0 420 240" role="img" aria-label="${esc(title)}" class="fig">
          <text x="210" y="24" class="fig-title">${esc(title)}</text>
          ${box(150, fy, t(lang, 'Front'))}
          ${box(150, first ? 150 : 40, t(lang, 'From above'))}
          ${box(first ? 285 : 15, fy, t(lang, 'From the left'))}
        </svg>`;
    };
    return `<figure class="figs">
        ${layout(t(lang, 'First angle'), true)}
        ${layout(t(lang, 'Third angle'), false)}
        <figcaption>${esc(t(lang, 'Where the view from above and the view from the left go around the front view. Simplified drawing.'))}</figcaption>
      </figure>`;
  },
  'projection-symbols': (lang) => {
    // The same truncated cone in both: side view (small end on the left) and end view (two circles).
    const cone = (x) => `<path d="M${x} 75 L${x + 70} 55 L${x + 70} 125 L${x} 105 Z" class="fig-line"/><path d="M${x - 8} 90 H${x + 78}" class="fig-centre"/>`;
    const ends = (x) => `<circle cx="${x}" cy="90" r="35" class="fig-line"/><circle cx="${x}" cy="90" r="15" class="fig-line"/><path d="M${x - 43} 90 H${x + 43} M${x} 47 V133" class="fig-centre"/>`;
    const sym = (title, first) => `<svg viewBox="0 0 230 160" role="img" aria-label="${esc(title)}" class="fig">
          <text x="115" y="24" class="fig-title">${esc(title)}</text>
          ${first ? cone(30) + ends(170) : ends(60) + cone(130)}
        </svg>`;
    return `<figure class="figs">
        ${sym(t(lang, 'First angle symbol'), true)}
        ${sym(t(lang, 'Third angle symbol'), false)}
        <figcaption>${esc(t(lang, 'The projection symbols: the same truncated cone, with its end view on the right (first angle) or on the left (third angle). Simplified drawing, not to the proportions of ISO 5456-2.'))}</figcaption>
      </figure>`;
  },
};

function guidePages(vars) {
  const meta = {};
  for (const g of GUIDES) {
    for (const lang of ['en', 'it']) {
      const file = `scripts/site/guides/${g.id}.${lang}.md`;
      if (!existsSync(join(root, file))) throw new Error(`Missing guide ${file} (every guide needs its Italian version)`);
      let src = read(file);
      const head = {};
      src = src.replace(/^<!--\s*([\s\S]*?)-->\n/, (_, block) => {
        for (const line of block.split('\n')) {
          const m = /^\s*(\w+):\s*(.*)$/.exec(line);
          if (m) head[m[1]] = m[2].trim();
        }
        return '';
      });
      if (!head.description) throw new Error(`${file}: no description in the header comment`);
      src = src.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
        const v = vars[lang][k];
        if (v === undefined) throw new Error(`${file}: unknown placeholder ${m}`);
        return v;
      });
      const title = /^# (.*)$/m.exec(src)[1].trim();
      let body = markdown(src, {});
      body = body.replace(/<p>\[\[FIG:([a-z-]+)\]\]<\/p>/g, (m, name) => {
        if (!figures[name]) throw new Error(`${file}: unknown figure ${name}`);
        return figures[name](lang);
      });
      meta[`${g.id}.${lang}`] = { title, blurb: head.description };
      page({
        lang,
        path: g[lang],
        alt: g[lang === 'en' ? 'it' : 'en'],
        title: `${title} · MechPilot`,
        description: head.description,
        section: 'guides',
        crumbs: [[t(lang, 'Guides'), NAV[2][lang]], [title]],
        body: `<article class="prose narrow">
        ${body}
      </article>`,
      });
    }
  }
  for (const lang of ['en', 'it']) {
    page({
      lang,
      path: NAV[2][lang],
      alt: NAV[2][lang === 'en' ? 'it' : 'en'],
      title: t(lang, 'Guides to technical drawing · MechPilot'),
      description: t(lang, 'Short, factual guides to the standards behind mechanical drawings: ISO fits and the first and third angle projection methods.'),
      section: 'guides',
      crumbs: [[t(lang, 'Guides')]],
      body: `<div class="narrow">
        <h1>${esc(t(lang, 'Guides'))}</h1>
        <ul class="cards">
          ${GUIDES.map((g) => `<li><a href="${g[lang]}">${esc(meta[`${g.id}.${lang}`].title)}</a><span>${esc(meta[`${g.id}.${lang}`].blurb)}</span></li>`).join('\n          ')}
        </ul>
        <p>${esc(t(lang, 'The tables behind them, with their sources:'))} <a href="${NAV[1][lang]}">${esc(t(lang, 'Standards'))}</a></p>
      </div>`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The build.

// Start clean: everything in site/ is generated, except the screenshots in site/img/*.png.
mkdirSync(siteDir, { recursive: true });
for (const f of readdirSync(siteDir)) if (f !== 'img') rmSync(join(siteDir, f), { recursive: true, force: true });
mkdirSync(join(siteDir, 'img'), { recursive: true });
for (const f of readdirSync(join(siteDir, 'img'))) {
  if (!SHOTS.some((s) => f === `${s}.png`)) rmSync(join(siteDir, 'img', f), { recursive: true, force: true });
}
for (const name of SHOTS) {
  const png = join(siteDir, 'img', `${name}.png`);
  if (existsSync(png)) {
    const buf = readFileSync(png);
    if (buf.toString('latin1', 1, 4) !== 'PNG') throw new Error(`site/img/${name}.png is not a PNG`);
    if (statSync(png).size > 400 * 1024) console.warn(`warning: site/img/${name}.png is over 400 KB`);
    images[name] = { src: `/img/${name}.png?v=${hash(buf)}`, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } else {
    const svg = placeholderSvg(name);
    emit(`img/${name}.svg`, svg);
    images[name] = { src: `/img/${name}.svg?v=${hash(svg)}`, width: 1440, height: 900, placeholder: true };
  }
}

const TEMPLATES = [
  { template: 'index.template.html', en: '/', it: '/it/', section: '' },
  { template: 'companies.template.html', en: '/companies/', it: '/it/aziende/', section: 'companies' },
];
for (const def of TEMPLATES) for (const lang of ['en', 'it']) templatePage(def, lang);
docPages();
changelogPages();
const { guideVars } = standardPages({ lib, t, num, esc, inline, REPO, page, NAV, GUIDES });
guidePages(guideVars);

// 404: both languages on one page (Cloudflare Pages serves /404.html for every missing path).
emit(
  '404.html',
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page not found · MechPilot</title>
    <meta name="robots" content="noindex" />
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${CSS_URL}" />
  </head>
  <body>
    <header class="top"><a class="logo" href="/"><img src="/logo.svg" alt="" width="28" height="28" /> MechPilot</a></header>
    <main id="main">
      <div class="narrow">
        <h1>Page not found</h1>
        <p>This page does not exist (any more). Try the <a href="/">home page</a>, the <a href="/docs/">docs</a> or the <a href="/standards/">standards tables</a>.</p>
        <h2 lang="it">Pagina non trovata</h2>
        <p lang="it">Questa pagina non esiste (più). Prova la <a href="/it/">pagina iniziale</a>, la <a href="/it/documentazione/">documentazione</a> o le <a href="/it/norme/">tabelle delle norme</a>.</p>
      </div>
    </main>
  </body>
</html>
`,
);

if (missing.size) {
  throw new Error(`Missing Italian site texts (add them to scripts/site/i18n-it.mjs):\n${[...missing].map((m) => `  ${JSON.stringify(m)}`).join('\n')}`);
}

emit('style.css', css);
emit('logo.svg', read('scripts/site/logo.svg'));
emit('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
const indexed = pages.filter((p) => p.index).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
emit(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    indexed
      .map((p) => {
        const alts = p.alt
          ? [
              [p.lang, p.path],
              [p.lang === 'en' ? 'it' : 'en', p.alt],
            ]
              .sort((a, b) => (a[0] < b[0] ? -1 : 1))
              .map(([l, href]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${href}"/>`)
              .join('')
          : '';
        return `  <url><loc>${SITE}${p.path}</loc>${alts}</url>`;
      })
      .join('\n') +
    '\n</urlset>\n',
);
// Cloudflare Pages headers: strict security, no third parties, long cache for hashed assets (every
// reference to style.css and img/* carries ?v=<content hash>).
emit(
  '_headers',
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    "  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
    '/style.css',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/img/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
);
// Short links to share (302: they may point elsewhere later).
emit('_redirects', `/download ${RELEASES} 302\n/discussions ${REPO}/discussions 302\n`);

for (const [rel, content] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const p = join(siteDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

const problems = checkSite(siteDir, SITE);
if (problems.length) {
  console.error(problems.join('\n'));
  throw new Error(`site/ has ${problems.length} problem(s), see above`);
}
const placeholders = Object.entries(images).filter(([, v]) => v.placeholder);
console.log(
  `site/ built: ${pages.length} pages (${indexed.length} in the sitemap), links checked` +
    (placeholders.length ? `; SVG placeholders for ${placeholders.map(([k]) => k).join(', ')}` : ''),
);
