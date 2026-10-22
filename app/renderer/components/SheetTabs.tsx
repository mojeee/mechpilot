// Tab strip under the top bar: Model, then one tab per sheet, "+ Sheet", then one 3D tab per part and "+ Part".

import { t } from '@shared/i18n';
import { useStore } from '../state/store';

export function SheetTabs() {
  const doc = useStore((s) => s.editor.doc);
  const active = useStore((s) => s.activeSheet);
  const setActive = useStore((s) => s.setActiveSheet);
  const addSheet = useStore((s) => s.addSheet);
  const activePart = useStore((s) => s.activePart);
  const setActivePart = useStore((s) => s.setActivePart);
  const addPart = useStore((s) => s.addPart);
  return (
    <div className="sheet-tabs" role="tablist">
      <button role="tab" aria-selected={active === null && activePart === null} className={`stab ${active === null && activePart === null ? 'on' : ''}`} onClick={() => setActive(null)}>
        {t('Model')}
      </button>
      {doc.sheetOrder.map((id) => (
        <button key={id} role="tab" aria-selected={active === id} className={`stab ${active === id ? 'on' : ''}`} onClick={() => setActive(id)}>
          {doc.sheets[id].name}
          <span className="dim"> {doc.sheets[id].size}</span>
        </button>
      ))}
      <button className="stab add" onClick={() => addSheet('A3')} title={t('Add an A3 sheet with a 1:1 view of the drawing')}>
        + {t('Sheet')}
      </button>
      <span className="stab-gap" />
      {doc.partOrder.map((id) => (
        <button key={id} role="tab" aria-selected={activePart === id} className={`stab part ${activePart === id ? 'on' : ''}`} onClick={() => setActivePart(id)} title={t('3D part')}>
          <span className="dim">3D </span>
          {doc.parts[id].name}
        </button>
      ))}
      <button className="stab add" onClick={() => setActivePart(addPart())} title={t('Add an empty 3D part; then select an outline in Model and type SKETCH')}>
        + {t('Part')}
      </button>
    </div>
  );
}
