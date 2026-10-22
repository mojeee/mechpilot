// The command layer and undo/redo (product rule 4): every command has an exact inverse.

import { describe, expect, it } from 'vitest';
import { apply } from '@shared/commands';
import { canRedo, canUndo, editorState, execute, redo, undo, undoLabel } from '@shared/commands/history';
import { newDocument } from '@shared/doc/document';
import { serialize } from '@shared/doc/file';
import type { Document, Entity, Layer } from '@shared/doc/types';

const line = (id: string, layer = '0'): Entity => ({ id, type: 'line', layer, a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
const circle = (id: string, r = 5): Entity => ({ id, type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: r });

function run(doc: Document, ...cmds: Parameters<typeof apply>[1][]): Document {
  for (const c of cmds) {
    const r = apply(doc, c);
    if (!r.ok) throw new Error(r.error.message);
    doc = r.doc;
  }
  return doc;
}

describe('apply', () => {
  it('adds and removes entities without touching the input document', () => {
    const doc = newDocument();
    const r = apply(doc, { kind: 'addEntities', entities: [line('a'), circle('b')] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(doc.entityOrder).toEqual([]);
    expect(r.doc.entityOrder).toEqual(['a', 'b']);
    const back = apply(r.doc, r.inverse);
    expect(back.ok && serialize(back.doc)).toBe(serialize(doc));
  });

  it('refuses duplicates, unknown layers and locked layers in plain words', () => {
    const doc = run(newDocument(), { kind: 'addEntities', entities: [line('a')] });
    expect(apply(doc, { kind: 'addEntities', entities: [line('a')] })).toMatchObject({ ok: false, error: { code: 'duplicate-id' } });
    expect(apply(doc, { kind: 'addEntities', entities: [line('b', 'nope')] })).toMatchObject({ ok: false, error: { code: 'unknown-layer' } });
    const locked = run(doc, { kind: 'updateLayer', layer: { ...doc.layers['0'], locked: true } });
    const r = apply(locked, { kind: 'deleteEntities', ids: ['a'] });
    expect(r).toMatchObject({ ok: false, error: { code: 'layer-locked' } });
    if (!r.ok) expect(r.error.hint).toContain('Unlock');
  });

  it('deleteEntities restores drawing order on undo', () => {
    const doc = run(newDocument(), { kind: 'addEntities', entities: [line('a'), line('b'), line('c')] });
    const r = apply(doc, { kind: 'deleteEntities', ids: ['c', 'a'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.entityOrder).toEqual(['b']);
    expect(r.inverse).toEqual({ kind: 'addEntities', entities: [line('a'), line('c')] });
  });

  it('updateEntities keeps the previous entity as the inverse', () => {
    const doc = run(newDocument(), { kind: 'addEntities', entities: [circle('a', 5)] });
    const r = apply(doc, { kind: 'updateEntities', entities: [circle('a', 7)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.doc.entities.a as { radius: number }).radius).toBe(7);
    expect(r.inverse).toEqual({ kind: 'updateEntities', entities: [circle('a', 5)] });
  });

  it('layers: add, update, delete only when empty, never the last one', () => {
    const l: Layer = { id: 'x', name: 'X', color: 'auto', lineType: '01.1', lineWidth: 0.25, visible: true, locked: false };
    let doc = run(newDocument(), { kind: 'addLayer', layer: l, index: 1 });
    expect(doc.layerOrder[1]).toBe('x');
    doc = run(doc, { kind: 'addEntities', entities: [line('a', 'x')] });
    expect(apply(doc, { kind: 'deleteLayer', id: 'x' })).toMatchObject({ ok: false, error: { code: 'layer-not-empty' } });
    doc = run(doc, { kind: 'deleteEntities', ids: ['a'] }, { kind: 'setActiveLayer', id: 'x' });
    const r = apply(doc, { kind: 'deleteLayer', id: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.activeLayer).toBe('0');
    const back = apply(r.doc, r.inverse);
    expect(back.ok && back.doc.layerOrder).toEqual(doc.layerOrder);
    expect(back.ok && back.doc.activeLayer).toBe('x');
    const one: Document = { ...newDocument(), layers: { '0': newDocument().layers['0'] }, layerOrder: ['0'] };
    expect(apply(one, { kind: 'deleteLayer', id: '0' })).toMatchObject({ ok: false, error: { code: 'last-layer' } });
  });

  it('setProps and batch invert exactly', () => {
    const doc = newDocument('Before');
    const r = apply(doc, { kind: 'batch', label: 'Import', commands: [{ kind: 'setProps', props: { name: 'After', projection: 'third' } }, { kind: 'addEntities', entities: [line('a')] }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.name).toBe('After');
    expect(r.doc.projection).toBe('third');
    const back = apply(r.doc, r.inverse);
    expect(back.ok && serialize(back.doc)).toBe(serialize(doc));
  });

  it('a failing command inside a batch leaves the document unchanged', () => {
    const doc = newDocument();
    const r = apply(doc, { kind: 'batch', label: 'x', commands: [{ kind: 'addEntities', entities: [line('a')] }, { kind: 'deleteEntities', ids: ['nope'] }] });
    expect(r.ok).toBe(false);
    expect(doc.entityOrder).toEqual([]);
  });
});

describe('history', () => {
  it('undo and redo walk the stack and keep labels', () => {
    let s = editorState(newDocument());
    const r1 = execute(s, { kind: 'addEntities', entities: [line('a')] });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    s = r1.state;
    const r2 = execute(s, { kind: 'addEntities', entities: [circle('b')] });
    if (!r2.ok) return;
    s = r2.state;
    expect(s.dirty).toBe(true);
    expect(undoLabel(s)).toBe('Add circle');
    s = undo(s)!;
    expect(s.doc.entityOrder).toEqual(['a']);
    expect(canRedo(s)).toBe(true);
    s = undo(s)!;
    expect(s.doc.entityOrder).toEqual([]);
    expect(canUndo(s)).toBe(false);
    expect(undo(s)).toBeNull();
    s = redo(s)!;
    s = redo(s)!;
    expect(s.doc.entityOrder).toEqual(['a', 'b']);
    expect(redo(s)).toBeNull();
  });

  it('a new command clears the redo stack and the limit drops the oldest entries', () => {
    let s = editorState(newDocument());
    for (let i = 0; i < 5; i++) {
      const r = execute(s, { kind: 'addEntities', entities: [line(`e${i}`)] }, 3);
      if (r.ok) s = r.state;
    }
    expect(s.history.undo.length).toBe(3);
    s = undo(s)!;
    expect(s.history.redo.length).toBe(1);
    const r = execute(s, { kind: 'addEntities', entities: [line('new')] });
    if (r.ok) s = r.state;
    expect(s.history.redo.length).toBe(0);
  });

  it('opening a document is undoable', () => {
    let s = editorState(newDocument('A'));
    const r = execute(s, { kind: 'replaceDocument', doc: newDocument('B') });
    if (r.ok) s = r.state;
    expect(s.doc.name).toBe('B');
    s = undo(s)!;
    expect(s.doc.name).toBe('A');
  });
});
