// Features tab: the active part's feature tree (sketch, extrude, revolve, hole, fillet, chamfer,
// shell, mirror, pattern, import). Every change is a command (undoable) and triggers a rebuild in
// the kernel worker; a failed feature shows its reason in plain words under its row.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import type { EdgeSelector, FaceSelector, Feature, HoleSpec, Part, SketchPlane } from '@shared/doc/types';
import { randomId } from '@shared/ids';
import { parseLength } from '@shared/units';
import { useStore } from '../state/store';

function Num({ label, value, onCommit, unit = 'mm', min }: { label: string; value: number; onCommit: (v: number) => void; unit?: string; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseLength(text);
    if (v === null || (min !== undefined && v < min)) {
      setText(String(value));
      return;
    }
    if (v !== value) onCommit(v);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-unit">
        <input className="mono" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

function Str({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function Sel<T extends string>({ label, value, options, onCommit }: { label: string; value: T; options: [T, string][]; onCommit: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onCommit(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const PLANES: [SketchPlane, string][] = [
  ['XY', 'XY'],
  ['XZ', 'XZ'],
  ['YZ', 'YZ'],
];
const AXES: ['X' | 'Y' | 'Z', string][] = [
  ['X', 'X'],
  ['Y', 'Y'],
  ['Z', 'Z'],
];

export function featureKindLabel(kind: Feature['kind']): string {
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

function EdgeSel({ value, onCommit }: { value: EdgeSelector; onCommit: (v: EdgeSelector) => void }) {
  const kinds: [EdgeSelector['kind'], string][] = [
    ['all', t('All edges')],
    ['parallelTo', t('Edges parallel to an axis')],
    ['inPlane', t('Edges in a plane')],
    ['ofLength', t('Edges of a length')],
  ];
  const setKind = (k: EdgeSelector['kind']) => {
    if (k === 'all') onCommit({ kind: 'all' });
    else if (k === 'parallelTo') onCommit({ kind: 'parallelTo', axis: 'Z' });
    else if (k === 'inPlane') onCommit({ kind: 'inPlane', plane: 'XY', offset: 0 });
    else if (k === 'ofLength') onCommit({ kind: 'ofLength', length: 10 });
  };
  return (
    <>
      <Sel label={t('Edges')} value={value.kind} options={kinds} onCommit={setKind} />
      {value.kind === 'parallelTo' && <Sel label={t('Axis')} value={value.axis} options={AXES} onCommit={(axis) => onCommit({ ...value, axis })} />}
      {value.kind === 'inPlane' && (
        <>
          <Sel label={t('Plane')} value={value.plane} options={PLANES} onCommit={(plane) => onCommit({ ...value, plane })} />
          <Num label={t('Offset')} value={value.offset} onCommit={(offset) => onCommit({ ...value, offset })} />
        </>
      )}
      {value.kind === 'ofLength' && <Num label={t('Length')} value={value.length} min={0} onCommit={(length) => onCommit({ ...value, length })} />}
    </>
  );
}

function HoleSpecEditor({ value, onCommit }: { value: HoleSpec; onCommit: (v: HoleSpec) => void }) {
  const kinds: [HoleSpec['kind'], string][] = [
    ['simple', t('Plain hole')],
    ['clearance', t('Clearance hole (ISO 273)')],
    ['tapped', t('Tapped hole (tap drill)')],
  ];
  const setKind = (k: HoleSpec['kind']) => {
    if (k === 'simple') onCommit({ kind: 'simple', diameter: 6.6 });
    else if (k === 'clearance') onCommit({ kind: 'clearance', thread: 'M6', series: 'medium' });
    else onCommit({ kind: 'tapped', thread: 'M6' });
  };
  return (
    <>
      <Sel label={t('Type')} value={value.kind} options={kinds} onCommit={setKind} />
      {value.kind === 'simple' && <Num label={t('Diameter')} value={value.diameter} min={0.01} onCommit={(diameter) => onCommit({ ...value, diameter })} />}
      {value.kind !== 'simple' && <Str label={t('Thread')} value={value.thread} onCommit={(thread) => onCommit({ ...value, thread: thread.trim().toUpperCase() })} />}
      {value.kind === 'clearance' && (
        <Sel
          label={t('Series')}
          value={value.series}
          options={[
            ['fine', t('fine')],
            ['medium', t('medium')],
            ['coarse', t('coarse')],
          ]}
          onCommit={(series) => onCommit({ ...value, series })}
        />
      )}
    </>
  );
}

function FeatureEditor({ part, f }: { part: Part; f: Feature }) {
  const update = useStore((s) => s.updateFeature);
  const sketches = part.features.filter((x): x is Extract<Feature, { kind: 'sketch' }> => x.kind === 'sketch').map((x): [string, string] => [x.id, x.name]);
  const set = (patch: Partial<Feature>) => update(part.id, { ...f, ...patch } as Feature);
  switch (f.kind) {
    case 'sketch':
      return (
        <>
          <Sel label={t('Plane')} value={f.plane} options={PLANES} onCommit={(plane) => set({ plane })} />
          <Num label={t('Offset')} value={f.offset} onCommit={(offset) => set({ offset })} />
          <div className="dim small">{t('{n} entities from the model', { n: f.entities.length })}</div>
        </>
      );
    case 'extrude':
      return (
        <>
          <Sel label={t('Sketch')} value={f.sketch} options={sketches} onCommit={(sketch) => set({ sketch })} />
          <Num label={t('Distance')} value={f.distance} min={0.001} onCommit={(distance) => set({ distance })} />
          <Sel
            label={t('Direction')}
            value={f.direction}
            options={[
              ['normal', t('Along the normal')],
              ['reverse', t('Opposite')],
              ['both', t('Both sides')],
            ]}
            onCommit={(direction) => set({ direction })}
          />
          <Sel
            label={t('Operation')}
            value={f.op}
            options={[
              ['add', t('Add')],
              ['cut', t('Cut')],
            ]}
            onCommit={(op) => set({ op })}
          />
        </>
      );
    case 'revolve':
      return (
        <>
          <Sel label={t('Sketch')} value={f.sketch} options={sketches} onCommit={(sketch) => set({ sketch })} />
          <Num label={t('Axis x1')} value={f.axis.a.x} onCommit={(x) => set({ axis: { ...f.axis, a: { ...f.axis.a, x } } })} />
          <Num label={t('Axis y1')} value={f.axis.a.y} onCommit={(y) => set({ axis: { ...f.axis, a: { ...f.axis.a, y } } })} />
          <Num label={t('Axis x2')} value={f.axis.b.x} onCommit={(x) => set({ axis: { ...f.axis, b: { ...f.axis.b, x } } })} />
          <Num label={t('Axis y2')} value={f.axis.b.y} onCommit={(y) => set({ axis: { ...f.axis, b: { ...f.axis.b, y } } })} />
          <Num label={t('Angle')} value={f.angle} unit="°" min={0.001} onCommit={(angle) => set({ angle })} />
          <Sel
            label={t('Operation')}
            value={f.op}
            options={[
              ['add', t('Add')],
              ['cut', t('Cut')],
            ]}
            onCommit={(op) => set({ op })}
          />
        </>
      );
    case 'hole':
      return (
        <>
          <Sel label={t('Sketch')} value={f.sketch} options={sketches} onCommit={(sketch) => set({ sketch })} />
          <HoleSpecEditor value={f.spec} onCommit={(spec) => set({ spec })} />
          <label className="field">
            <span>{t('Through')}</span>
            <input type="checkbox" checked={f.depth === 'through'} onChange={(e) => set({ depth: e.target.checked ? 'through' : 10 })} />
          </label>
          {f.depth !== 'through' && <Num label={t('Depth')} value={f.depth} min={0.001} onCommit={(depth) => set({ depth })} />}
        </>
      );
    case 'fillet':
      return (
        <>
          <Num label={t('Radius')} value={f.radius} min={0.001} onCommit={(radius) => set({ radius })} />
          <EdgeSel value={f.edges} onCommit={(edges) => set({ edges })} />
        </>
      );
    case 'chamfer':
      return (
        <>
          <Num label={t('Distance')} value={f.distance} min={0.001} onCommit={(distance) => set({ distance })} />
          <EdgeSel value={f.edges} onCommit={(edges) => set({ edges })} />
        </>
      );
    case 'shell': {
      const face = f.faces[0];
      const dirs: [FaceSelector['kind'] | 'none', string][] = [
        ['none', t('Keep all faces (closed hollow)')],
        ['normal', t('Remove the face facing a direction')],
      ];
      return (
        <>
          <Num label={t('Thickness')} value={f.thickness} min={0.001} onCommit={(thickness) => set({ thickness })} />
          <Sel label={t('Open face')} value={face ? face.kind : 'none'} options={dirs} onCommit={(k) => set({ faces: k === 'none' ? [] : [{ kind: 'normal', direction: 'Z+' }] })} />
          {face && face.kind === 'normal' && (
            <Sel
              label={t('Direction')}
              value={face.direction}
              options={[
                ['X+', 'X+'],
                ['X-', 'X−'],
                ['Y+', 'Y+'],
                ['Y-', 'Y−'],
                ['Z+', 'Z+'],
                ['Z-', 'Z−'],
              ]}
              onCommit={(direction) => set({ faces: [{ kind: 'normal', direction }] })}
            />
          )}
        </>
      );
    }
    case 'mirror':
      return (
        <>
          <Sel label={t('Plane')} value={f.plane} options={PLANES} onCommit={(plane) => set({ plane })} />
          <Num label={t('Offset')} value={f.offset} onCommit={(offset) => set({ offset })} />
        </>
      );
    case 'pattern':
      if (f.mode === 'linear')
        return (
          <>
            <Sel
              label={t('Mode')}
              value={f.mode}
              options={[
                ['linear', t('Linear')],
                ['circular', t('Circular')],
              ]}
              onCommit={(mode) => (mode === 'circular' ? update(part.id, { id: f.id, name: f.name, suppressed: f.suppressed, kind: 'pattern', mode: 'circular', axis: 'Z', count: 6, angle: 360 }) : null)}
            />
            <Num label={t('Count along 1')} value={f.counts[0]} unit="" min={1} onCommit={(n) => set({ counts: [Math.round(n), f.counts[1]] })} />
            <Num label={t('Spacing 1')} value={f.spacing[0]} onCommit={(v) => set({ spacing: [v, f.spacing[1]] })} />
            <Sel label={t('Axis 1')} value={f.axes[0]} options={AXES} onCommit={(a) => set({ axes: [a, f.axes[1]] })} />
            <Num label={t('Count along 2')} value={f.counts[1]} unit="" min={1} onCommit={(n) => set({ counts: [f.counts[0], Math.round(n)] })} />
            <Num label={t('Spacing 2')} value={f.spacing[1]} onCommit={(v) => set({ spacing: [f.spacing[0], v] })} />
            <Sel label={t('Axis 2')} value={f.axes[1]} options={AXES} onCommit={(a) => set({ axes: [f.axes[0], a] })} />
          </>
        );
      return (
        <>
          <Sel
            label={t('Mode')}
            value={f.mode}
            options={[
              ['linear', t('Linear')],
              ['circular', t('Circular')],
            ]}
            onCommit={(mode) => (mode === 'linear' ? update(part.id, { id: f.id, name: f.name, suppressed: f.suppressed, kind: 'pattern', mode: 'linear', counts: [2, 1], spacing: [20, 20], axes: ['X', 'Y'] }) : null)}
          />
          <Sel label={t('Axis')} value={f.axis} options={AXES} onCommit={(axis) => set({ axis })} />
          <Num label={t('Count')} value={f.count} unit="" min={1} onCommit={(n) => set({ count: Math.round(n) })} />
          <Num label={t('Total angle')} value={f.angle} unit="°" min={0.001} onCommit={(angle) => set({ angle })} />
        </>
      );
    case 'import':
      return <div className="dim small">{t('STEP file {name} ({kb} kB)', { name: f.sourceName, kb: Math.round((f.data.length * 3) / 4 / 1024) })}</div>;
    default:
      return null;
  }
}

function AddFeatureMenu({ part }: { part: Part }) {
  const add = useStore((s) => s.addFeature);
  const say = useStore((s) => s.say);
  const sketches = part.features.filter((f) => f.kind === 'sketch');
  const lastSketch = sketches[sketches.length - 1];
  const n = (kind: Feature['kind']) => part.features.filter((f) => f.kind === kind).length + 1;
  const make = (kind: Feature['kind']) => {
    const id = randomId();
    const name = `${featureKindLabel(kind)} ${n(kind)}`;
    const needsSketch = kind === 'extrude' || kind === 'revolve' || kind === 'hole';
    if (needsSketch && !lastSketch) {
      say({ kind: 'warn', text: t('Add a sketch first: select a closed outline in Model and type SKETCH.') });
      return;
    }
    const sk = lastSketch?.id ?? '';
    let f: Feature;
    switch (kind) {
      case 'extrude':
        f = { id, name, kind, sketch: sk, distance: 10, direction: 'normal', op: part.features.some((x) => x.kind !== 'sketch') ? 'cut' : 'add' };
        break;
      case 'revolve':
        f = { id, name, kind, sketch: sk, axis: { a: { x: 0, y: 0 }, b: { x: 0, y: 1 } }, angle: 360, op: 'add' };
        break;
      case 'hole':
        f = { id, name, kind, sketch: sk, spec: { kind: 'clearance', thread: 'M6', series: 'medium' }, depth: 'through' };
        break;
      case 'fillet':
        f = { id, name, kind, edges: { kind: 'all' }, radius: 2 };
        break;
      case 'chamfer':
        f = { id, name, kind, edges: { kind: 'all' }, distance: 1 };
        break;
      case 'shell':
        f = { id, name, kind, thickness: 2, faces: [{ kind: 'normal', direction: 'Z+' }] };
        break;
      case 'mirror':
        f = { id, name, kind, plane: 'YZ', offset: 0 };
        break;
      case 'pattern':
        f = { id, name, kind, mode: 'linear', counts: [2, 1], spacing: [20, 20], axes: ['X', 'Y'] };
        break;
      default:
        return;
    }
    add(part.id, f);
  };
  const kinds: Feature['kind'][] = ['extrude', 'revolve', 'hole', 'fillet', 'chamfer', 'shell', 'mirror', 'pattern'];
  return (
    <div className="feature-add">
      {kinds.map((k) => (
        <button key={k} className="btn small" onClick={() => make(k)}>
          + {featureKindLabel(k)}
        </button>
      ))}
    </div>
  );
}

export function FeaturesPanel() {
  const doc = useStore((s) => s.editor.doc);
  const activePart = useStore((s) => s.activePart);
  const build = useStore((s) => s.build);
  const building = useStore((s) => s.building);
  const setActivePart = useStore((s) => s.setActivePart);
  const addPart = useStore((s) => s.addPart);
  const updatePart = useStore((s) => s.updatePart);
  const deletePart = useStore((s) => s.deletePart);
  const updateFeature = useStore((s) => s.updateFeature);
  const deleteFeature = useStore((s) => s.deleteFeature);
  const exportPart = useStore((s) => s.exportPart);
  const importStep = useStore((s) => s.importStepFile);
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const measure = useStore((s) => s.measure);
  const toggleMeasure = useStore((s) => s.toggleMeasure);
  const [open, setOpen] = useState<string | null>(null);
  const addReference = useStore((s) => s.assistant.addReference);
  const part = activePart ? doc.parts[activePart] : null;

  const move = (p: Part, i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= p.features.length) return;
    const fs = [...p.features];
    [fs[i], fs[j]] = [fs[j], fs[i]];
    updatePart({ ...p, features: fs });
  };

  return (
    <div className="features">
      <div className="layers-head">
        <strong>{t('Parts')}</strong>
        <span>
          <button className="btn small" onClick={() => setActivePart(addPart())} title={t('New empty part')}>
            + {t('Part')}
          </button>{' '}
          <button className="btn small" onClick={() => void importStep()} title={t('Import a STEP file as a new part')}>
            {t('Import STEP…')}
          </button>
        </span>
      </div>
      {doc.partOrder.length === 0 && <p className="dim small">{t('No part yet. Draw a closed outline in Model, select it and type SKETCH, then EXTRUDE.')}</p>}
      <ul className="part-list">
        {doc.partOrder.map((id) => (
          <li key={id} className={id === activePart ? 'on' : ''}>
            <button className="link" onClick={() => setActivePart(id)}>
              {doc.parts[id].name}
            </button>
            <span className="dim small"> {t('{n} features', { n: doc.parts[id].features.length })}</span>
            <button className="icon-btn to-chat" title={t('Add this part to the assistant chat')} aria-label={t('Add this part to the assistant chat')} onClick={() => addReference({ kind: 'part', partId: id, label: doc.parts[id].name })}>
              {t('→ chat')}
            </button>
          </li>
        ))}
      </ul>
      {part && (
        <>
          <hr />
          <Str label={t('Name')} value={part.name} onCommit={(name) => updatePart({ ...part, name })} />
          <Str label={t('Material')} value={part.material ?? ''} onCommit={(m) => updatePart(m ? { ...part, material: m } : { id: part.id, name: part.name, features: part.features })} />
          <div className="layers-head">
            <strong>{t('Features')}</strong>
            {building && <span className="dim">{t('Building…')}</span>}
            {build && !building && <span className="dim small">{t('{ms} ms', { ms: Math.round(build.ms) })}</span>}
          </div>
          <ol className="feature-list">
            {part.features.map((f, i) => {
              const st = build?.status[f.id];
              const errors = build?.errors.filter((e) => e.feature === f.id) ?? [];
              const cls = f.suppressed ? 'off' : st === 'failed' ? 'err' : st === 'skipped' ? 'skip' : '';
              return (
                <li key={f.id} className={`feature ${cls} ${open === f.id ? 'open' : ''}`}>
                  <div className="feature-row">
                    <button className="link grow" onClick={() => setOpen(open === f.id ? null : f.id)} title={featureKindLabel(f.kind)}>
                      <span className="feature-kind">{featureKindLabel(f.kind)}</span> {f.name}
                    </button>
                    <button className="icon-btn to-chat" title={t('Add this feature to the assistant chat')} aria-label={t('Add this feature to the assistant chat')} onClick={() => addReference({ kind: 'feature', partId: part.id, featureId: f.id, label: t('{feature} in {part}', { feature: f.name, part: part.name }) })}>
                      →
                    </button>
                    <button className="icon-btn" title={t('Move up')} onClick={() => move(part, i, -1)}>
                      ↑
                    </button>
                    <button className="icon-btn" title={t('Move down')} onClick={() => move(part, i, 1)}>
                      ↓
                    </button>
                    <button className="icon-btn" title={f.suppressed ? t('Unsuppress') : t('Suppress')} onClick={() => updateFeature(part.id, f.suppressed ? { ...f, suppressed: undefined } : { ...f, suppressed: true })}>
                      {f.suppressed ? '◌' : '●'}
                    </button>
                    <button className="icon-btn" title={t('Delete this feature')} onClick={() => deleteFeature(part.id, f.id)}>
                      ×
                    </button>
                  </div>
                  {errors.map((e, k) => (
                    <div key={k} className="feature-error">
                      {e.message}
                      {e.hint && <div className="dim small">{e.hint}</div>}
                    </div>
                  ))}
                  {open === f.id && (
                    <div className="feature-body">
                      <Str label={t('Name')} value={f.name} onCommit={(name) => updateFeature(part.id, { ...f, name })} />
                      <FeatureEditor part={part} f={f} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <AddFeatureMenu part={part} />
          <hr />
          <div className="layers-head">
            <strong>{t('View')}</strong>
          </div>
          <label className="field">
            <span>{t('Section')}</span>
            <select value={section ? section.plane : 'none'} onChange={(e) => setSection(e.target.value === 'none' ? null : { plane: e.target.value as SketchPlane, offset: section?.offset ?? 0 })}>
              <option value="none">{t('Off')}</option>
              {PLANES.map(([p]) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {section && <Num label={t('Section offset')} value={section.offset} onCommit={(offset) => setSection({ ...section, offset })} />}
          <label className="field">
            <span>{t('Measure')}</span>
            <input type="checkbox" checked={measure} onChange={toggleMeasure} />
          </label>
          {build?.properties && (
            <table className="props-table">
              <tbody>
                <tr>
                  <td>{t('Volume')}</td>
                  <td className="mono">{(build.properties.volume / 1000).toFixed(3)} cm³</td>
                </tr>
                <tr>
                  <td>{t('Surface')}</td>
                  <td className="mono">{(build.properties.area / 100).toFixed(2)} cm²</td>
                </tr>
                <tr>
                  <td>{t('Size')}</td>
                  <td className="mono">
                    {(build.properties.bbox.max[0] - build.properties.bbox.min[0]).toFixed(2)} × {(build.properties.bbox.max[1] - build.properties.bbox.min[1]).toFixed(2)} × {(build.properties.bbox.max[2] - build.properties.bbox.min[2]).toFixed(2)} mm
                  </td>
                </tr>
                <tr>
                  <td>{t('Centre of mass')}</td>
                  <td className="mono">{build.properties.centerOfMass.map((v) => v.toFixed(2)).join(', ')}</td>
                </tr>
              </tbody>
            </table>
          )}
          <div className="feature-add">
            <button className="btn small" onClick={() => void exportPart('step')}>
              {t('Export STEP…')}
            </button>
            <button className="btn small" onClick={() => void exportPart('stl')}>
              {t('Export STL…')}
            </button>
            <button className="btn small" onClick={() => void exportPart('3mf')}>
              {t('Export 3MF…')}
            </button>
            <button className="btn small danger" onClick={() => deletePart(part.id)}>
              {t('Delete part')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
