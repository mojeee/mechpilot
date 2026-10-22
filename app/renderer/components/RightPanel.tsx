// Right panel: Properties, Layers and (from M7) Checks as tabs.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { SheetsPanel } from './SheetsPanel';
import { ChecksPanel } from './ChecksPanel';
import { FeaturesPanel } from './FeaturesPanel';
import { useStore } from '../state/store';

type Tab = 'properties' | 'layers' | 'sheets' | 'features' | 'checks';

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('properties');
  const activeSheet = useStore((s) => s.activeSheet);
  // Switching to a sheet shows its settings.
  const activePart = useStore((s) => s.activePart);
  useEffect(() => {
    if (activeSheet) setTab('sheets');
  }, [activeSheet]);
  useEffect(() => {
    if (activePart) setTab('features');
  }, [activePart]);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'properties', label: t('Properties') },
    { id: 'layers', label: t('Layers') },
    { id: 'sheets', label: t('Sheets') },
    { id: 'features', label: t('Features') },
    { id: 'checks', label: t('Checks') },
  ];
  return (
    <aside className="right-panel">
      <div className="tabs" role="tablist">
        {tabs.map((tb) => (
          <button key={tb.id} role="tab" aria-selected={tab === tb.id} className={`tab ${tab === tb.id ? 'on' : ''}`} onClick={() => setTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'properties' && <PropertiesPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'sheets' && <SheetsPanel />}
        {tab === 'features' && <FeaturesPanel />}
        {tab === 'checks' && <ChecksPanel />}
      </div>
    </aside>
  );
}
