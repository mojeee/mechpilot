// Properties: the selected entity's values (editable, in mm), or the drawing's settings and the
// dimension style when nothing is selected. Every edit is a command.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import type { DimensionEntity, DimStyle, Entity, Projection, Standard, Tolerance } from '@shared/doc/types';
import { countByType } from '@shared/doc/document';
import { GDT_SYMBOLS } from '@shared/draw/annotations';
import { formatLength, parseLength } from '@shared/units';
import { useStore } from '../state/store';

/** A number field in mm: commits on Enter or blur, rejects what is not a length. */
function NumberField({ label, value, onCommit, min, unit = 'mm', allowNegative = true }: { label: string; value: number; onCommit: (v: number) => void; min?: number; unit?: string; allowNegative?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseLength(text);
    if (v === null || (min !== undefined && v < min) || (!allowNegative && min === undefined && v < 0)) {
      setText(String(value));
      useStore.getState().say({ kind: 'warn', text: t('"{text}" is not a valid length.', { text }), hint: t('Type a number in mm, for example 12.5') });
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

function TextField({ label, value, onCommit, placeholder, multiline }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      ) : (
        <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
    </label>
  );
}

function LayerField({ e }: { e: Entity }) {
  const s = useStore();
  const doc = s.editor.doc;
  return (
    <label className="field">
      <span>{t('Layer')}</span>
      <select value={e.layer} onChange={(ev) => s.run({ kind: 'updateEntities', entities: [{ ...e, layer: ev.target.value }] })}>
        {doc.layerOrder.map((id) => (
          <option key={id} value={id}>
            {doc.layers[id].name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToleranceEditor({ e }: { e: DimensionEntity }) {
  const run = useStore((s) => s.run);
  const tol = e.tolerance;
  const kind = tol?.kind ?? 'none';
  const set = (tolerance: Tolerance | undefined) => {
    const next = { ...e };
    if (tolerance) next.tolerance = tolerance;
    else delete next.tolerance;
    run({ kind: 'updateEntities', entities: [next] });
  };
  const change = (k: string) => {
    switch (k) {
      case 'none':
        return set(undefined);
      case 'deviation':
        return set({ kind: 'deviation', upper: 0.1, lower: -0.1 });
      case 'symmetric':
        return set({ kind: 'symmetric', value: 0.1 });
      case 'limits':
        return set({ kind: 'limits', upper: 0, lower: 0 });
      case 'fit':
        return set({ kind: 'fit', cls: e.kind === 'diameter' || e.kind === 'radius' ? 'H7' : 'h7' });
    }
  };
  return (
    <>
      <label className="field">
        <span>{t('Tolerance')}</span>
        <select value={kind} onChange={(ev) => change(ev.target.value)}>
          <option value="none">{t('None')}</option>
          <option value="deviation">{t('Deviations (+/−)')}</option>
          <option value="symmetric">{t('Symmetric (±)')}</option>
          <option value="limits">{t('Limits')}</option>
          <option value="fit">{t('ISO 286 fit (H7, g6…)')}</option>
        </select>
      </label>
      {tol?.kind === 'deviation' && (
        <>
          <NumberField label={t('Upper')} value={tol.upper} allowNegative onCommit={(upper) => set({ ...tol, upper })} />
          <NumberField label={t('Lower')} value={tol.lower} allowNegative onCommit={(lower) => set({ ...tol, lower })} />
        </>
      )}
      {tol?.kind === 'symmetric' && <NumberField label={t('± value')} value={tol.value} min={0} onCommit={(value) => set({ ...tol, value })} />}
      {tol?.kind === 'limits' && (
        <>
          <NumberField label={t('Upper limit')} value={tol.upper} onCommit={(upper) => set({ ...tol, upper })} />
          <NumberField label={t('Lower limit')} value={tol.lower} onCommit={(lower) => set({ ...tol, lower })} />
        </>
      )}
      {tol?.kind === 'fit' && <TextField label={t('Class')} value={tol.cls} placeholder="H7" onCommit={(cls) => /^[A-Za-z]{1,2}\d{1,2}$/.test(cls.trim()) && set({ ...tol, cls: cls.trim() })} />}
    </>
  );
}

function EntityProps({ e }: { e: Entity }) {
  const s = useStore();
  const update = (next: Entity) => s.run({ kind: 'updateEntities', entities: [next] });
  const title: Record<Entity['type'], string> = {
    line: t('Line'),
    circle: t('Circle'),
    arc: t('Arc'),
    polyline: t('Polyline'),
    ellipse: t('Ellipse'),
    spline: t('Spline'),
    text: t('Text'),
    dimension: t('Dimension'),
    note: t('Note'),
    balloon: t('Balloon'),
    surface: t('Surface texture'),
    gdt: t('Geometrical tolerance'),
    datum: t('Datum'),
  };
  return (
    <div className="props">
      <h3>{title[e.type]}</h3>
      <LayerField e={e} />
      {e.type === 'line' && (
        <>
          <NumberField label={t('Start X')} value={e.a.x} onCommit={(x) => update({ ...e, a: { ...e.a, x } })} />
          <NumberField label={t('Start Y')} value={e.a.y} onCommit={(y) => update({ ...e, a: { ...e.a, y } })} />
          <NumberField label={t('End X')} value={e.b.x} onCommit={(x) => update({ ...e, b: { ...e.b, x } })} />
          <NumberField label={t('End Y')} value={e.b.y} onCommit={(y) => update({ ...e, b: { ...e.b, y } })} />
          <div className="readout">
            <span>{t('Length')}</span>
            <span className="mono">{formatLength(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y))}</span>
          </div>
        </>
      )}
      {(e.type === 'circle' || e.type === 'arc') && (
        <>
          <NumberField label={t('Centre X')} value={e.center.x} onCommit={(x) => update({ ...e, center: { ...e.center, x } })} />
          <NumberField label={t('Centre Y')} value={e.center.y} onCommit={(y) => update({ ...e, center: { ...e.center, y } })} />
          <NumberField label={t('Radius')} value={e.radius} min={1e-9} onCommit={(radius) => update({ ...e, radius })} />
          <div className="readout">
            <span>{t('Diameter')}</span>
            <span className="mono">{formatLength(e.radius * 2)}</span>
          </div>
        </>
      )}
      {e.type === 'arc' && (
        <div className="readout">
          <span>{t('Angles')}</span>
          <span className="mono">
            {((e.start * 180) / Math.PI).toFixed(2)}° → {((e.end * 180) / Math.PI).toFixed(2)}°
          </span>
        </div>
      )}
      {e.type === 'polyline' && (
        <>
          <div className="readout">
            <span>{t('Points')}</span>
            <span className="mono">{e.points.length}</span>
          </div>
          <label className="field">
            <span>{t('Closed')}</span>
            <input type="checkbox" checked={e.closed} onChange={(ev) => update({ ...e, closed: ev.target.checked })} />
          </label>
        </>
      )}
      {e.type === 'ellipse' && (
        <>
          <NumberField label={t('Centre X')} value={e.center.x} onCommit={(x) => update({ ...e, center: { ...e.center, x } })} />
          <NumberField label={t('Centre Y')} value={e.center.y} onCommit={(y) => update({ ...e, center: { ...e.center, y } })} />
          <div className="readout">
            <span>{t('Axes')}</span>
            <span className="mono">
              {formatLength(2 * Math.hypot(e.major.x, e.major.y))} × {formatLength(2 * Math.hypot(e.major.x, e.major.y) * e.ratio)}
            </span>
          </div>
        </>
      )}
      {e.type === 'text' && (
        <>
          <TextField label={t('Text')} value={e.text} onCommit={(text) => text && update({ ...e, text })} />
          <NumberField label={t('Height')} value={e.height} min={1e-6} onCommit={(height) => update({ ...e, height })} />
          <NumberField label={t('Rotation')} value={(e.rotation * 180) / Math.PI} unit="°" allowNegative onCommit={(deg) => update({ ...e, rotation: (deg * Math.PI) / 180 })} />
        </>
      )}
      {e.type === 'dimension' && (
        <>
          <div className="readout">
            <span>{t('Kind')}</span>
            <span className="mono">{e.kind}</span>
          </div>
          <TextField label={t('Text')} value={e.text ?? ''} placeholder="<>" onCommit={(text) => update(text.trim() ? { ...e, text } : withoutKey(e, 'text'))} />
          <TextField label={t('Prefix')} value={e.prefix ?? ''} placeholder={e.kind === 'diameter' ? 'Ø' : ''} onCommit={(prefix) => update(prefix ? { ...e, prefix } : withoutKey(e, 'prefix'))} />
          <TextField label={t('Suffix')} value={e.suffix ?? ''} onCommit={(suffix) => update(suffix ? { ...e, suffix } : withoutKey(e, 'suffix'))} />
          <label className="field">
            <span>{t('Decimals')}</span>
            <select value={e.decimals ?? -1} onChange={(ev) => update(ev.target.value === '-1' ? withoutKey(e, 'decimals') : { ...e, decimals: Number(ev.target.value) })}>
              <option value={-1}>{t('Style default ({n})', { n: s.editor.doc.dimStyle.decimals })}</option>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <ToleranceEditor e={e} />
        </>
      )}
      {e.type === 'note' && (
        <>
          <TextField label={t('Text')} value={e.text} multiline onCommit={(text) => text.trim() && update({ ...e, text })} />
          <NumberField label={t('Height')} value={e.height} min={1e-6} onCommit={(height) => update({ ...e, height })} />
        </>
      )}
      {e.type === 'balloon' && <TextField label={t('Item')} value={e.text} onCommit={(text) => text.trim() && update({ ...e, text: text.trim() })} />}
      {e.type === 'surface' && (
        <>
          <label className="field">
            <span>{t('Removal')}</span>
            <select value={e.removal} onChange={(ev) => update({ ...e, removal: ev.target.value as typeof e.removal })}>
              <option value="any">{t('Any process')}</option>
              <option value="required">{t('Removal required')}</option>
              <option value="prohibited">{t('Removal prohibited')}</option>
            </select>
          </label>
          <NumberField label="Ra" value={e.ra ?? 0} unit="µm" min={0} onCommit={(ra) => update(ra > 0 ? { ...e, ra } : withoutKey(e, 'ra'))} />
          <TextField label={t('Requirement')} value={e.text ?? ''} onCommit={(text) => update(text.trim() ? { ...e, text: text.trim() } : withoutKey(e, 'text'))} />
        </>
      )}
      {e.type === 'gdt' && (
        <>
          <label className="field">
            <span>{t('Characteristic')}</span>
            <select value={e.characteristic} onChange={(ev) => update({ ...e, characteristic: ev.target.value })}>
              {Object.keys(GDT_SYMBOLS).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <TextField label={t('Tolerance')} value={e.tolerance} onCommit={(tolerance) => tolerance.trim() && update({ ...e, tolerance: tolerance.trim() })} />
          <TextField label={t('Datums')} value={e.datums.join(' ')} placeholder="A B" onCommit={(d) => update({ ...e, datums: d.toUpperCase().split(/[\s,;-]+/).filter(Boolean).slice(0, 3) })} />
        </>
      )}
      {e.type === 'datum' && <TextField label={t('Label')} value={e.label} onCommit={(label) => /^[A-Za-z]{1,2}$/.test(label.trim()) && update({ ...e, label: label.trim().toUpperCase() })} />}
      <div className="readout dim">
        <span>id</span>
        <span className="mono">{e.id}</span>
      </div>
    </div>
  );
}

function withoutKey<T extends object, K extends keyof T>(obj: T, key: K): T {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function DimStyleProps() {
  const s = useStore();
  const st = s.editor.doc.dimStyle;
  const set = (patch: Partial<DimStyle>) => s.run({ kind: 'setDimStyle', style: { ...st, ...patch } });
  const scales = [
    [10, '10:1'],
    [5, '5:1'],
    [2, '2:1'],
    [1, '1:1'],
    [0.5, '1:2'],
    [0.2, '1:5'],
    [0.1, '1:10'],
    [0.05, '1:20'],
    [0.02, '1:50'],
    [0.01, '1:100'],
  ] as const;
  return (
    <>
      <h3>{t('Dimension style')}</h3>
      <NumberField label={t('Text height')} value={st.textHeight} min={0.1} onCommit={(textHeight) => set({ textHeight })} />
      <NumberField label={t('Arrow size')} value={st.arrowSize} min={0.1} onCommit={(arrowSize) => set({ arrowSize })} />
      <label className="field">
        <span>{t('Arrowhead')}</span>
        <select value={st.arrowhead} onChange={(ev) => set({ arrowhead: ev.target.value as DimStyle['arrowhead'] })}>
          <option value="closed-filled">{t('Closed filled (ISO)')}</option>
          <option value="open">{t('Open')}</option>
          <option value="oblique">{t('Oblique stroke')}</option>
          <option value="dot">{t('Dot')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('Decimals')}</span>
        <select value={st.decimals} onChange={(ev) => set({ decimals: Number(ev.target.value) })}>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('Annotation scale')}</span>
        <select value={String(st.annotationScale)} onChange={(ev) => set({ annotationScale: Number(ev.target.value) })}>
          {scales.map(([v, label]) => (
            <option key={label} value={String(v)}>
              {label}
            </option>
          ))}
          {!scales.some(([v]) => v === st.annotationScale) && <option value={String(st.annotationScale)}>{st.annotationScale}</option>}
        </select>
      </label>
      <p className="dim">{t('Sizes are paper millimetres (ISO 3098 lettering 3.5 mm); the annotation scale keeps them right for a view at that scale.')}</p>
    </>
  );
}

function DocumentProps() {
  const s = useStore();
  const doc = s.editor.doc;
  const counts = countByType(doc);
  const [name, setName] = useState(doc.name);
  useEffect(() => setName(doc.name), [doc.name]);
  return (
    <div className="props">
      <h3>{t('Drawing')}</h3>
      <label className="field">
        <span>{t('Name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== doc.name && s.run({ kind: 'setProps', props: { name: name.trim() } })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </label>
      <label className="field">
        <span>{t('Standard')}</span>
        <select value={doc.standard} onChange={(e) => s.run({ kind: 'setProps', props: { standard: e.target.value as Standard } })}>
          <option value="iso">ISO</option>
          <option value="asme">ASME</option>
        </select>
      </label>
      <label className="field">
        <span>{t('Projection')}</span>
        <select value={doc.projection} onChange={(e) => s.run({ kind: 'setProps', props: { projection: e.target.value as Projection } })}>
          <option value="first">{t('First angle (ISO 5456-2)')}</option>
          <option value="third">{t('Third angle')}</option>
        </select>
      </label>
      <div className="readout">
        <span>{t('Unit')}</span>
        <span className="mono">mm</span>
      </div>
      <div className="readout">
        <span>{t('Entities')}</span>
        <span className="mono">{doc.entityOrder.length}</span>
      </div>
      {Object.entries(counts).map(([type, n]) => (
        <div className="readout dim" key={type}>
          <span>{type}</span>
          <span className="mono">{n}</span>
        </div>
      ))}
      {doc.description && <p className="dim">{doc.description}</p>}
      {s.filePath && (
        <div className="readout dim">
          <span>{t('File')}</span>
          <span className="mono path">{s.filePath}</span>
        </div>
      )}
      <DimStyleProps />
    </div>
  );
}

export function PropertiesPanel() {
  const selection = useStore((s) => s.selection);
  const doc = useStore((s) => s.editor.doc);
  if (selection.length === 1 && doc.entities[selection[0]]) return <EntityProps e={doc.entities[selection[0]]} />;
  if (selection.length > 1) {
    return (
      <div className="props">
        <h3>{t('{n} selected', { n: selection.length })}</h3>
        <p className="dim">{t('Select one entity to edit its values. Press Delete to remove the selection.')}</p>
      </div>
    );
  }
  return <DocumentProps />;
}
