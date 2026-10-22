// Short random ids for entities and layers: 8 characters of base36, from crypto when available.
// Tests pass their own generator so documents are reproducible.

export type IdGen = () => string;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function randomId(): string {
  const bytes = new Uint8Array(8);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return s;
}

/** A deterministic generator for tests and samples: a1, a2, a3, ... with the given prefix. */
export function sequentialIds(prefix = 'e'): IdGen {
  let n = 0;
  return () => `${prefix}${++n}`;
}
