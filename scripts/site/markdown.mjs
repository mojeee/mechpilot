// A small Markdown-to-HTML converter for the website: the subset the repo's docs use. ATX headings
// (with ids for anchors), paragraphs, bullet and numbered lists (with wrapped continuation lines),
// fenced code blocks, pipe tables, links, **bold**, *italic* and `inline code`. No raw HTML: every
// character of the source is escaped. No dependency, deterministic.

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** "Top level (format 1)" -> "top-level-format-1", the way GitHub makes heading anchors. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/**
 * Inline Markdown to HTML. `link(href)` may rewrite link targets (relative .md links to site
 * pages); it returns { href, external }.
 */
export function inline(text, link = (href) => ({ href, external: /^https?:/.test(href) })) {
  const codes = [];
  // Code spans first: their content is literal.
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const l = link(href.replace(/&amp;/g, '&'));
    const rel = l.external ? ' rel="noopener"' : '';
    return `<a href="${escapeHtml(l.href)}"${rel}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      inCode = !inCode;
      cur += c;
    } else if (c === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const listItem = (line) => /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);

/**
 * Markdown to HTML. Options: link (see inline), headingOffset (added to heading levels, so a
 * document's "# Title" can become the page h1 or be shifted), skipTitle (drop the first h1, when
 * the page prints its own), ids (a Set shared across a page for unique heading ids).
 */
export function markdown(src, { link, skipTitle = false, ids = new Set() } = {}) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let titleSkipped = false;
  const uniqueId = (text) => {
    const base = slugify(text) || 'section';
    let id = base;
    for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code.
    const fence = /^(\s*)(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[2])) body.push(lines[i++]);
      i++;
      const lang = fence[3] ? ` class="language-${escapeHtml(fence[3])}"` : '';
      out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    // Heading.
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      i++;
      const level = h[1].length;
      if (level === 1 && skipTitle && !titleSkipped) {
        titleSkipped = true;
        continue;
      }
      const html = inline(h[2], link);
      out.push(`<h${level} id="${uniqueId(h[2].replace(/`/g, ''))}">${html}</h${level}>`);
      continue;
    }
    // Table: a row of pipes followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` class="${align[k]}"` : ''}>${inline(c, link)}</${tag}>`;
      out.push(
        '<div class="table-wrap"><table>' +
          `<thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody>` +
          '</table></div>',
      );
      continue;
    }
    // Lists (one level; wrapped lines that are indented continue the item).
    const li = listItem(line);
    if (li && li[1].length === 0) {
      const ordered = /\d/.test(li[2]);
      const items = [];
      let start = ordered ? Number(li[2].slice(0, -1)) : 1;
      while (i < lines.length) {
        const m = listItem(lines[i]);
        if (m && m[1].length === 0 && /\d/.test(m[2]) === ordered) {
          items.push(m[3]);
          i++;
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        } else if (!lines[i].trim() && i + 1 < lines.length && listItem(lines[i + 1])?.[1] === '' && /\d/.test(listItem(lines[i + 1])[2]) === ordered) {
          i++; // a blank line between items of the same list
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      out.push(`<${tag}${startAttr}>${items.map((t) => `<li>${inline(t, link)}</li>`).join('')}</${tag}>`);
      continue;
    }
    // Paragraph: until a blank line or the start of another block.
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~)/.test(lines[i]) && !(listItem(lines[i]) && listItem(lines[i])[1] === '' && para.length === 0)) {
      if (para.length && listItem(lines[i]) && listItem(lines[i])[1] === '') break;
      if (lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
      para.push(lines[i].trim());
      i++;
    }
    if (para.length === 0) {
      // A line no rule took (should not happen); keep it as text rather than loop forever.
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join(' '), link)}</p>`);
  }
  return out.join('\n');
}
