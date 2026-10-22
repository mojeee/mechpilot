// What an assistant proposal changes, computed by comparing the current document with the preview
// document (the proposal's commands dry-run with `apply`). The card shows it as a compact diff; the
// 2D overlay draws the added / changed / deleted entities; the 3D overlay rebuilds the parts whose
// features change.

import { t } from '@shared/i18n';
import type { Document, Entity, EntityType, Feature, HoleSpec, Id } from '@shared/doc/types';
import { formatLength } from '@shared/units';

export interface FeatureChange {
  kind: 'added' | 'changed' | 'deleted';
  partId: Id;
  partName: string;
  /** One line in plain words: "Extrude “Extrude 1”: 10 mm, add". */
  text: string;
}

export interface ProposalDiff {
  added: Id[];
  changed: Id[];
  deleted: Id[];
  /** Parts whose feature list (or the entities of their sketches) changes. */
  parts: Id[];
  features: FeatureChange[];
  sheets: { added: number; changed: number; deleted: number };
  /** Other document changes (layers, properties, dimension style, constraints): a short note each. */
  other: string[];
}

const ENTITY_WORDS: Record<EntityType, () => [string, string]> = {
  line: () => [t('{n} line'), t('{n} lines')],
  circle: () => [t('{n} circle'), t('{n} circles')],
  arc: () => [t('{n} arc'), t('{n} arcs')],
  polyline: () => [t('{n} polyline'), t('{n} polylines')],
  ellipse: () => [t('{n} ellipse'), t('{n} ellipses')],
  spline: () => [t('{n} spline'), t('{n} splines')],
  text: () => [t('{n} text'), t('{n} texts')],
  dimension: () => [t('{n} dimension'), t('{n} dimensions')],
  note: () => [t('{n} note'), t('{n} notes')],
  balloon: () => [t('{n} balloon'), t('{n} balloons')],
  surface: () => [t('{n} surface symbol'), t('{n} surface symbols')],
  gdt: () => [t('{n} tolerance frame'), t('{n} tolerance frames')],
  datum: () => [t('{n} datum'), t('{n} datums')],
};

/** "3 lines, 1 arc": the entities grouped by type, in a fixed order. */
export function entitiesLabel(entities: Entity[]): string {
  const counts = new Map<EntityType, number>();
  for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const parts: string[] = [];
  for (const type of Object.keys(ENTITY_WORDS) as EntityType[]) {
    const n = counts.get(type);
    if (!n) continue;
    const [one, many] = ENTITY_WORDS[type]();
    parts.push((n === 1 ? one : many).replace('{n}', String(n)));
  }
  return parts.join(', ') || t('nothing');
}

function holeText(spec: HoleSpec): string {
  if (spec.kind === 'simple') return `Ø${formatLength(spec.diameter)}`;
  if (spec.kind === 'clearance') return t('{thread} clearance ({series})', { thread: spec.thread, series: spec.series });
  return t('{thread} tapped', { thread: spec.thread });
}

/** The values that matter for a feature, in a few words. */
export function featureValues(f: Feature): string {
  switch (f.kind) {
    case 'sketch':
      return t('{plane} plane, offset {offset}, {n} entities', { plane: f.plane, offset: formatLength(f.offset), n: f.entities.length });
    case 'extrude':
      return `${formatLength(f.distance)}, ${f.op === 'cut' ? t('cut') : t('add')}${f.direction === 'normal' ? '' : `, ${f.direction === 'both' ? t('both sides') : t('reversed')}`}`;
    case 'revolve':
      return `${f.angle}°, ${f.op === 'cut' ? t('cut') : t('add')}`;
    case 'hole':
      return `${holeText(f.spec)}, ${f.depth === 'through' ? t('through') : formatLength(f.depth)}`;
    case 'fillet':
      return `R${formatLength(f.radius)}`;
    case 'chamfer':
      return `${formatLength(f.distance)}`;
    case 'shell':
      return t('wall {t}', { t: formatLength(f.thickness) });
    case 'mirror':
      return t('{plane} plane', { plane: f.plane });
    case 'pattern':
      return f.mode === 'linear' ? `${f.counts[0]} × ${f.counts[1]}, ${formatLength(f.spacing[0])} × ${formatLength(f.spacing[1])}` : `${f.count} × ${f.angle}° ${f.axis}`;
    case 'import':
      return f.sourceName;
    default:
      return '';
  }
}

export function featureKindWord(kind: Feature['kind']): string {
  switch (kind) {
    case 'sketch':
      return t('Sketch');
    case 'extrude':
      return t('Extrude');
    case 'revolve':
      return t('Revolve');
    case 'hole':
      return t('Hole');
    case 'fillet':
      return t('Fillet');
    case 'chamfer':
      return t('Chamfer');
    case 'shell':
      return t('Shell');
    case 'mirror':
      return t('Mirror');
    case 'pattern':
      return t('Pattern');
    case 'import':
      return t('Import');
    default:
      return '';
  }
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function proposalDiff(base: Document, next: Document, touches: Id[] = []): ProposalDiff {
  const added: Id[] = [];
  const changed: Id[] = [];
  const deleted: Id[] = [];
  if (next.entities !== base.entities) {
    for (const id of next.entityOrder) {
      const b = base.entities[id];
      if (!b) added.push(id);
      else if (b !== next.entities[id] && !same(b, next.entities[id])) changed.push(id);
    }
    for (const id of base.entityOrder) if (!next.entities[id]) deleted.push(id);
  }
  // The model may name entities it changed; keep those that exist on both sides.
  const known = new Set([...added, ...changed]);
  for (const id of touches) if (!known.has(id) && base.entities[id] && next.entities[id]) {
    changed.push(id);
    known.add(id);
  }

  const parts = new Set<Id>();
  const features: FeatureChange[] = [];
  const touchedEntities = new Set([...changed, ...deleted]);
  if (next.parts !== base.parts) {
    for (const pid of next.partOrder) {
      const np = next.parts[pid];
      const bp = base.parts[pid];
      if (bp === np) continue;
      const before = new Map((bp?.features ?? []).map((f) => [f.id, f]));
      const after = new Set(np.features.map((f) => f.id));
      for (const f of np.features) {
        const old = before.get(f.id);
        if (!old) features.push({ kind: 'added', partId: pid, partName: np.name, text: `${featureKindWord(f.kind)} “${f.name}”: ${featureValues(f)}` });
        else if (!same(old, f)) {
          const a = featureValues(old);
          const b = featureValues(f);
          features.push({ kind: 'changed', partId: pid, partName: np.name, text: `${featureKindWord(f.kind)} “${f.name}”: ${a === b ? t('changed') : `${a} → ${b}`}` });
        }
      }
      for (const f of bp?.features ?? []) if (!after.has(f.id)) features.push({ kind: 'deleted', partId: pid, partName: np.name, text: `${featureKindWord(f.kind)} “${f.name}”` });
      if (!bp || !same(bp, np)) parts.add(pid);
    }
    for (const pid of base.partOrder) if (!next.parts[pid]) parts.add(pid);
  }
  // A part whose sketch entities move or disappear changes too.
  if (touchedEntities.size) {
    for (const pid of next.partOrder) {
      const p = next.parts[pid];
      if (p.features.some((f) => f.kind === 'sketch' && f.entities.some((id) => touchedEntities.has(id)))) parts.add(pid);
    }
  }

  const sheets = { added: 0, changed: 0, deleted: 0 };
  if (next.sheets !== base.sheets) {
    for (const id of next.sheetOrder) {
      if (!base.sheets[id]) sheets.added++;
      else if (base.sheets[id] !== next.sheets[id] && !same(base.sheets[id], next.sheets[id])) sheets.changed++;
    }
    for (const id of base.sheetOrder) if (!next.sheets[id]) sheets.deleted++;
  }

  const other: string[] = [];
  if (next.layers !== base.layers && !same(next.layers, base.layers)) other.push(t('layers'));
  if (next.constraints !== base.constraints && !same(next.constraints, base.constraints)) other.push(t('constraints'));
  if (next.dimStyle !== base.dimStyle && !same(next.dimStyle, base.dimStyle)) other.push(t('dimension style'));
  if (next.name !== base.name || next.standard !== base.standard || next.projection !== base.projection || next.description !== base.description) other.push(t('drawing properties'));

  return { added, changed, deleted, parts: [...parts], features, sheets, other };
}

/** "+4 circles · 1 changed · 2 deleted" for the card header. */
export function entityDiffLine(diff: ProposalDiff, next: Document, base: Document): string[] {
  const out: string[] = [];
  if (diff.added.length) out.push(`+ ${entitiesLabel(diff.added.map((id) => next.entities[id]))}`);
  if (diff.changed.length) out.push(`~ ${t('{what} changed', { what: entitiesLabel(diff.changed.map((id) => next.entities[id])) })}`);
  if (diff.deleted.length) out.push(`− ${t('{what} deleted', { what: entitiesLabel(diff.deleted.map((id) => base.entities[id])) })}`);
  if (diff.sheets.added) out.push(`+ ${t('{n} sheets', { n: diff.sheets.added })}`);
  if (diff.sheets.changed) out.push(`~ ${t('{n} sheets changed', { n: diff.sheets.changed })}`);
  if (diff.sheets.deleted) out.push(`− ${t('{n} sheets deleted', { n: diff.sheets.deleted })}`);
  if (diff.other.length) out.push(`~ ${diff.other.join(', ')}`);
  return out;
}
