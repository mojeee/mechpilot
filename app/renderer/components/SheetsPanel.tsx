// Sheets tab: the active sheet's size, orientation, title block (ISO 7200 fields) and views
// (scale from ISO 5455, position and size on the paper, model centre). Every change is a command.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import type { Sheet, SheetSize, SheetView } from '@shared/doc/types';
import { SCALES, SHEETS, TITLE_BLOCK, drawingSpace, scaleLabel, titleFieldName } from '@shared/draw/sheet';
import { documentBox } from '@shared/doc/document';
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

function ViewEditor({ sheet, view }: { sheet: Sheet; view: SheetView }) {
  const s = useStore();
  const update = (patch: Partial<SheetView>) => s.updateSheet({ ...sheet, views: sheet.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const remove = () => s.updateSheet({ ...sheet, views: sheet.views.filter((v) => v.id !== view.id) });
  const fit = () => {
    const box = documentBox(s.editor.doc);
    if (box) update({ center: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 } });
  };
  return (
    <div className="view-card">
      <div className="layers-head">
        <strong>{view.name}</strong>
        <button className="icon-btn" title={t('Remove this view')} onClick={remove}>
          ×
        </button>
      </div>
      <Str label={t('Name')} value={view.name} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
      <label className="field">
        <span>{t('Scale')}</span>
        <select value={String(view.scale)} onChange={(e) => update({ scale: Number(e.target.value) })}>
          {SCALES.scales.map((sc) => (
            <option key={sc.id} value={String(sc.ratio)}>
              {sc.id}
            </option>
          ))}
          {!SCALES.scales.some((sc) => sc.ratio === view.scale) && <option value={String(view.scale)}>{scaleLabel(view.scale)}</option>}
        </select>
      </label>
      <Num label={t('Centre X')} value={view.center.x} onCommit={(x) => update({ center: { ...view.center, x } })} />
      <Num label={t('Centre Y')} value={view.center.y} onCommit={(y) => update({ center: { ...view.center, y } })} />
      <button className="btn small" onClick={fit}>
        {t('Centre on the drawing')}
      </button>
      <Num label={t('Paper X')} value={view.position.x} onCommit={(x) => update({ position: { ...view.position, x } })} />
      <Num label={t('Paper Y')} value={view.position.y} onCommit={(y) => update({ position: { ...view.position, y } })} />
      <Num label={t('Width')} value={view.width} min={1} onCommit={(width) => update({ width })} />
      <Num label={t('Height')} value={view.height} min={1} onCommit={(height) => update({ height })} />
      <label className="field">
        <span>{t('Label')}</span>
        <input type="checkbox" checked={view.label} onChange={(e) => update({ label: e.target.checked })} />
      </label>
    </div>
  );
}

export function SheetsPanel() {
  const s = useStore();
  const doc = s.editor.doc;
  const lang = s.settings.lang;
  const sheet = s.activeSheet ? doc.sheets[s.activeSheet] : null;
  if (!sheet) {
    return (
      <div className="props">
        <h3>{t('Sheets')}</h3>
        <p className="dim">{t('A sheet puts the drawing on paper: ISO 5457 size and frame, ISO 7200 title block, views at ISO 5455 scales. Export PDF prints every sheet.')}</p>
        {doc.sheetOrder.map((id) => (
          <button key={id} className="btn small" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => s.setActiveSheet(id)}>
            {doc.sheets[id].name} · {doc.sheets[id].size}
          </button>
        ))}
        <div>
          <button className="btn small primary" onClick={() => s.addSheet('A3')}>
            + {t('Add an A3 sheet')}
          </button>
        </div>
      </div>
    );
  }
  const update = (patch: Partial<Sheet>) => s.updateSheet({ ...sheet, ...patch });
  const ds = drawingSpace(sheet);
  const addView = () => {
    const box = documentBox(doc);
    const center = box ? { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 } : { x: 0, y: 0 };
    const n = sheet.views.length + 1;
    update({ views: [...sheet.views, { id: randomId(), name: t('View {n}', { n }), scale: 1, center, position: { x: ds.x + ds.width / 2, y: ds.y + ds.height / 2 }, width: Math.min(150, ds.width - 20), height: Math.min(100, ds.height - 50), label: true }] });
  };
  return (
    <div className="props">
      <div className="layers-head">
        <h3 style={{ margin: 0 }}>{sheet.name}</h3>
        <button className="icon-btn" title={t('Delete this sheet')} onClick={() => s.deleteSheet(sheet.id)}>
          ×
        </button>
      </div>
      <Str label={t('Name')} value={sheet.name} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
      <label className="field">
        <span>{t('Size')}</span>
        <select
          value={sheet.size}
          onChange={(e) => {
            const size = e.target.value as SheetSize;
            const def = SHEETS.sizes.find((x) => x.id === size);
            update({ size, orientation: def?.orientation ?? sheet.orientation });
          }}
        >
          {SHEETS.sizes.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} ({Math.max(x.width, x.height)} × {Math.min(x.width, x.height)} mm)
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('Orientation')}</span>
        <select value={sheet.orientation} onChange={(e) => update({ orientation: e.target.value as Sheet['orientation'] })}>
          <option value="landscape">{t('Landscape')}</option>
          <option value="portrait">{t('Portrait')}</option>
        </select>
      </label>
      <h3>{t('Title block (ISO 7200)')}</h3>
      {TITLE_BLOCK.fields.map((f) => (
        <Str key={f.id} label={titleFieldName(f.id, lang) + (f.mandatory ? ' *' : '')} value={sheet.titleBlock[f.id] ?? ''} onCommit={(v) => update({ titleBlock: { ...sheet.titleBlock, [f.id]: v } })} />
      ))}
      <p className="dim">{t('* required by ISO 7200; the drawing checker (M7) will flag empty ones.')}</p>
      <div className="layers-head">
        <h3 style={{ margin: 0 }}>{t('Views')}</h3>
        <button className="btn small" onClick={addView}>
          + {t('View')}
        </button>
      </div>
      {sheet.views.map((v) => (
        <ViewEditor key={v.id} sheet={sheet} view={v} />
      ))}
      <div style={{ marginTop: 12 }}>
        <button className="btn small primary" onClick={() => void s.exportPdf()}>
          {t('Export PDF…')}
        </button>
      </div>
    </div>
  );
}
