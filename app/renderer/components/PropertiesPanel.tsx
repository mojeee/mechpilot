// Properties: the selected entity's numbers (editable, in mm), or the drawing's settings when
// nothing is selected. Every edit is a command.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import type { Entity, Projection, Standard } from '@shared/doc/types';
import { countByType } from '@shared/doc/document';
import { formatLength, parseLength } from '@shared/units';
import { useStore } from '../state/store';

/** A number field in mm: commits on Enter or blur, rejects what is not a length. */
function NumberField({ label, value, onCommit, min }: { label: string; value: number; onCommit: (v: number) => void; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = parseLength(text);
    if (v === null || (min !== undefined && v < min)) {
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
        <span className="unit">mm</span>
      </span>
    </label>
  );
}

function EntityProps({ e }: { e: Entity }) {
  const s = useStore();
  const doc = s.editor.doc;
  const update = (next: Entity) => s.run({ kind: 'updateEntities', entities: [next] });
  return (
    <div className="props">
      <h3>{t(e.type === 'line' ? 'Line' : e.type === 'circle' ? 'Circle' : 'Arc')}</h3>
      <label className="field">
        <span>{t('Layer')}</span>
        <select value={e.layer} onChange={(ev) => update({ ...e, layer: ev.target.value })}>
          {doc.layerOrder.map((id) => (
            <option key={id} value={id}>
              {doc.layers[id].name}
            </option>
          ))}
        </select>
      </label>
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
      <div className="readout dim">
        <span>id</span>
        <span className="mono">{e.id}</span>
      </div>
    </div>
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
