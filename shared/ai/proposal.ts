// Server-side validation of the assistant's proposals (product rule 7: propose, never edit; and
// rule 5: no dead ends). A proposal reaches the user only after its commands have been dry-run
// with the real command layer on a copy of the document and the result has passed the file
// format's own validation. On any problem the model gets the reason in plain words and fixes it.
//
// What is filled in for the model (docs/assistant.md, "Proposals"):
// - ids: a new entity, constraint, part, feature, sheet, view or layer without an id, or with an
//   id that already exists, gets a fresh randomId(); later references in the same proposal to an
//   id that was replaced follow the new id;
// - layers: a new entity without a layer goes on the "dimensions" layer for annotations (when it
//   exists) and on the active layer otherwise;
// - updates are patches: updateEntities / updateConstraints / updateLayer / updateSheet /
//   updatePart / setDimStyle merge the given fields onto the current object (null removes an
//   optional field); updatePart's feature list is the complete new list, and each entry that
//   names an existing feature is merged onto it;
// - the commands the UI receives are the validated, normalized objects (no stray keys);
// - touches: every entity and part added, changed or deleted, plus parts whose sketches use a
//   touched entity.

import type { Claim, ClaimSource, Proposal } from './types';
import { apply, type Command, type CommandKind } from '../commands';
import type { Document, Entity, Feature, Id, Part } from '../doc/types';
import { ANNOTATION_TYPES } from '../doc/types';
import { validate } from '../doc/file';
import { buildProfile } from '../cad/profile';
import { dimensionValue } from '../draw/annotations';
import { fitDeviations } from '../fits';
import { randomId, type IdGen } from '../ids';
import { CLEARANCE_THREADS, TAP_THREADS } from './tools';

export type ProposalCheck =
  | { ok: true; proposal: Proposal; /** The document with this proposal applied. */ doc: Document; /** Ids the model gave that were replaced: given → final. */ renamed: Record<string, string>; /** Ids that were generated for objects the model left without one. */ created: Id[] }
  | { ok: false; error: string };

const ALLOWED: ReadonlySet<CommandKind> = new Set<CommandKind>([
  'addEntities',
  'deleteEntities',
  'updateEntities',
  'addLayer',
  'deleteLayer',
  'updateLayer',
  'setActiveLayer',
  'setProps',
  'batch',
  'setDimStyle',
  'addSheet',
  'deleteSheet',
  'updateSheet',
  'addConstraints',
  'deleteConstraints',
  'updateConstraints',
  'addPart',
  'deletePart',
  'updatePart',
]);

const MAX_COMMANDS = 400;
const MAX_NEW_OBJECTS = 20000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const hasId = (v: Obj): boolean => isStr(v.id) && v.id.trim() !== '';

/** {...base, ...patch}, where a null in the patch removes the key. */
function merge<T extends object>(base: T, patch: Obj): T {
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** Keys whose string values (or string-array values) are ids of other objects. */
const REF_KEYS = new Set(['entity', 'line', 'a', 'b', 'sketch', 'id', 'layer', 'partId', 'sheetId']);
const REF_LIST_KEYS = new Set(['entities', 'ids', 'order']);

function remapRefs(v: unknown, map: Map<string, string>): unknown {
  if (map.size === 0) return v;
  if (Array.isArray(v)) return v.map((x) => remapRefs(x, map));
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) {
    if (REF_KEYS.has(k) && isStr(x)) out[k] = map.get(x) ?? x;
    else if (REF_LIST_KEYS.has(k) && Array.isArray(x)) out[k] = x.map((y) => (isStr(y) ? (map.get(y) ?? y) : remapRefs(y, map)));
    else out[k] = remapRefs(x, map);
  }
  return out;
}

/** Flatten nested batches: the proposal itself becomes one undo step in the UI. */
function flatten(cmds: unknown[]): unknown[] {
  return cmds.flatMap((c) => (isObj(c) && c.kind === 'batch' && Array.isArray(c.commands) ? flatten(c.commands) : [c]));
}

export function parseClaims(v: unknown): Claim[] {
  if (!Array.isArray(v)) return [];
  const out: Claim[] = [];
  for (const c of v) {
    if (!isObj(c) || !isStr(c.text) || !c.text.trim()) continue;
    const s = isObj(c.source) ? c.source : {};
    let source: ClaimSource = { kind: 'suggestion' };
    // A claim whose source is incomplete is shown as a suggestion: never a stronger source than given.
    if (s.kind === 'measured' && isStr(s.what) && s.what) source = { kind: 'measured', what: s.what };
    else if (s.kind === 'standard' && isStr(s.standard) && s.standard) source = { kind: 'standard', standard: s.standard, ...(isStr(s.clause) && s.clause ? { clause: s.clause } : {}) };
    else if (s.kind === 'library' && isStr(s.file) && s.file && isStr(s.entry) && s.entry) source = { kind: 'library', file: s.file, entry: s.entry };
    out.push({ text: c.text.trim(), source });
  }
  return out;
}

interface Ctx {
  doc: Document;
  newId: IdGen;
  renamed: Map<string, string>;
  created: Id[];
  count: number;
}

/** A fresh id not used in `taken`. */
function fresh(ctx: Ctx, taken: (id: string) => boolean): string {
  for (;;) {
    const id = ctx.newId();
    if (!taken(id)) return id;
  }
}

/** Give `o` an id: keep the model's when it is free, else a new one (remembered for later references). */
function claimId(ctx: Ctx, o: Obj, taken: (id: string) => boolean, used: Set<string>): void {
  const isTaken = (id: string) => taken(id) || used.has(id);
  if (!hasId(o)) {
    o.id = fresh(ctx, isTaken);
    ctx.created.push(o.id as string);
  } else if (isTaken(o.id as string)) {
    const id = fresh(ctx, isTaken);
    ctx.renamed.set(o.id as string, id);
    o.id = id;
  }
  used.add(o.id as string);
}

function fillFeatures(ctx: Ctx, list: unknown, old: Feature[] = []): { features?: Feature[]; error?: string } {
  if (list === undefined) return { features: old };
  if (!Array.isArray(list)) return { error: 'features must be a list' };
  const used = new Set<string>();
  const features: Feature[] = [];
  list.forEach((raw, i) => {
    if (!isObj(raw)) return;
    const prev = hasId(raw) ? old.find((f) => f.id === raw.id) : undefined;
    const f: Obj = prev ? merge(prev, raw) : { ...raw };
    if (!prev) claimId(ctx, f, () => false, used);
    else used.add(prev.id);
    if (!isStr(f.name) || !f.name) f.name = `${String(f.kind ?? 'feature')} ${i + 1}`;
    features.push(f as Feature);
  });
  return { features };
}

/** Make one command concrete against the current working document. Returns the command or an error. */
function prepare(ctx: Ctx, raw: Obj): Command | string {
  const doc = ctx.doc;
  const cmd = remapRefs(raw, ctx.renamed) as Obj;
  switch (cmd.kind) {
    case 'addEntities': {
      if (!Array.isArray(cmd.entities) || cmd.entities.length === 0) return 'addEntities needs a non-empty "entities" list';
      const used = new Set<string>();
      const entities = cmd.entities.map((e) => (isObj(e) ? { ...e } : e));
      for (const e of entities) {
        if (!isObj(e)) return 'every entity must be an object';
        claimId(ctx, e, (id) => !!doc.entities[id], used);
        if (!isStr(e.layer) || !e.layer) e.layer = ANNOTATION_TYPES.has(e.type as Entity['type']) && doc.layers.dimensions ? 'dimensions' : doc.activeLayer;
      }
      ctx.count += entities.length;
      return { kind: 'addEntities', entities: entities as Entity[] };
    }
    case 'updateEntities': {
      if (!Array.isArray(cmd.entities) || cmd.entities.length === 0) return 'updateEntities needs a non-empty "entities" list';
      const entities: Entity[] = [];
      for (const e of cmd.entities) {
        if (!isObj(e) || !hasId(e)) return 'every entity in updateEntities needs the id of an existing entity';
        const old = doc.entities[e.id as string];
        if (!old) return `entity "${String(e.id)}" does not exist (updateEntities can only change existing entities; use addEntities for new ones)`;
        if (isStr(e.type) && e.type !== old.type) return `entity "${old.id}" is a ${old.type}; to make it a ${e.type}, delete it and add a new entity`;
        entities.push(merge(old, e));
      }
      return { kind: 'updateEntities', entities };
    }
    case 'deleteEntities':
    case 'deleteConstraints': {
      const ids = Array.isArray(cmd.ids) ? cmd.ids.filter(isStr) : [];
      if (!ids.length) return `${cmd.kind} needs a non-empty "ids" list`;
      return { kind: cmd.kind, ids };
    }
    case 'addConstraints': {
      if (!Array.isArray(cmd.constraints) || cmd.constraints.length === 0) return 'addConstraints needs a non-empty "constraints" list';
      const used = new Set<string>();
      const constraints = cmd.constraints.map((c) => (isObj(c) ? { ...c } : c));
      for (const c of constraints) {
        if (!isObj(c)) return 'every constraint must be an object';
        claimId(ctx, c, (id) => !!doc.constraints[id], used);
      }
      ctx.count += constraints.length;
      return { kind: 'addConstraints', constraints: constraints as never };
    }
    case 'updateConstraints': {
      if (!Array.isArray(cmd.constraints) || cmd.constraints.length === 0) return 'updateConstraints needs a non-empty "constraints" list';
      const constraints = [];
      for (const c of cmd.constraints) {
        if (!isObj(c) || !hasId(c)) return 'every constraint in updateConstraints needs the id of an existing constraint';
        const old = doc.constraints[c.id as string];
        if (!old) return `constraint "${String(c.id)}" does not exist`;
        constraints.push(merge(old, c));
      }
      return { kind: 'updateConstraints', constraints };
    }
    case 'addLayer': {
      if (!isObj(cmd.layer)) return 'addLayer needs "layer"';
      const layer: Obj = { color: 'auto', lineType: '01.1', lineWidth: 0.25, visible: true, locked: false, ...cmd.layer };
      claimId(ctx, layer, (id) => !!doc.layers[id], new Set());
      if (!isStr(layer.name) || !layer.name) layer.name = layer.id;
      return { kind: 'addLayer', layer: layer as never, ...(typeof cmd.index === 'number' ? { index: cmd.index } : {}) };
    }
    case 'updateLayer': {
      if (!isObj(cmd.layer) || !hasId(cmd.layer)) return 'updateLayer needs "layer" with the id of an existing layer';
      const old = doc.layers[cmd.layer.id as string];
      if (!old) return `layer "${String(cmd.layer.id)}" does not exist`;
      return { kind: 'updateLayer', layer: merge(old, cmd.layer) };
    }
    case 'deleteLayer':
    case 'setActiveLayer':
    case 'deleteSheet':
    case 'deletePart':
      if (!isStr(cmd.id) || !cmd.id) return `${cmd.kind} needs "id"`;
      return { kind: cmd.kind, id: cmd.id };
    case 'setProps': {
      if (!isObj(cmd.props)) return 'setProps needs "props"';
      const props: Obj = {};
      for (const k of ['name', 'description', 'standard', 'projection']) if (cmd.props[k] !== undefined) props[k] = cmd.props[k];
      return { kind: 'setProps', props };
    }
    case 'setDimStyle': {
      if (!isObj(cmd.style)) return 'setDimStyle needs "style"';
      return { kind: 'setDimStyle', style: merge(doc.dimStyle, cmd.style) };
    }
    case 'addSheet': {
      if (!isObj(cmd.sheet)) return 'addSheet needs "sheet"';
      const s: Obj = { ...cmd.sheet };
      claimId(ctx, s, (id) => !!doc.sheets[id], new Set());
      if (!isStr(s.name) || !s.name) s.name = `Sheet ${doc.sheetOrder.length + 1}`;
      if (s.orientation === undefined) s.orientation = s.size === 'A4' ? 'portrait' : 'landscape';
      if (!isObj(s.titleBlock)) s.titleBlock = {};
      const used = new Set<string>();
      s.views = (Array.isArray(s.views) ? s.views : []).map((v, i) => {
        if (!isObj(v)) return v;
        const view: Obj = { label: true, ...v };
        claimId(ctx, view, () => false, used);
        if (!isStr(view.name) || !view.name) view.name = `View ${i + 1}`;
        return view;
      });
      return { kind: 'addSheet', sheet: s as never, ...(typeof cmd.index === 'number' ? { index: cmd.index } : {}) };
    }
    case 'updateSheet': {
      if (!isObj(cmd.sheet) || !hasId(cmd.sheet)) return 'updateSheet needs "sheet" with the id of an existing sheet';
      const old = doc.sheets[cmd.sheet.id as string];
      if (!old) return `sheet "${String(cmd.sheet.id)}" does not exist`;
      const s = merge(old, cmd.sheet);
      if (isObj(cmd.sheet.titleBlock)) s.titleBlock = merge(old.titleBlock, cmd.sheet.titleBlock);
      if (Array.isArray(cmd.sheet.views)) {
        const used = new Set<string>();
        s.views = cmd.sheet.views.map((v, i) => {
          if (!isObj(v)) return v;
          const prev = hasId(v) ? old.views.find((w) => w.id === v.id) : undefined;
          const view: Obj = prev ? (merge(prev, v) as unknown as Obj) : { label: true, ...v };
          if (!prev) claimId(ctx, view, () => false, used);
          else used.add(prev.id);
          if (!isStr(view.name) || !view.name) view.name = `View ${i + 1}`;
          return view;
        }) as never;
      }
      return { kind: 'updateSheet', sheet: s };
    }
    case 'addPart': {
      if (!isObj(cmd.part)) return 'addPart needs "part"';
      const p: Obj = { ...cmd.part };
      claimId(ctx, p, (id) => !!doc.parts[id], new Set());
      if (!isStr(p.name) || !p.name) p.name = `Part ${doc.partOrder.length + 1}`;
      const f = fillFeatures(ctx, p.features ?? [], []);
      if (f.error) return `addPart: ${f.error}`;
      p.features = f.features;
      return { kind: 'addPart', part: p as unknown as Part, ...(typeof cmd.index === 'number' ? { index: cmd.index } : {}) };
    }
    case 'updatePart': {
      if (!isObj(cmd.part) || !hasId(cmd.part)) return 'updatePart needs "part" with the id of an existing part';
      const old = doc.parts[cmd.part.id as string];
      if (!old) return `part "${String(cmd.part.id)}" does not exist`;
      const { features, dropFeatures, ...rest } = cmd.part;
      const p = merge(old, rest);
      if (features !== undefined) {
        const f = fillFeatures(ctx, features, old.features);
        if (f.error) return `updatePart: ${f.error}`;
        const kept = new Set((f.features ?? []).map((x) => x.id));
        const dropped = old.features.filter((x) => !kept.has(x.id)).map((x) => x.id);
        // Parametric history is never destroyed silently (product rule 4).
        if (dropped.length && dropFeatures !== true) return `updatePart would remove the features ${dropped.join(', ')} of part "${old.name}". Send the complete feature list (an unchanged feature can be just {"id": "..."}), or set "dropFeatures": true on the part if removing them is intended`;
        p.features = f.features ?? [];
      }
      return { kind: 'updatePart', part: p };
    }
    case 'replaceDocument':
      return 'replaceDocument is not available to the assistant: propose the specific changes instead';
    default:
      return `unknown command kind "${String(cmd.kind)}"; kinds: ${[...ALLOWED].filter((k) => k !== 'batch').join(', ')}`;
  }
}

/** Every sketch an extrude or revolve uses must be a closed profile; hole threads must be in the library. */
function semanticChecks(doc: Document, parts: Id[]): string | null {
  for (const pid of parts) {
    const part = doc.parts[pid];
    if (!part) continue;
    for (const f of part.features) {
      if (f.suppressed) continue;
      if (f.kind === 'extrude' || f.kind === 'revolve') {
        const sk = part.features.find((x) => x.id === f.sketch);
        if (sk?.kind === 'sketch') {
          const r = buildProfile(doc, sk);
          if (!r.ok) return `part "${part.name}", feature ${f.id} (${f.kind}) uses sketch ${sk.id}, which is not a closed profile: ${r.error.message}`;
        }
      }
      if (f.kind === 'hole') {
        const sk = part.features.find((x) => x.id === f.sketch);
        if (sk?.kind === 'sketch' && !sk.entities.some((id) => ['circle', 'line', 'polyline'].includes(doc.entities[id]?.type ?? ''))) return `part "${part.name}", hole ${f.id}: its sketch ${sk.id} has no circles, lines or polylines to place holes at`;
        const spec = f.spec;
        const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
        if (spec.kind === 'clearance' && !CLEARANCE_THREADS.some((x) => norm(x) === norm(spec.thread))) return `part "${part.name}", hole ${f.id}: no ISO 273 clearance hole for "${spec.thread}" in the library; threads: ${CLEARANCE_THREADS.join(', ')}`;
        if (spec.kind === 'tapped' && !TAP_THREADS.some((x) => norm(x) === norm(spec.thread))) return `part "${part.name}", hole ${f.id}: no tap drill for "${spec.thread}" in the library; threads: ${TAP_THREADS.join(', ')}`;
      }
    }
  }
  return null;
}

/** JSON with sorted keys, so two objects with the same values compare equal whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const same = (a: unknown, b: unknown): boolean => a === b || stable(a) === stable(b);

/**
 * Validate and normalize one proposal from the model against `base` (the snapshot, with any
 * earlier proposals of the same reply applied). Pure; `newId` is injectable for tests.
 */
export function validateProposal(base: Document, input: Record<string, unknown>, newId: IdGen = randomId): ProposalCheck {
  const title = isStr(input.title) ? input.title.trim().slice(0, 200) : '';
  if (!title) return { ok: false, error: 'the proposal needs a title' };
  const summary = isStr(input.summary) ? input.summary.trim() : '';
  if (!Array.isArray(input.commands) || input.commands.length === 0) return { ok: false, error: 'the proposal needs a non-empty "commands" list' };
  let rawCommands: unknown[];
  try {
    rawCommands = flatten(JSON.parse(JSON.stringify(input.commands)) as unknown[]);
  } catch {
    return { ok: false, error: 'the commands are not plain JSON' };
  }
  if (rawCommands.length > MAX_COMMANDS) return { ok: false, error: `too many commands (${rawCommands.length}; at most ${MAX_COMMANDS}): split the change into several proposals` };

  const ctx: Ctx = { doc: base, newId, renamed: new Map(), created: [], count: 0 };
  const commands: Command[] = [];
  for (let i = 0; i < rawCommands.length; i++) {
    const raw = rawCommands[i];
    const where = `command ${i + 1}`;
    if (!isObj(raw) || !isStr(raw.kind)) return { ok: false, error: `${where} must be an object with "kind"` };
    const cmd = prepare(ctx, raw);
    if (typeof cmd === 'string') return { ok: false, error: `${where} (${raw.kind}): ${cmd}` };
    if (ctx.count > MAX_NEW_OBJECTS) return { ok: false, error: `the proposal adds more than ${MAX_NEW_OBJECTS} objects: split it` };
    const r = apply(ctx.doc, cmd);
    if (!r.ok) return { ok: false, error: `${where} (${cmd.kind}): ${r.error.message}${r.error.hint ? ' ' + r.error.hint : ''}` };
    ctx.doc = r.doc;
    commands.push(cmd);
  }

  // The result must be a valid document by the file format's own rules (shapes, references).
  const checked = validate(JSON.parse(JSON.stringify(ctx.doc)) as Record<string, unknown>);
  if (typeof checked === 'string') return { ok: false, error: `the result would not be a valid drawing: ${checked}` };

  // What changed (for the preview) and which parts it affects.
  const applied = ctx.doc;
  const entities = new Set<Id>();
  for (const id of applied.entityOrder) if (!same(base.entities[id], applied.entities[id])) entities.add(id);
  for (const id of base.entityOrder) if (!checked.entities[id]) entities.add(id);
  const parts = new Set<Id>();
  for (const id of applied.partOrder) if (!same(base.parts[id], applied.parts[id])) parts.add(id);
  for (const id of base.partOrder) if (!checked.parts[id]) parts.add(id);
  for (const id of checked.partOrder) {
    const p = checked.parts[id];
    if (p.features.some((f) => f.kind === 'sketch' && f.entities.some((e) => entities.has(e)))) parts.add(id);
  }

  const problem = semanticChecks(checked, [...parts]);
  if (problem) return { ok: false, error: problem };

  // ISO 286 classes on new or changed dimensions must exist (product rule 6, "fits that do not exist").
  for (const id of entities) {
    const e = checked.entities[id];
    if (e?.type === 'dimension' && e.tolerance?.kind === 'fit' && !fitDeviations(e.tolerance.cls, dimensionValue(e)))
      return { ok: false, error: `dimension ${id}: the class ${e.tolerance.cls} at ${dimensionValue(e)} mm is not in MechPilot's ISO 286 data; pick a class the library has (check with the library tool)` };
  }

  let then: Proposal['then'];
  if (input.then !== undefined && input.then !== null) {
    const th = input.then;
    if (!isObj(th)) return { ok: false, error: '"then" must be an object' };
    const map = (id: unknown) => (isStr(id) ? (ctx.renamed.get(id) ?? id) : '');
    if (th.kind === 'exportPdf') {
      if (checked.sheetOrder.length === 0) return { ok: false, error: '"then": exportPdf needs a sheet in the drawing; add one with addSheet' };
      then = { kind: 'exportPdf' };
    } else if (th.kind === 'openPart') {
      const id = map(th.partId);
      if (!checked.parts[id]) return { ok: false, error: `"then": part "${String(th.partId)}" does not exist` };
      then = { kind: 'openPart', partId: id };
    } else if (th.kind === 'openSheet') {
      const id = map(th.sheetId);
      if (!checked.sheets[id]) return { ok: false, error: `"then": sheet "${String(th.sheetId)}" does not exist` };
      then = { kind: 'openSheet', sheetId: id };
    } else return { ok: false, error: `"then": unknown kind "${String(th.kind)}" (exportPdf, openPart, openSheet)` };
  }

  // The UI receives the normalized objects as the file format reads them (no stray keys).
  const clean = commands.map((c): Command => {
    switch (c.kind) {
      case 'addEntities':
      case 'updateEntities':
        return { ...c, entities: c.entities.map((e) => checked.entities[e.id] ?? e) };
      case 'addConstraints':
      case 'updateConstraints':
        return { ...c, constraints: c.constraints.map((x) => checked.constraints[x.id] ?? x) };
      case 'addPart':
      case 'updatePart':
        return { ...c, part: checked.parts[c.part.id] ?? c.part };
      case 'addSheet':
      case 'updateSheet':
        return { ...c, sheet: checked.sheets[c.sheet.id] ?? c.sheet };
      case 'addLayer':
      case 'updateLayer':
        return { ...c, layer: checked.layers[c.layer.id] ?? c.layer };
      default:
        return c;
    }
  });

  // The model's own touches are kept when they name something that exists before or after.
  if (isObj(input.touches)) {
    for (const id of Array.isArray(input.touches.entities) ? input.touches.entities : []) if (isStr(id) && (checked.entities[ctx.renamed.get(id) ?? id] || base.entities[id])) entities.add(ctx.renamed.get(id) ?? id);
    for (const id of Array.isArray(input.touches.parts) ? input.touches.parts : []) if (isStr(id) && (checked.parts[ctx.renamed.get(id) ?? id] || base.parts[id])) parts.add(ctx.renamed.get(id) ?? id);
  }

  const proposal: Proposal = {
    id: newId(),
    title,
    summary,
    commands: clean,
    claims: parseClaims(input.claims),
    touches: { entities: [...entities], parts: [...parts] },
    ...(then ? { then } : {}),
    state: 'pending',
  };
  return { ok: true, proposal, doc: checked, renamed: Object.fromEntries(ctx.renamed), created: ctx.created };
}
