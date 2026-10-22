// A scripted, deterministic stand-in for a real model (MP_AI_FAKE=1, unit and end-to-end tests).
// It drives the same tool loop as a real provider: it calls read_model and the other tools, reads
// their results from the conversation, and proposes through the propose tool, so validation,
// progress events and the reply are exercised exactly as with Claude, GPT or Gemini.
//
// Scripts, chosen by the newest user text:
// - "fail": the provider fails (a server error), to test error display;
// - "pdf": a sheet with the drawing on it plus overall dimensions, then: exportPdf;
// - "thicker" / "più spesso" with a part (reference or the active part): the first extrude's
//   distance + 5 mm (or the number of mm in the text);
// - "plate" / "piastra": a 120 × 80 plate outline with four Ø6.6 holes (ISO 273 M6 medium, looked
//   up with the library tool), 10 mm from the edges;
// - "add holes" / "aggiungi fori" with no number (no size, no position): reads the model and
//   asks one clarifying question with numbered options and a default, text only, no proposal;
// - anything else: reads the model and answers with what it found.

import type { AiProviderId } from '@shared/ai/types';
import { newSheet } from '@shared/draw/sheet';
import { ProviderError, type AiProvider, type ChatMessage, type ChatRequest, type ChatResponse, type ToolCall, type ToolResult } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

interface Turn {
  /** The newest user text (what they wrote, with references appended). */
  text: string;
  /** Tool calls made since that text, with their results. */
  calls: { call: ToolCall; result?: ToolResult }[];
  italian: boolean;
}

function readTurn(req: ChatRequest): Turn {
  let last = -1;
  req.messages.forEach((m, i) => {
    if (m.role === 'user') last = i;
  });
  const user = last >= 0 ? (req.messages[last] as Extract<ChatMessage, { role: 'user' }>) : null;
  const text = user ? (user.content[user.content.length - 1] ?? '') : '';
  const calls: Turn['calls'] = [];
  for (const m of req.messages.slice(last + 1)) {
    if (m.role === 'assistant') for (const c of m.toolCalls) calls.push({ call: c });
    else if (m.role === 'tool') for (const r of m.results) {
      const c = calls.find((x) => x.call.id === r.callId);
      if (c) c.result = r;
    }
  }
  return { text, calls, italian: /Answer in Italian/.test(req.system) };
}

const resultOf = (turn: Turn, name: string): { ok: boolean; value: Obj } | null => {
  const hit = [...turn.calls].reverse().find((c) => c.call.name === name && c.result);
  if (!hit?.result) return null;
  let value: unknown = {};
  try {
    value = JSON.parse(hit.result.content);
  } catch {
    value = { text: hit.result.content };
  }
  return { ok: !hit.result.isError, value: isObj(value) ? value : {} };
};

let seq = 0;
const call = (name: string, input: Obj): ChatResponse => {
  const tc: ToolCall = { id: `fake-${++seq}`, name, input };
  return { text: '', toolCalls: [tc], stop: 'tool_use', raw: { provider: 'anthropic', data: null } };
};
const say = (text: string): ChatResponse => ({ text, toolCalls: [], stop: 'end', raw: { provider: 'anthropic', data: null } });

const P = (x: number, y: number) => ({ x, y });

/** Ask again after a validation error, at most once; then report it. */
function afterPropose(turn: Turn, done: { en: string; it: string }): ChatResponse {
  const r = resultOf(turn, 'propose');
  if (r && !r.ok) return say(turn.italian ? `La proposta non è valida: ${String(r.value.error)}` : `The proposal did not validate: ${String(r.value.error)}`);
  return say(turn.italian ? done.it : done.en);
}

function plate(turn: Turn): ChatResponse {
  if (!resultOf(turn, 'read_model')) return call('read_model', {});
  const lib = resultOf(turn, 'library');
  if (!lib) return call('library', { topic: 'clearance', query: 'M6' });
  if (!resultOf(turn, 'propose')) {
    const d = typeof lib.value.medium === 'number' ? lib.value.medium : 6.6;
    const r = d / 2;
    const at = [P(10, 10), P(110, 10), P(110, 70), P(10, 70)];
    return call('propose', {
      title: turn.italian ? 'Piastra 120 × 80 con quattro fori M6' : 'Plate 120 × 80 with four M6 clearance holes',
      summary: turn.italian ? `Contorno 120 × 80 mm e quattro fori Ø${d} a 10 mm dai bordi.` : `A 120 × 80 mm outline and four Ø${d} holes 10 mm from the edges.`,
      commands: [
        {
          kind: 'addEntities',
          entities: [
            { id: '', type: 'polyline', layer: '0', points: [P(0, 0), P(120, 0), P(120, 80), P(0, 80)], closed: true },
            ...at.map((c) => ({ id: '', type: 'circle', layer: '0', center: c, radius: r })),
          ],
        },
      ],
      claims: [
        { text: `Ø${d} mm clearance hole for M6, medium series`, source: { kind: 'library', file: 'library/holes/iso-273.json', entry: 'M6 clearance hole' } },
        { text: '10 mm from the edges', source: { kind: 'suggestion' } },
      ],
    });
  }
  return afterPropose(turn, { en: 'I proposed the plate outline with four M6 clearance holes. Accept it to add it to the drawing.', it: 'Ho proposto il contorno della piastra con quattro fori di passaggio M6. Accetta per aggiungerla al disegno.' });
}

function thicker(turn: Turn): ChatResponse {
  const model = resultOf(turn, 'read_model');
  if (!model) return call('read_model', {});
  if (!resultOf(turn, 'propose')) {
    const parts = Array.isArray(model.value.parts) ? (model.value.parts as Obj[]) : [];
    const refId = /"partId":"([^"]+)"/.exec(turn.text)?.[1];
    const part = parts.find((p) => p.id === refId) ?? parts.find((p) => p.id === model.value.activePart) ?? parts[0];
    const features = part && Array.isArray(part.features) ? (part.features as Obj[]) : [];
    const ex = features.find((f) => f.kind === 'extrude');
    if (!part || !ex || typeof ex.distance !== 'number') return say(turn.italian ? 'Non trovo una parte con un\'estrusione da rendere più spessa.' : 'I found no part with an extrusion to make thicker.');
    const m = /(\d+(?:[.,]\d+)?)\s*mm/.exec(turn.text);
    const delta = m ? Number(m[1].replace(',', '.')) : 5;
    const next = ex.distance + delta;
    return call('propose', {
      title: turn.italian ? `${String(part.name)}: spessore ${ex.distance} → ${next} mm` : `${String(part.name)}: thickness ${ex.distance} → ${next} mm`,
      summary: turn.italian ? `L'estrusione ${String(ex.id)} passa da ${ex.distance} a ${next} mm.` : `The extrusion ${String(ex.id)} goes from ${ex.distance} to ${next} mm.`,
      commands: [{ kind: 'updatePart', part: { id: part.id, features: features.map((f) => (f.id === ex.id ? { id: f.id, distance: next } : { id: f.id })) } }],
      claims: [{ text: `Current extrusion distance ${ex.distance} mm`, source: { kind: 'measured', what: `feature ${String(ex.id)} of part ${String(part.name)}` } }],
      touches: { parts: [part.id] },
    });
  }
  return afterPropose(turn, { en: 'I proposed the thicker part. Accept it to rebuild the part.', it: 'Ho proposto la parte più spessa. Accetta per ricostruirla.' });
}

/** The largest ISO 5455 scale at which a w × h box fits in the view (ISO 5455:1979, 5.1). */
function fitScale(w: number, h: number, vw: number, vh: number): number {
  const ratios = [5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  return ratios.find((r) => w * r <= vw * 0.75 && h * r <= vh * 0.75) ?? 0.01;
}

function pdf(turn: Turn): ChatResponse {
  const model = resultOf(turn, 'read_model');
  if (!model) return call('read_model', {});
  if (!resultOf(turn, 'propose')) {
    const b = model.value.bounds as { min: { x: number; y: number }; max: { x: number; y: number } } | null;
    if (!b) return say(turn.italian ? 'Il disegno è vuoto: non c\'è niente da mettere su un foglio.' : 'The drawing is empty: there is nothing to put on a sheet.');
    const center = P((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2);
    const sheet = newSheet('sheet-pdf', 'view-pdf', turn.italian ? 'Foglio PDF' : 'PDF sheet', center, 'A3');
    const v = sheet.views[0];
    v.scale = fitScale(b.max.x - b.min.x, b.max.y - b.min.y, v.width, v.height);
    const gap = 10 / v.scale;
    return call('propose', {
      title: turn.italian ? 'Foglio A3 con le quote d\'ingombro, poi PDF' : 'A3 sheet with overall dimensions, then PDF',
      summary: turn.italian ? 'Aggiunge le quote d\'ingombro e un foglio A3 con il disegno, poi esporta il PDF.' : 'Adds the overall dimensions and an A3 sheet showing the drawing, then exports the PDF.',
      commands: [
        {
          kind: 'addEntities',
          entities: [
            { id: '', type: 'dimension', kind: 'linear', a: b.min, b: P(b.max.x, b.min.y), position: P(center.x, b.min.y - gap), rotation: 0 },
            { id: '', type: 'dimension', kind: 'linear', a: b.min, b: P(b.min.x, b.max.y), position: P(b.min.x - gap, center.y), rotation: Math.PI / 2 },
          ],
        },
        { kind: 'addSheet', sheet: { ...sheet, titleBlock: { title: String(model.value.name ?? '') } } },
      ],
      claims: [
        { text: `Overall size ${String((model.value.bounds as Obj).size ? JSON.stringify((model.value.bounds as Obj).size) : '')}`, source: { kind: 'measured', what: 'the bounds of the drawing (read_model)' } },
        { text: 'A3 landscape, 420 × 297 mm', source: { kind: 'library', file: 'library/sheets/iso-5457.json', entry: 'A3' } },
      ],
      then: { kind: 'exportPdf' },
    });
  }
  return afterPropose(turn, { en: 'I proposed an A3 sheet with the overall dimensions. When you accept it, the PDF export starts.', it: 'Ho proposto un foglio A3 con le quote d\'ingombro. Quando accetti, parte l\'esportazione PDF.' });
}

/** A request without the facts that change the result: ask, with numbered options and a default. */
function clarifyHoles(turn: Turn): ChatResponse {
  const model = resultOf(turn, 'read_model');
  if (!model) return call('read_model', {});
  const size = (model.value.bounds as { size?: { x: number; y: number } } | null)?.size;
  const outline = size ? (turn.italian ? ` sul contorno di ${size.x} × ${size.y} mm` : ` on the ${size.x} × ${size.y} mm outline`) : '';
  if (turn.italian)
    return say(
      [
        `Che fori vuoi${outline}? Dimmi misura e posizione:`,
        '1. Fori di passaggio M6 (Ø6,6, ISO 273 serie media)',
        '2. Fori di passaggio M8 (Ø9, ISO 273 serie media)',
        '3. Fori filettati o un altro diametro: scrivi quale',
        'Predefinito se rispondi "vai": 1, quattro fori a 10 mm dagli angoli.',
      ].join('\n'),
    );
  return say(
    [
      `Which holes do you want${outline}? Tell me the size and the position:`,
      '1. M6 clearance holes (Ø6.6, ISO 273 medium series)',
      '2. M8 clearance holes (Ø9, ISO 273 medium series)',
      '3. Tapped holes or another diameter: say which',
      'Default if you just say "go ahead": 1, four holes 10 mm from the corners.',
    ].join('\n'),
  );
}

function other(turn: Turn): ChatResponse {
  const model = resultOf(turn, 'read_model');
  if (!model) return call('read_model', {});
  const n = model.value.entityCount ?? 0;
  const p = Array.isArray(model.value.parts) ? model.value.parts.length : 0;
  return say(turn.italian ? `Il disegno ha ${String(n)} entità e ${p} parti (letto con read_model).` : `The drawing has ${String(n)} entities and ${p} parts (read with read_model).`);
}

export class FakeProvider implements AiProvider {
  constructor(readonly id: AiProviderId = 'anthropic') {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (req.signal?.aborted) throw new ProviderError('cancelled', this.id, 'Cancelled');
    const turn = readTurn(req);
    const text = turn.text.toLowerCase().split('<references>')[0];
    if (/\bfail\b/.test(text)) throw new ProviderError('server', this.id, 'Scripted failure (fake provider)', 500);
    let res: ChatResponse;
    if (/\bpdf\b/.test(text)) res = pdf(turn);
    else if (/thicker|più spesso|piu spesso/.test(text)) res = thicker(turn);
    else if (/\b(add|aggiungi)\b.*\b(holes?|fori|foro)\b/.test(text) && !/\d/.test(text)) res = clarifyHoles(turn);
    else if (/plate|piastra/.test(text)) res = plate(turn);
    else res = other(turn);
    return { ...res, raw: { provider: this.id, data: null } };
  }

  async check(): Promise<void> {
    // The fake accepts any key.
  }
}
