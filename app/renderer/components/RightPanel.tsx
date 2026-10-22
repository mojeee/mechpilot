// Right panel: Properties, Layers, Sheets, Features, Checks and (M7) the Assistant as tabs.

import { useEffect, useState } from 'react';
import { t } from '@shared/i18n';
import { PropertiesPanel } from './PropertiesPanel';
import { LayersPanel } from './LayersPanel';
import { SheetsPanel } from './SheetsPanel';
import { ChecksPanel } from './ChecksPanel';
import { FeaturesPanel } from './FeaturesPanel';
import { AssistantPanel } from './AssistantPanel';
import { useStore } from '../state/store';

type Tab = 'properties' | 'layers' | 'sheets' | 'features' | 'checks' | 'assistant';

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('properties');
  const activeSheet = useStore((s) => s.activeSheet);
  // Switching to a sheet shows its settings.
  const activePart = useStore((s) => s.activePart);
  useEffect(() => {
    if (activeSheet) setTab((cur) => (cur === 'assistant' ? cur : 'sheets'));
  }, [activeSheet]);
  useEffect(() => {
    if (activePart) setTab((cur) => (cur === 'assistant' ? cur : 'features'));
  }, [activePart]);
  // Ctrl+Shift+A, the AI command and the chat buttons ask for the Assistant tab.
  const focusTick = useStore((s) => s.assistant.focusTick);
  useEffect(() => {
    if (focusTick > 0) setTab('assistant');
  }, [focusTick]);
  const pendingRefs = useStore((s) => s.assistant.references.length);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'properties', label: t('Properties') },
    { id: 'layers', label: t('Layers') },
    { id: 'sheets', label: t('Sheets') },
    { id: 'features', label: t('Features') },
    { id: 'checks', label: t('Checks') },
    { id: 'assistant', label: t('Assistant') },
  ];
  return (
    <aside className="right-panel">
      <div className="tabs" role="tablist">
        {tabs.map((tb) => (
          <button key={tb.id} role="tab" aria-selected={tab === tb.id} className={`tab ${tab === tb.id ? 'on' : ''}`} onClick={() => setTab(tb.id)}>
            {tb.label}
            {tb.id === 'assistant' && pendingRefs > 0 && tab !== 'assistant' && <span className="tab-count">{pendingRefs}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'properties' && <PropertiesPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'sheets' && <SheetsPanel />}
        {tab === 'features' && <FeaturesPanel />}
        {tab === 'checks' && <ChecksPanel />}
        {tab === 'assistant' && <AssistantPanel />}
      </div>
    </aside>
  );
}
