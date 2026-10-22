// Server-side validation of proposals (shared/ai/proposal.ts): a proposal reaches the user only
// when its commands apply cleanly and the result is a valid drawing; ids are filled in, updates
// are patches, touches come from the diff, and errors name what is wrong.

import { describe, expect, it } from 'vitest';
import { validateProposal } from '@shared/ai/proposal';
import { apply, type Command } from '@shared/commands';
import type { CircleEntity, Document } from '@shared/doc/types';
import { blank, ids, sample } from './ai-helpers';

const P = (x: number, y: number) => ({ x, y });

function plate(over: Record<string, unknown> = {}) {
  return {
    title: 'Plate',
    summary: 'A plate with four holes.',
    commands: [
      {
        kind: 'addEntities',
        entities: [
          { id: '', type: 'polyline', layer: '0', points: [P(0, 0), P(120, 0), P(120, 80), P(0, 80)], closed: true, junk: 'dropped' },
          ...[P(10, 10), P(110, 10), P(110, 70), P(10, 70)].map((c) => ({ id: '', type: 'circle', center: c, radius: 3.3 })),
        ],
      },
    ],
    claims: [
      { text: 'Ø6.6 for M6 medium', source: { kind: 'library', file: 'library/holes/iso-273.json', entry: 'M6' } },
      { text: 'Edge distance 10 mm', source: { kind: 'library' } },
    ],
    ...over,
  };
}

/** Apply a proposal's commands the way the UI does on Accept. */
function accept(doc: Document, commands: Command[]): Document {
  const r = apply(doc, { kind: 'batch', label: 'AI', commands });
  if (!r.ok) throw new Error(r.error.message);
  return r.doc;
}

describe('proposal validation', () => {
  it('passes a good proposal, fills the ids and the layers, and normalizes the commands', () => {
    const r = validateProposal(blank(), plate(), ids());
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    const p = r.proposal;
    expect(p.state).toBe('pending');
    expect(p.id).toBeTruthy();
    const added = (p.commands[0] as Extract<Command, { kind: 'addEntities' }>).entities;
    expect(added.map((e) => e.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(r.created).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(added[1].layer).toBe('0');
    expect('junk' in added[0]).toBe(false);
    expect(p.touches.entities.sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    // An incomplete source is never shown as stronger than "suggestion".
    expect(p.claims[1].source).toEqual({ kind: 'suggestion' });
    expect(p.claims[0].source.kind).toBe('library');
    const after = accept(blank(), p.commands);
    expect(after.entityOrder).toHaveLength(5);
  });

  it('fails on an unknown id and names it', () => {
    const r = validateProposal(blank(), { title: 'Edit', summary: '', commands: [{ kind: 'updateEntities', entities: [{ id: 'ghost-17', radius: 2 }] }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('ghost-17');
    expect(r.error).toMatch(/command 1 \(updateEntities\)/);
    const d = validateProposal(blank(), { title: 'Delete', summary: '', commands: [{ kind: 'deleteEntities', ids: ['ghost-18'] }] });
    expect(!d.ok && d.error).toContain('ghost-18');
  });

  it('renames an id that already exists and follows it in later commands', () => {
    const doc = sample('sheet-metal-cover');
    const r = validateProposal(doc, {
      title: 'Hole and its radius',
      summary: '',
      commands: [
        { kind: 'addEntities', entities: [{ id: 'h1', type: 'circle', layer: '0', center: P(50, 50), radius: 2 }] },
        { kind: 'addConstraints', constraints: [{ id: '', kind: 'radius', entity: 'h1', value: 2 }] },
      ],
    }, ids());
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    const newId = r.renamed.h1;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe('h1');
    const c = (r.proposal.commands[1] as Extract<Command, { kind: 'addConstraints' }>).constraints[0];
    expect(c).toMatchObject({ kind: 'radius', entity: newId });
    expect((doc.entities.h1 as CircleEntity).radius).not.toBe(2);
  });

  it('treats updates as patches and fills touches from the diff', () => {
    const doc = sample('sheet-metal-cover');
    const r = validateProposal(doc, { title: 'Bigger hole', summary: '', commands: [{ kind: 'updateEntities', entities: [{ id: 'h1', radius: 3 }] }] });
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    const e = (r.proposal.commands[0] as Extract<Command, { kind: 'updateEntities' }>).entities[0] as CircleEntity;
    expect(e).toEqual({ ...(doc.entities.h1 as CircleEntity), radius: 3 });
    expect(r.proposal.touches.entities).toEqual(['h1']);
    // The part whose hole sketch uses h1 rebuilds, so the preview highlights it.
    expect(r.proposal.touches.parts).toEqual(['cover']);
  });

  it('updates a part feature by id and keeps the rest of the tree', () => {
    const doc = sample('sheet-metal-cover');
    const features = doc.parts.cover.features.map((f) => (f.id === 'ex1' ? { id: 'ex1', distance: 30 } : { id: f.id }));
    const r = validateProposal(doc, { title: 'Thicker', summary: '', commands: [{ kind: 'updatePart', part: { id: 'cover', features } }] });
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    const part = (r.proposal.commands[0] as Extract<Command, { kind: 'updatePart' }>).part;
    expect(part.features).toHaveLength(doc.parts.cover.features.length);
    expect(part.features[1]).toMatchObject({ kind: 'extrude', distance: 30, sketch: 'sk1' });
    expect(r.proposal.touches).toEqual({ entities: [], parts: ['cover'] });
  });

  it('never drops features silently', () => {
    const doc = sample('sheet-metal-cover');
    const r = validateProposal(doc, { title: 'Oops', summary: '', commands: [{ kind: 'updatePart', part: { id: 'cover', features: [{ id: 'ex1', distance: 30 }] } }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/would remove the features sk1/);
  });

  it('rejects an extrude of an open profile with the reason', () => {
    const doc = blank();
    const r = validateProposal(doc, {
      title: 'Open',
      summary: '',
      commands: [
        { kind: 'addEntities', entities: [{ id: 'a', type: 'line', a: P(0, 0), b: P(10, 0) }, { id: 'b', type: 'line', a: P(10, 0), b: P(10, 10) }] },
        { kind: 'addPart', part: { id: '', name: 'P', features: [{ id: 'sk', kind: 'sketch', plane: 'XY', offset: 0, entities: ['a', 'b'] }, { id: '', kind: 'extrude', sketch: 'sk', distance: 5, direction: 'normal', op: 'add' }] } },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a closed profile/);
  });

  it('checks the file format rules on the result', () => {
    const r = validateProposal(blank(), { title: 'Bad circle', summary: '', commands: [{ kind: 'addEntities', entities: [{ id: 'c', type: 'circle', center: P(0, 0), radius: -1 }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/circle needs center and radius > 0/);
    const k = validateProposal(blank(), { title: 'Nope', summary: '', commands: [{ kind: 'replaceDocument', doc: blank() }] });
    expect(!k.ok && k.error).toMatch(/not available/);
  });

  it('rejects ISO 286 classes that the library does not have, and unknown hole threads', () => {
    const r = validateProposal(blank(), { title: 'Fit', summary: '', commands: [{ kind: 'addEntities', entities: [{ id: '', type: 'dimension', kind: 'diameter', a: P(0, 0), b: P(5000, 0), position: P(1, 1), rotation: 0, tolerance: { kind: 'fit', cls: 'H7' } }] }] });
    expect(!r.ok && r.error).toMatch(/H7 .* not in MechPilot's ISO 286 data/);
    const doc = sample('sheet-metal-cover');
    const features = doc.parts.cover.features.map((f) => (f.id === 'ho1' ? { id: 'ho1', spec: { kind: 'clearance', thread: 'M7.5', series: 'medium' } } : { id: f.id }));
    const h = validateProposal(doc, { title: 'Hole', summary: '', commands: [{ kind: 'updatePart', part: { id: 'cover', features } }] });
    expect(!h.ok && h.error).toMatch(/no ISO 273 clearance hole for "M7.5"/);
  });

  it('checks the then-action', () => {
    const r = validateProposal(blank(), plate({ then: { kind: 'exportPdf' } }));
    expect(!r.ok && r.error).toMatch(/exportPdf needs a sheet/);
    const withSheet = plate({ then: { kind: 'exportPdf' } });
    withSheet.commands.push({ kind: 'addSheet', sheet: { size: 'A3', views: [{ scale: 1, center: P(60, 40), position: P(210, 160), width: 200, height: 150 }] } } as never);
    const ok = validateProposal(blank(), withSheet, ids());
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    if (ok.ok) {
      expect(ok.proposal.then).toEqual({ kind: 'exportPdf' });
      const sheet = (ok.proposal.commands[1] as Extract<Command, { kind: 'addSheet' }>).sheet;
      expect(sheet).toMatchObject({ orientation: 'landscape', titleBlock: {}, name: 'Sheet 1' });
      expect(sheet.views[0].id).toBeTruthy();
    }
  });

  it('builds on an earlier proposal of the same reply', () => {
    const first = validateProposal(blank(), plate(), ids());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = validateProposal(first.doc, { title: 'Bigger holes', summary: '', commands: [{ kind: 'updateEntities', entities: [{ id: 'n2', radius: 4 }] }] });
    expect(second.ok, second.ok ? '' : second.error).toBe(true);
  });
});
