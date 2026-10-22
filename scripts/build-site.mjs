#!/usr/bin/env node
// Builds the static website in site/ (English and Italian): landing page, "For companies",
// 404, robots.txt and sitemap.xml. Run `npm run build:site` after editing scripts/site/*.
// Output is committed, because Cloudflare Pages serves site/ as it is (no build step), and CI
// checks that the committed output is up to date. The build is deterministic: no dates.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { IT } from './site/i18n-it.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = 'https://mechpilot.agentflowbind.com';
const REPO = 'https://github.com/mojeee/mechpilot';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function write(rel, content) {
  const p = join(root, 'site', rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/** Replace the text of every data-i18n element, and data-i18n-content / data-i18n-alt attributes. Fails on a missing key. */
function translate(html, dict) {
  const missing = new Set();
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, _tag, key, _inner, close) => {
    if (!(key in dict)) {
      missing.add(key);
      return m;
    }
    return open + dict[key] + close;
  });
  html = html.replace(/data-i18n-(content|alt)="([^"]+)"(\s+[^>]*?)?\s(content|alt)="[^"]*"/g, (m, _a, key, mid = '', attr) => {
    if (!(key in dict)) {
      missing.add(key);
      return m;
    }
    return `data-i18n-${attr}="${key}"${mid} ${attr}="${esc(dict[key])}"`;
  });
  if (missing.size) throw new Error(`Missing Italian site texts: ${[...missing].join(', ')}`);
  return html;
}

const PAGES = [
  { template: 'index.template.html', en: '/', it: '/it/' },
  { template: 'companies.template.html', en: '/companies/', it: '/it/aziende/' },
];

/** Content hash of style.css, so browsers never show a stale stylesheet. */
const css = readFileSync(join(root, 'scripts/site/style.css'));
const cssHash = createHash('sha1').update(css).digest('hex').slice(0, 10);

function page(def, lang) {
  const path = def[lang];
  const alt = def[lang === 'en' ? 'it' : 'en'];
  let html = readFileSync(join(root, 'scripts/site', def.template), 'utf8');
  // Translate first: Italian texts may carry {{VERSION}} and the other placeholders too.
  if (lang === 'it') html = translate(html, IT);
  html = html
    .replaceAll('{{SITE}}', SITE)
    .replaceAll('{{REPO}}', REPO)
    .replaceAll('{{URL}}', SITE + path)
    .replaceAll('{{ALT_URL}}', SITE + alt)
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{ALT_LANG}}', lang === 'en' ? 'it' : 'en')
    .replaceAll('{{ALT_LABEL}}', lang === 'en' ? 'Italiano' : 'English')
    .replaceAll('{{HOME}}', lang === 'en' ? '/' : '/it/')
    .replaceAll('{{COMPANIES}}', lang === 'en' ? '/companies/' : '/it/aziende/')
    .replaceAll('{{VERSION}}', pkg.version)
    .replaceAll('{{CSS}}', `/style.css?v=${cssHash}`);
  return html;
}

for (const def of PAGES) {
  for (const lang of ['en', 'it']) {
    const path = def[lang];
    write(join(path, 'index.html'), page(def, lang));
  }
}
write('style.css', css);
write('404.html', page(PAGES[0], 'en').replace('<title>', '<title>Not found · '));
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    PAGES.flatMap((d) =>
      ['en', 'it'].map(
        (lang) =>
          `  <url><loc>${SITE}${d[lang]}</loc><xhtml:link rel="alternate" hreflang="en" href="${SITE}${d.en}"/><xhtml:link rel="alternate" hreflang="it" href="${SITE}${d.it}"/></url>`,
      ),
    ).join('\n') +
    '\n</urlset>\n',
);
// Cloudflare Pages headers: no tracking, strict security, long cache for hashed assets.
write(
  '_headers',
  `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'\n/style.css\n  Cache-Control: public, max-age=31536000, immutable\n`,
);
copyFileSync(join(root, 'scripts/site/logo.svg'), join(root, 'site/logo.svg'));
console.log(`site/ built: ${PAGES.length * 2} pages`);
