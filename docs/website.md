# The website

https://mechpilot.agentflowbind.com is a static site generated from this repository into `site/`
and served as it is by Cloudflare Pages. English pages are at `/`, Italian pages at `/it/`. There
is no JavaScript on any page, no cookie, no web font, no tracking and no request to a third party.
The look: dark like the app for the hero and the story sections, light "paper" sections for tables
and reading (docs, standards, guides), one stylesheet with colour tokens in `scripts/site/style.css`
(every text colour pair passes WCAG AA; motion only when the visitor has not asked for less).

## What is in it

| Pages | Built from |
| --- | --- |
| Landing page, "For companies" | `scripts/site/index.template.html`, `scripts/site/companies.template.html` |
| Demo (`/demo/`, `/it/demo/`) | `docs/demo.md` (English) and `scripts/site/demo.it.md` (Italian, same steps and prompts), `site/img/demo-N.png`, `site/video/demo.webm` and `demo.mp4` |
| Docs (`/docs/…`) | `docs/getting-started.md`, `file-format.md`, `dxf.md`, `pdf.md`, `sketches.md`, `standards.md` |
| Changelog (`/changelog/`) | `CHANGELOG.md` |
| Standards tables (`/standards/…`, `/it/norme/…`) | `library/**/*.json`, one page per table (ISO 286 grades and eleven fits, ISO 5457, 128-2, 3098, 1101, 21920-1, 5455, 129-1, 7200, ISO 273 holes, tap drills, material densities) |
| Guides (`/guides/…`, `/it/guide/…`) | `scripts/site/guides/<id>.en.md` and `<id>.it.md` |
| Screenshots (`site/img/*.png`) | taken from the real app by `e2e/screenshots.e2e.ts`; the demo ones (`demo-1.png` … one per step) by hand |
| Demo recording (`site/video/demo.webm`, `demo.mp4`) | a screen recording, committed as it is (not built, not copied) |
| 404, `robots.txt`, `sitemap.xml`, `_headers`, `_redirects` | `scripts/build-site.mjs` |

Rules the build enforces:

- **Italian for every page.** Template texts carry `data-i18n` keys and generated pages call
  `t()`; the Italian text of both is in `scripts/site/i18n-it.mjs`. A missing one fails the build
  with the list. Each guide needs its `.it.md`. The docs and the changelog are in English only: the
  Italian docs page says so and links to them, and those pages claim no hreflang pair.
- **Values from the data, never typed.** The standards pages read every number from
  `library/*.json` and show each file's `source`, `verification` and `verifiedFrom` as written
  there. The ISO 286 fit pages compute limit deviations from the tolerance grades and fundamental
  deviations by the rules quoted in `library/fits/iso-286.json` (`scripts/site/fits.mjs`, the same
  method as `shared/fits.ts`). The numbers in the guides come from the same data.
- **Status from the roadmap.** "Planned (M4)" in the comparison and formats tables, the milestone
  line on the landing page and the "first release is not out yet" note are derived from the ticked
  boxes in `docs/roadmap.md`, so they change when a milestone is done and the site is rebuilt.
- **The AI gate.** The assistant is described as shipped only when every box under the roadmap
  heading `## M7-AI Assistant …` is ticked (the build fails if that heading disappears). Until
  then the hero, the "AI inside" section, the facts, the comparison row, the companies page and the
  demo page word it as coming and show a "Coming in the next release" tag. Template branches are
  written as `<!-- if ai --> … <!-- else --> … <!-- end -->` (`if video` is true once the demo
  recording exists); both branches are translated on every build, so ticking the roadmap only needs
  a rebuild.
- **The demo page.** Each `## N. Title` section of `docs/demo.md` (N ≥ 1) is a step with its
  quoted prompts as chat bubbles and a screenshot slot `site/img/demo-N.png`; `## 0.` is the
  preparation box; other sections are left out. The Italian file must have the same steps and the
  same number of prompts in each, or the build fails; its `source:` line records the hash of the
  English text it translates, and the build warns when `docs/demo.md` has changed since. On top
  of the page is the screen recording (`<video>` with the WebM and MP4 sources, poster
  `demo-1.png`) or, while neither file exists, a "recording in progress" note.
- **Deterministic.** No dates, stable order; two runs give identical bytes. Everything in `site/`
  except `site/img/*.png` and `site/video/` is deleted and written again on every build.
- **Checked.** After writing, the build runs `scripts/check-site.mjs`: every internal link,
  image and anchor resolves to a file in `site/`; every page has `lang`, one `<title>`, one `<h1>`,
  a description and a canonical link (or `noindex`); hreflang pairs point at each other; the
  demo video's poster and sources exist; the sitemap lists only pages that exist; no page has a `<script>`, an inline event handler, an email
  address, or anything loaded from another origin. It can also run on its own:
  `node scripts/check-site.mjs`.

## Build and check

```bash
npm run build:site          # node scripts/build-site.mjs
node scripts/check-site.mjs # the link and page check alone (the build runs it too)
```

Commit `site/` together with the change that caused it. CI runs `npm run build:site` and then
`git diff --exit-code -- site`: it fails when the committed site is not what the sources produce.
So rebuild the site after editing `docs/*.md`, `CHANGELOG.md`, `docs/roadmap.md`, `library/`,
`package.json` (the version is shown) or anything in `scripts/site/`.

### Screenshots

The PNGs in `site/img/` come from the built app (1440 × 900, dark and light theme): the sample
drawing, its sheet, and the constrained sketch. To take them again:

```bash
npm run build
npx playwright test -c e2e/playwright.config.ts screenshots
npm run build:site
```

The demo screenshots `site/img/demo-1.png` … `demo-5.png` (one per step of `docs/demo.md`,
1440 × 900 PNG, under 400 KB each if possible) are taken by hand in the real app with the
assistant, and the recording goes in `site/video/demo.webm` (VP9) and `site/video/demo.mp4`
(H.264), 1440 × 900, under 20 MB each (the build fails over 25 MiB, the Cloudflare Pages limit).
Commit them and rebuild: the build hashes them for the cache-busting `?v=` and the `_headers`
cache rule covers `/video/*`; the Content Security Policy allows `media-src 'self'`.

The spec is skipped in CI (it writes into `site/`). If the working tree's sample is newer than the
app in `out/`, point it at another file with `MP_SHOTS_SAMPLE=/path/to/file.mechpilot.json`. A
missing PNG is replaced by an SVG placeholder and the build says so.

## Cloudflare Pages: one-time setup (owner)

The site needs no build step on Cloudflare: it serves the committed `site/` folder.

1. Sign in to the Cloudflare dashboard. Go to **Workers & Pages** > **Create** > **Pages** >
   **Connect to Git**.
2. Authorise the Cloudflare GitHub app for the `mojeee/mechpilot` repository only, and select it.
3. Set up builds and deployments:
   - **Project name:** `mechpilot` (the preview address becomes `mechpilot.pages.dev`).
   - **Production branch:** `main`.
   - **Framework preset:** None.
   - **Build command:** leave empty.
   - **Build output directory:** `site`.
   - **Root directory (advanced):** `/` (the repository root).
   - No environment variables.
4. **Save and Deploy.** Every push to `main` now deploys production; pushes to other branches and
   pull requests get preview URLs. If you do not want previews, turn them off under
   **Settings** > **Builds & deployments** > **Preview deployments**.
5. Custom domain: in the project, **Custom domains** > **Set up a custom domain** >
   `mechpilot.agentflowbind.com`.
   - If `agentflowbind.com` is a zone in the same Cloudflare account, Cloudflare creates the DNS
     record itself; confirm it.
   - If the domain's DNS is elsewhere, add this record at your DNS provider, then wait for
     Cloudflare to show the domain as **Active** (the certificate is issued automatically):

     | Type | Name | Target |
     | --- | --- | --- |
     | CNAME | `mechpilot` | `mechpilot.pages.dev` |

6. Optional: in the zone's settings, keep **Always Use HTTPS** on. Leave **Rocket Loader**, **Email
   Address Obfuscation** and any other feature that injects scripts off: the Content Security
   Policy blocks injected scripts anyway, and the pages need none.

### What `_headers` and `_redirects` do

Cloudflare Pages reads both files from the root of the output directory (`site/`).

- `site/_headers` adds HTTP headers:
  - on every path: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (no framing),
    `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off
    camera, microphone and geolocation, and a `Content-Security-Policy` that allows only this
    origin (`default-src 'self'`; images also as `data:` URLs);
  - on `/style.css` and `/img/*`: `Cache-Control: public, max-age=31536000, immutable`. This is
    safe because every page references them as `/style.css?v=<hash>` and `/img/name.png?v=<hash>`,
    and the hash changes with the content.
- `site/_redirects` adds two short links, both temporary (302) because their target may change:
  `/download` goes to the latest GitHub release and `/discussions` to GitHub Discussions.
  Pages already redirects `/it` to `/it/` and `/docs` to `/docs/` by itself, so no rule is needed
  for that.

### Check after a deploy

```bash
curl -sI https://mechpilot.agentflowbind.com/ | grep -iE 'content-security|x-frame|x-content|referrer|permissions'
curl -sI "https://mechpilot.agentflowbind.com/style.css?v=x" | grep -i cache-control
curl -sI https://mechpilot.agentflowbind.com/download | grep -iE '^(HTTP|location)'
curl -s -o /dev/null -w '%{http_code}\n' https://mechpilot.agentflowbind.com/does-not-exist/   # 404
curl -s https://mechpilot.agentflowbind.com/sitemap.xml | head -5
```

On Windows PowerShell use `curl.exe` instead of `curl`. In a browser, the developer tools' Network
tab shows the same headers; the Console should show no CSP error on any page. Then submit
`https://mechpilot.agentflowbind.com/sitemap.xml` in Google Search Console and Bing Webmaster
Tools if you want the pages indexed sooner (optional).

## Analytics (opt-in, not enabled)

The site has no analytics. If you ever want visitor counts, Cloudflare Web Analytics is the
privacy-friendly option: it sets no cookies and stores no personal data. Two ways to enable it:

- **Automatic setup** (Pages project > **Metrics** > **Web Analytics** > Enable): Cloudflare
  injects its beacon script at the edge. The current Content Security Policy blocks it, so also add
  `https://static.cloudflareinsights.com` to `script-src` and
  `https://cloudflareinsights.com` to a `connect-src` directive in `scripts/build-site.mjs`
  (`_headers`), rebuild and commit.
- **Manual snippet:** not recommended here; the site is designed to run no scripts, and
  `scripts/check-site.mjs` fails on any `<script>` tag.

Before enabling it, update the footer sentence "This site sets no cookies, runs no scripts and
loads nothing from third parties" (and its Italian text) so that it stays true.
