// Every literal passed to t('…') must have an Italian translation, and every translation must
// keep the same {placeholders} (CLAUDE.md, Conventions).

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IT } from '@shared/i18n';

const ROOTS = ['app', 'shared'].map((d) => join(__dirname, '..', d));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'i18n' ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

function literals(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;
  for (const f of ROOTS.flatMap(files)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) {
      if (m[1] === '`' && m[2].includes('${')) continue;
      const text = m[2].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
      out.set(text, f);
    }
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('Italian translations', () => {
  const lits = literals();
  it('finds translatable strings', () => expect(lits.size).toBeGreaterThan(40));
  it('has an Italian entry for every t() literal', () => {
    const missing = [...lits.entries()].filter(([k]) => !(k in IT)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });
  it('keeps the same placeholders', () => {
    const bad = Object.entries(IT).filter(([en, it]) => placeholders(en) !== placeholders(it)).map(([en]) => en);
    expect(bad).toEqual([]);
  });
  it('has no empty translations', () => {
    expect(Object.entries(IT).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
});
