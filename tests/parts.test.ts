// Format 5: parts with a feature tree round-trip exactly, broken features are named in plain
// words, and the part commands undo cleanly (product rules 1, 4 and 5).

import { describe, expect, it } from 'vitest';
import { newDocument } from '@shared/doc/document';
import { parse, serialize } from '@shared/doc/file';
import type { Document, Feature, Part } from '@shared/doc/types';
import type { Command } from '@shared/commands';
import { editorState, execute, undo, type EditorState } from '@shared/commands/history';

function docWithPart(features: Feature[]): { doc: Document; part: Part } {
  const base = newDocument('Parts');
  const line = { id: 'l1', type: 'line' as const, layer: '0', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const part: Part = { id: 'p1', name: 'Block', material: 'steel-s235', features };
  const doc: Document = { ...base, entities: { l1: line }, entityOrder: ['l1'], parts: { p1: part }, partOrder: ['p1'] };
  return { doc, part };
}

const SKETCH: Feature = { id: 's1', name: 'Sketch 1', kind: 'sketch', plane: 'XY', offset: 0, entities: ['l1'] };

describe('parts in the file format', () => {
  it('round-trips every feature kind exactly', () => {
    const features: Feature[] = [
      SKETCH,
      { id: 'e1', name: 'Extrude 1', kind: 'extrude', sketch: 's1', distance: 12.5, direction: 'both', op: 'add' },
      { id: 'r1', name: 'Revolve 1', kind: 'revolve', sketch: 's1', axis: { a: { x: 0, y: 0 }, b: { x: 0, y: 1 } }, angle: 270, op: 'cut', suppressed: true },
      { id: 'h1', name: 'Hole 1', kind: 'hole', sketch: 's1', spec: { kind: 'clearance', thread: 'M6', series: 'medium' }, depth: 'through' },
      { id: 'h2', name: 'Hole 2', kind: 'hole', sketch: 's1', spec: { kind: 'tapped', thread: 'M8' }, depth: 15 },
      { id: 'f1', name: 'Fillet 1', kind: 'fillet', edges: { kind: 'parallelTo', axis: 'Z' }, radius: 2 },
      { id: 'c1', name: 'Chamfer 1', kind: 'chamfer', edges: { kind: 'inPlane', plane: 'XY', offset: 12.5 }, distance: 1 },
      { id: 'sh', name: 'Shell 1', kind: 'shell', thickness: 1.5, faces: [{ kind: 'normal', direction: 'Z+' }] },
      { id: 'm1', name: 'Mirror 1', kind: 'mirror', plane: 'YZ', offset: 0 },
      { id: 'p1', name: 'Pattern 1', kind: 'pattern', mode: 'linear', counts: [3, 2], spacing: [20, 15], axes: ['X', 'Y'] },
      { id: 'p2', name: 'Pattern 2', kind: 'pattern', mode: 'circular', axis: 'Z', count: 6, angle: 360 },
      { id: 'i1', name: 'Imported', kind: 'import', format: 'step', data: 'SVNPLTEwMzAzLTIx', sourceName: 'x.step' },
    ];
    const { doc } = docWithPart(features);
    const text = serialize(doc);
    const back = parse(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.doc.parts.p1).toEqual(doc.parts.p1);
    expect(back.doc.partOrder).toEqual(['p1']);
    expect(serialize(back.doc)).toBe(text);
  });

  it('names a broken feature', () => {
    const { doc } = docWithPart([{ id: 'e1', name: 'Extrude 1', kind: 'extrude', sketch: 'nope', distance: -3, direction: 'normal', op: 'add' }]);
    const r = parse(serialize(doc));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/e1|Extrude 1/);
  });

  it('refuses a sketch that points at a missing entity', () => {
    const { doc } = docWithPart([{ ...SKETCH, entities: ['ghost'] }]);
    const r = parse(serialize(doc));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('ghost');
  });
});

describe('part commands', () => {
  const run = (s: EditorState, cmd: Command): EditorState => {
    const r = execute(s, cmd, 100);
    if (!r.ok) throw new Error(r.error.message);
    return r.state;
  };
  const back = (s: EditorState): EditorState => {
    const u = undo(s);
    if (!u) throw new Error('nothing to undo');
    return u;
  };

  it('add, update and delete a part, each undoable', () => {
    let s = editorState(newDocument('x'));
    const part: Part = { id: 'p', name: 'Shaft', features: [SKETCH] };
    // The sketch needs its entity.
    s = run(s, { kind: 'addEntities', entities: [{ id: 'l1', type: 'line', layer: '0', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }] });
    s = run(s, { kind: 'addPart', part });
    expect(s.doc.partOrder).toEqual(['p']);
    s = run(s, { kind: 'updatePart', part: { ...part, name: 'Shaft 2', features: [SKETCH, { id: 'e', name: 'Extrude 1', kind: 'extrude', sketch: 's1', distance: 5, direction: 'normal', op: 'add' }] } });
    expect(s.doc.parts.p.name).toBe('Shaft 2');
    expect(s.doc.parts.p.features).toHaveLength(2);
    s = run(s, { kind: 'deletePart', id: 'p' });
    expect(s.doc.partOrder).toEqual([]);
    s = back(s);
    expect(s.doc.parts.p.name).toBe('Shaft 2');
    s = back(s);
    expect(s.doc.parts.p.name).toBe('Shaft');
    expect(s.doc.parts.p.features).toHaveLength(1);
    s = back(s);
    expect(s.doc.partOrder).toEqual([]);
    expect(s.doc.parts.p).toBeUndefined();
  });

  it('refuses to add a part twice or touch an unknown part', () => {
    let s = editorState(newDocument('x'));
    const part: Part = { id: 'p', name: 'A', features: [] };
    s = run(s, { kind: 'addPart', part });
    const dup = execute(s, { kind: 'addPart', part }, 100);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.message).toContain('p');
    const unknown = execute(s, { kind: 'updatePart', part: { ...part, id: 'zz' } }, 100);
    expect(unknown.ok).toBe(false);
  });
});
