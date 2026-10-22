// The one command layer (CLAUDE.md, Architecture). Every user action, import and AI proposal is a
// command: plain data applied by a pure function that returns the new document and the inverse
// command. Undo, autosave, scripting and AI all go through here; nothing else edits a document.

import type { Constraint, DimStyle, Document, Entity, Id, Layer, Projection, Sheet, Standard } from '../doc/types';

export type Command =
  /** `order`, when given, is the full entityOrder to restore (undo of a delete keeps the drawing order). */
  | { kind: 'addEntities'; entities: Entity[]; order?: Id[] }
  | { kind: 'deleteEntities'; ids: Id[] }
  /** Replace entities by id (whole entity, so the inverse is the previous entity). */
  | { kind: 'updateEntities'; entities: Entity[] }
  | { kind: 'addLayer'; layer: Layer; index?: number }
  /** Only an empty layer can be deleted, and never the last one. */
  | { kind: 'deleteLayer'; id: Id }
  | { kind: 'updateLayer'; layer: Layer }
  | { kind: 'setActiveLayer'; id: Id }
  | { kind: 'setProps'; props: Partial<{ name: string; description: string; standard: Standard; projection: Projection }> }
  /** Several commands as one undo step, e.g. an import or an AI proposal. */
  | { kind: 'batch'; label: string; commands: Command[] }
  /** The whole document at once (open, import). Undoable like everything else (product rule 4). */
  | { kind: 'replaceDocument'; doc: Document }
  /* M2: dimension style and sheets. */
  | { kind: 'setDimStyle'; style: DimStyle }
  | { kind: 'addSheet'; sheet: Sheet; index?: number }
  | { kind: 'deleteSheet'; id: Id }
  | { kind: 'updateSheet'; sheet: Sheet }
  /* M3: sketch constraints. */
  /** `order`, when given, is the full constraintOrder to restore (undo of a delete keeps the order). */
  | { kind: 'addConstraints'; constraints: Constraint[]; order?: Id[] }
  | { kind: 'deleteConstraints'; ids: Id[] }
  | { kind: 'updateConstraints'; constraints: Constraint[] };

export type CommandKind = Command['kind'];

export interface CommandError {
  code: 'unknown-entity' | 'unknown-layer' | 'unknown-sheet' | 'unknown-constraint' | 'duplicate-id' | 'layer-not-empty' | 'last-layer' | 'layer-locked' | 'empty';
  message: string;
  hint?: string;
}
export type ApplyResult = { ok: true; doc: Document; inverse: Command } | { ok: false; error: CommandError };

const fail = (code: CommandError['code'], message: string, hint?: string): ApplyResult => ({ ok: false, error: { code, message, hint } });

/** Apply `cmd` to `doc`. Never mutates `doc`; copies only the maps it touches. */
export function apply(doc: Document, cmd: Command): ApplyResult {
  switch (cmd.kind) {
    case 'addEntities': {
      if (cmd.entities.length === 0) return fail('empty', 'Nothing to add.');
      const entities = { ...doc.entities };
      const entityOrder = [...doc.entityOrder];
      for (const e of cmd.entities) {
        if (entities[e.id]) return fail('duplicate-id', `An entity with id ${e.id} already exists.`);
        const layer = doc.layers[e.layer];
        if (!layer) return fail('unknown-layer', `Layer "${e.layer}" does not exist.`, 'Pick an existing layer or create it first.');
        if (layer.locked) return fail('layer-locked', `Layer "${layer.name}" is locked.`, 'Unlock the layer in the Layers panel to draw on it.');
        entities[e.id] = e;
        entityOrder.push(e.id);
      }
      const order = cmd.order && cmd.order.length === entityOrder.length && cmd.order.every((id) => entities[id]) ? cmd.order : entityOrder;
      return { ok: true, doc: { ...doc, entities, entityOrder: order }, inverse: { kind: 'deleteEntities', ids: cmd.entities.map((e) => e.id) } };
    }
    case 'deleteEntities': {
      if (cmd.ids.length === 0) return fail('empty', 'Nothing selected.');
      const removed: Entity[] = [];
      const entities = { ...doc.entities };
      for (const id of cmd.ids) {
        const e = entities[id];
        if (!e) return fail('unknown-entity', `Entity ${id} does not exist.`);
        const layer = doc.layers[e.layer];
        if (layer?.locked) return fail('layer-locked', `Layer "${layer.name}" is locked.`, 'Unlock the layer in the Layers panel to edit it.');
        removed.push(e);
        delete entities[id];
      }
      const gone = new Set(cmd.ids);
      // Keep the removed entities in drawing order so undo puts them back in the same order.
      const ordered = doc.entityOrder.filter((id) => gone.has(id)).map((id) => doc.entities[id]);
      // Constraints that refer to a deleted entity go with it (and come back on undo).
      const goneConstraints = doc.constraintOrder.filter((cid) => constraintEntities(doc.constraints[cid]).some((eid) => gone.has(eid)));
      let next: Document = { ...doc, entities, entityOrder: doc.entityOrder.filter((id) => !gone.has(id)) };
      if (goneConstraints.length) {
        const constraints = { ...doc.constraints };
        for (const cid of goneConstraints) delete constraints[cid];
        const gc = new Set(goneConstraints);
        next = { ...next, constraints, constraintOrder: doc.constraintOrder.filter((cid) => !gc.has(cid)) };
        return { ok: true, doc: next, inverse: { kind: 'batch', label: 'deleteEntities', commands: [{ kind: 'addEntities', entities: ordered, order: doc.entityOrder }, { kind: 'addConstraints', constraints: goneConstraints.map((cid) => doc.constraints[cid]), order: doc.constraintOrder }] } };
      }
      return { ok: true, doc: next, inverse: { kind: 'addEntities', entities: ordered, order: doc.entityOrder } };
    }
    case 'updateEntities': {
      if (cmd.entities.length === 0) return fail('empty', 'Nothing to change.');
      const entities = { ...doc.entities };
      const previous: Entity[] = [];
      for (const e of cmd.entities) {
        const old = entities[e.id];
        if (!old) return fail('unknown-entity', `Entity ${e.id} does not exist.`);
        if (!doc.layers[e.layer]) return fail('unknown-layer', `Layer "${e.layer}" does not exist.`);
        const layer = doc.layers[old.layer];
        if (layer?.locked) return fail('layer-locked', `Layer "${layer.name}" is locked.`, 'Unlock the layer in the Layers panel to edit it.');
        previous.push(old);
        entities[e.id] = e;
      }
      return { ok: true, doc: { ...doc, entities }, inverse: { kind: 'updateEntities', entities: previous } };
    }
    case 'addLayer': {
      if (doc.layers[cmd.layer.id]) return fail('duplicate-id', `A layer with id ${cmd.layer.id} already exists.`);
      const layerOrder = [...doc.layerOrder];
      layerOrder.splice(cmd.index ?? layerOrder.length, 0, cmd.layer.id);
      return { ok: true, doc: { ...doc, layers: { ...doc.layers, [cmd.layer.id]: cmd.layer }, layerOrder }, inverse: { kind: 'deleteLayer', id: cmd.layer.id } };
    }
    case 'deleteLayer': {
      const layer = doc.layers[cmd.id];
      if (!layer) return fail('unknown-layer', `Layer "${cmd.id}" does not exist.`);
      if (doc.layerOrder.length === 1) return fail('last-layer', 'A drawing needs at least one layer.');
      if (doc.entityOrder.some((id) => doc.entities[id]?.layer === cmd.id)) return fail('layer-not-empty', `Layer "${layer.name}" still has entities.`, 'Move or delete them first.');
      const layers = { ...doc.layers };
      delete layers[cmd.id];
      const index = doc.layerOrder.indexOf(cmd.id);
      const layerOrder = doc.layerOrder.filter((id) => id !== cmd.id);
      const activeLayer = doc.activeLayer === cmd.id ? layerOrder[0] : doc.activeLayer;
      const next = { ...doc, layers, layerOrder, activeLayer };
      const inverse: Command = doc.activeLayer === cmd.id ? { kind: 'batch', label: 'deleteLayer', commands: [{ kind: 'addLayer', layer, index }, { kind: 'setActiveLayer', id: cmd.id }] } : { kind: 'addLayer', layer, index };
      return { ok: true, doc: next, inverse };
    }
    case 'updateLayer': {
      const old = doc.layers[cmd.layer.id];
      if (!old) return fail('unknown-layer', `Layer "${cmd.layer.id}" does not exist.`);
      return { ok: true, doc: { ...doc, layers: { ...doc.layers, [cmd.layer.id]: cmd.layer } }, inverse: { kind: 'updateLayer', layer: old } };
    }
    case 'setActiveLayer': {
      if (!doc.layers[cmd.id]) return fail('unknown-layer', `Layer "${cmd.id}" does not exist.`);
      return { ok: true, doc: { ...doc, activeLayer: cmd.id }, inverse: { kind: 'setActiveLayer', id: doc.activeLayer } };
    }
    case 'setProps': {
      const previous: typeof cmd.props = {};
      for (const k of Object.keys(cmd.props) as (keyof typeof cmd.props)[]) {
        const v = doc[k];
        if (v !== undefined) (previous as Record<string, unknown>)[k] = v;
      }
      return { ok: true, doc: { ...doc, ...cmd.props }, inverse: { kind: 'setProps', props: previous } };
    }
    case 'batch': {
      let cur = doc;
      const inverses: Command[] = [];
      for (const c of cmd.commands) {
        const r = apply(cur, c);
        if (!r.ok) return r;
        cur = r.doc;
        inverses.push(r.inverse);
      }
      return { ok: true, doc: cur, inverse: { kind: 'batch', label: cmd.label, commands: inverses.reverse() } };
    }
    case 'replaceDocument':
      return { ok: true, doc: cmd.doc, inverse: { kind: 'replaceDocument', doc } };
    case 'setDimStyle':
      return { ok: true, doc: { ...doc, dimStyle: cmd.style }, inverse: { kind: 'setDimStyle', style: doc.dimStyle } };
    case 'addSheet': {
      if (doc.sheets[cmd.sheet.id]) return fail('duplicate-id', `A sheet with id ${cmd.sheet.id} already exists.`);
      const sheetOrder = [...doc.sheetOrder];
      sheetOrder.splice(cmd.index ?? sheetOrder.length, 0, cmd.sheet.id);
      return { ok: true, doc: { ...doc, sheets: { ...doc.sheets, [cmd.sheet.id]: cmd.sheet }, sheetOrder }, inverse: { kind: 'deleteSheet', id: cmd.sheet.id } };
    }
    case 'deleteSheet': {
      const sheet = doc.sheets[cmd.id];
      if (!sheet) return fail('unknown-sheet', `Sheet "${cmd.id}" does not exist.`);
      const sheets = { ...doc.sheets };
      delete sheets[cmd.id];
      const index = doc.sheetOrder.indexOf(cmd.id);
      return { ok: true, doc: { ...doc, sheets, sheetOrder: doc.sheetOrder.filter((id) => id !== cmd.id) }, inverse: { kind: 'addSheet', sheet, index } };
    }
    case 'updateSheet': {
      const old = doc.sheets[cmd.sheet.id];
      if (!old) return fail('unknown-sheet', `Sheet "${cmd.sheet.id}" does not exist.`);
      return { ok: true, doc: { ...doc, sheets: { ...doc.sheets, [cmd.sheet.id]: cmd.sheet } }, inverse: { kind: 'updateSheet', sheet: old } };
    }
    case 'addConstraints': {
      if (cmd.constraints.length === 0) return fail('empty', 'Nothing to add.');
      const constraints = { ...doc.constraints };
      const constraintOrder = [...doc.constraintOrder];
      for (const c of cmd.constraints) {
        if (constraints[c.id]) return fail('duplicate-id', `A constraint with id ${c.id} already exists.`);
        for (const eid of constraintEntities(c)) if (!doc.entities[eid]) return fail('unknown-entity', `Entity ${eid} does not exist.`);
        constraints[c.id] = c;
        constraintOrder.push(c.id);
      }
      const order = cmd.order && cmd.order.length === constraintOrder.length && cmd.order.every((id) => constraints[id]) ? cmd.order : constraintOrder;
      return { ok: true, doc: { ...doc, constraints, constraintOrder: order }, inverse: { kind: 'deleteConstraints', ids: cmd.constraints.map((c) => c.id) } };
    }
    case 'deleteConstraints': {
      if (cmd.ids.length === 0) return fail('empty', 'Nothing selected.');
      const constraints = { ...doc.constraints };
      for (const id of cmd.ids) {
        if (!constraints[id]) return fail('unknown-constraint', `Constraint ${id} does not exist.`);
        delete constraints[id];
      }
      const gone = new Set(cmd.ids);
      const removed = doc.constraintOrder.filter((id) => gone.has(id)).map((id) => doc.constraints[id]);
      return { ok: true, doc: { ...doc, constraints, constraintOrder: doc.constraintOrder.filter((id) => !gone.has(id)) }, inverse: { kind: 'addConstraints', constraints: removed, order: doc.constraintOrder } };
    }
    case 'updateConstraints': {
      if (cmd.constraints.length === 0) return fail('empty', 'Nothing to change.');
      const constraints = { ...doc.constraints };
      const previous: Constraint[] = [];
      for (const c of cmd.constraints) {
        const old = constraints[c.id];
        if (!old) return fail('unknown-constraint', `Constraint ${c.id} does not exist.`);
        previous.push(old);
        constraints[c.id] = c;
      }
      return { ok: true, doc: { ...doc, constraints }, inverse: { kind: 'updateConstraints', constraints: previous } };
    }
  }
}

/** The entity ids a constraint refers to. */
export function constraintEntities(c: Constraint): Id[] {
  switch (c.kind) {
    case 'coincident':
    case 'distance':
      return [c.p1.entity, c.p2.entity];
    case 'pointOnLine':
    case 'pointLineDistance':
      return [c.p.entity, c.line];
    case 'symmetric':
      return [c.p1.entity, c.p2.entity, c.line];
    case 'horizontal':
    case 'vertical':
    case 'fixed':
    case 'radius':
      return [c.entity];
    case 'parallel':
    case 'perpendicular':
    case 'tangent':
    case 'equal':
    case 'angle':
      return [c.a, c.b];
  }
}

/** A short English label for the history (translated by the UI with t()). */
export function labelOf(cmd: Command): string {
  switch (cmd.kind) {
    case 'addEntities':
      return cmd.entities.length === 1 ? `Add ${cmd.entities[0].type}` : `Add ${cmd.entities.length} entities`;
    case 'deleteEntities':
      return cmd.ids.length === 1 ? 'Delete entity' : `Delete ${cmd.ids.length} entities`;
    case 'updateEntities':
      return cmd.entities.length === 1 ? `Edit ${cmd.entities[0].type}` : `Edit ${cmd.entities.length} entities`;
    case 'addLayer':
      return `Add layer ${cmd.layer.name}`;
    case 'deleteLayer':
      return 'Delete layer';
    case 'updateLayer':
      return `Edit layer ${cmd.layer.name}`;
    case 'setActiveLayer':
      return 'Set active layer';
    case 'setProps':
      return 'Edit drawing properties';
    case 'batch':
      return cmd.label;
    case 'replaceDocument':
      return `Open ${cmd.doc.name}`;
    case 'setDimStyle':
      return 'Edit dimension style';
    case 'addSheet':
      return `Add sheet ${cmd.sheet.name}`;
    case 'deleteSheet':
      return 'Delete sheet';
    case 'updateSheet':
      return `Edit sheet ${cmd.sheet.name}`;
    case 'addConstraints':
      return cmd.constraints.length === 1 ? `Add ${cmd.constraints[0].kind} constraint` : `Add ${cmd.constraints.length} constraints`;
    case 'deleteConstraints':
      return cmd.ids.length === 1 ? 'Delete constraint' : `Delete ${cmd.ids.length} constraints`;
    case 'updateConstraints':
      return cmd.constraints.length === 1 ? `Edit ${cmd.constraints[0].kind} constraint` : `Edit ${cmd.constraints.length} constraints`;
  }
}
