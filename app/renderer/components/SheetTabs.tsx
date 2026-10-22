// Tab strip under the top bar: Model, then one tab per sheet, then "+ Sheet".

import { t } from '@shared/i18n';
import { useStore } from '../state/store';

export function SheetTabs() {
  const doc = useStore((s) => s.editor.doc);
  const active = useStore((s) => s.activeSheet);
  const setActive = useStore((s) => s.setActiveSheet);
  const addSheet = useStore((s) => s.addSheet);
  return (
    <div className="sheet-tabs" role="tablist">
      <button role="tab" aria-selected={active === null} className={`stab ${active === null ? 'on' : ''}`} onClick={() => setActive(null)}>
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
    </div>
  );
}
