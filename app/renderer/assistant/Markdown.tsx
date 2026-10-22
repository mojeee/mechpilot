// A small, safe renderer for the subset of Markdown the assistant writes: paragraphs, bullet and
// numbered lists, **bold**, `code`, and line breaks. Text only: no HTML is ever interpreted, so
// nothing the model writes can inject markup. Headings are shown as bold lines.

import { Fragment, type ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  // Split on **bold** and `code`, keeping the markers' contents.
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${key}-b${i++}`}>{tok.slice(2, -2)}</strong>);
    else out.push(<code key={`${key}-c${i++}`}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) {
      if (last && last.kind === 'ul') last.items.push(bullet[1]);
      else out.push({ kind: 'ul', items: [bullet[1]] });
    } else if (number) {
      if (last && last.kind === 'ol') last.items.push(number[1]);
      else out.push({ kind: 'ol', items: [number[1]] });
    } else if (heading) {
      out.push({ kind: 'p', lines: [`**${heading[1]}**`] });
    } else if (line.trim() === '') {
      if (last && last.kind === 'p' && last.lines.length) out.push({ kind: 'p', lines: [] });
    } else if (last && last.kind === 'p') {
      // A line that continues a list item (indented) joins the previous item instead.
      last.lines.push(line.trim());
    } else if (last && (last.kind === 'ul' || last.kind === 'ol') && /^\s{2,}/.test(raw)) {
      last.items[last.items.length - 1] += ' ' + line.trim();
    } else out.push({ kind: 'p', lines: [line.trim()] });
  }
  return out.filter((b) => b.kind !== 'p' || b.lines.length > 0);
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        if (b.kind === 'p')
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l, `${i}-${j}`)}
                </Fragment>
              ))}
            </p>
          );
        const items = b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}`)}</li>);
        return b.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
      })}
    </>
  );
}
