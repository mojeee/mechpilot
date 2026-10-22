// Shared fixtures for the assistant tests (tests/ai-*.test.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@shared/doc/file';
import { newDocument } from '@shared/doc/document';
import type { Document } from '@shared/doc/types';
import type { AssistantContext, AssistantRequest, ChatTurn, Reference } from '@shared/ai/types';
import { sequentialIds } from '@shared/ids';

export function sample(name: string): Document {
  const r = parse(readFileSync(join(__dirname, '..', 'samples', `${name}.mechpilot.json`), 'utf8'));
  if (!r.ok) throw new Error(r.error.message);
  return r.doc;
}

export const blank = (): Document => newDocument('Test');

export function context(doc: Document, over: Partial<AssistantContext> = {}): AssistantContext {
  return { doc, selection: [], activePart: null, activeSheet: null, build: null, sketch: null, lang: 'en', ...over };
}

export const userTurn = (text: string, references?: Reference[]): ChatTurn => ({ id: 'u1', role: 'user', text, at: '2026-10-22T10:00:00Z', ...(references ? { references } : {}) });

export const request = (text: string, ctx: AssistantContext, references?: Reference[]): AssistantRequest => ({ turns: [userTurn(text, references)], context: ctx });

export const ids = () => sequentialIds('n');
