// Layers: visibility, lock, colour, ISO 128-2 line type and width, the active layer. Every change
// is a command.

import { t } from '@shared/i18n';
import { LINE_TYPES, LINE_WIDTHS } from '@shared/library';
import type { Layer } from '@shared/doc/types';
import { randomId } from '@shared/ids';
import { useStore } from '../state/store';

export function LayersPanel() {
  const s = useStore();
  const doc = s.editor.doc;
  const update = (l: Layer) => s.run({ kind: 'updateLayer', layer: l });
  const counts: Record<string, number> = {};
  for (const id of doc.entityOrder) counts[doc.entities[id].layer] = (counts[doc.entities[id].layer] ?? 0) + 1;
  const addLayer = () => {
    const n = doc.layerOrder.length + 1;
    const layer: Layer = { id: randomId(), name: t('Layer {n}', { n }), color: 'auto', lineType: '01.2', lineWidth: 0.5, visible: true, locked: false };
    if (s.run({ kind: 'addLayer', layer })) s.run({ kind: 'setActiveLayer', id: layer.id });
  };
  const remove = (id: string) => s.run({ kind: 'deleteLayer', id });
  return (
    <div className="layers">
      <div className="layers-head">
        <span className="dim">{t('{n} layers', { n: doc.layerOrder.length })}</span>
        <button className="btn small" onClick={addLayer}>
          + {t('Layer')}
        </button>
      </div>
      {doc.layerOrder.map((id) => {
        const l = doc.layers[id];
        const active = doc.activeLayer === id;
        return (
          <div key={id} className={`layer ${active ? 'active' : ''}`}>
            <button className={`dot ${active ? 'on' : ''}`} title={t('Make this the active layer')} onClick={() => s.run({ kind: 'setActiveLayer', id })} aria-label={t('Active')} />
            <input className="layer-name" value={l.name} title={t('Rename')} onChange={(e) => update({ ...l, name: e.target.value })} />
            <input type="color" className="swatch" value={l.color === 'auto' ? '#808080' : l.color} title={l.color === 'auto' ? t('Colour: automatic (canvas foreground)') : t('Colour')} onChange={(e) => update({ ...l, color: e.target.value })} />
            <button className={`icon-btn ${l.visible ? '' : 'off'}`} title={l.visible ? t('Hide') : t('Show')} onClick={() => update({ ...l, visible: !l.visible })}>
              {l.visible ? '◉' : '○'}
            </button>
            <button className={`icon-btn ${l.locked ? 'on' : ''}`} title={l.locked ? t('Unlock') : t('Lock')} onClick={() => update({ ...l, locked: !l.locked })}>
              {l.locked ? '🔒' : '🔓'}
            </button>
            <select className="line-type" value={l.lineType} title={t('Line type (ISO 128-2)')} onChange={(e) => update({ ...l, lineType: e.target.value })}>
              {LINE_TYPES.types.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.id} {lt.name}
                </option>
              ))}
            </select>
            <select className="line-width mono" value={l.lineWidth} title={t('Line width in mm (ISO 128-2 series)')} onChange={(e) => update({ ...l, lineWidth: Number(e.target.value) })}>
              {LINE_WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <span className="count mono dim">{counts[id] ?? 0}</span>
            <button className="icon-btn" title={counts[id] ? t('Move or delete its entities first') : t('Delete layer')} disabled={!!counts[id] || doc.layerOrder.length === 1} onClick={() => remove(id)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
