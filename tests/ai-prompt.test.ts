// The assistant's prompts (shared/ai/prompt.ts): frozen per language, honest rules present, the
// command schema explained, under the size budget; the drawing goes in the first user message.

import { describe, expect, it } from 'vitest';
import { assistantTurnText, contextText, systemPrompt, userTurnText } from '@shared/ai/prompt';
import type { ChatTurn } from '@shared/ai/types';
import { context, sample, userTurn } from './ai-helpers';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('system prompt', () => {
  const en = systemPrompt('en');
  it('is frozen (same text every time, no date or drawing in it)', () => {
    expect(systemPrompt('en')).toBe(en);
    expect(en).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(en).not.toContain('<drawing>');
  });
  it('states the honesty rules', () => {
    expect(en).toMatch(/Never state a dimension/);
    expect(en).toContain('"measured"');
    expect(en).toContain('"standard"');
    expect(en).toContain('"library"');
    expect(en).toContain('"suggestion"');
    expect(en).toMatch(/You never edit the drawing/);
    expect(en).toContain('propose');
  });
  it('explains the commands, features, sheets, references and then-actions', () => {
    for (const s of ['addEntities', 'updateEntities', 'deleteEntities', 'addConstraints', 'addPart', 'updatePart', 'addSheet', 'updateSheet', 'bulge', 'tolerance', 'driving', 'revolve', 'hole', 'fillet', 'inPlane', 'shell', 'mirror', 'pattern', 'exportPdf', 'openPart', 'edgesOfThisFace', 'thisFaceByNormal', 'ISO 5457'])
      expect(en, s).toContain(s);
  });
  it('asks one clear question when the request is not clear, and states assumptions otherwise', () => {
    expect(en).toContain('# When the request is not clear: ask');
    expect(en).toMatch(/one short, clear question in a single message and do not call propose/);
    expect(en).toMatch(/numbered options/);
    expect(en).toMatch(/state the default you would use/);
    for (const gap of ['a size or a position', 'which face or edge', 'which part', 'which hole size', '"make it bigger" without a number', 'could go on several faces']) expect(en, gap).toContain(gap);
    expect(en).toMatch(/state every assumption in the proposal's summary/);
    expect(en).toMatch(/Never ask about something you can find out with a tool/);
  });
  it('stays under about 2,500 words', () => {
    expect(words(en)).toBeLessThan(2500);
  });
  it('answers in the context language', () => {
    expect(en).toContain('Answer in English.');
    expect(systemPrompt('it')).toContain('Answer in Italian');
  });
});

describe('messages', () => {
  it('puts the drawing snapshot in the first user message', () => {
    const doc = sample('mounting-bracket');
    const text = contextText(context(doc, { selection: [doc.entityOrder[0]] }));
    expect(text).toContain('<drawing>');
    expect(text).toContain('"entityCount":' + doc.entityOrder.length);
    expect(text).toContain('<selected_entities>');
  });
  it('appends references to the user text', () => {
    const doc = sample('sheet-metal-cover');
    const t = userTurnText(userTurn('make this thicker', [{ kind: 'part', partId: 'cover', label: 'Cover' }]), context(doc));
    expect(t).toContain('make this thicker');
    expect(t).toContain('"partId":"cover"');
    expect(t).toContain('"name":"Sheet-metal cover"');
  });
  it('tells the model what became of earlier proposals', () => {
    const turn: ChatTurn = {
      id: 'a1',
      role: 'assistant',
      text: 'Here it is.',
      at: '',
      proposals: [
        { id: 'p1', title: 'Plate', summary: '', commands: [], claims: [], touches: { entities: [], parts: [] }, state: 'accepted' },
        { id: 'p2', title: 'Holes', summary: '', commands: [], claims: [], touches: { entities: [], parts: [] }, state: 'rejected' },
      ],
    };
    const t = assistantTurnText(turn);
    expect(t).toContain('"Plate" (p1): accepted');
    expect(t).toContain('"Holes" (p2): rejected');
  });
});
