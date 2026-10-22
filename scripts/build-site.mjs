#!/usr/bin/env node
// Builds the static website in site/ (English at /, Italian at /it/): landing page, "For
// companies", the demo walkthrough from docs/demo.md, the docs rendered from docs/*.md, the
// changelog, one page per standards table in
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

// The AI gate. The site speaks of the assistant as shipped only when every box of the roadmap
// section "## M7-AI Assistant …" is ticked. Until then every AI sentence is worded as coming and
// carries a "Coming in the next release" tag, and the demo page says the recordings are being made.
// Both wordings are translated on every build (template branches and t() calls alike), so ticking
// the roadmap never breaks the Italian check.
const aiSection = sections.find((sec) => sec.id === 'M7' && /^AI\b/i.test(sec.title));
if (!aiSection || aiSection.boxes === 0) {
  throw new Error('docs/roadmap.md has no "## M7-AI Assistant" section with boxes: the website reads it to decide whether the AI assistant has shipped');
}
const aiReady = aiSection.ticked === aiSection.boxes;
/** One of two texts by the AI gate; both are passed in already translated. */
const gate = (shipped, coming) => (aiReady ? shipped : coming);

// ---------------------------------------------------------------------------------------------
// Assets: content hashes for cache busting, image sizes from the PNG header.

const hash = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 10);
const css = read('scripts/site/style.css');
const CSS_URL = `/style.css?v=${hash(css)}`;

// ---------------------------------------------------------------------------------------------
// The demo walkthrough: docs/demo.md in English, scripts/site/demo.it.md in Italian with the same
// structure. "## N. Title" sections: N = 0 is the preparation, 1, 2… are the steps, each with a
// screenshot slot site/img/demo-N.png; other "## " sections (the note about this page) are left
// out. Quoted lines ("> …") are what the user types in the Assistant tab: they become chat bubbles.

function parseDemo(src, file) {
  const parts = src.split(/\n(?=## )/);
  const title = /^# (.*)$/m.exec(parts[0])?.[1].trim();
  if (!title) throw new Error(`${file}: no "# " title`);
  const steps = [];
  for (const part of parts.slice(1)) {
    const h = /^## (\d+)\.\s+(.+)\n/.exec(part);
    if (!h) continue;
    const body = part.slice(h[0].length).trim();
    const prompts = body.split(/\n\s*\n/).filter((b) => b.split('\n').every((l) => /^\s*>/.test(l))).length;
    steps.push({ n: Number(h[1]), title: h[2].trim(), body, prompts });
  }
  const first = steps[0]?.n;
  if (!steps.some((s) => s.n > 0) || first > 1 || steps.some((s, k) => s.n !== first + k)) {
    throw new Error(`${file}: the walkthrough needs sections "## 1. …", "## 2. …" numbered in order (optionally from "## 0. …")`);
  }
  return { title, steps };
}
const demoSource = read('docs/demo.md');
const demoItFile = 'scripts/site/demo.it.md';
const demo = { en: parseDemo(demoSource, 'docs/demo.md') };
{
  let src = read(demoItFile);
  let source = '';
  src = src.replace(/^<!--\s*([\s\S]*?)-->\n/, (_, block) => {
    source = (/^\s*source:\s*(\S+)/m.exec(block) ?? [])[1] ?? '';
    return '';
  });
  demo.it = parseDemo(src, demoItFile);
  const shape = (d) => d.steps.map((s) => `${s.n}:${s.prompts}`).join(' ');
  if (shape(demo.en) !== shape(demo.it)) {
    throw new Error(`${demoItFile} does not match docs/demo.md (steps:prompts ${shape(demo.it)} instead of ${shape(demo.en)}): translate the changed steps`);
  }
  // The Italian file records the hash of the English text it translates; a newer English text is
  // a warning, not an error, so editing docs/demo.md never blocks a build.
  const current = createHash('sha1').update(demoSource).digest('hex').slice(0, 10);
  if (source !== current) console.warn(`warning: docs/demo.md changed since ${demoItFile} was translated (source ${source || 'missing'}, now ${current}): update the Italian text and its "source:" line`);
}
const demoSteps = demo.en.steps.filter((s) => s.n > 0);

/** The screenshots the pages use; each falls back to an SVG placeholder when the PNG is missing. */
const SHOTS = [
  'hero-dark',
  'hero-light',
  'sheet-dark',
  'sheet-light',
  'sketch-dark',
  'sketch-light',
  'part-dark',
  'part-light',
  // The demo page: one per step of docs/demo.md, taken by hand once the assistant ships (1440 × 900).
  ...demoSteps.map((s) => `demo-${s.n}`),
];
const images = {};

/**
 * The demo's screen recording, committed in site/video/ (not built, not copied): VP9 WebM and
 * H.264 MP4. While neither exists the demo page shows "recording in progress" instead.
 */
const VIDEOS = [
  ['demo.webm', 'video/webm'],
  ['demo.mp4', 'video/mp4'],
];
const videos = [];
function placeholderSvg(name) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" width="1440" height="900">` +
    `<defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1f262f" stroke-width="1"/></pattern></defs>` +
    `<rect width="1440" height="900" fill="#12161b"/><rect x="100" y="72" width="1020" height="748" fill="url(#g)"/>` +
    `<rect width="1440" height="44" fill="#0d1115"/><rect y="44" width="1440" height="28" fill="#10141a"/>` +
    `<rect x="1120" y="72" width="320" height="748" fill="#171c22"/><rect y="72" width="100" height="748" fill="#0f1318"/>` +
    `<rect y="820" width="1440" height="80" fill="#0d1115"/>` +
    `<text x="610" y="440" fill="#a7b3bf" font-family="sans-serif" font-size="30" text-anchor="middle">Screenshot not taken yet</text>` +
    `<text x="610" y="488" fill="#808c99" font-family="monospace" font-size="22" text-anchor="middle">site/img/${esc(name)}.png</text></svg>\n`
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
  { key: 'demo', en: '/demo/', it: '/it/demo/', label: 'Demo' },
  { key: 'docs', en: '/docs/', it: '/it/documentazione/', label: 'Docs' },
  { key: 'standards', en: '/standards/', it: '/it/norme/', label: 'Standards' },
  { key: 'guides', en: '/guides/', it: '/it/guide/', label: 'Guides' },
  { key: 'companies', en: '/companies/', it: '/it/aziende/', label: 'For companies' },
  { key: 'changelog', en: '/changelog/', it: '/it/novita/', label: 'Changelog' },
];
/** The path of a NAV section in a language. */
const navPath = (key, lang) => NAV.find((n) => n.key === key)[lang];
const LOGO = '<img src="/logo.svg" alt="" width="28" height="28" />';
const HERO_ALT = 'The MechPilot window with the mounting bracket sample: a dimensioned plate with holes, tolerances and geometrical tolerance frames.';

/**
 * A full page. `alt` is the same page in the other language (null when there is none: then no
 * hreflang is claimed and the language link goes to the other home page). `noindex` keeps thin
 * pages out of search engines and the sitemap. `full` pages (landing, demo, companies) bring their
 * own full-width sections; the others are set on a light reading surface in a centred column.
 */
function page({ lang, path, alt = null, title, description, body, section = '', noindex = false, crumbs = [], full = false }) {
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
  const nav = NAV.map((n) => `<a href="${n[lang]}"${n.key === section ? ' aria-current="page"' : ''}>${esc(t(lang, n.label))}</a>`).join('\n          ');
  const langLink = `<a class="lang" href="${altHref}"${alt ? ` hreflang="${other}"` : ''} lang="${other}">${other === 'it' ? 'Italiano' : 'English'}</a>`;
  const footLinks = (items) => `<ul>${items.map(([label, href]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}</ul>`;
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
      <div class="wrap top-in">
        <a class="logo" href="${HOME[lang]}">${LOGO} MechPilot</a>
        <nav class="main-nav" aria-label="${esc(t(lang, 'Main'))}">
          ${nav}
          <a href="${REPO}">GitHub</a>
          ${langLink}
        </nav>
        <a class="btn primary sm top-dl" href="${HOME[lang]}#download">${esc(t(lang, 'Download'))}</a>
      </div>
    </header>
    <main id="main"${full ? '' : ' class="page light"'}>
      ${full ? body.trim() : `<div class="wrap">
      ${crumbHtml}${body.trim()}
      </div>`}
    </main>
    <footer class="foot">
      <div class="wrap">
        <div class="foot-grid">
          <div class="foot-brand">
            <a class="logo" href="${HOME[lang]}">${LOGO} MechPilot</a>
            <p>${esc(t(lang, 'Mechanical CAD for production drawings, with 3D parts built in. Free and open source. Runs on your computer. Your files stay yours.'))}</p>
          </div>
          <nav class="foot-nav" aria-label="${esc(t(lang, 'Footer'))}">
            <div>
              <p class="foot-h">${esc(t(lang, 'Product'))}</p>
              ${footLinks([
                [t(lang, 'Demo'), navPath('demo', lang)],
                [t(lang, 'Download'), `${HOME[lang]}#download`],
                [t(lang, 'How it compares'), `${HOME[lang]}#compare`],
                [t(lang, 'For companies'), navPath('companies', lang)],
              ])}
            </div>
            <div>
              <p class="foot-h">${esc(t(lang, 'Learn'))}</p>
              ${footLinks([
                [t(lang, 'Docs'), navPath('docs', lang)],
                [t(lang, 'Standards'), navPath('standards', lang)],
                [t(lang, 'Guides'), navPath('guides', lang)],
                [t(lang, 'Changelog'), navPath('changelog', lang)],
              ])}
            </div>
            <div>
              <p class="foot-h">${esc(t(lang, 'Project'))}</p>
              ${footLinks([
                ['GitHub', REPO],
                [t(lang, 'Discussions'), `${REPO}/discussions`],
                [t(lang, 'Releases'), RELEASES.replace(/\/latest$/, '')],
              ])}
            </div>
          </nav>
        </div>
        <div class="foot-base">
          <p>${esc(t(lang, 'Copyright Mojtaba Amini. Apache-2.0.'))} ${esc(t(lang, 'Version {v}.', { v: pkg.version }))}</p>
          <p>${esc(t(lang, 'This site sets no cookies, runs no scripts and loads nothing from third parties.'))}</p>
        </div>
      </div>
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

/** The tag on every AI sentence while the assistant has not shipped (see the AI gate above). */
function aiTag(lang) {
  const tag = `<span class="tag soon">${esc(t(lang, 'Coming in the next release'))}</span>`;
  return aiReady ? '' : tag;
}

/** A screenshot in both themes; the theme switch (radio buttons, no script) shows one of them. */
function shotPair(name, lang, alt) {
  const a = t(lang, alt);
  return `<figure class="shot">${figureImg(`${name}-dark`, a, { cls: 't-dark' })}${figureImg(`${name}-light`, `${a} ${t(lang, '(Light theme.)')}`, { cls: 't-light' })}</figure>`;
}
const themeSwitch = (lang) =>
  `<p class="switch"><span>${esc(t(lang, 'Theme:'))}</span> <label for="shot-dark">${esc(t(lang, 'Dark'))}</label><label for="shot-light">${esc(t(lang, 'Light'))}</label></p>`;

/** The first prompt of the demo (step 1), as the user types it. */
const firstPrompt = (lang) => {
  const step = demo[lang].steps.find((s) => s.n === 1);
  const block = step.body.split(/\n\s*\n/).find((b) => b.split('\n').every((l) => /^\s*>/.test(l)));
  return block.split('\n').map((l) => l.replace(/^\s*>\s?/, '')).join(' ').trim();
};

/**
 * The "AI inside" illustration: a chat bubble with the demo's first prompt and the proposal card
 * the assistant answers with (rule 7: a preview, Accept / Reject, a source on every claim). Drawn
 * for the page and captioned as such; the clearance hole comes from the library, not from here.
 */
function aiMock(lang) {
  const m8 = lib('holes/iso-273.json').holes.find((h) => h.thread === 'M8');
  if (!m8) throw new Error('library/holes/iso-273.json has no M8 row (the AI illustration shows it)');
  const claims = [
    [t(lang, 'Ø{d} clearance holes for M8, medium series', { d: num(lang, m8.medium) }), t(lang, 'library: {p}', { p: 'holes/iso-273' }), 'lib'],
    [t(lang, 'Ø40 H7 bore tolerance'), 'ISO 286-1', 'std'],
    [t(lang, 'Hole centres 15 mm from every edge'), t(lang, 'measured'), 'measured'],
    [t(lang, 'Break sharp edges 0.5 × 45°'), t(lang, 'suggestion'), 'sug'],
  ];
  // The plate at 1.5 px/mm: 160 × 100 with R12 corners, holes on 130 × 70, Ø40 in the centre.
  const holes = [
    [42.5, 42.5],
    [237.5, 42.5],
    [42.5, 147.5],
    [237.5, 147.5],
  ];
  const ghost = `<svg class="ghost" viewBox="0 0 280 190" aria-hidden="true" focusable="false">
            <path class="c" d="M8 95H272M140 6V184"/>
            <rect class="g" x="20" y="20" width="240" height="150" rx="18"/>
            ${holes.map(([x, y]) => `<circle class="g" cx="${x}" cy="${y}" r="${num('en', (m8.medium / 2) * 1.5)}"/><path class="c" d="M${x - 11} ${y}H${x + 11}M${x} ${y - 11}V${y + 11}"/>`).join('')}
            <circle class="g" cx="140" cy="95" r="30"/>
          </svg>`;
  return `<figure class="mock">
          <div class="mock-win">
            <p class="mock-bar"><span>${esc(t(lang, 'Features'))}</span><span>${esc(t(lang, 'Checks'))}</span><span class="on">${esc(t(lang, 'Assistant'))}</span></p>
            <div class="mock-body">
              <p class="bubble"><span class="who">${esc(t(lang, 'You type'))}</span>${inline(firstPrompt(lang))}</p>
              <div class="proposal">
                <p class="prop-head"><span class="kind">${esc(t(lang, 'Proposal'))}</span><span>${esc(t(lang, 'Outline, 4 holes, bore: preview on the drawing'))}</span></p>
                ${ghost}
                <ul class="claims">
                  ${claims.map(([what, src, cls]) => `<li><span>${esc(what)}</span><span class="src ${cls}">${esc(src)}</span></li>`).join('\n                  ')}
                </ul>
                <p class="actions"><span class="fake-btn primary">${esc(t(lang, 'Accept'))}</span><span class="fake-btn">${esc(t(lang, 'Reject'))}</span><span class="undo">${esc(t(lang, 'One undo step'))}</span></p>
              </div>
            </div>
          </div>
          <figcaption>${esc(t(lang, 'An illustration drawn for this page, not a screenshot: the first prompt of the demo and the kind of proposal the assistant answers with.'))}</figcaption>
        </figure>`;
}

/** Sketch constraint glyphs, drawn for the page (24 × 24, stroke only). */
const GLYPHS = [
  ['Coincident', '<path d="M4 20L12 12L20 16"/><circle cx="12" cy="12" r="2.4" class="g-pt"/>'],
  ['Horizontal', '<path d="M3 15H21"/><path d="M8 9H16" class="g-acc"/>'],
  ['Vertical', '<path d="M9 3V21"/><path d="M15 8V16" class="g-acc"/>'],
  ['Parallel', '<path d="M5 19L13 5M11 19L19 5"/>'],
  ['Perpendicular', '<path d="M4 20H20M12 20V5"/><path d="M12 15H17V20" class="g-acc"/>'],
  ['Tangent', '<circle cx="11" cy="12" r="6"/><path d="M3 18H21" class="g-acc"/>'],
  ['Equal', '<path d="M5 9H19M5 15H19"/>'],
  ['Symmetric', '<path d="M12 3V21" class="g-axis"/><circle cx="6" cy="12" r="2.2" class="g-pt"/><circle cx="18" cy="12" r="2.2" class="g-pt"/>'],
  ['Fixed', '<path d="M12 4V14M5 14H19"/><path d="M8 14L5 19M12 14L9 19M16 14L13 19M19.5 15.5L17.5 19" class="g-acc"/>'],
  ['Distance', '<path d="M4 7V17M20 7V17M4 12H20"/><path d="M7 10L4 12L7 14M17 10L20 12L17 14" class="g-acc"/>'],
];
const glyphs = (lang) =>
  `<ul class="glyphs" aria-label="${esc(t(lang, 'Some of the sketch constraints'))}">
          ${GLYPHS.map(([label, d]) => `<li><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg><span>${esc(t(lang, label))}</span></li>`).join('\n          ')}
        </ul>`;

/** The stepped shaft's feature tree, as the sample has it (see the part screenshot). */
const featureTree = (lang) => {
  const icon = {
    sketch: '<path d="M4 18L9 8L15 14L20 6"/><circle cx="9" cy="8" r="1.6"/><circle cx="15" cy="14" r="1.6"/>',
    revolve: '<ellipse cx="12" cy="12" rx="8" ry="3.5"/><path d="M12 3V21"/>',
    chamfer: '<path d="M4 20V10L10 4H20"/>',
  };
  const rows = [
    ['sketch', 'Sketch', 'Half profile'],
    ['revolve', 'Revolve', 'Revolve'],
    ['chamfer', 'Chamfer', 'Chamfer left end'],
    ['chamfer', 'Chamfer', 'Chamfer right end'],
  ];
  return `<div class="tree">
          <p class="tree-h">${esc(t(lang, 'Features'))} · ${esc(t(lang, 'Stepped shaft'))}</p>
          <ol aria-label="${esc(t(lang, 'Feature tree of the stepped shaft sample'))}">
            ${rows.map(([k, kind, name]) => `<li><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon[k]}</svg><span class="k">${esc(t(lang, kind))}</span> ${esc(t(lang, name))}</li>`).join('\n            ')}
          </ol>
        </div>`;
};

/** Links to the standards pages the 2D drawings follow. */
const STD_CHIPS = [
  ['ISO 128-2', 'iso-128-2-line-types', 'iso-128-2-tipi-di-linea'],
  ['ISO 129-1', 'iso-129-1-dimensioning', 'iso-129-1-quotatura'],
  ['ISO 286', 'iso-286-fits', 'iso-286-accoppiamenti'],
  ['ISO 1101', 'iso-1101-gdt-symbols', 'iso-1101-simboli-tolleranze-geometriche'],
  ['ISO 21920-1', 'iso-21920-1-surface-texture', 'iso-21920-1-stato-della-superficie'],
  ['ISO 5457', 'iso-5457-sheet-sizes', 'iso-5457-formati-dei-fogli'],
  ['ISO 7200', 'iso-7200-title-block', 'iso-7200-cartiglio'],
];
const stdChips = (lang) =>
  `<p class="chips">${STD_CHIPS.map(([label, en, it]) => `<a href="${navPath('standards', lang)}${lang === 'en' ? en : it}/">${label}</a>`).join('')}</p>`;

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
          ${os.map(([name, sub]) => `<a class="dl" href="${RELEASES}"><strong>${name}</strong><span>${esc(t(lang, sub))}</span></a>`).join('\n          ')}
        </div>
        <p class="small">${esc(t(lang, 'Builds are unsigned for now: macOS and Windows will ask you to confirm the first start.'))}</p>`;
}

function compareTable(lang) {
  const tools = ['MechPilot', 'AutoCAD LT', 'DraftSight', 'FreeCAD', 'LibreCAD', 'SolidWorks'];
  const Y = (x = 'Yes') => cell(lang, x, 'yes');
  const N = (x = 'No') => cell(lang, x, 'no');
  const U = () => ({ text: '—', cls: 'unknown' });
  const P = (x) => cell(lang, x, 'plain');
  const aiCell = gate(Y(), { text: t(lang, 'Planned ({m})', { m: aiSection.id }), cls: 'planned' });
  const rows = [
    ['Licence and price', [Y('Apache-2.0, free'), P('Proprietary, subscription'), P('Proprietary, paid'), Y('LGPL-2.0-or-later, free'), Y('GPL-2.0, free'), P('Proprietary, paid')]],
    ['Platforms', [P('macOS, Windows, Linux'), P('Windows, macOS'), P('Windows'), P('Windows, macOS, Linux'), P('Windows, macOS, Linux'), P('Windows')]],
    ['Open, documented native file format', [Y('Yes (JSON)'), N('No (DWG)'), N('No (DWG)'), Y('Yes (FCStd)'), Y('Yes (DXF)'), N()]],
    ['DXF in and out', [planned(lang, 'M1'), Y(), Y(), Y(), Y(), Y()]],
    ['Parametric sketches (constraints)', [planned(lang, 'M3'), U(), U(), Y(), N(), Y()]],
    ['3D solid parts', [planned(lang, 'M4'), N(), U(), Y(), N(), Y()]],
    ['STEP in and out', [planned(lang, 'M4'), U(), U(), Y(), N(), Y()]],
    ['ISO dimensioning', [planned(lang, 'M2', 'Yes (ISO 129-1)'), Y('Yes (ISO-25 style)'), U(), Y('Yes (TechDraw)'), U(), Y()]],
    ['AI assistant with your own API key, previews you accept or reject', [aiCell, U(), U(), U(), U(), U()]],
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

/**
 * Template conditions: <!-- if ai --> … <!-- else --> … <!-- end --> (or "if !ai"; "video" is true
 * once the demo recording is in site/video/), resolved after
 * the translation so that both branches always have their Italian text.
 */
function conditions(html, file) {
  const flags = { ai: aiReady, video: videos.length > 0 };
  // A marker on a line of its own takes its line with it.
  const mark = (word) => `(?:^[ \\t]*)?<!--\\s*${word}\\s*-->(?:[ \\t]*\\n)?`;
  const re = new RegExp(`${mark('if\\s+(!?)(\\w+)')}([\\s\\S]*?)(?:${mark('else')}([\\s\\S]*?))?${mark('end')}`, 'gm');
  return html.replace(re, (_, not, name, yes, no = '') => {
    if (!(name in flags)) throw new Error(`${file}: unknown condition "${name}"`);
    return flags[name] !== (not === '!') ? yes : no;
  });
}

function templatePage(def, lang) {
  let html = read(`scripts/site/${def.template}`);
  const meta = {};
  html = html.replace(/<!--\s*(title|description):\s*([\s\S]*?)-->\n?/g, (_, k, v) => {
    meta[k] = v.trim();
    return '';
  });
  if (lang === 'it') html = translate(html, IT);
  html = conditions(html, def.template);
  const blocks = {
    STATUS: () => esc(statusText(lang)),
    FORMATS: () => formatsTable(lang),
    DOWNLOADS: () => downloads(lang),
    COMPARE: () => compareTable(lang),
    HERO_IMG: () => figureImg('hero-dark', t(lang, HERO_ALT), { lazy: false }),
    AI_TAG: () => aiTag(lang),
    AI_MOCK: () => aiMock(lang),
    SWITCH: () => themeSwitch(lang),
    SHOT_SHEET: () => shotPair('sheet', lang, 'The same drawing on an A3 sheet to ISO 5457, with frame, grid zones and an ISO 7200 title block, ready for vector PDF export.'),
    SHOT_SKETCH: () => shotPair('sketch', lang, 'The sketch solved by its constraints: fully constrained entities in green, the constraint list in the Checks tab, the degrees of freedom left in the status bar.'),
    SHOT_PART: () => shotPair('part', lang, 'The stepped shaft sample in the 3D tab: its half profile revolved and chamfered by the feature tree in the Features tab, with volume, size and centre of mass measured on the body.'),
    TAG_2D: () => pillarTag(lang, ['M1', 'M2']),
    TAG_SKETCH: () => pillarTag(lang, ['M3']),
    TAG_3D: () => pillarTag(lang, ['M4']),
    TAG_M5: () => pillarTag(lang, ['M5']),
    TAG_CHECKS: () => pillarTag(lang, ['M7']),
    STD_CHIPS: () => stdChips(lang),
    GLYPHS: () => glyphs(lang),
    TREE: () => featureTree(lang),
  };
  const simple = {
    REPO,
    VERSION: pkg.version,
    RELEASES,
    HOME: HOME[lang],
    P_DEMO: navPath('demo', lang),
    P_DOCS: navPath('docs', lang),
    P_STANDARDS: navPath('standards', lang),
    P_GUIDES: navPath('guides', lang),
    P_COMPANIES: navPath('companies', lang),
    P_FITS_GUIDE: lang === 'en' ? '/guides/iso-fits-explained/' : '/it/guide/accoppiamenti-iso-spiegati/',
    P_PROJ_GUIDE: lang === 'en' ? '/guides/first-angle-vs-third-angle-projection/' : '/it/guide/proiezione-primo-diedro-terzo-diedro/',
    P_FITS: lang === 'en' ? '/standards/iso-286-fits/' : '/it/norme/iso-286-accoppiamenti/',
  };
  html = html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
    if (blocks[k]) return blocks[k]();
    if (k in simple) return simple[k];
    throw new Error(`${def.template}: unknown placeholder ${m}`);
  });
  page({ lang, path: def[lang], alt: def[lang === 'en' ? 'it' : 'en'], title: t(lang, meta.title), description: t(lang, meta.description), body: html, section: def.section, full: true });
}

// ---------------------------------------------------------------------------------------------
// The demo page (/demo/, /it/demo/): the walkthrough of docs/demo.md, one section per step with
// its prompts as chat bubbles and its screenshot slot, then "try it yourself".

const DEMO_SHOT_ALT = {
  1: 'The proposal for the mounting plate in the Assistant tab: what it adds, the source of every number, and the preview on the drawing.',
  2: 'The plate as a 3D part with the boss and its fillet, and the feature tree in the Features tab.',
  3: 'The top face of the boss picked with Alt+click as a reference in the chat, and the proposal for the chamfer.',
  4: 'The plate dimensioned to ISO 129-1 on an A3 sheet at 1:1 with the title block filled in.',
  5: 'A request that cannot be built, answered in plain words: nothing is applied.',
};

/** A step's Markdown, with the quoted prompts as chat bubbles. */
function demoBlocks(body, lang) {
  const out = [];
  let md = [];
  const flush = () => {
    if (md.length) out.push(markdown(md.join('\n\n'), { link: linkFrom('docs') }));
    md = [];
  };
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*>/.test(l))) {
      flush();
      const text = lines.map((l) => l.replace(/^\s*>\s?/, '')).join(' ').trim();
      out.push(`<p class="bubble"><span class="who">${esc(t(lang, 'You type'))}</span>${inline(text)}</p>`);
    } else md.push(block);
  }
  flush();
  return out.join('\n          ');
}

function demoPages() {
  for (const lang of ['en', 'it']) {
    const other = lang === 'en' ? 'it' : 'en';
    const d = demo[lang];
    const prep = d.steps.find((s) => s.n === 0);
    const steps = d.steps.filter((s) => s.n > 0);
    const placeholders = steps.filter((s) => images[`demo-${s.n}`].placeholder).length;
    const gateNote = gate(
      '',
      `<p class="gate">${aiTag(lang)} <span>${esc(
        t(lang, 'The assistant is being built now (roadmap milestone {m}) and ships in the next release. This page is its demo script.', { m: aiSection.id }),
      )}</span></p>`,
    );
    const shotText = t(lang, 'Some screenshots are not taken yet: the grey frames stand in for them.');
    const shotNote = placeholders ? `<p class="gate"><span>${esc(shotText)}</span></p>` : '';
    // The screen recording on top; the steps below are its chapters.
    // Both states are translated on every build, so a new recording never breaks the Italian check.
    const recordingText = t(lang, 'Recording in progress: the screen recording of this walkthrough appears here as soon as it is ready. The steps below are its chapters.');
    const noPlayText = t(lang, 'Your browser does not play this video.');
    const downloadText = t(lang, 'Download the recording');
    const captionText = t(lang, 'A screen recording of the walkthrough below, made in the real app.');
    const mp4 = videos.find((v) => v.type === 'video/mp4') ?? videos[0];
    const video = videos.length
      ? `<figure class="demo-video">
            <video controls preload="metadata" poster="${images['demo-1']?.src ?? images['hero-dark'].src}" width="1440" height="900">
              ${videos.map((v) => `<source src="${v.src}" type="${v.type}" />`).join('\n              ')}
              <p>${esc(noPlayText)} <a href="${mp4.src}">${esc(downloadText)}</a></p>
            </video>
            <figcaption>${esc(captionText)}</figcaption>
          </figure>`
      : `<p class="recording"><span class="rec" aria-hidden="true"></span><span>${esc(recordingText)}</span></p>`;
    const toc = steps.map((s) => `<li><a href="#step-${s.n}"><span>${String(s.n).padStart(2, '0')}</span> ${inline(s.title)}</a></li>`).join('\n            ');
    const stepHtml = steps
      .map((s) => {
        const name = `demo-${s.n}`;
        const real = t(lang, DEMO_SHOT_ALT[s.n] ?? 'Screenshot of step {n} of the demo.', { n: s.n });
        const stand = t(lang, 'Placeholder: the screenshot of step {n} is not taken yet.', { n: s.n });
        const alt = images[name].placeholder ? stand : real;
        return `<section class="step${s.n % 2 ? '' : ' alt'}" id="step-${s.n}" aria-labelledby="step-${s.n}-h">
        <div class="wrap step-grid">
          <div class="step-text">
          <p class="step-num" aria-hidden="true">${String(s.n).padStart(2, '0')}</p>
          <h2 id="step-${s.n}-h"><span class="label">${esc(t(lang, 'Step {n}', { n: s.n }))}</span> ${inline(s.title)}</h2>
          ${demoBlocks(s.body, lang)}
          </div>
          <figure class="shot"><a href="${images[name].src}">${figureImg(name, alt)}</a></figure>
        </div>
      </section>`;
      })
      .join('\n      ');
    const tryText = gate(
      t(lang, 'Get MechPilot, open the Assistant tab, add your own Claude, OpenAI or Gemini API key, and type the first prompt:'),
      t(lang, 'The assistant ships with milestone {m}. Until then you can build MechPilot from source and try what it does today: 2D drafting to ISO, parametric sketches and 3D parts. The first prompt, for when it ships:', { m: aiSection.id }),
    );
    const body = `<section class="hero hero-sub">
        <div class="wrap">
          <p class="eyebrow">${esc(t(lang, 'Demo'))}</p>
          <h1>${esc(t(lang, 'Design by writing. Point. Change. Print.'))}</h1>
          <p class="lead">${esc(
            t(lang, 'A ten-minute walkthrough of MechPilot with the assistant: a part from one sentence, step by step to a 3D part, a change on a face you point at, and the dimensioned A3 drawing as a PDF. Nothing the assistant proposes is applied until you click Accept, and every accepted proposal is one undo step.'),
          )}</p>
          ${gateNote}
          ${video}
          <h2 class="toc-h">${esc(t(lang, 'Chapters'))}</h2>
          ${shotNote}
          <ol class="step-toc">
            ${toc}
          </ol>
        </div>
      </section>
      ${
        prep
          ? `<section class="prep-sec" aria-labelledby="prep-h">
        <div class="wrap">
          <div class="prep">
            <h2 id="prep-h">${inline(prep.title)}</h2>
            ${demoBlocks(prep.body, lang)}
          </div>
        </div>
      </section>
      `
          : ''
      }${stepHtml}
      <section class="sec try-sec" aria-labelledby="try-h">
        <div class="wrap">
          <div class="try">
            <h2 id="try-h">${esc(t(lang, 'Try it yourself'))}</h2>
            <p>${esc(tryText)}</p>
            <p class="bubble"><span class="who">${esc(t(lang, 'You type'))}</span>${inline(firstPrompt(lang))}</p>
            <p class="cta"><a class="btn primary lg" href="${HOME[lang]}#download">${esc(t(lang, 'Download'))}</a> <a class="btn lg" href="${REPO}#contribute-in-30-minutes">${esc(t(lang, 'Build from source'))}</a> <a class="btn lg" href="/docs/getting-started/"${lang === 'it' ? ' hreflang="en"' : ''}>${esc(t(lang, 'Getting started'))}</a></p>
          </div>
        </div>
      </section>`;
    page({
      lang,
      path: navPath('demo', lang),
      alt: navPath('demo', other),
      title: t(lang, 'Demo: design by writing, point, change, print · MechPilot'),
      description: t(lang, 'The demo script of the MechPilot AI assistant: a part from one sentence, step by step to a 3D part, a change on a face you point at, and the A3 drawing as a PDF.'),
      section: 'demo',
      body,
      full: true,
    });
  }
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
      path: navPath('docs', lang),
      alt: navPath('docs', lang === 'en' ? 'it' : 'en'),
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
        crumbs: [[t(lang, 'Guides'), navPath('guides', lang)], [title]],
        body: `<article class="prose narrow">
        ${body}
      </article>`,
      });
    }
  }
  for (const lang of ['en', 'it']) {
    page({
      lang,
      path: navPath('guides', lang),
      alt: navPath('guides', lang === 'en' ? 'it' : 'en'),
      title: t(lang, 'Guides to technical drawing · MechPilot'),
      description: t(lang, 'Short, factual guides to the standards behind mechanical drawings: ISO fits and the first and third angle projection methods.'),
      section: 'guides',
      crumbs: [[t(lang, 'Guides')]],
      body: `<div class="narrow">
        <h1>${esc(t(lang, 'Guides'))}</h1>
        <ul class="cards">
          ${GUIDES.map((g) => `<li><a href="${g[lang]}">${esc(meta[`${g.id}.${lang}`].title)}</a><span>${esc(meta[`${g.id}.${lang}`].blurb)}</span></li>`).join('\n          ')}
        </ul>
        <p>${esc(t(lang, 'The tables behind them, with their sources:'))} <a href="${navPath('standards', lang)}">${esc(t(lang, 'Standards'))}</a></p>
      </div>`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The build.

// Start clean: everything in site/ is generated, except the screenshots in site/img/*.png.
mkdirSync(siteDir, { recursive: true });
for (const f of readdirSync(siteDir)) if (f !== 'img' && f !== 'video') rmSync(join(siteDir, f), { recursive: true, force: true });
for (const [name, type] of VIDEOS) {
  const file = join(siteDir, 'video', name);
  if (!existsSync(file)) continue;
  const size = statSync(file).size;
  // Cloudflare Pages serves files up to 25 MiB.
  if (size > 25 * 1024 * 1024) throw new Error(`site/video/${name} is over 25 MiB, the Cloudflare Pages limit per file`);
  if (size > 20 * 1024 * 1024) console.warn(`warning: site/video/${name} is over 20 MB`);
  videos.push({ src: `/video/${name}?v=${hash(readFileSync(file))}`, type });
}
if (existsSync(join(siteDir, 'video'))) {
  for (const f of readdirSync(join(siteDir, 'video'))) if (!VIDEOS.some(([n]) => n === f)) console.warn(`warning: site/video/${f} is not used by any page`);
}
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
demoPages();
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
    <header class="top"><div class="wrap top-in"><a class="logo" href="/">${LOGO} MechPilot</a></div></header>
    <main id="main">
      <section class="hero hero-sub">
        <div class="wrap">
          <p class="eyebrow">404</p>
          <h1>Page not found</h1>
          <p class="lead">This page does not exist (any more). Try the <a href="/">home page</a>, the <a href="/demo/">demo</a>, the <a href="/docs/">docs</a> or the <a href="/standards/">standards tables</a>.</p>
          <h2 lang="it">Pagina non trovata</h2>
          <p class="lead" lang="it">Questa pagina non esiste (più). Prova la <a href="/it/">pagina iniziale</a>, la <a href="/it/demo/">demo</a>, la <a href="/it/documentazione/">documentazione</a> o le <a href="/it/norme/">tabelle delle norme</a>.</p>
        </div>
      </section>
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
    "  Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'",
    '/style.css',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/img/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/video/*',
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
