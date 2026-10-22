#!/usr/bin/env node
// Checks the generated website in site/: every internal link and asset resolves to a file in site/
// (anchors included), every page has a language, a title, one h1, a description and a canonical
// link (or noindex), hreflang pairs point at each other, nothing loads from another origin, no
// page carries a script or an email address. scripts/build-site.mjs runs it after every build; it
// also runs on its own: node scripts/check-site.mjs

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function* walk(dir) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Site path ("/docs/dxf/") of an HTML file. */
const urlPath = (siteDir, file) => {
  const rel = '/' + relative(siteDir, file).split(sep).join('/');
  return rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel;
};

/** The file a site path is served from, or null (Cloudflare Pages rules: /a/ -> /a/index.html). */
function resolve(siteDir, path) {
  const clean = decodeURIComponent(path.split('#')[0].split('?')[0]);
  const candidates = clean.endsWith('/') ? [join(siteDir, clean, 'index.html')] : [join(siteDir, clean), join(siteDir, clean, 'index.html'), join(siteDir, clean + '.html')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

export function checkSite(siteDir, site) {
  const problems = [];
  const htmlFiles = [...walk(siteDir)].filter((f) => f.endsWith('.html'));
  const cache = new Map();
  const htmlOf = (f) => {
    if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8'));
    return cache.get(f);
  };
  for (const file of htmlFiles) {
    const html = htmlOf(file);
    const where = relative(siteDir, file).split(sep).join('/');
    const err = (msg) => problems.push(`site/${where}: ${msg}`);
    const self = urlPath(siteDir, file);
    const is404 = where === '404.html';

    if (!/^<!doctype html>\n<html lang="(en|it)">/.test(html)) err('must start with <!doctype html> and <html lang="en|it">');
    if (!/<meta charset="utf-8" \/>/.test(html)) err('no charset');
    if (!/<meta name="viewport"/.test(html)) err('no viewport');
    if ((html.match(/<title>[^<]+<\/title>/g) ?? []).length !== 1) err('needs exactly one non-empty <title>');
    if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) err('needs exactly one <h1>');
    if (/<script\b/i.test(html)) err('has a <script>: the site runs no JavaScript');
    if (/\son[a-z]+="/i.test(html)) err('has an inline event handler');
    if (/mailto:|[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(html)) err('has an email address');
    if (/(?:src|srcset)="(?:https?:)?\/\//.test(html) || /<link[^>]+rel="(?:stylesheet|preload|icon)"[^>]+href="(?:https?:)?\/\//.test(html)) err('loads something from another origin');
    const noindex = /<meta name="robots" content="noindex" \/>/.test(html);
    if (!is404) {
      if (!/<meta name="description" content="[^"]{20,}" \/>/.test(html)) err('no meta description');
      const canonical = /<link rel="canonical" href="([^"]+)" \/>/.exec(html);
      if (!noindex && !canonical) err('no canonical link');
      if (canonical && canonical[1] !== site + self) err(`canonical ${canonical[1]} is not ${site + self}`);
      if (!/<meta property="og:image" content="[^"]+"/.test(html)) err('no og:image');
    }
    // hreflang: both languages and x-default, and the other page points back here.
    const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)" \/>/g)].map((m) => [m[1], m[2]]);
    if (alternates.length) {
      const langs = alternates.map(([l]) => l).sort().join(',');
      if (langs !== 'en,it,x-default') err(`hreflang set is ${langs}`);
      for (const [l, href] of alternates) {
        if (!href.startsWith(site + '/')) {
          err(`hreflang ${l} is not on ${site}`);
          continue;
        }
        const target = resolve(siteDir, href.slice(site.length));
        if (!target) err(`hreflang ${l} -> ${href} does not exist`);
        else if (!htmlOf(target).includes(`hreflang="${(/lang="(en|it)"/.exec(html) ?? [])[1]}" href="${site}${self}"`)) err(`hreflang ${l} -> ${href} does not point back`);
      }
    }
    // Every internal reference resolves, with its anchor.
    for (const m of html.matchAll(/\s(href|src|content)="([^"]*)"/g)) {
      let ref = m[2].replace(/&amp;/g, '&');
      if (m[1] === 'content' && !ref.startsWith(site)) continue;
      if (ref.startsWith(site)) ref = ref.slice(site.length) || '/';
      if (/^[a-z]+:/i.test(ref) || ref.startsWith('//')) continue; // external link
      let target;
      if (ref.startsWith('#')) target = file;
      else if (ref.startsWith('/')) target = resolve(siteDir, ref);
      else target = resolve(siteDir, join(dirname(self + 'x'), ref).split(sep).join('/'));
      if (!target) {
        err(`broken link ${m[2]}`);
        continue;
      }
      const anchor = ref.split('#')[1];
      if (anchor && target.endsWith('.html') && !idsOf(htmlOf(target)).has(decodeURIComponent(anchor))) err(`missing anchor ${m[2]}`);
    }
    // Duplicate ids break anchors.
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    const dup = ids.filter((id, k) => ids.indexOf(id) !== k);
    if (dup.length) err(`duplicate ids: ${[...new Set(dup)].join(', ')}`);
  }
  // The sitemap lists only pages that exist and are not noindex.
  const sitemap = join(siteDir, 'sitemap.xml');
  if (existsSync(sitemap)) {
    for (const m of readFileSync(sitemap, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const target = resolve(siteDir, m[1].slice(site.length));
      if (!target) problems.push(`site/sitemap.xml: ${m[1]} does not exist`);
      else if (/<meta name="robots" content="noindex"/.test(htmlOf(target))) problems.push(`site/sitemap.xml: ${m[1]} is noindex`);
    }
  } else problems.push('site/sitemap.xml is missing');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkSite(join(root, 'site'), 'https://mechpilot.agentflowbind.com');
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('site/ checked: no problems');
}
